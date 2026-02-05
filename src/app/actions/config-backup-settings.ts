"use server"

import prisma from "@/lib/prisma";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { checkPermission } from "@/lib/access-control";
import { PERMISSIONS } from "@/lib/permissions";
import { logger } from "@/lib/logger";
import { wrapError } from "@/lib/errors";

const log = logger.child({ action: "config-backup-settings" });

const configBackupSchema = z.object({
    enabled: z.boolean(),
    // schedule: z.string().min(1, "Schedule is required"), // Removed
    storageId: z.string().min(1, "Destination is required"),
    profileId: z.string().optional().or(z.literal("")), // Can be empty if secrets not included? But UI recommends it.
    includeSecrets: z.boolean(),
    retention: z.coerce.number().min(1).default(10),
});

export async function updateConfigBackupSettings(data: z.infer<typeof configBackupSchema>) {
    await checkPermission(PERMISSIONS.SETTINGS.WRITE);

    const result = configBackupSchema.safeParse(data);
    if (!result.success) {
        return { success: false, error: result.error.issues[0].message };
    }

    if (result.data.includeSecrets && !result.data.profileId) {
        return { success: false, error: "Encryption Profile is required when including secrets." };
    }

    try {
        await prisma.$transaction([
            prisma.systemSetting.upsert({
                where: { key: "config.backup.enabled" },
                update: { value: String(result.data.enabled) },
                create: { key: "config.backup.enabled", value: String(result.data.enabled) },
            }),
            /* Schedule is now managed in System Tasks
            prisma.systemSetting.upsert({
                where: { key: "config.backup.schedule" },
                update: { value: result.data.schedule },
                create: { key: "config.backup.schedule", value: result.data.schedule },
            }),
            */
            prisma.systemSetting.upsert({
                where: { key: "config.backup.storageId" },
                update: { value: result.data.storageId },
                create: { key: "config.backup.storageId", value: result.data.storageId },
            }),
            prisma.systemSetting.upsert({
                where: { key: "config.backup.profileId" },
                update: { value: result.data.profileId || "" },
                create: { key: "config.backup.profileId", value: result.data.profileId || "" },
            }),
            prisma.systemSetting.upsert({
                where: { key: "config.backup.includeSecrets" },
                update: { value: String(result.data.includeSecrets) },
                create: { key: "config.backup.includeSecrets", value: String(result.data.includeSecrets) },
            }),
             prisma.systemSetting.upsert({
                where: { key: "config.backup.retention" },
                update: { value: String(result.data.retention) },
                create: { key: "config.backup.retention", value: String(result.data.retention) },
            }),
        ]);

        // TODO: In Phase 3, we will need to re-schedule the cron job here!

        revalidatePath("/dashboard/settings");
        return { success: true };
    } catch (error: unknown) {
        log.error("Failed to update config backup settings", {}, wrapError(error));
        return { success: false, error: "Failed to update settings" };
    }
}
