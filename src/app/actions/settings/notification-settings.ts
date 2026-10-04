"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { checkPermission } from "@/lib/auth/access-control";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { logger } from "@/lib/logging/logger";
import { ValidationError, wrapError } from "@/lib/logging/errors";
import { AUDIT_ACTIONS, AUDIT_RESOURCES } from "@/lib/core/audit-types";
import type { SaveResult } from "@/lib/settings/save-part";
import type { SystemNotificationConfig } from "@/lib/notifications/types";
import { auditService } from "@/services/audit-service";
import { notificationSettingsChanges } from "@/services/notifications/notification-settings-audit";
import { MAX_REMINDER_HOURS, saveDefaultChannels, saveEventSettings, sendEventTest } from "@/services/notifications/notification-settings-service";
import { SETTINGS_AREAS } from "@/services/system/settings-audit";

const log = logger.child({ action: "notification-settings" });

const patchSchema = z.object({
    enabled: z.boolean().optional(),
    channels: z.array(z.string().min(1)).nullable().optional(),
    notifyUser: z.enum(["none", "also", "only"]).optional(),
    // 0 turns the reminder off, null keeps the default of the event.
    reminderHours: z.number().int().min(0).max(MAX_REMINDER_HOURS).nullable().optional(),
});

/** Writes what a save changed and answers the part, or hands back why it was refused. */
async function saved(userId: string, save: () => Promise<{ before: SystemNotificationConfig; after: SystemNotificationConfig }>): Promise<SaveResult> {
    try {
        const { before, after } = await save();
        const changes = await notificationSettingsChanges(before, after);
        if (changes.length > 0) {
            await auditService.log(userId, AUDIT_ACTIONS.UPDATE, AUDIT_RESOURCES.SYSTEM, { area: SETTINGS_AREAS.NOTIFICATIONS, changes });
        }
        revalidatePath("/dashboard/settings");
        return { success: true };
    } catch (error: unknown) {
        if (error instanceof ValidationError) return { success: false, error: error.message, field: error.field };
        log.error("Failed to save the notification settings", {}, wrapError(error));
        return { success: false, error: "Failed to save the notification settings" };
    }
}

/** Saves one event from its Edit dialog or its switch, or the same change of several from the bar of a selection. */
export async function saveNotificationEventsAction(eventIds: string[], patch: z.infer<typeof patchSchema>): Promise<SaveResult> {
    const user = await checkPermission(PERMISSIONS.SETTINGS.WRITE);

    const ids = z.array(z.string().min(1)).min(1).max(100).safeParse(eventIds);
    const parsed = patchSchema.safeParse(patch);
    if (!ids.success) return { success: false, error: "Pick at least one event" };
    if (!parsed.success) return { success: false, error: parsed.error.issues[0].message, field: String(parsed.error.issues[0].path[0] ?? "") };
    return saved(user.id, () => saveEventSettings(ids.data, parsed.data));
}

/** Saves the channels every event goes to unless it has its own. */
export async function saveDefaultChannelsAction(channelIds: string[]): Promise<SaveResult> {
    const user = await checkPermission(PERMISSIONS.SETTINGS.WRITE);

    const parsed = z.array(z.string().min(1)).max(100).safeParse(channelIds);
    if (!parsed.success) return { success: false, error: "Invalid channels" };
    return saved(user.id, () => saveDefaultChannels(parsed.data));
}

/** Sends an example of an event to where it goes now, and says how many channels took it. */
export async function sendTestNotificationAction(eventId: string): Promise<{ success: boolean; message?: string; error?: string }> {
    await checkPermission(PERMISSIONS.SETTINGS.WRITE);

    const parsed = z.string().min(1).safeParse(eventId);
    if (!parsed.success) return { success: false, error: "Unknown notification event" };
    try {
        const { sent, failed } = await sendEventTest(parsed.data);
        const channels = (count: number) => (count === 1 ? "1 channel" : `${count} channels`);
        return { success: true, message: failed > 0 ? `Sent to ${channels(sent)}, ${channels(failed)} did not take it` : `Sent to ${channels(sent)}` };
    } catch (error: unknown) {
        if (error instanceof ValidationError) return { success: false, error: error.message };
        log.error("Failed to send a test notification", { eventId: parsed.data }, wrapError(error));
        return { success: false, error: "Failed to send the test" };
    }
}
