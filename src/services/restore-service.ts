import prisma from "@/lib/prisma";
import { registry } from "@/lib/core/registry";
import { registerAdapters } from "@/lib/adapters";
import { StorageAdapter, DatabaseAdapter, BackupMetadata } from "@/lib/core/interfaces";
import { decryptConfig } from "@/lib/crypto";
import { compareVersions } from "@/lib/utils";
import path from "path";
import os from "os";
import fs from "fs";
import { pipeline } from "stream/promises";
import { createReadStream, createWriteStream } from "fs";
import { getProfileMasterKey } from "@/services/encryption-service";
import { createDecryptionStream } from "@/lib/crypto-stream";
import { getDecompressionStream, CompressionType } from "@/lib/compression";
import { LogEntry, LogLevel, LogType } from "@/lib/core/logs";

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

        // Version Compatibility Check
        const storageConfig = await prisma.adapterConfig.findUnique({ where: { id: storageConfigId } });
        if (storageConfig && targetConfig.type === 'database') {
            const storageAdapter = registry.get(storageConfig.adapterId) as StorageAdapter;
            const targetAdapter = registry.get(targetConfig.adapterId) as DatabaseAdapter;

            if (storageAdapter && storageAdapter.read && targetAdapter && targetAdapter.test) {
                try {
                    const storageConf = decryptConfig(JSON.parse(storageConfig.config));
                    const metaPath = file + ".meta.json";
                    const metadataContent = await storageAdapter.read(storageConf, metaPath);

                    if (metadataContent) {
                        const metadata = JSON.parse(metadataContent) as BackupMetadata;
                        if (metadata.engineVersion) {
                            const dbConf = decryptConfig(JSON.parse(targetConfig.config));
                            if (privilegedAuth) dbConf.privilegedAuth = privilegedAuth;

                            const testResult = await targetAdapter.test(dbConf);
                            if (testResult.success && testResult.version) {
                                // Check if Source (Backup) > Target (Current Server)
                                if (compareVersions(metadata.engineVersion, testResult.version) > 0) {
                                     throw new Error(`Running restore of a newer database version (${metadata.engineVersion}) on an older server (${testResult.version}) is not recommended. This can cause severe incompatibility issues.`);
                                }
                            }
                        }
                    }
                } catch (e: any) {
                    if (e.message && e.message.includes('not recommended')) {
                        throw e;
                    }
                    // Ignore metadata read errors (e.g. file missing) or other non-critical issues
                    console.warn(`[RestoreService] Version check skipped: ${e.message}`);
                }
            }
        }

        // Initial Structured Log
        const initialLog: LogEntry = {
            timestamp: new Date().toISOString(),
            message: `Starting restore for ${path.basename(file)}`,
            level: 'info',
            type: 'general',
            stage: 'Initializing'
        };

        // Start Logging Execution
        const execution = await prisma.execution.create({
            data: {
                type: 'Restore',
                status: 'Running',
                logs: JSON.stringify([initialLog]),
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
        const internalLogs: LogEntry[] = [{
            timestamp: new Date().toISOString(),
            message: `Starting restore for ${path.basename(file)}`,
            level: 'info',
            type: 'general',
            stage: 'Initializing'
        }];

        // State
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

        const log = (msg: string, level: LogLevel = 'info', type: LogType = 'general', details?: string) => {
            const entry: LogEntry = {
                timestamp: new Date().toISOString(),
                message: msg,
                level: level,
                type: type,
                stage: currentStage,
                details: details
            };
            internalLogs.push(entry);
            flushLogs(level === 'error'); // Force flush on error
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

            log(`Initiating restore process...`, 'info');

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
            updateProgress(5, "Downloading");
            log(`Downloading backup file: ${file}...`, 'info');
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
                        log("Detected encrypted backup.", 'info');
                    }
                    if (metadata.compression && metadata.compression !== 'NONE') {
                        compressionMeta = metadata.compression;
                        log(`Detected ${compressionMeta} compression.`, 'info');
                    }

                    // Version Check
                    if (metadata.engineVersion) {
                        const usageConfig = { ...decryptConfig(JSON.parse(sourceConfig.config)) };
                         if (privilegedAuth) {
                           usageConfig.privilegedAuth = privilegedAuth;
                           // Some adapters might need user/pass merged to root
                           if (privilegedAuth.user) usageConfig.user = privilegedAuth.user;
                           if (privilegedAuth.password) usageConfig.password = privilegedAuth.password;
                        }

                        try {
                            const test = await sourceAdapter.test?.(usageConfig);
                            if (test?.success && test.version) {
                                log(`Compatibility Check: Backup Version [${metadata.engineVersion}] vs Target [${test.version}]`, 'info');
                                // Simple string comparison for major versions could be added here
                                if (parseFloat(metadata.engineVersion) > parseFloat(test.version)) {
                                    log(`WARNING: You are restoring a newer version backup (${metadata.engineVersion}) to an older database (${test.version}). This might fail.`, 'warning');
                                }
                            }
                        } catch { /* ignore connection tests during restore init */ }
                    }

                    await fs.promises.unlink(tempMetaPath).catch(() => {});
                }
            } catch (e: any) {
                log(`Warning: Failed to check sidecar metadata: ${e.message}`, 'warning');

                // Fallback: Extension based detection
                if (file.endsWith('.enc')) {
                    log("Fallback: Detected encryption via .enc extension", 'warning');
                    // We can't proceed with fallback encryption as we need IV/AuthTag from metadata
                    throw new Error("Encrypted file detected but metadata missing. Cannot decrypt without IV/AuthTag.");
                }
                if (file.endsWith('.gz')) compressionMeta = 'GZIP';
                if (file.endsWith('.br')) compressionMeta = 'BROTLI';
            }
            // --- END METADATA CHECK ---


            const downloadSuccess = await storageAdapter.download(sConf, file, tempFile, (processed, total) => {
                const percent = total > 0 ? Math.round((processed / total) * 100) : 0;
                // Only log sparingly or update progress
                if (percent % 10 === 0 && percent > 0) {
                     // We don't want to spam logs
                }
                updateProgress(Math.floor(percent / 2), "Downloading"); // Map download to 0-50% overall? Or just use stage "Downloading"
            });

            if (!downloadSuccess) {
                throw new Error("Failed to download file from storage");
            }
            log(`Download complete.`, 'success');

            // --- DECRYPTION EXECUTION ---
            if (isEncrypted && encryptionMeta) {
                try {
                    updateProgress(0, "Decrypting");
                    log(`Decrypting backup (Profile: ${encryptionMeta.profileId})...`, 'info');

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

                    log("Decryption successful.", 'success');

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
                    log(`Decompressing backup (${compressionMeta})...`, 'info');
                    updateProgress(0, "Decompressing");

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

                        log("Decompression successful.", 'success');

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
            updateProgress(0, "Restoring Database");
            log(`Starting database restore on ${sourceConfig.name}...`, 'info');

            const dbConf = decryptConfig(JSON.parse(sourceConfig.config));
            // Inject adapterId as type for Dialect selection
            dbConf.type = sourceConfig.adapterId;

            // CRITICAL: Detect target server version for version-matched binary selection
            if (sourceAdapter.test) {
                try {
                    const testConf = { ...dbConf };
                    if (privilegedAuth) {
                        testConf.privilegedAuth = privilegedAuth;
                    }

                    const testResult = await sourceAdapter.test(testConf);
                    if (testResult.success && testResult.version) {
                        dbConf.detectedVersion = testResult.version;
                        log(`Target server version: ${testResult.version}`, 'info');
                    } else {
                        log('Could not detect target server version, using default binary', 'warning');
                    }
                } catch (e: any) {
                    log(`Version detection failed: ${e.message}`, 'warning');
                }
            }

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
                // Determine level based on msg content
                let level: LogLevel = 'info';
                const lower = msg.toLowerCase();
                if (lower.includes('error') || lower.includes('fail') || lower.includes('fatal')) level = 'error';
                else if (lower.includes('warn')) level = 'warning';

                log(msg, level);
            }, (p) => {
                updateProgress(p, "Restoring Database");
            });

            if (!restoreResult.success) {
                if (restoreResult.error) {
                    log(restoreResult.error, 'error');
                }

                log(`Restore adapter reported failure. Check logs above.`, 'error');
                updateProgress(100, "Failed");

                await prisma.execution.update({
                    where: { id: executionId },
                    data: {
                        status: 'Failed',
                        endedAt: new Date(),
                        logs: JSON.stringify(internalLogs)
                    }
                });
            } else {
                log(`Restore completed successfully.`, 'success');
                updateProgress(100, "Completed");
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
            log(`Fatal Error: ${error.message}`, 'error');
            updateProgress(100, "Failed");

            await prisma.execution.update({
                where: { id: executionId },
                data: { status: 'Failed', endedAt: new Date(), logs: JSON.stringify(internalLogs) }
            });
        } finally {
            if (tempFile && fs.existsSync(tempFile)) {
                try { fs.unlinkSync(tempFile); } catch {}
            }
            flushLogs(true);
        }
    }
}

export const restoreService = new RestoreService();
