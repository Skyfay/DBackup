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
import { tenantSummaries } from "@/services/tenant/tenant-summaries";

const log = logger.child({ action: "tenant" });

const IdSchema = z.string().min(1).max(200);
const NameSchema = z.string().trim().min(1, "Give the tenant a name.").max(60, "The name can have at most 60 characters.");

/** The message of a refusal the user can act on, a plain one for anything else. */
const messageOf = (error: unknown, fallback: string) =>
    error instanceof ValidationError || error instanceof ConflictError || error instanceof NotFoundError ? error.message : fallback;

/** A change of the tenants is the platform's, so its entry goes into the log of the home tenant. */
const PLATFORM = { tenantId: HOME_TENANT_ID };

/**
 * Whether the viewer may manage this tenant: a platform admin every tenant, anyone else of a
 * platform group the tenants they may open. One they may not reads as gone.
 */
async function managesTenant(viewer: { id: string; isPlatformAdmin: boolean }, tenantId: string): Promise<boolean> {
    if (viewer.isPlatformAdmin) return true;
    return (await tenantService.switchable(viewer.id, false)).some((tenant) => tenant.id === tenantId);
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
        return { success: true as const, data: { name: tenant.name } };
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

/** Creates a tenant with the built-in templates, for whoever may manage the tenants. */
export async function createTenant(name: string) {
    const viewer = await checkPermission(PERMISSIONS.PLATFORM.TENANTS_WRITE);
    const parsed = NameSchema.safeParse(name);
    if (!parsed.success) return { success: false as const, error: parsed.error.issues[0]?.message ?? "Invalid request" };

    try {
        const tenant = await tenantService.create(parsed.data);
        await auditService.log(viewer.id, AUDIT_ACTIONS.CREATE, AUDIT_RESOURCES.TENANT, { name: tenant.name }, tenant.id, PLATFORM);
        revalidatePath("/dashboard", "layout");
        return { success: true as const, data: tenant };
    } catch (error: unknown) {
        log.error("Creating a tenant failed", {}, wrapError(error));
        return { success: false as const, error: messageOf(error, "The tenant could not be created.") };
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
        const removal = await tenantService.delete(tenantId.data);
        await auditService.log(viewer.id, AUDIT_ACTIONS.DELETE, AUDIT_RESOURCES.TENANT, { ...removal }, tenantId.data, PLATFORM);
        revalidatePath("/dashboard", "layout");
        return { success: true as const, data: removal };
    } catch (error: unknown) {
        log.error("Deleting a tenant failed", { tenantId: tenantId.data }, wrapError(error));
        return { success: false as const, error: messageOf(error, "The tenant could not be deleted.") };
    }
}
