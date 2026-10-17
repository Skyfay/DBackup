"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { checkPermission } from "@/lib/auth/access-control";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { AUDIT_ACTIONS, AUDIT_RESOURCES } from "@/lib/core/audit-types";
import { ConflictError, NotFoundError, ValidationError, getErrorMessage, wrapError } from "@/lib/logging/errors";
import { logger } from "@/lib/logging/logger";
import { SEE_SHARING_PERMISSION, SHARE_PERMISSION } from "@/lib/tenant/sharing";
import { auditService } from "@/services/audit-service";
import { ShareChangeError, connectionShareService, type ShareChange, type ShareSettings } from "@/services/sharing/connection-shares";
import { setRecipients } from "@/services/sharing/channel-recipients";
import { sendRecipientsTest } from "@/services/sharing/recipients-test";

/**
 * Sharing a destination or a channel with other tenants, and naming the recipients of an email
 * channel another tenant shares. Who shares holds Share with customers, a right of the platform, in
 * a tenant that shares with customers. Each action works in one tenant, never in All tenants.
 */

const log = logger.child({ action: "connection-share" });

const IdSchema = z.string().min(1).max(200);
const SettingsSchema = z.object({
    allTenants: z.boolean(),
    tenantIds: z.array(IdSchema).max(1000),
    encryptedOnly: z.boolean(),
    ownRecipients: z.boolean(),
});

const messageOf = (error: unknown, fallback: string) =>
    error instanceof ValidationError || error instanceof ConflictError || error instanceof NotFoundError ? error.message : fallback;

const ALL_TENANTS = "Open the tenant of the connection first.";

const resourceOf = (kind: string) => (kind === "destination" ? AUDIT_RESOURCES.DESTINATION : AUDIT_RESOURCES.ADAPTER);

/** Who gets a connection of the open tenant, and how each uses it. */
export async function getConnectionShare(configId: string) {
    const viewer = await checkPermission(SEE_SHARING_PERMISSION);
    const id = IdSchema.safeParse(configId);
    if (!id.success) return { success: false as const, error: "Invalid request" };
    if (!viewer.tenantId) return { success: false as const, error: ALL_TENANTS };
    try {
        return { success: true as const, data: await connectionShareService.view(id.data) };
    } catch (error: unknown) {
        return { success: false as const, error: messageOf(error, "The sharing of this connection could not be read.") };
    }
}

/** The tenants that would lose a connection with these settings, with what each uses of it. */
export async function previewShareLoss(configId: string, settings: Pick<ShareSettings, "allTenants" | "tenantIds">) {
    const viewer = await checkPermission(SHARE_PERMISSION);
    const id = IdSchema.safeParse(configId);
    const parsed = SettingsSchema.pick({ allTenants: true, tenantIds: true }).safeParse(settings);
    if (!id.success || !parsed.success) return { success: false as const, error: "Invalid request" };
    if (!viewer.tenantId) return { success: false as const, error: ALL_TENANTS };
    try {
        return { success: true as const, data: await connectionShareService.losing(id.data, parsed.data) };
    } catch (error: unknown) {
        return { success: false as const, error: messageOf(error, "The change could not be checked.") };
    }
}

/** Logs a change of who gets a connection, in the log of its tenant and in the log of each tenant that lost it. */
async function logChange(viewerId: string, configId: string, result: ShareChange, settings: Pick<ShareSettings, "allTenants">, kept: string[]) {
    const resource = resourceOf(result.kind);
    if (result.gained.length > 0 || settings.allTenants) {
        await auditService.log(viewerId, AUDIT_ACTIONS.UPDATE, resource, { name: result.name, action: "share", tenants: settings.allTenants ? "all tenants" : kept.join(", ") }, configId);
    }
    if (result.losses.length > 0) {
        await auditService.log(viewerId, AUDIT_ACTIONS.UPDATE, resource, { name: result.name, action: "unshare", tenants: result.losses.map((loss) => loss.name).join(", ") }, configId);
    }
    for (const loss of result.losses) {
        await auditService.log(viewerId, AUDIT_ACTIONS.UPDATE, resource, {
            name: result.name,
            action: "unshare",
            tenants: loss.name,
            ...(loss.jobs.length > 0 ? { jobs: loss.jobs } : {}),
            ...(loss.templates.length > 0 ? { templates: loss.templates } : {}),
            ...(loss.backups > 0 ? { backups: loss.backups } : {}),
        }, configId, { tenantId: loss.tenantId });
    }
}

/**
 * Saves who gets a destination or a channel of the open tenant. A tenant that loses a destination
 * loses its backups on it, so that needs `confirmed`.
 */
export async function saveConnectionShare(configId: string, settings: ShareSettings, confirmed = false) {
    const viewer = await checkPermission(SHARE_PERMISSION);
    const id = IdSchema.safeParse(configId);
    const parsed = SettingsSchema.safeParse(settings);
    if (!id.success || !parsed.success || typeof confirmed !== "boolean") return { success: false as const, error: "Invalid request" };
    if (!viewer.tenantId) return { success: false as const, error: ALL_TENANTS };
    try {
        const result = await connectionShareService.save(id.data, parsed.data, { confirmed });
        const view = await connectionShareService.view(id.data);
        await logChange(viewer.id, id.data, result, parsed.data, view.uses.map((use) => use.name));
        revalidatePath("/dashboard/connections");
        return { success: true as const, data: { gained: result.gained, lost: result.losses.map((loss) => ({ name: loss.name, backups: loss.backups, jobs: loss.jobs.length })) } };
    } catch (error: unknown) {
        // The tenants that lost it before the storage stopped answering are told all the same.
        if (error instanceof ShareChangeError) await logChange(viewer.id, id.data, error.change, { allTenants: false }, []);
        if (!(error instanceof ValidationError || error instanceof NotFoundError)) log.error("Saving the sharing of a connection failed", { configId: id.data }, wrapError(error));
        return { success: false as const, error: messageOf(error, getErrorMessage(error) || "The sharing could not be saved.") };
    }
}

/** Stops sharing a connection of the open tenant with one tenant, which loses its backups on a destination. */
export async function stopSharingWith(configId: string, tenantId: string, confirmed = false) {
    const viewer = await checkPermission(SHARE_PERMISSION);
    const id = IdSchema.safeParse(configId);
    const customer = IdSchema.safeParse(tenantId);
    if (!id.success || !customer.success || typeof confirmed !== "boolean") return { success: false as const, error: "Invalid request" };
    if (!viewer.tenantId) return { success: false as const, error: ALL_TENANTS };
    try {
        const result = await connectionShareService.stopFor(id.data, customer.data, { confirmed });
        const view = await connectionShareService.view(id.data);
        await logChange(viewer.id, id.data, result, { ...view.settings }, view.uses.map((use) => use.name));
        revalidatePath("/dashboard/connections");
        return { success: true as const, data: { lost: result.losses.map((loss) => ({ name: loss.name, backups: loss.backups, jobs: loss.jobs.length })) } };
    } catch (error: unknown) {
        if (error instanceof ShareChangeError) await logChange(viewer.id, id.data, error.change, { allTenants: false }, []);
        if (!(error instanceof ValidationError || error instanceof NotFoundError)) log.error("Stopping to share a connection failed", { configId: id.data }, wrapError(error));
        return { success: false as const, error: messageOf(error, getErrorMessage(error) || "The sharing could not be changed.") };
    }
}

/** Deletes the backups of one tenant on a destination the open tenant shares with it. Its jobs go on writing. */
export async function deleteSharedBackups(configId: string, tenantId: string) {
    const viewer = await checkPermission(SHARE_PERMISSION);
    const id = IdSchema.safeParse(configId);
    const customer = IdSchema.safeParse(tenantId);
    if (!id.success || !customer.success) return { success: false as const, error: "Invalid request" };
    if (!viewer.tenantId) return { success: false as const, error: ALL_TENANTS };
    try {
        const result = await connectionShareService.deleteBackupsOf(id.data, customer.data);
        const details = { name: result.name, action: "tenantBackups", tenant: result.tenantName, backups: result.backups };
        await auditService.log(viewer.id, AUDIT_ACTIONS.DELETE, AUDIT_RESOURCES.DESTINATION, details, id.data);
        await auditService.log(viewer.id, AUDIT_ACTIONS.DELETE, AUDIT_RESOURCES.DESTINATION, details, id.data, { tenantId: customer.data });
        revalidatePath("/dashboard/connections");
        return { success: true as const, data: { backups: result.backups } };
    } catch (error: unknown) {
        if (!(error instanceof ValidationError || error instanceof NotFoundError)) log.error("Deleting the backups of a tenant failed", { configId: id.data }, wrapError(error));
        return { success: false as const, error: messageOf(error, getErrorMessage(error) || "The backups could not be deleted.") };
    }
}

/** Names the recipients of the open tenant for an email channel another tenant shares with it. */
export async function setChannelRecipients(configId: string, recipients: string[]) {
    const viewer = await checkPermission(PERMISSIONS.NOTIFICATIONS.WRITE);
    const id = IdSchema.safeParse(configId);
    const list = z.array(z.string().max(320)).max(100).safeParse(recipients);
    if (!id.success || !list.success) return { success: false as const, error: "Invalid request" };
    if (!viewer.tenantId) return { success: false as const, error: ALL_TENANTS };
    try {
        const result = await setRecipients(id.data, viewer.tenantId, list.data);
        await auditService.log(viewer.id, AUDIT_ACTIONS.UPDATE, AUDIT_RESOURCES.ADAPTER, {
            name: result.name,
            action: "recipients",
            changes: [{ field: "Recipients", from: result.before.join(", ") || null, to: result.after.join(", ") || null }],
        }, id.data);
        revalidatePath("/dashboard/connections");
        return { success: true as const, data: { recipients: result.after } };
    } catch (error: unknown) {
        return { success: false as const, error: messageOf(error, "The recipients could not be saved.") };
    }
}

/** Sends a test to the recipients the open tenant named for an email channel another tenant shares with it. */
export async function testChannelRecipients(configId: string) {
    const viewer = await checkPermission(PERMISSIONS.NOTIFICATIONS.WRITE);
    const id = IdSchema.safeParse(configId);
    if (!id.success) return { success: false as const, error: "Invalid request" };
    if (!viewer.tenantId) return { success: false as const, error: ALL_TENANTS };
    try {
        const result = await sendRecipientsTest(id.data, viewer.tenantId);
        return { success: true as const, data: { recipients: result.recipients } };
    } catch (error: unknown) {
        // Why the mail server of another tenant refused it stays with that tenant.
        log.warn("A test to the recipients of a shared channel failed", { configId: id.data }, wrapError(error));
        return { success: false as const, error: messageOf(error, "The test did not go out. The tenant that shares the channel can see why.") };
    }
}
