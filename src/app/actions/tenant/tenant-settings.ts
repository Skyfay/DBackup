"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { checkPermission, type Viewer } from "@/lib/auth/access-control";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { AUDIT_ACTIONS, AUDIT_RESOURCES } from "@/lib/core/audit-types";
import { ConflictError, NotFoundError, ValidationError, wrapError } from "@/lib/logging/errors";
import { logger } from "@/lib/logging/logger";
import { HOME_TENANT_ID } from "@/lib/tenant/home";
import { auditService } from "@/services/audit-service";
import { sendTenantEventTest } from "@/services/notifications/tenant-notification-delivery";
import { saveTenantDefaultChannels, saveTenantEventSettings, type TenantNotificationConfig } from "@/services/notifications/tenant-notification-settings";
import type { SaveResult } from "@/services/system/settings-save";
import { TENANT_SETTINGS_AREA, tenantNotificationChanges } from "@/services/tenant/tenant-settings-audit";
import { tenantService } from "@/services/tenant/tenant-service";

/**
 * The settings of the tenant the viewer works in: its name and where its own events go. They
 * need the right to change the tenant settings there, and All tenants, which changes no tenant,
 * is refused. Each action names the tenant the page shows and is refused when the session works
 * in another one, since a switch in another tab moves the session under an open page. Every
 * change goes into the audit log of the tenant. The logo is a route, see `api/tenants/[id]/logo`,
 * for the size of a file.
 */

const log = logger.child({ action: "tenant-settings" });

const TenantIdSchema = z.string().min(1).max(200);
const NameSchema = z.string().trim().min(1, "Give the tenant a name.").max(60, "The name can have at most 60 characters.");
const IdsSchema = z.array(z.string().min(1).max(200)).max(100);
const PatchSchema = z.object({
    enabled: z.boolean().optional(),
    channels: z.array(z.string().min(1).max(200)).max(100).nullable().optional(),
});

const OPEN_A_TENANT = "Open a tenant to change its settings.";
const ANOTHER_TENANT = "You opened another tenant in another tab. Load the page again before you change these settings.";
const HOME_IS_PLATFORM = "The home tenant reports through the notifications of the platform.";

/** The tenant the viewer may change the settings of, the one the page shows, or why not. */
function tenantOfViewer(viewer: Viewer, pageTenantId: string): { tenantId: string } | { error: string } {
    if (viewer.allTenants || !viewer.tenantId) return { error: OPEN_A_TENANT };
    const page = TenantIdSchema.safeParse(pageTenantId);
    if (!page.success || page.data !== viewer.tenantId) return { error: ANOTHER_TENANT };
    return { tenantId: viewer.tenantId };
}

const messageOf = (error: unknown, fallback: string) =>
    error instanceof ValidationError || error instanceof ConflictError || error instanceof NotFoundError ? error.message : fallback;

/** Renames the tenant the viewer works in, `tenantId` the one the page shows. */
export async function renameOwnTenant(tenantId: string, name: string): Promise<SaveResult> {
    const viewer = await checkPermission(PERMISSIONS.TENANT_SETTINGS.WRITE);
    const scope = tenantOfViewer(viewer, tenantId);
    if ("error" in scope) return { success: false, error: scope.error };
    const parsed = NameSchema.safeParse(name);
    if (!parsed.success) return { success: false, error: parsed.error.issues[0]?.message ?? "Invalid request", field: "name" };

    try {
        const change = await tenantService.rename(scope.tenantId, parsed.data);
        if (change.name !== change.renamedFrom) {
            await auditService.log(viewer.id, AUDIT_ACTIONS.UPDATE, AUDIT_RESOURCES.TENANT, {
                name: change.name,
                renamedFrom: change.renamedFrom,
                area: TENANT_SETTINGS_AREA,
                changes: [{ field: "Name", from: change.renamedFrom, to: change.name }],
            }, scope.tenantId, { tenantId: scope.tenantId });
        }
        revalidatePath("/dashboard", "layout");
        return { success: true };
    } catch (error: unknown) {
        if (!(error instanceof ValidationError || error instanceof ConflictError)) log.error("Renaming the own tenant failed", { tenantId: scope.tenantId }, wrapError(error));
        return { success: false, error: messageOf(error, "The tenant could not be renamed."), field: "name" };
    }
}

/** Writes what a save of the notifications changed into the log of the tenant, or hands back why it was refused. */
async function saved(viewer: Viewer, tenantId: string, save: () => Promise<{ before: TenantNotificationConfig; after: TenantNotificationConfig }>): Promise<SaveResult> {
    try {
        const { before, after } = await save();
        const changes = await tenantNotificationChanges(before, after);
        if (changes.length > 0) {
            const tenant = await tenantService.find(tenantId);
            await auditService.log(viewer.id, AUDIT_ACTIONS.UPDATE, AUDIT_RESOURCES.TENANT, { name: tenant?.name ?? null, area: TENANT_SETTINGS_AREA, changes }, tenantId, { tenantId });
        }
        revalidatePath("/dashboard/settings");
        return { success: true };
    } catch (error: unknown) {
        if (error instanceof ValidationError) return { success: false, error: error.message, field: error.field };
        log.error("Failed to save the notifications of a tenant", { tenantId }, wrapError(error));
        return { success: false, error: "Failed to save the notifications" };
    }
}

/** Saves one event of the tenant the page shows, or the same change of several. */
export async function saveTenantNotificationEventsAction(tenantId: string, eventIds: string[], patch: z.infer<typeof PatchSchema>): Promise<SaveResult> {
    const viewer = await checkPermission(PERMISSIONS.TENANT_SETTINGS.WRITE);
    const scope = tenantOfViewer(viewer, tenantId);
    if ("error" in scope) return { success: false, error: scope.error };
    if (scope.tenantId === HOME_TENANT_ID) return { success: false, error: HOME_IS_PLATFORM };

    const ids = IdsSchema.min(1).safeParse(eventIds);
    const parsed = PatchSchema.safeParse(patch);
    if (!ids.success) return { success: false, error: "Pick at least one event" };
    if (!parsed.success) return { success: false, error: parsed.error.issues[0].message, field: String(parsed.error.issues[0].path[0] ?? "") };
    return saved(viewer, scope.tenantId, () => saveTenantEventSettings(scope.tenantId, ids.data, parsed.data));
}

/** Saves the channels every event of the tenant the page shows goes to unless it has its own. */
export async function saveTenantDefaultChannelsAction(tenantId: string, channelIds: string[]): Promise<SaveResult> {
    const viewer = await checkPermission(PERMISSIONS.TENANT_SETTINGS.WRITE);
    const scope = tenantOfViewer(viewer, tenantId);
    if ("error" in scope) return { success: false, error: scope.error };
    if (scope.tenantId === HOME_TENANT_ID) return { success: false, error: HOME_IS_PLATFORM };

    const parsed = IdsSchema.safeParse(channelIds);
    if (!parsed.success) return { success: false, error: "Invalid channels" };
    return saved(viewer, scope.tenantId, () => saveTenantDefaultChannels(scope.tenantId, parsed.data));
}

/** Sends an example of an event of the tenant the page shows to where it goes now, and says how many channels took it. */
export async function sendTenantTestNotificationAction(tenantId: string, eventId: string): Promise<{ success: boolean; message?: string; error?: string }> {
    const viewer = await checkPermission(PERMISSIONS.TENANT_SETTINGS.WRITE);
    const scope = tenantOfViewer(viewer, tenantId);
    if ("error" in scope) return { success: false, error: scope.error };
    if (scope.tenantId === HOME_TENANT_ID) return { success: false, error: HOME_IS_PLATFORM };

    const parsed = z.string().min(1).max(100).safeParse(eventId);
    if (!parsed.success) return { success: false, error: "Unknown notification event" };
    try {
        const { sent, failed } = await sendTenantEventTest(scope.tenantId, parsed.data);
        const channels = (count: number) => (count === 1 ? "1 channel" : `${count} channels`);
        return { success: true, message: failed > 0 ? `Sent to ${channels(sent)}, ${channels(failed)} did not take it` : `Sent to ${channels(sent)}` };
    } catch (error: unknown) {
        if (error instanceof ValidationError) return { success: false, error: error.message };
        log.error("Failed to send a test notification of a tenant", { tenantId: scope.tenantId, eventId: parsed.data }, wrapError(error));
        return { success: false, error: "Failed to send the test" };
    }
}
