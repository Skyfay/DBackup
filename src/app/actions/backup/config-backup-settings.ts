"use server"

import { z } from "zod";
import { checkPermission } from "@/lib/auth/access-control";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { MAX_CONFIG_BACKUPS_KEPT, saveConfigBackupSettings } from "@/services/config/config-backup-settings";
import { configBackupSettings, SETTINGS_AREAS } from "@/services/system/settings-audit";
import { invalid, savePart, type SaveResult } from "@/lib/settings/save-part";

const configBackupSchema = z.object({
    enabled: z.boolean(),
    storageId: z.string(),
    profileId: z.string(),
    schedule: z.string().trim().min(1, "Pick a schedule"),
    includeStatistics: z.boolean(),
    retention: z.coerce.number().int().min(1).max(MAX_CONFIG_BACKUPS_KEPT),
});

export async function saveConfigBackupSettingsAction(data: z.infer<typeof configBackupSchema>): Promise<SaveResult> {
    const user = await checkPermission(PERMISSIONS.SETTINGS.WRITE);

    const parsed = configBackupSchema.safeParse(data);
    if (!parsed.success) return invalid(parsed.error.issues);
    return savePart(user.id, SETTINGS_AREAS.CONFIG_BACKUP, configBackupSettings, () => saveConfigBackupSettings(parsed.data));
}
