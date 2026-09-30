"use server";

import { checkPermission } from "@/lib/auth/access-control";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { ConfigService } from "@/services/config/config-service";
import { RestoreOptions } from "@/lib/types/config-backup";
import { runConfigBackup } from "@/lib/runner/config-runner";
import { logger } from "@/lib/logging/logger";
import { wrapError, getErrorMessage } from "@/lib/logging/errors";
import { connectionName } from "@/services/adapters/adapter-audit";
import { auditService } from "@/services/audit-service";
import { AUDIT_ACTIONS, AUDIT_RESOURCES } from "@/lib/core/audit-types";

const log = logger.child({ action: "config-management" });
const configService = new ConfigService();

/**
 * A restore writes users, groups and sign-in providers from a file, so it could make anyone a
 * SuperAdmin. Only a SuperAdmin restores a configuration. Restore from a file is the route
 * `/api/settings/config-backup/restore`, since a Server Action takes at most 1 MB.
 */
const ONLY_SUPER_ADMIN = { success: false as const, error: "Only a SuperAdmin restores a configuration backup." };

/**
 * Trigger the Automated Config Backup Logic Manually
 */
export async function triggerManualConfigBackupAction() {
    const user = await checkPermission(PERMISSIONS.SETTINGS.WRITE);
    try {
        // Trigger the runner async (fire & forget from UI perspective, but we await completion to inform user)
        // Actually, runConfigBackup is async.
        await runConfigBackup();
        await auditService.log(user.id, AUDIT_ACTIONS.EXECUTE, AUDIT_RESOURCES.SYSTEM, { action: "config_backup" });
        return { success: true };
    } catch (e: unknown) {
        log.error("Manual config backup failed", {}, wrapError(e));
        return { success: false, error: getErrorMessage(e) };
    }
}

/**
 * Restores a configuration backup from storage.
 */
export async function restoreFromStorageAction(
    storageConfigId: string,
    file: string,
    decryptionProfileId?: string,
    options?: RestoreOptions
) {
    const user = await checkPermission(PERMISSIONS.SETTINGS.WRITE);
    if (user.group?.name !== "SuperAdmin") return ONLY_SUPER_ADMIN;

    try {
        const executionId = await configService.restoreFromStorage(storageConfigId, file, decryptionProfileId, options);
        // Written once the restore started, it runs on in the background.
        await auditService.log(user.id, AUDIT_ACTIONS.RESTORE, AUDIT_RESOURCES.SYSTEM, {
            action: "config_restore",
            file,
            destination: await connectionName(storageConfigId),
        });
        return { success: true, executionId };
    } catch (error: unknown) {
        log.error("Restore from storage error", {}, wrapError(error));
        return {
            success: false,
            error: error instanceof Error ? error.message : "Failed to initiate restore"
        };
    }
}
