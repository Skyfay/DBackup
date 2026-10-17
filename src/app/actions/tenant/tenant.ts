"use server";

import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { checkPermission, currentSessionId, forgetAuthContext, getViewer } from "@/lib/auth/access-control";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { AUDIT_ACTIONS, AUDIT_RESOURCES } from "@/lib/core/audit-types";
import { ConflictError, NotFoundError, ValidationError, wrapError } from "@/lib/logging/errors";
import { logger } from "@/lib/logging/logger";
import { HOME_TENANT_ID } from "@/lib/tenant/home";
import { auditService } from "@/services/audit-service";
import { tenantService } from "@/services/tenant/tenant-service";
import { platformGroupService } from "@/services/user/platform-group-service";
import { tenantSummaries } from "@/services/tenant/tenant-summaries";
import { setAllowances } from "@/services/tenant/tenant-allowances";
import { ALLOWANCE_KINDS, ALLOWANCE_NOUNS, type TenantAllowances } from "@/lib/tenant/allowances";

const log = logger.child({ action: "tenant" });

const IdSchema = z.string().min(1).max(200);
const NameSchema = z.string().trim().min(1, "Give the tenant a name.").max(60, "The name can have at most 60 characters.");

/** The message of a refusal the user can act on, a plain one for anything else. */
const messageOf = (error: unknown, fallback: string) =>
    error instanceof ValidationError || error instanceof ConflictError || error instanceof NotFoundError ? error.message : fallback;

/** A change of the tenants is the platform's, so its entry goes into the log of the home tenant. */
const PLATFORM = { tenantId: HOME_TENANT_ID };

/**
 * Whether the viewer may manage this tenant: a platform admin every tenant, anyone else the
 * tenants their platform group reaches. Being a member of a tenant gives no right on the platform.
 * One they may not reads as gone.
 */
async function managesTenant(viewer: { id: string; isPlatformAdmin: boolean }, tenantId: string): Promise<boolean> {
    return viewer.isPlatformAdmin || platformGroupService.reaches(viewer.id, tenantId);
}

/**
 * Makes the session of the viewer work in another tenant. Every page shows that tenant from the
 * next request on.
 * @no-permission-required - switches the viewer's own session, to a tenant they are a member of
 */
export async function switchTenant(tenantId: string) {
    const viewer = await getViewer();
    if (!viewer) return { success: false as const, error: "Unauthorized" };
    const id = IdSchema.safeParse(tenantId);
    const sessionId = await currentSessionId();
    if (!id.success || !sessionId) return { success: false as const, error: "Invalid request" };

    try {
        const tenant = await tenantService.setActive(sessionId, viewer.id, id.data, viewer.isPlatformAdmin);
        forgetAuthContext(await headers());
        revalidatePath("/dashboard", "layout");
        return { success: true as const, data: { id: tenant.id, name: tenant.name } };
    } catch (error: unknown) {
        return { success: false as const, error: messageOf(error, "The tenant could not be opened.") };
    }
}

/**
 * The jobs, the databases and the health of the tenants the viewer may open, which the switcher,
 * the Overview of All tenants and the Tenants page show to whoever may see the tenants.
 */
export async function getTenantSummaries() {
    const viewer = await checkPermission(PERMISSIONS.PLATFORM.TENANTS_READ);
    try {
        const tenants = await tenantService.switchable(viewer.id, viewer.isPlatformAdmin);
        return { success: true as const, data: await tenantSummaries(tenants.map((tenant) => tenant.id)) };
    } catch (error: unknown) {
        log.error("Reading the tenant summaries failed", {}, wrapError(error));
        return { success: false as const, error: "The tenants could not be read." };
    }
}

/**
 * Creates a tenant with the built-in templates, for whoever may manage the tenants. A tenant of the
 * MSP whose servers give databases to customers says so with `sharesWithCustomers`.
 */
export async function createTenant(name: string, sharesWithCustomers = false) {
    const viewer = await checkPermission(PERMISSIONS.PLATFORM.TENANTS_WRITE);
    const parsed = NameSchema.safeParse(name);
    if (!parsed.success) return { success: false as const, error: parsed.error.issues[0]?.message ?? "Invalid request" };
    if (typeof sharesWithCustomers !== "boolean") return { success: false as const, error: "Invalid request" };
    // A platform group of some tenants would never reach the tenant it made.
    if (!viewer.isPlatformAdmin && !(await platformGroupService.reachesAll(viewer.id))) {
        return { success: false as const, error: "Your platform group reaches some tenants only, so a new one would be out of your reach. A platform admin creates it." };
    }

    try {
        const tenant = await tenantService.create(parsed.data, sharesWithCustomers);
        await auditService.log(viewer.id, AUDIT_ACTIONS.CREATE, AUDIT_RESOURCES.TENANT, { name: tenant.name, ...(sharesWithCustomers ? { sharesWithCustomers } : {}) }, tenant.id, PLATFORM);
        revalidatePath("/dashboard", "layout");
        return { success: true as const, data: tenant };
    } catch (error: unknown) {
        log.error("Creating a tenant failed", {}, wrapError(error));
        return { success: false as const, error: messageOf(error, "The tenant could not be created.") };
    }
}

/**
 * Switches whether a tenant shares with customers, its databases, destinations and channels, for
 * whoever may manage the tenants and reaches this one. Who shares is the right Share with customers.
 */
export async function setTenantSharing(id: string, on: boolean) {
    const viewer = await checkPermission(PERMISSIONS.PLATFORM.TENANTS_WRITE);
    const tenantId = IdSchema.safeParse(id);
    if (!tenantId.success || typeof on !== "boolean") return { success: false as const, error: "Invalid request" };
    if (!(await managesTenant(viewer, tenantId.data))) return { success: false as const, error: "The tenant no longer exists." };

    try {
        const change = await tenantService.setSharing(tenantId.data, on);
        if (change.changed) {
            await auditService.log(viewer.id, AUDIT_ACTIONS.UPDATE, AUDIT_RESOURCES.TENANT, { name: change.name, change: on ? "Shares with customers" : "Shares nothing with customers" }, tenantId.data, PLATFORM);
        }
        revalidatePath("/dashboard", "layout");
        return { success: true as const };
    } catch (error: unknown) {
        if (!(error instanceof ValidationError || error instanceof NotFoundError)) log.error("Switching the sharing of a tenant failed", { tenantId: tenantId.data }, wrapError(error));
        return { success: false as const, error: messageOf(error, "The tenant could not be changed.") };
    }
}

const AllowancesSchema = z.object({
    databases: z.boolean(),
    directorySources: z.boolean(),
    destinations: z.boolean(),
    channels: z.boolean(),
    apiKeys: z.boolean(),
}).partial();

/**
 * Sets what a tenant may add itself: database connections, directory sources, destinations and
 * channels, for whoever may manage the tenants and reaches this one. What it has keeps working.
 */
export async function setTenantAllowances(id: string, allowances: Partial<TenantAllowances>) {
    const viewer = await checkPermission(PERMISSIONS.PLATFORM.TENANTS_WRITE);
    const tenantId = IdSchema.safeParse(id);
    const patch = AllowancesSchema.safeParse(allowances);
    if (!tenantId.success || !patch.success) return { success: false as const, error: "Invalid request" };
    if (!(await managesTenant(viewer, tenantId.data))) return { success: false as const, error: "The tenant no longer exists." };

    try {
        const change = await setAllowances(tenantId.data, patch.data);
        const changes = ALLOWANCE_KINDS.filter((kind) => change.before[kind] !== change.after[kind])
            .map((kind) => ({ field: `Adds ${ALLOWANCE_NOUNS[kind]}`, from: change.before[kind] ? "Yes" : "No", to: change.after[kind] ? "Yes" : "No" }));
        if (changes.length > 0) {
            // The platform's change, and one the tenant learns of in its own log.
            await auditService.log(viewer.id, AUDIT_ACTIONS.UPDATE, AUDIT_RESOURCES.TENANT, { name: change.name, changes }, tenantId.data, PLATFORM);
            await auditService.log(viewer.id, AUDIT_ACTIONS.UPDATE, AUDIT_RESOURCES.TENANT, { name: change.name, changes }, tenantId.data, { tenantId: tenantId.data });
        }
        revalidatePath("/dashboard", "layout");
        return { success: true as const };
    } catch (error: unknown) {
        if (!(error instanceof ValidationError || error instanceof NotFoundError)) log.error("Changing what a tenant may add failed", { tenantId: tenantId.data }, wrapError(error));
        return { success: false as const, error: messageOf(error, "The tenant could not be changed.") };
    }
}

export async function renameTenant(id: string, name: string) {
    const viewer = await checkPermission(PERMISSIONS.PLATFORM.TENANTS_WRITE);
    const tenantId = IdSchema.safeParse(id);
    const parsed = NameSchema.safeParse(name);
    if (!tenantId.success || !parsed.success) return { success: false as const, error: parsed.error?.issues[0]?.message ?? "Invalid request" };
    if (!(await managesTenant(viewer, tenantId.data))) return { success: false as const, error: "The tenant no longer exists." };

    try {
        const change = await tenantService.rename(tenantId.data, parsed.data);
        if (change.name !== change.renamedFrom) {
            await auditService.log(viewer.id, AUDIT_ACTIONS.UPDATE, AUDIT_RESOURCES.TENANT, { name: change.name, renamedFrom: change.renamedFrom }, tenantId.data, PLATFORM);
        }
        revalidatePath("/dashboard", "layout");
        return { success: true as const };
    } catch (error: unknown) {
        log.error("Renaming a tenant failed", { tenantId: tenantId.data }, wrapError(error));
        return { success: false as const, error: messageOf(error, "The tenant could not be renamed.") };
    }
}

/**
 * Deletes a tenant with everything it holds. The backups at its destinations stay, and so do the
 * accounts, which lose their membership there.
 */
export async function deleteTenant(id: string) {
    const viewer = await checkPermission(PERMISSIONS.PLATFORM.TENANTS_WRITE);
    const tenantId = IdSchema.safeParse(id);
    if (!tenantId.success) return { success: false as const, error: "Invalid request" };
    if (tenantId.data === viewer.tenantId) return { success: false as const, error: "You work in this tenant. Open another one first." };
    if (!(await managesTenant(viewer, tenantId.data))) return { success: false as const, error: "The tenant no longer exists." };

    try {
        const { withdrawn = [], ...removal } = await tenantService.delete(tenantId.data);
        await auditService.log(viewer.id, AUDIT_ACTIONS.DELETE, AUDIT_RESOURCES.TENANT, { ...removal }, tenantId.data, PLATFORM);
        // Each customer of what it shared learns in its own log what it lost with it.
        for (const loss of withdrawn) {
            await auditService.log(viewer.id, AUDIT_ACTIONS.UPDATE, loss.kind === "destination" ? AUDIT_RESOURCES.DESTINATION : AUDIT_RESOURCES.ADAPTER, {
                name: loss.name,
                action: "unshare",
                ...(loss.jobs.length > 0 ? { jobs: loss.jobs } : {}),
                ...(loss.templates.length > 0 ? { templates: loss.templates } : {}),
            }, loss.configId, { tenantId: loss.tenantId });
        }
        revalidatePath("/dashboard", "layout");
        return { success: true as const, data: removal };
    } catch (error: unknown) {
        log.error("Deleting a tenant failed", { tenantId: tenantId.data }, wrapError(error));
        return { success: false as const, error: messageOf(error, "The tenant could not be deleted.") };
    }
}
