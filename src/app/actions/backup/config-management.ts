"use server";

import { checkPermission } from "@/lib/auth/access-control";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { ConfigService } from "@/services/config/config-service";
import { RestoreOptions } from "@/lib/types/config-backup";
import { runConfigBackup } from "@/lib/runner/config-runner";
import { getTempDir } from "@/lib/temp-dir";
import { promises as fs } from "fs";
import path from "path";
import { logger } from "@/lib/logging/logger";
import { EncryptionKeyRequiredError, wrapError, getErrorMessage } from "@/lib/logging/errors";
import { getProfileMasterKey } from "@/services/backup/encryption-service";
import { connectionName } from "@/services/adapters/adapter-audit";
import { auditService } from "@/services/audit-service";
import { AUDIT_ACTIONS, AUDIT_RESOURCES } from "@/lib/core/audit-types";

const log = logger.child({ action: "config-management" });
const configService = new ConfigService();

/**
 * A restore writes users, groups and sign-in providers from a file, so it could make anyone a
 * SuperAdmin. Only a SuperAdmin restores a configuration.
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
 * Uploads and restores a configuration backup file (Offline Restore).
 * Supports JSON, GZIP, and Encrypted (.enc) backups (requires .meta.json sidecar).
 */
export async function uploadAndRestoreConfigAction(formData: FormData) {
    const user = await checkPermission(PERMISSIONS.SETTINGS.WRITE);
    if (user.group?.name !== "SuperAdmin") return ONLY_SUPER_ADMIN;

    const backupFile = formData.get("backupFile") as File;
    const metaFile = formData.get("metaFile") as File | null;
    const strategy = "OVERWRITE"; // Currently the only supported strategy

    if (!backupFile) {
        return { success: false, error: "No backup file provided" };
    }

    const tempDir = getTempDir();
    const tempBackupPath = path.join(tempDir, `upload_restore_${Date.now()}_${backupFile.name}`);
    let tempMetaPath: string | undefined;

    try {
        // 1. Save Backup File
        const backupBuffer = Buffer.from(await backupFile.arrayBuffer());
        await fs.writeFile(tempBackupPath, backupBuffer);

        // 2. Save Meta File (if provided)
        if (metaFile) {
            tempMetaPath = path.join(tempDir, `upload_restore_${Date.now()}_${metaFile.name}`);
            const metaBuffer = Buffer.from(await metaFile.arrayBuffer());
            await fs.writeFile(tempMetaPath, metaBuffer);
        }

        // 3. Parse & Process
        // This helper handles decryption and decompression if needed
        const rawKeyHex = formData.get("encryptionKeyHex") as string | null;
        const profileIdOverride = formData.get("encryptionProfileIdOverride") as string | null;

        let resolvedKeyHex = rawKeyHex || undefined;
        if (profileIdOverride && !resolvedKeyHex) {
            // The recovery dialog offers a vault profile as well as a typed key. An uploaded
            // file has no storage adapter behind it, so the profile is turned into its key
            // here rather than being resolved further down.
            const profileKey = await getProfileMasterKey(profileIdOverride);
            resolvedKeyHex = profileKey.toString('hex');
        }

        const configData = await configService.parseBackupFile(tempBackupPath, tempMetaPath, resolvedKeyHex);

        // 4. Import
        await configService.import(configData, strategy);

        await auditService.log(user.id, AUDIT_ACTIONS.RESTORE, AUDIT_RESOURCES.SYSTEM, { action: "config_restore", file: backupFile.name });
        return { success: true };
    } catch (e: unknown) {
        // Same contract as the API routes: a missing key is answerable, so it comes back as
        // a prompt for one rather than as a failure message.
        if (e instanceof EncryptionKeyRequiredError) {
            return { success: false, code: "ENCRYPTION_KEY_REQUIRED" as const, profileId: e.profileId ?? "unknown" };
        }
        log.error("Offline restore failed", {}, wrapError(e));
        return { success: false, error: getErrorMessage(e) || "Failed to restore configuration" };
    } finally {
        // Cleanup
        try {
            if (await fs.stat(tempBackupPath).catch(() => false)) await fs.unlink(tempBackupPath);
            if (tempMetaPath && await fs.stat(tempMetaPath).catch(() => false)) await fs.unlink(tempMetaPath);
        } catch (cleanupErr: unknown) {
            log.warn("Temp cleanup failed", {}, wrapError(cleanupErr));
        }
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
