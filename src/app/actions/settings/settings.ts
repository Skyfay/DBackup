"use server"

import prisma from "@/lib/prisma";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { checkPermission } from "@/lib/auth/access-control";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { logger } from "@/lib/logging/logger";
import { wrapError } from "@/lib/logging/errors";
import { scheduler } from "@/lib/server/scheduler";
import { isValidTimezone } from "@/lib/utils";
import { STUCK_TIMEOUT_SETTING } from "@/services/system/stuck-execution-service";

const log = logger.child({ action: "settings" });

const settingsSchema = z.object({
    maxConcurrentJobs: z.coerce.number().min(1).max(10),
    // 0 disables the watchdog. The upper bound is a week, past which a run that reports no
    // progress is not worth waiting for under any configuration.
    stuckTimeoutMinutes: z.coerce.number().min(0).max(10080).optional(),
    disablePasskeyLogin: z.boolean().optional(),
    sessionDuration: z.coerce.number().min(3600).max(7776000).optional(), // 1h to 90d in seconds
    checkForUpdates: z.boolean().optional(),
    showQuickSetup: z.boolean().optional(),
    systemTimezone: z.string()
        .refine(isValidTimezone, { message: "Invalid IANA timezone" })
        .optional(),
    filenamePattern: z.string().min(1).optional(),
    instanceName: z.string().max(50).optional(),
});

export async function updateSystemSettings(data: z.infer<typeof settingsSchema>) {
    await checkPermission(PERMISSIONS.SETTINGS.WRITE);

    const result = settingsSchema.safeParse(data);
    if (!result.success) {
        return { success: false, error: result.error.issues[0].message };
    }

    try {
        await prisma.systemSetting.upsert({
            where: { key: "maxConcurrentJobs" },
            update: { value: String(result.data.maxConcurrentJobs) },
            create: { key: "maxConcurrentJobs", value: String(result.data.maxConcurrentJobs) },
        });

        // Stuck execution watchdog threshold, in minutes (default 360, 0 disables it)
        if (result.data.stuckTimeoutMinutes !== undefined) {
            await prisma.systemSetting.upsert({
                where: { key: STUCK_TIMEOUT_SETTING },
                update: { value: String(result.data.stuckTimeoutMinutes) },
                create: { key: STUCK_TIMEOUT_SETTING, value: String(result.data.stuckTimeoutMinutes) },
            });
        }

        // Session Duration Setting (default 604800 = 7 days, in seconds)
        if (result.data.sessionDuration !== undefined) {
            await prisma.systemSetting.upsert({
                where: { key: "auth.sessionDuration" },
                update: { value: String(result.data.sessionDuration) },
                create: { key: "auth.sessionDuration", value: String(result.data.sessionDuration) },
            });
        }

        // Passkey Login Setting (default false/enabled, stored as true if disabled)
        if (result.data.disablePasskeyLogin !== undefined) {
             await prisma.systemSetting.upsert({
                where: { key: "auth.disablePasskeyLogin" },
                update: { value: String(result.data.disablePasskeyLogin) },
                create: { key: "auth.disablePasskeyLogin", value: String(result.data.disablePasskeyLogin) },
            });
        }

        // Check for Updates Setting (default true)
        if (result.data.checkForUpdates !== undefined) {
            await prisma.systemSetting.upsert({
               where: { key: "general.checkForUpdates" },
               update: { value: String(result.data.checkForUpdates) },
               create: { key: "general.checkForUpdates", value: String(result.data.checkForUpdates) },
           });
       }

        // Show Quick Setup Setting (default false)
        if (result.data.showQuickSetup !== undefined) {
            await prisma.systemSetting.upsert({
               where: { key: "general.showQuickSetup" },
               update: { value: String(result.data.showQuickSetup) },
               create: { key: "general.showQuickSetup", value: String(result.data.showQuickSetup) },
           });
       }

        // System Timezone Setting (default UTC)
        if (result.data.systemTimezone !== undefined) {
            await prisma.systemSetting.upsert({
                where: { key: "system.timezone" },
                update: { value: result.data.systemTimezone },
                create: { key: "system.timezone", value: result.data.systemTimezone, description: "System-wide timezone for scheduler" },
            });

            // Refresh scheduler to apply new timezone to all cron tasks
            scheduler.refresh().catch((e) => log.error("Scheduler refresh failed after timezone update", {}, wrapError(e)));
        }

        // Backup Filename Pattern Setting
        if (result.data.filenamePattern !== undefined) {
            await prisma.systemSetting.upsert({
                where: { key: "system.filenamePattern" },
                update: { value: result.data.filenamePattern },
                create: { key: "system.filenamePattern", value: result.data.filenamePattern, description: "Template pattern for backup file names" },
            });
        }

        // Instance Name Setting
        if (result.data.instanceName !== undefined) {
            await prisma.systemSetting.upsert({
                where: { key: "general.instanceName" },
                update: { value: result.data.instanceName },
                create: { key: "general.instanceName", value: result.data.instanceName, description: "Custom instance name shown in the browser tab title" },
            });
        }

        revalidatePath("/dashboard/settings");
        return { success: true };
    } catch (error: unknown) {
        log.error("Failed to update system settings", {}, wrapError(error));
        return { success: false, error: "Failed to update settings" };
    }
}
