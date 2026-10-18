"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { checkPermission } from "@/lib/auth/access-control";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { diffFields } from "@/lib/core/audit-diff";
import { AUDIT_ACTIONS, AUDIT_RESOURCES } from "@/lib/core/audit-types";
import { NotFoundError, ValidationError, wrapError } from "@/lib/logging/errors";
import { logger } from "@/lib/logging/logger";
import { HOME_TENANT_ID } from "@/lib/tenant/home";
import { ON_DEMAND_MAX, ON_DEMAND_MIN } from "@/lib/tenant/sharing";
import { auditService } from "@/services/audit-service";
import { tenantOnDemandService, type TenantOnDemand } from "@/services/tenant/tenant-on-demand";
import { platformGroupService } from "@/services/user/platform-group-service";

/**
 * Backups on demand of a customer under Platform, Tenants: how many backups a day it may start of
 * every database given to it, and letting a database or a rule that sets its own follow it again.
 * Like what a tenant may add, the platform decides it, for the tenants the viewer looks after.
 */

const log = logger.child({ action: "tenant-on-demand" });

const IdSchema = z.string().min(1).max(200);
const PerDaySchema = z.coerce.number().int().min(ON_DEMAND_MIN).max(ON_DEMAND_MAX).nullable();
const PLATFORM = { tenantId: HOME_TENANT_ID };
const GONE = "The tenant no longer exists.";

const messageOf = (error: unknown, fallback: string) => (error instanceof ValidationError || error instanceof NotFoundError ? error.message : fallback);
const words = (perDay: number | null) => (perDay === null ? "Off" : perDay === 0 ? "Off here" : `${perDay} a day`);

/** Whether the viewer looks after this tenant: a platform admin every tenant, anyone else the ones their platform group reaches. */
async function reaches(viewer: { id: string; isPlatformAdmin: boolean }, tenantId: string): Promise<boolean> {
    return viewer.isPlatformAdmin || platformGroupService.reaches(viewer.id, tenantId);
}

/** The number of a customer and its databases and rules that set their own, for the dialog. */
export async function getTenantOnDemand(id: string): Promise<{ success: true; data: TenantOnDemand } | { success: false; error: string }> {
    const viewer = await checkPermission(PERMISSIONS.PLATFORM.TENANTS_READ);
    const tenantId = IdSchema.safeParse(id);
    if (!tenantId.success) return { success: false, error: "Invalid request" };
    if (!(await reaches(viewer, tenantId.data))) return { success: false, error: GONE };
    try {
        const found = await tenantOnDemandService.find(tenantId.data);
        return found ? { success: true, data: found } : { success: false, error: GONE };
    } catch (error: unknown) {
        log.error("Reading backups on demand of a tenant failed", { tenantId: tenantId.data }, wrapError(error));
        return { success: false, error: "Backups on demand could not be loaded." };
    }
}

/** Sets how many backups a day a customer may start of every database given to it, none with null. */
export async function setTenantOnDemand(id: string, perDay: number | null) {
    const viewer = await checkPermission(PERMISSIONS.PLATFORM.TENANTS_WRITE);
    const tenantId = IdSchema.safeParse(id);
    const value = PerDaySchema.safeParse(perDay);
    if (!tenantId.success || !value.success) return { success: false as const, error: value.error?.issues[0]?.message ?? "Invalid request" };
    if (!(await reaches(viewer, tenantId.data))) return { success: false as const, error: GONE };

    try {
        const change = await tenantOnDemandService.set(tenantId.data, value.data);
        if (change.before !== change.after) {
            const changes = diffFields({ perDay: words(change.before) }, { perDay: words(change.after) }, { perDay: { label: "Backups on demand" } });
            // The platform's change, and one the tenant learns of in its own log, which is the same
            // log for the home tenant.
            await auditService.log(viewer.id, AUDIT_ACTIONS.UPDATE, AUDIT_RESOURCES.TENANT, { name: change.name, changes }, tenantId.data, PLATFORM);
            if (tenantId.data !== HOME_TENANT_ID) {
                await auditService.log(viewer.id, AUDIT_ACTIONS.UPDATE, AUDIT_RESOURCES.TENANT, { name: change.name, changes }, tenantId.data, { tenantId: tenantId.data });
            }
        }
        revalidatePath("/dashboard", "layout");
        return { success: true as const, data: change };
    } catch (error: unknown) {
        if (!(error instanceof ValidationError || error instanceof NotFoundError)) log.error("Changing backups on demand of a tenant failed", { tenantId: tenantId.data }, wrapError(error));
        return { success: false as const, error: messageOf(error, "Backups on demand could not be changed.") };
    }
}

/** Lets a database or a rule of a customer that sets its own number follow the number of the customer again. */
export async function followTenantOnDemand(id: string, kind: "database" | "rule", entryId: string) {
    const viewer = await checkPermission(PERMISSIONS.PLATFORM.TENANTS_WRITE);
    const tenantId = IdSchema.safeParse(id);
    const entry = IdSchema.safeParse(entryId);
    const what = z.enum(["database", "rule"]).safeParse(kind);
    if (!tenantId.success || !entry.success || !what.success) return { success: false as const, error: "Invalid request" };
    if (!(await reaches(viewer, tenantId.data))) return { success: false as const, error: GONE };

    try {
        const followed = await tenantOnDemandService.follow(tenantId.data, what.data, entry.data);
        const details = {
            change: "Backups on demand", tenant: followed.tenantName, server: followed.serverName,
            ...(followed.kind === "rule" ? { pattern: followed.name } : { database: followed.name }),
            changes: diffFields({ perDay: words(followed.perDay) }, { perDay: "As the tenant" }, { perDay: { label: "Backups on demand" } }),
        };
        // The change of the platform, and the tenant that shares the server learns of it in its own log.
        await auditService.log(viewer.id, AUDIT_ACTIONS.UPDATE, AUDIT_RESOURCES.ADAPTER, details, followed.sourceId, PLATFORM);
        if (followed.providerId && followed.providerId !== HOME_TENANT_ID) {
            await auditService.log(viewer.id, AUDIT_ACTIONS.UPDATE, AUDIT_RESOURCES.ADAPTER, details, followed.sourceId, { tenantId: followed.providerId });
        }
        revalidatePath("/dashboard", "layout");
        return { success: true as const };
    } catch (error: unknown) {
        if (!(error instanceof ValidationError || error instanceof NotFoundError)) log.error("Letting a database follow its tenant failed", { tenantId: tenantId.data }, wrapError(error));
        return { success: false as const, error: messageOf(error, "Backups on demand could not be changed.") };
    }
}
