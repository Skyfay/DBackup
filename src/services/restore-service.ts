import prisma from "@/lib/prisma";
import { registry } from "@/lib/core/registry";
import { registerAdapters } from "@/lib/adapters";
import { StorageAdapter, DatabaseAdapter, BackupMetadata } from "@/lib/core/interfaces";
import { decryptConfig } from "@/lib/crypto";
import { compareVersions } from "@/lib/utils";
import { getTempDir } from "@/lib/temp-dir";
import path from "path";
import fs from "fs";
import { pipeline } from "stream/promises";
import { createReadStream, createWriteStream } from "fs";
import { getProfileMasterKey, getEncryptionProfiles } from "@/services/encryption-service";
import { createDecryptionStream } from "@/lib/crypto-stream";
import { getDecompressionStream, CompressionType } from "@/lib/compression";
import { LogEntry, LogLevel, LogType } from "@/lib/core/logs";
import { isMultiDbTar, readTarManifest } from "@/lib/adapters/database/common/tar-utils";
import { logger } from "@/lib/logger";
import { wrapError, getErrorMessage } from "@/lib/errors";

const svcLog = logger.child({ service: "RestoreService" });

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

                        // STRICT TYPE CHECK: Prevent Cross-Vendor Restores (e.g. MySQL -> MariaDB)
                        if (metadata.sourceType && metadata.sourceType !== targetConfig.adapterId) {
                            throw new Error(`Incompatible database types: Cannot restore backup from '${metadata.sourceType}' to '${targetConfig.adapterId}'. Strict type matching is enforced to prevent corruption.`);
                        }

                        if (metadata.engineVersion) {
                            const dbConf = decryptConfig(JSON.parse(targetConfig.config));
                            if (privilegedAuth) dbConf.privilegedAuth = privilegedAuth;

                            const testResult = await targetAdapter.test(dbConf) as { success: boolean; version?: string; edition?: string };
                            if (testResult.success && testResult.version) {
                                // Check if Source (Backup) > Target (Current Server)
                                if (compareVersions(metadata.engineVersion, testResult.version) > 0) {
                                     throw new Error(`Running restore of a newer database version (${metadata.engineVersion}) on an older server (${testResult.version}) is not recommended. This can cause severe incompatibility issues.`);
                                }

                                // MSSQL Edition Compatibility Check: Azure SQL Edge <-> SQL Server
                                if (targetConfig.adapterId === 'mssql' && metadata.engineEdition && testResult.edition) {
                                    const sourceIsEdge = metadata.engineEdition === 'Azure SQL Edge';
                                    const targetIsEdge = testResult.edition === 'Azure SQL Edge';

                                    if (sourceIsEdge !== targetIsEdge) {
                                        throw new Error(
                                            `Incompatible MSSQL editions: Cannot restore backup from '${metadata.engineEdition}' to '${testResult.edition}'. ` +
                                            `Azure SQL Edge and SQL Server are not fully compatible despite having similar version numbers.`
                                        );
                                    }
                                }
                            }
                        }
                    }
                } catch (e: unknown) {
                    const errMsg = getErrorMessage(e);
                    if (errMsg.includes('not recommended') || errMsg.includes('Incompatible') || errMsg.includes('Azure SQL Edge')) {
                        throw e;
                    }
                    // Ignore metadata read errors (e.g. file missing) or other non-critical issues
                    svcLog.warn("Version check skipped", {}, wrapError(e));
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
            svcLog.error("Background restore failed", { executionId }, wrapError(err));
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
            const tempDir = getTempDir();
            tempFile = path.join(tempDir, path.basename(file));

            const sConf = decryptConfig(JSON.parse(storageConfig.config));

            // --- METADATA & COMPRESSION/ENCRYPTION CHECK ---
            let isEncrypted = false;
            let encryptionMeta: BackupMetadata['encryption'] = undefined;
            let compressionMeta: CompressionType | undefined = undefined;

            try {
                const metaRemotePath = file + ".meta.json";
                const tempMetaPath = path.join(getTempDir(), "meta_" + Date.now() + ".json");

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
            } catch (e: unknown) {
                const message = e instanceof Error ? e.message : String(e);
                log(`Warning: Failed to check sidecar metadata: ${message}`, 'warning');

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
                updateProgress(0, "Decrypting"); // Set stage to Decrypting immediately

                let masterKey: Buffer;

                try {
                    masterKey = await getProfileMasterKey(encryptionMeta.profileId);
                } catch (_keyError) {
                    log(`Profile ${encryptionMeta.profileId} not found. Attempting Smart Recovery...`, 'warning');


                    const allProfiles = await getEncryptionProfiles();
                    let foundKey: Buffer | null = null;
                    let matchProfileName = "";

                    // Helper to check if a key candidate produces valid output
                    const checkKeyCandidate = async (candidateKey: Buffer): Promise<boolean> => {
                        return new Promise((resolve) => {
                            const iv = Buffer.from(encryptionMeta!.iv, 'hex');
                            const authTag = Buffer.from(encryptionMeta!.authTag, 'hex');

                            try {
                                const decipher = createDecryptionStream(candidateKey, iv, authTag);
                                const input = createReadStream(tempFile!, { start: 0, end: 1024 }); // Check first 1KB

                                let isValid = true; // Assume valid unless proven otherwise

                                // Pipe to heuristic check
                                if (compressionMeta && compressionMeta !== 'NONE') {
                                    // With compression: Decrypt -> Decompress -> Error?
                                    const decompressor = getDecompressionStream(compressionMeta);
                                    if (!decompressor) return resolve(false);

                                    decipher.on('error', () => { isValid = false; resolve(false); });
                                    decompressor.on('error', () => { isValid = false; resolve(false); });

                                    // If we get 'data' from decompressor, it means header was valid!
                                    decompressor.on('data', () => {
                                        // Once we got some data without crashing, it's a strong positive
                                        resolve(true);
                                        input.destroy(); // Stop reading
                                    });

                                    input.pipe(decipher).pipe(decompressor);
                                } else {
                                    // No compression: Decrypt -> Check for text/magic bytes
                                    decipher.on('error', () => { isValid = false; resolve(false); });
                                    decipher.on('data', (chunk: Buffer) => {
                                        // Simple heuristic: If SQL/Text, should be mostly printable ASCII/UTF8
                                        // If random noise, we get lots of control chars
                                        const printable = chunk.toString('utf8').replace(/[^\x20-\x7E]/g, '').length;
                                        const ratio = printable / chunk.length;
                                        if (ratio > 0.7) { // 70% printable
                                            resolve(true);
                                        } else {
                                            resolve(false);
                                        }
                                        input.destroy();
                                    });
                                    input.pipe(decipher);
                                }

                                // Handling stream end without data (empty file?)
                                input.on('end', () => {
                                    if (isValid) resolve(true); // Should have resolved in 'data' usually
                                });

                            } catch (_e) {
                                resolve(false);
                            }
                        });
                    };

                    for (const profile of allProfiles) {
                        try {
                            const candidateKey = await getProfileMasterKey(profile.id);
                            const isMatch = await checkKeyCandidate(candidateKey);
                            if (isMatch) {
                                foundKey = candidateKey;
                                matchProfileName = profile.name;
                                break;
                            }
                        } catch (_e) { /* ignore */ }
                    }

                    if (foundKey) {
                        log(`Smart Recovery Successful: Matched key from profile '${matchProfileName}'.`, 'success');
                        masterKey = foundKey;
                    } else {
                        throw new Error(`Profile ${encryptionMeta.profileId} missing, and no other profile could decrypt this file.`);
                    }
                }

                try {
                    // Update progress usually resets logs or status, but we are already in Decrypting.
                    // We just log that we are proceeding.
                    log(`Starting decryption process...`, 'info');

                    // If we found a fallback key, log it again just to be sure
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

                } catch (e: unknown) {
                    const message = e instanceof Error ? e.message : String(e);
                    throw new Error(`Decryption failed: ${message}`);
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
                } catch (e: unknown) {
                    const message = e instanceof Error ? e.message : String(e);
                    throw new Error(`Decompression failed: ${message}`);
                }
            }
            // --- END DECOMPRESSION EXECUTION ---

            // --- MULTI-DB TAR DETECTION ---
            // Check if the backup is a Multi-DB TAR archive and log contained databases
            try {
                if (await isMultiDbTar(tempFile)) {
                    const manifest = await readTarManifest(tempFile);
                    if (manifest) {
                        log(`Multi-DB TAR archive detected: ${manifest.databases.length} databases`, 'info');
                        manifest.databases.forEach(db => {
                            log(`  - ${db.name} (${db.format}, ${db.size} bytes)`, 'info');
                        });
                    }
                }
            } catch (e: unknown) {
                // Non-fatal: just informational
                const message = e instanceof Error ? e.message : String(e);
                log(`Note: Could not check for Multi-DB TAR format: ${message}`, 'info');
            }
            // --- END MULTI-DB TAR DETECTION ---

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
                } catch (e: unknown) {
                    const message = e instanceof Error ? e.message : String(e);
                    log(`Version detection failed: ${message}`, 'warning');
                }
            }

            // Override database name if provided
            if (targetDatabaseName) {
                if (sourceConfig.adapterId === 'sqlite' && dbConf.path) {
                    const dir = path.dirname(dbConf.path);
                    dbConf.path = path.join(dir, targetDatabaseName);
                } else {
                    // Store original database name for adapters that need it (e.g., MongoDB nsFrom/nsTo)
                    dbConf.originalDatabase = dbConf.database;
                    dbConf.targetDatabaseName = targetDatabaseName;
                    dbConf.database = targetDatabaseName;
                }
            }

            // Pass database mapping if provided
            if (databaseMapping) {
                dbConf.databaseMapping = databaseMapping;
            }

            // Add privileged auth if provided
            if (privilegedAuth) {
                dbConf.privilegedAuth = privilegedAuth;
            }

            const restoreResult = await sourceAdapter.restore(dbConf, tempFile, (msg, level?: LogLevel, type?: LogType, details?: string) => {
                // Use provided level, or determine based on msg content
                let finalLevel: LogLevel = level || 'info';

                // Only auto-detect level if not explicitly provided
                if (!level) {
                    const lower = msg.toLowerCase();
                    // Check for actual errors, not just presence of error-related words
                    // "0 failures" or "0 document(s) failed" are success messages
                    const hasActualError = (lower.includes('error') && !lower.includes('0 error')) ||
                                          (lower.includes('fail') && !lower.match(/0\s+(document|failure|failed)/));
                    if (hasActualError || lower.includes('fatal')) finalLevel = 'error';
                    else if (lower.includes('warn')) finalLevel = 'warning';
                }

                log(msg, finalLevel, type, details);
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

        } catch (error: unknown) {
            svcLog.error("Restore service error", {}, wrapError(error));
            log(`Fatal Error: ${getErrorMessage(error)}`, 'error');
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
