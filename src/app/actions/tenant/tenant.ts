"use server";

import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { checkPermission, currentSessionId, forgetAuthContext, getViewer } from "@/lib/auth/access-control";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { ConflictError, NotFoundError, PermissionError, ValidationError, wrapError } from "@/lib/logging/errors";
import { logger } from "@/lib/logging/logger";
import { tenantService } from "@/services/tenant/tenant-service";
import { tenantSummaries } from "@/services/tenant/tenant-summaries";
import type { TenantNetwork } from "@/services/tenant/tenant-network";
import type { TenantAllowances } from "@/lib/tenant/allowances";
import { AllowancesSchema, NetworkSchema, TenantNameSchema } from "@/lib/tenant/tenant-schemas";
import {
    createTenantAs, deleteRefusal, deleteTenantAs, removeTenantAs, renameTenantAs, setTenantAllowancesAs, setTenantNetworkAs, setTenantSharingAs, TenantNotEmptyError, type TenantAdminActor,
} from "@/services/tenant/tenant-admin";
import { emptyBulkResult } from "@/lib/core/bulk";
import { BulkIdsSchema } from "@/lib/core/bulk-schema";
import { isEmptyTenant, tenantContents } from "@/services/tenant/tenant-contents";

const log = logger.child({ action: "tenant" });

const IdSchema = z.string().min(1).max(200);

/** A refusal the user can act on, which is no failure for the log. */
const isRefusal = (error: unknown) =>
    error instanceof ValidationError || error instanceof ConflictError || error instanceof NotFoundError || error instanceof PermissionError;

/** The message of a refusal the user can act on, a plain one for anything else. */
const messageOf = (error: unknown, fallback: string) => (isRefusal(error) ? (error as Error).message : fallback);

/**
 * The viewer as the rules of `tenant-admin.ts` read them. Whether they look after a tenant is the
 * reach of their platform group, which those rules read per check.
 */
const actorOf = (viewer: { id: string; isPlatformAdmin: boolean; tenantId: string | null }): TenantAdminActor => ({ id: viewer.id, isPlatformAdmin: viewer.isPlatformAdmin, tenantId: viewer.tenantId });

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
    const parsed = TenantNameSchema.safeParse(name);
    if (!parsed.success) return { success: false as const, error: parsed.error.issues[0]?.message ?? "Invalid request" };
    if (typeof sharesWithCustomers !== "boolean") return { success: false as const, error: "Invalid request" };

    try {
        const tenant = await createTenantAs(actorOf(viewer), parsed.data, sharesWithCustomers);
        revalidatePath("/dashboard", "layout");
        return { success: true as const, data: tenant };
    } catch (error: unknown) {
        if (!isRefusal(error)) log.error("Creating a tenant failed", {}, wrapError(error));
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

    try {
        await setTenantSharingAs(actorOf(viewer), tenantId.data, on);
        revalidatePath("/dashboard", "layout");
        return { success: true as const };
    } catch (error: unknown) {
        if (!isRefusal(error)) log.error("Switching the sharing of a tenant failed", { tenantId: tenantId.data }, wrapError(error));
        return { success: false as const, error: messageOf(error, "The tenant could not be changed.") };
    }
}

/**
 * Sets what a tenant may add itself: database connections, directory sources, destinations and
 * channels, for whoever may manage the tenants and reaches this one. What it has keeps working.
 */
export async function setTenantAllowances(id: string, allowances: Partial<TenantAllowances>) {
    const viewer = await checkPermission(PERMISSIONS.PLATFORM.TENANTS_WRITE);
    const tenantId = IdSchema.safeParse(id);
    const patch = AllowancesSchema.safeParse(allowances);
    if (!tenantId.success || !patch.success) return { success: false as const, error: "Invalid request" };

    try {
        await setTenantAllowancesAs(actorOf(viewer), tenantId.data, patch.data);
        revalidatePath("/dashboard", "layout");
        return { success: true as const };
    } catch (error: unknown) {
        if (!isRefusal(error)) log.error("Changing what a tenant may add failed", { tenantId: tenantId.data }, wrapError(error));
        return { success: false as const, error: messageOf(error, "The tenant could not be changed.") };
    }
}

/**
 * Sets whether the connections of a tenant reach the local network of the server DBackup runs on,
 * and the ranges they reach anyway, for whoever may manage the tenants and reaches this one. Never
 * for the home tenant, which is the platform, nor for All tenants, which is no tenant.
 */
export async function setTenantNetwork(id: string, network: TenantNetwork) {
    const viewer = await checkPermission(PERMISSIONS.PLATFORM.TENANTS_WRITE);
    const tenantId = IdSchema.safeParse(id);
    const input = NetworkSchema.safeParse(network);
    if (!tenantId.success) return { success: false as const, error: "Invalid request" };
    if (!input.success) return { success: false as const, error: input.error.issues[0]?.message ?? "Invalid request" };

    try {
        await setTenantNetworkAs(actorOf(viewer), tenantId.data, input.data);
        revalidatePath("/dashboard", "layout");
        return { success: true as const };
    } catch (error: unknown) {
        if (!isRefusal(error)) log.error("Changing the network of a tenant failed", { tenantId: tenantId.data }, wrapError(error));
        return { success: false as const, error: messageOf(error, "The tenant could not be changed.") };
    }
}

export async function renameTenant(id: string, name: string) {
    const viewer = await checkPermission(PERMISSIONS.PLATFORM.TENANTS_WRITE);
    const tenantId = IdSchema.safeParse(id);
    const parsed = TenantNameSchema.safeParse(name);
    if (!tenantId.success || !parsed.success) return { success: false as const, error: parsed.error?.issues[0]?.message ?? "Invalid request" };

    try {
        await renameTenantAs(actorOf(viewer), tenantId.data, parsed.data);
        revalidatePath("/dashboard", "layout");
        return { success: true as const };
    } catch (error: unknown) {
        if (!isRefusal(error)) log.error("Renaming a tenant failed", { tenantId: tenantId.data }, wrapError(error));
        return { success: false as const, error: messageOf(error, "The tenant could not be renamed.") };
    }
}

/** What the delete of a tenant that holds something answers before the dialog confirmed it. */
const DELETE_NOT_CONFIRMED = "It holds connections, jobs or people, or keys, API keys or entries in Recently deleted. Confirm what goes with it first.";

/**
 * Deletes a tenant with everything it holds. The backups at its destinations stay, and so do the
 * accounts, which lose their membership there. Refused while a run of the tenant waits or runs,
 * and for a tenant that holds anything until the dialog that lists it confirmed it, the same gate
 * as `DELETE /api/tenants/[id]` (`deleteTenantAs`).
 */
export async function deleteTenant(id: string, confirmed = false) {
    const viewer = await checkPermission(PERMISSIONS.PLATFORM.TENANTS_WRITE);
    const tenantId = IdSchema.safeParse(id);
    if (!tenantId.success || typeof confirmed !== "boolean") return { success: false as const, error: "Invalid request" };

    try {
        const removal = await deleteTenantAs(actorOf(viewer), tenantId.data, confirmed);
        revalidatePath("/dashboard", "layout");
        return { success: true as const, data: removal };
    } catch (error: unknown) {
        if (error instanceof TenantNotEmptyError) return { success: false as const, error: DELETE_NOT_CONFIRMED };
        if (!isRefusal(error)) log.error("Deleting a tenant failed", { tenantId: tenantId.data }, wrapError(error));
        return { success: false as const, error: messageOf(error, "The tenant could not be deleted.") };
    }
}

/**
 * Deletes several empty tenants at once: no connection, no job, nobody working in them, no key, no
 * API key and nothing in Recently deleted. One that holds any of it stays, with why, since Delete of
 * one asks first what goes with it, like the recovery kits of its keys.
 */
export async function bulkDeleteTenants(ids: string[]) {
    const viewer = await checkPermission(PERMISSIONS.PLATFORM.TENANTS_WRITE);
    const parsed = BulkIdsSchema.safeParse(ids);
    if (!parsed.success) return { success: false as const, error: "Invalid request" };

    const actor = actorOf(viewer);
    const result = emptyBulkResult();
    for (const id of parsed.data) {
        try {
            const refused = await deleteRefusal(actor, id);
            if (refused) {
                result.failed.push({ id, error: refused });
                continue;
            }
            if (!isEmptyTenant(await tenantContents(id))) {
                result.failed.push({ id, error: "It holds connections, jobs or people, or keys, API keys or entries in Recently deleted. Delete it on its own, which asks first." });
                continue;
            }
            await removeTenantAs(actor, id);
            result.succeeded.push(id);
        } catch (error: unknown) {
            if (!isRefusal(error)) log.error("Deleting a tenant failed", { tenantId: id }, wrapError(error));
            result.failed.push({ id, error: messageOf(error, "The tenant could not be deleted.") });
        }
    }
    revalidatePath("/dashboard", "layout");
    return { success: true as const, data: result };
}
