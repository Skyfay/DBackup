"use server"

import prisma from "@/lib/prisma";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { checkPermission } from "@/lib/access-control";
import { PERMISSIONS } from "@/lib/permissions";
import { logger } from "@/lib/logger";
import { wrapError } from "@/lib/errors";

const log = logger.child({ action: "settings" });

const settingsSchema = z.object({
    maxConcurrentJobs: z.coerce.number().min(1).max(10),
    disablePasskeyLogin: z.boolean().optional(),
    auditLogRetentionDays: z.coerce.number().min(1).max(1825).optional(),
    storageSnapshotRetentionDays: z.coerce.number().min(7).max(1825).optional(),
    notificationLogRetentionDays: z.coerce.number().min(7).max(1825).optional(),
    checkForUpdates: z.boolean().optional(),
    showQuickSetup: z.boolean().optional(),
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

        // Passkey Login Setting (default false/enabled, stored as true if disabled)
        if (result.data.disablePasskeyLogin !== undefined) {
             await prisma.systemSetting.upsert({
                where: { key: "auth.disablePasskeyLogin" },
                update: { value: String(result.data.disablePasskeyLogin) },
                create: { key: "auth.disablePasskeyLogin", value: String(result.data.disablePasskeyLogin) },
            });
        }

        // Audit Log Retention Setting (default 90)
        if (result.data.auditLogRetentionDays !== undefined) {
             await prisma.systemSetting.upsert({
                where: { key: "audit.retentionDays" },
                update: { value: String(result.data.auditLogRetentionDays) },
                create: { key: "audit.retentionDays", value: String(result.data.auditLogRetentionDays) },
            });
        }

        // Storage Snapshot Retention Setting (default 90)
        if (result.data.storageSnapshotRetentionDays !== undefined) {
             await prisma.systemSetting.upsert({
                where: { key: "storage.snapshotRetentionDays" },
                update: { value: String(result.data.storageSnapshotRetentionDays) },
                create: { key: "storage.snapshotRetentionDays", value: String(result.data.storageSnapshotRetentionDays) },
            });
        }

        // Notification Log Retention Setting (default 90)
        if (result.data.notificationLogRetentionDays !== undefined) {
             await prisma.systemSetting.upsert({
                where: { key: "notification.logRetentionDays" },
                update: { value: String(result.data.notificationLogRetentionDays) },
                create: { key: "notification.logRetentionDays", value: String(result.data.notificationLogRetentionDays) },
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

        revalidatePath("/dashboard/settings");
        return { success: true };
    } catch (error: unknown) {
        log.error("Failed to update system settings", {}, wrapError(error));
        return { success: false, error: "Failed to update settings" };
    }
}
