"use server";

import { checkPermission } from "@/lib/access-control";
import { PERMISSIONS } from "@/lib/permissions";
import { ConfigService } from "@/services/config-service";
import { RestoreOptions } from "@/lib/types/config-backup";
import { runConfigBackup } from "@/lib/runner/config-runner";
import { getTempDir } from "@/lib/temp-dir";
import { promises as fs } from "fs";
import path from "path";
import { logger } from "@/lib/logger";
import { wrapError, getErrorMessage } from "@/lib/errors";

const log = logger.child({ action: "config-management" });
const configService = new ConfigService();

/**
 * Trigger the Automated Config Backup Logic Manually
 */
export async function triggerManualConfigBackupAction() {
    await checkPermission(PERMISSIONS.SETTINGS.WRITE);
    try {
        // Trigger the runner async (fire & forget from UI perspective, but we await completion to inform user)
        // Actually, runConfigBackup is async.
        await runConfigBackup();
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
    await checkPermission(PERMISSIONS.SETTINGS.WRITE);

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
        const configData = await configService.parseBackupFile(tempBackupPath, tempMetaPath);

        // 4. Import
        await configService.import(configData, strategy);

        return { success: true };
    } catch (e: unknown) {
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
    await checkPermission(PERMISSIONS.SETTINGS.WRITE);

    try {
        const executionId = await configService.restoreFromStorage(storageConfigId, file, decryptionProfileId, options);
        return { success: true, executionId };
    } catch (error: unknown) {
        log.error("Restore from storage error", {}, wrapError(error));
        return {
            success: false,
            error: error instanceof Error ? error.message : "Failed to initiate restore"
        };
    }
}
