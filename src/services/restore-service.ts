import prisma from "@/lib/prisma";
import { registry } from "@/lib/core/registry";
import { registerAdapters } from "@/lib/adapters";
import { StorageAdapter, DatabaseAdapter, BackupMetadata } from "@/lib/core/interfaces";
import { decryptConfig } from "@/lib/crypto";
import { formatBytes } from "@/lib/utils";
import path from "path";
import os from "os";
import fs from "fs";
import { pipeline } from "stream/promises";
import { createReadStream, createWriteStream } from "fs";
import { getProfileMasterKey } from "@/services/encryption-service";
import { createDecryptionStream } from "@/lib/crypto-stream";
import { getDecompressionStream, CompressionType } from "@/lib/compression";

// Ensure adapters are loaded
registerAdapters();

export interface RestoreInput {
    storageConfigId: string;
    file: string;
    targetSourceId: string;
    targetDatabaseName?: string;
    databaseMapping?: Record<string, string> | any[];
    privilegedAuth?: {
        user?: string;
        password?: string;
    };
}

export class RestoreService {
    async restore(input: RestoreInput) {
        const { file, storageConfigId, targetSourceId, targetDatabaseName, databaseMapping, privilegedAuth } = input;

        // Pre-flight check: Verify Permissions / Connectivity if supported
        const targetConfig = await prisma.adapterConfig.findUnique({ where: { id: targetSourceId } });
        if (!targetConfig) throw new Error("Target source not found");

        if (targetConfig.type === 'database') {
            const targetAdapter = registry.get(targetConfig.adapterId) as DatabaseAdapter;
            if (targetAdapter && targetAdapter.prepareRestore) {
                let dbsToCheck: string[] = [];

                if (Array.isArray(databaseMapping)) {
                    // Handle array format (from UI)
                    dbsToCheck = databaseMapping
                        .filter((m: any) => m.selected)
                        .map((m: any) => m.targetName || m.originalName);
                } else if (databaseMapping) {
                    // Handle Record format
                    dbsToCheck = Object.values(databaseMapping);
                } else if (targetDatabaseName) {
                    dbsToCheck = [targetDatabaseName];
                }

                if (dbsToCheck.length > 0) {
                    const dbConf = decryptConfig(JSON.parse(targetConfig.config));
                    if (privilegedAuth) dbConf.privilegedAuth = privilegedAuth;

                    await targetAdapter.prepareRestore(dbConf, dbsToCheck);
                }
            }
        }

        // Start Logging Execution
        const execution = await prisma.execution.create({
            data: {
                type: 'Restore',
                status: 'Running',
                logs: JSON.stringify([`Starting restore for ${file}`]),
                startedAt: new Date(),
                path: file,
                metadata: JSON.stringify({ progress: 0, stage: 'Initializing' })
            }
        });
        const executionId = execution.id;

        // Run in background (do not await)
        this.runRestoreProcess(executionId, input).catch(err => {
            console.error(`Background restore failed for ${executionId}:`, err);
        });

        return { success: true, executionId, message: "Restore started" };
    }

    private async runRestoreProcess(executionId: string, input: RestoreInput) {
        const { storageConfigId, file, targetSourceId, targetDatabaseName, databaseMapping, privilegedAuth } = input;
        let tempFile: string | null = null;

        // Log Buffer
        let internalLogs: string[] = [`Starting restore for ${file}`];
        let lastLogUpdate = Date.now();
        let currentProgress = 0;
        let currentStage = "Initializing";

        const flushLogs = async (force = false) => {
            const now = Date.now();
            if (force || now - lastLogUpdate > 1000) { // Update every 1 second
                await prisma.execution.update({
                    where: { id: executionId },
                    data: {
                        logs: JSON.stringify(internalLogs),
                        metadata: JSON.stringify({ progress: currentProgress, stage: currentStage })
                    }
                }).catch(() => {});
                lastLogUpdate = now;
            }
        };

        const log = (msg: string) => {
            internalLogs.push(msg);
            flushLogs(); // Throttled
        };

        const updateProgress = (p: number, stage?: string) => {
             currentProgress = p;
             if (stage) currentStage = stage;
             flushLogs();
        };

        try {
            if (!file || !targetSourceId) {
                throw new Error("Missing file or targetSourceId");
            }

            log(`Initiating restore process...`);

            // 1. Get Storage Adapter
            const storageConfig = await prisma.adapterConfig.findUnique({ where: { id: storageConfigId } });
            if (!storageConfig || storageConfig.type !== "storage") {
                throw new Error("Storage adapter not found");
            }

            const storageAdapter = registry.get(storageConfig.adapterId) as StorageAdapter;
            if (!storageAdapter) {
                throw new Error("Storage impl missing");
            }

            // 2. Get Source Adapter
            const sourceConfig = await prisma.adapterConfig.findUnique({ where: { id: targetSourceId } });
            if (!sourceConfig || sourceConfig.type !== "database") {
                throw new Error("Source adapter not found");
            }

            const sourceAdapter = registry.get(sourceConfig.adapterId) as DatabaseAdapter;
            if (!sourceAdapter) {
                throw new Error("Source impl missing");
            }

            // 3. Download File
            log(`Downloading backup file: ${file}...`);
            const tempDir = os.tmpdir();
            tempFile = path.join(tempDir, path.basename(file));

            const sConf = decryptConfig(JSON.parse(storageConfig.config));

            // --- METADATA & COMPRESSION/ENCRYPTION CHECK ---
            let isEncrypted = false;
            let encryptionMeta: BackupMetadata['encryption'] = undefined;
            let compressionMeta: CompressionType | undefined = undefined;

            try {
                const metaRemotePath = file + ".meta.json";
                const tempMetaPath = path.join(os.tmpdir(), "meta_" + Date.now() + ".json");

                // Try to download metadata to check for encryption/compression
                const metaDownSuccess = await storageAdapter.download(sConf, metaRemotePath, tempMetaPath, () => {}).catch(() => false);

                if (metaDownSuccess) {
                    const metaContent = await fs.promises.readFile(tempMetaPath, 'utf-8');
                    const metadata = JSON.parse(metaContent);

                    if (metadata.encryption && metadata.encryption.enabled) {
                        isEncrypted = true;
                        encryptionMeta = metadata.encryption;
                        log("Detected encrypted backup.");
                    }
                    if (metadata.compression && metadata.compression !== 'NONE') {
                        compressionMeta = metadata.compression;
                        log(`Detected ${compressionMeta} compression.`);
                    }
                    await fs.promises.unlink(tempMetaPath).catch(() => {});
                }
            } catch (e: any) {
                log(`Warning: Failed to check sidecar metadata: ${e.message}`);

                // Fallback: Extension based detection
                if (file.endsWith('.enc')) {
                    log("Fallback: Detected encryption via .enc extension");
                    // We can't proceed with fallback encryption as we need IV/AuthTag from metadata
                    throw new Error("Encrypted file detected but metadata missing. Cannot decrypt without IV/AuthTag.");
                }
                if (file.endsWith('.gz')) compressionMeta = 'GZIP';
                if (file.endsWith('.br')) compressionMeta = 'BROTLI';
            }
            // --- END METADATA CHECK ---


            const downloadSuccess = await storageAdapter.download(sConf, file, tempFile, (processed, total) => {
                const percent = total > 0 ? Math.round((processed / total) * 100) : 0;
                const stageText = `Downloading (${formatBytes(processed)} / ${formatBytes(total)})`;
                updateProgress(percent, stageText);
            });

            if (!downloadSuccess) {
                throw new Error("Failed to download file from storage");
            }
            log(`Download complete.`);

            // --- DECRYPTION EXECUTION ---
            if (isEncrypted && encryptionMeta) {
                try {
                    log(`Decrypting backup (Profile: ${encryptionMeta.profileId})...`);
                    updateProgress(0, "Decrypting Backup...");

                    const masterKey = await getProfileMasterKey(encryptionMeta.profileId);
                    const iv = Buffer.from(encryptionMeta.iv, 'hex');
                    const authTag = Buffer.from(encryptionMeta.authTag, 'hex');

                    const decryptStream = createDecryptionStream(masterKey, iv, authTag);

                    // Logic to determine output filename (strip .enc)
                    let decryptedTempFile = tempFile;
                    if (tempFile.endsWith('.enc')) {
                        decryptedTempFile = tempFile.slice(0, -4);
                    } else {
                        decryptedTempFile = tempFile + ".dec";
                    }

                    await pipeline(
                        createReadStream(tempFile),
                        decryptStream,
                        createWriteStream(decryptedTempFile)
                    );

                    log("Decryption successful.");

                    // Cleanup encrypted file
                    await fs.promises.unlink(tempFile);

                    // Switch to decrypted file for restore/decompression
                    tempFile = decryptedTempFile;

                } catch (e: any) {
                    throw new Error(`Decryption failed: ${e.message}`);
                }
            }
            // --- END DECRYPTION EXECUTION ---

            // --- DECOMPRESSION EXECUTION ---
            if (compressionMeta && compressionMeta !== 'NONE') {
                try {
                    log(`Decompressing backup (${compressionMeta})...`);
                    updateProgress(0, "Decompressing Backup...");

                    const decompStream = getDecompressionStream(compressionMeta);
                    if (decompStream) {
                        let unpackedFile = tempFile;
                        // Strip extension if present
                        if (tempFile.endsWith('.gz') || tempFile.endsWith('.br')) {
                            unpackedFile = tempFile.slice(0, -3); // remove .gz or .br
                        } else {
                            unpackedFile = tempFile + ".unpacked";
                        }

                        await pipeline(
                            createReadStream(tempFile),
                            decompStream,
                            createWriteStream(unpackedFile)
                        );

                        log("Decompression successful.");

                        // Cleanup compressed file
                        await fs.promises.unlink(tempFile);

                        // Switch file pointer
                        tempFile = unpackedFile;
                    }
                } catch (e: any) {
                    throw new Error(`Decompression failed: ${e.message}`);
                }
            }
            // --- END DECOMPRESSION EXECUTION ---

            // 4. Restore
            log(`Starting database restore on ${sourceConfig.name}...`);

            const totalSize = fs.statSync(tempFile).size;
            updateProgress(0, `Restoring (0 B / ${formatBytes(totalSize)})...`);

            const dbConf = decryptConfig(JSON.parse(sourceConfig.config));
            // Inject adapterId as type for Dialect selection
            dbConf.type = sourceConfig.adapterId;

            // Override database name if provided
            if (targetDatabaseName) {
                dbConf.database = targetDatabaseName;
            }

            // Pass database mapping if provided
            if (databaseMapping) {
                dbConf.databaseMapping = databaseMapping;
            }

            // Add privileged auth if provided
            if (privilegedAuth) {
                dbConf.privilegedAuth = privilegedAuth;
            }

            const restoreResult = await sourceAdapter.restore(dbConf, tempFile, (msg) => {
                log(msg); // Live logs from adapter
            }, (p) => {
                // If the adapter gives us raw bytes implicitly or checks file stream we might get percentage.
                // Adapters typically return 0-100 number.
                // We can reconstruct "processed bytes" estimate for display if we want, or just update the percentage.
                // For accurate bytes, we'd need to change adapter interface again, but percentage + total size is good enough for "Restoring (X / Total)..."
                // Estimate processed:
                const estimatedProcessed = Math.floor((p / 100) * totalSize);
                updateProgress(p, `Restoring (${formatBytes(estimatedProcessed)} / ${formatBytes(totalSize)})`);
            });

            if (!restoreResult.success) {
                // Final update
                // internalLogs.push(...restoreResult.logs); // logs are live streamed via callback, no need to append or replace
                await prisma.execution.update({
                    where: { id: executionId },
                    data: {
                        status: 'Failed',
                        endedAt: new Date(),
                        logs: JSON.stringify(internalLogs)
                    }
                });
            } else {
                // internalLogs.push(...restoreResult.logs);
                log(`Restore completed successfully.`);
                await prisma.execution.update({
                    where: { id: executionId },
                    data: {
                        status: 'Success',
                        endedAt: new Date(),
                        logs: JSON.stringify(internalLogs)
                    }
                });
            }

        } catch (error: any) {
            console.error("Restore service error:", error);
            log(`Fatal Error: ${error.message}`);
            await prisma.execution.update({
                where: { id: executionId },
                data: { status: 'Failed', endedAt: new Date(), logs: JSON.stringify(internalLogs) }
            });
        } finally {
            if (tempFile && fs.existsSync(tempFile)) {
                try { fs.unlinkSync(tempFile); } catch {}
            }
        }
    }
}

export const restoreService = new RestoreService();
