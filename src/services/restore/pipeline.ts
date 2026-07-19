import prisma from "@/lib/prisma";
import { registry } from "@/lib/core/registry";
import { StorageAdapter, DatabaseAdapter, BackupMetadata } from "@/lib/core/interfaces";
import { resolveAdapterConfig } from "@/lib/adapters/config-resolver";
import { formatDuration, formatBytes } from "@/lib/utils";
import { getTempDir } from "@/lib/temp-dir";
import path from "path";
import fs from "fs";
import { pipeline } from "stream/promises";
import { createReadStream, createWriteStream } from "fs";
import { Transform } from "stream";
import { createDecryptionStream } from "@/lib/crypto/stream";
import { getDecompressionStream, CompressionType } from "@/lib/crypto/compression";
import { LogEntry, LogLevel, LogType } from "@/lib/core/logs";
import { isMultiDbTar, readTarManifest, readManifestVersion } from "@/lib/adapters/database/common/tar-utils";
import { logger } from "@/lib/logging/logger";
import { wrapError, getErrorMessage } from "@/lib/logging/errors";
import { verifyFileChecksum } from "@/lib/crypto/checksum";
import { notify } from "@/services/notifications/system-notification-service";
import { NOTIFICATION_EVENTS } from "@/lib/notifications";
import { registerExecution, unregisterExecution } from "@/lib/execution/abort";
import { processQueue } from "@/lib/execution/queue-manager";
import type { RestoreInput } from "./types";
import { resolveDecryptionKey } from "./smart-recovery";
import { restoreCombinedArchive } from "./combined-restore";

const svcLog = logger.child({ service: "RestoreService" });

/**
 * The full restore pipeline run as a background task.
 * Handles: download → checksum → decrypt → decompress → multi-db detect → adapter restore.
 *
 * State (executionId, log buffer, stage, progress) is shared across all phases via closures.
 */
export async function runRestorePipeline(executionId: string, input: RestoreInput): Promise<void> {
    const { storageConfigId, file, targetSourceId, targetDatabaseName, databaseMapping, privilegedAuth } = input;
    let tempFile: string | null = null;
    const restoreStartTime = Date.now();
    const abortController = registerExecution(executionId);

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
    let currentDetail: string | null = null;
    const stageStartTimes = new Map<string, number>();
    stageStartTimes.set("Initializing", Date.now());

    const flushLogs = async (force = false) => {
        const now = Date.now();
        if (force || now - lastLogUpdate > 1000) { // Update every 1 second
            await prisma.execution.update({
                where: { id: executionId },
                data: {
                    logs: JSON.stringify(internalLogs),
                    metadata: JSON.stringify({ progress: currentProgress, stage: currentStage, detail: currentDetail })
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
        flushLogs(level === 'error');
    };

    const setStage = (stage: string) => {
        // Log duration of previous stage
        const prevStart = stageStartTimes.get(currentStage);
        if (prevStart && currentStage !== stage) {
            const durationMs = Date.now() - prevStart;
            const isTerminal = stage === "Cancelled" || stage === "Failed";
            const durationEntry: LogEntry = {
                timestamp: new Date().toISOString(),
                message: isTerminal
                    ? `${currentStage} aborted (${formatDuration(durationMs)})`
                    : `${currentStage} completed (${formatDuration(durationMs)})`,
                level: isTerminal ? 'warning' : 'success',
                type: 'general',
                stage: currentStage,
                durationMs
            };
            internalLogs.push(durationEntry);
        }

        currentStage = stage;
        currentDetail = null;
        currentProgress = 0;
        stageStartTimes.set(stage, Date.now());
        flushLogs(true);
    };

    const updateDetail = (detail: string) => {
        currentDetail = detail;
        flushLogs();
    };

    // Pre-resolve names for notification context (available in catch)
    let resolvedSourceName: string | undefined;
    let resolvedSourceType: string | undefined;
    let resolvedStorageName: string | undefined;

    try {
        if (!file) {
            throw new Error("Missing file");
        }

        log(`Initiating restore process...`, 'info');

        // 1. Get Storage Adapter
        const storageConfig = await prisma.adapterConfig.findUnique({ where: { id: storageConfigId } });
        if (!storageConfig || storageConfig.type !== "storage") {
            throw new Error("Storage adapter not found");
        }
        resolvedStorageName = storageConfig.name;

        const storageAdapter = registry.get(storageConfig.adapterId) as StorageAdapter;
        if (!storageAdapter) {
            throw new Error("Storage impl missing");
        }

        // 2. Get Source Adapter (optional - a directory-only archive has no database target;
        // the combined-restore path resolves its own target when the archive turns out to
        // contain database entries. Kept here too since v1 archives - the vast majority -
        // still expect it resolved up front, and it doubles as the version-compat check below.)
        let sourceConfig: Awaited<ReturnType<typeof prisma.adapterConfig.findUnique>> | null = null;
        let sourceAdapter: DatabaseAdapter | undefined;
        if (targetSourceId) {
            sourceConfig = await prisma.adapterConfig.findUnique({ where: { id: targetSourceId } });
            if (!sourceConfig || sourceConfig.type !== "database") {
                throw new Error("Source adapter not found");
            }
            resolvedSourceName = sourceConfig.name;
            resolvedSourceType = sourceConfig.adapterId;

            sourceAdapter = registry.get(sourceConfig.adapterId) as DatabaseAdapter;
            if (!sourceAdapter) {
                throw new Error("Source impl missing");
            }
        }

        // 3. Download File
        setStage("Downloading");
        log(`Downloading backup file: ${file}...`, 'info');
        const tempDir = getTempDir();
        tempFile = path.join(tempDir, path.basename(file));

        const sConf = await resolveAdapterConfig(storageConfig) as any;

        // --- METADATA & COMPRESSION/ENCRYPTION CHECK ---
        let isEncrypted = false;
        let encryptionMeta: BackupMetadata['encryption'] = undefined;
        let compressionMeta: CompressionType | undefined = undefined;
        let expectedChecksum: string | undefined = undefined;

        try {
            const metaRemotePath = file + ".meta.json";
            const tempMetaPath = path.join(getTempDir(), "meta_" + Date.now() + ".json");

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
                if (metadata.checksum) {
                    expectedChecksum = metadata.checksum;
                    log(`Checksum found in metadata (SHA-256).`, 'info');
                }

                // Version Check (informational - hard guard already done in preflight).
                // Only meaningful when a database target was actually resolved above.
                if (metadata.engineVersion && sourceConfig && sourceAdapter) {
                    const usageConfig = { ...(await resolveAdapterConfig(sourceConfig) as any) };
                    if (privilegedAuth) {
                        usageConfig.privilegedAuth = privilegedAuth;
                        if (privilegedAuth.user) usageConfig.user = privilegedAuth.user;
                        if (privilegedAuth.password) usageConfig.password = privilegedAuth.password;
                    }

                    try {
                        const test = await sourceAdapter.test?.(usageConfig);
                        if (test?.success && test.version) {
                            log(`Compatibility Check: Backup Version [${metadata.engineVersion}] vs Target [${test.version}]`, 'info');
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
                throw new Error("Encrypted file detected but metadata missing. Cannot decrypt without IV/AuthTag.");
            }
            if (file.endsWith('.gz')) compressionMeta = 'GZIP';
            if (file.endsWith('.br')) compressionMeta = 'BROTLI';
        }
        // --- END METADATA CHECK ---


        const downloadStartTime = Date.now();
        const downloadSuccess = await storageAdapter.download(sConf, file, tempFile, (processed, total) => {
            const percent = total > 0 ? Math.round((processed / total) * 100) : 0;
            currentProgress = percent;
            if (total > 0) {
                const elapsed = (Date.now() - downloadStartTime) / 1000;
                const speed = elapsed > 0 ? processed / elapsed : 0;
                updateDetail(`${formatBytes(processed)} / ${formatBytes(total)} (${formatBytes(speed)}/s)`);
            }
        });

        if (!downloadSuccess) {
            throw new Error("Failed to download file from storage");
        }
        log(`Download complete.`, 'success');

        // --- CHECKSUM VERIFICATION ---
        if (expectedChecksum) {
            log("Verifying backup integrity (SHA-256)...", 'info');
            try {
                const result = await verifyFileChecksum(tempFile, expectedChecksum);
                if (result.valid) {
                    log("Integrity check passed ✓ (SHA-256 match)", 'success');
                } else {
                    log(`CRITICAL: Integrity check FAILED! Expected: ${result.expected}, Got: ${result.actual}`, 'error');
                    throw new Error("Backup file integrity check failed. The file may be corrupted or tampered with.");
                }
            } catch (e: unknown) {
                if (e instanceof Error && e.message.includes('integrity check failed')) {
                    throw e;
                }
                const message = e instanceof Error ? e.message : String(e);
                log(`Warning: Could not verify checksum: ${message}`, 'warning');
            }
        } else {
            log("No checksum in metadata, skipping integrity verification.", 'info');
        }
        // --- END CHECKSUM VERIFICATION ---

        // --- DECRYPTION EXECUTION ---
        if (isEncrypted && encryptionMeta) {
            setStage("Decrypting");

            const masterKey = await resolveDecryptionKey(
                encryptionMeta,
                tempFile,
                compressionMeta,
                (msg, level) => log(msg, (level ?? 'info') as LogLevel),
            );

            try {
                log(`Starting decryption process...`, 'info');

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

                const encFileSize = (await fs.promises.stat(tempFile)).size;
                const decryptStart = Date.now();
                let decProcessed = 0;
                const decryptTracker = new Transform({
                    transform(chunk, _encoding, callback) {
                        decProcessed += chunk.length;
                        const elapsed = (Date.now() - decryptStart) / 1000;
                        const speed = elapsed > 0 ? Math.round(decProcessed / elapsed) : 0;
                        updateDetail(`${formatBytes(decProcessed)} / ${formatBytes(encFileSize)} – ${formatBytes(speed)}/s`);
                        callback(null, chunk);
                    }
                });

                await pipeline(
                    createReadStream(tempFile),
                    decryptTracker,
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
                setStage("Decompressing");

                const decompStream = getDecompressionStream(compressionMeta);
                if (decompStream) {
                    let unpackedFile = tempFile;
                    if (tempFile.endsWith('.gz') || tempFile.endsWith('.br')) {
                        unpackedFile = tempFile.slice(0, -3);
                    } else {
                        unpackedFile = tempFile + ".unpacked";
                    }

                    const compFileSize = (await fs.promises.stat(tempFile)).size;
                    const decompStart = Date.now();
                    let decompProcessed = 0;
                    const decompTracker = new Transform({
                        transform(chunk, _encoding, callback) {
                            decompProcessed += chunk.length;
                            const elapsed = (Date.now() - decompStart) / 1000;
                            const speed = elapsed > 0 ? Math.round(decompProcessed / elapsed) : 0;
                            updateDetail(`${formatBytes(decompProcessed)} / ${formatBytes(compFileSize)} – ${formatBytes(speed)}/s`);
                            callback(null, chunk);
                        }
                    });

                    await pipeline(
                        createReadStream(tempFile),
                        decompTracker,
                        decompStream,
                        createWriteStream(unpackedFile)
                    );

                    log("Decompression successful.", 'success');

                    await fs.promises.unlink(tempFile);
                    tempFile = unpackedFile;
                }
            } catch (e: unknown) {
                const message = e instanceof Error ? e.message : String(e);
                throw new Error(`Decompression failed: ${message}`);
            }
        }
        // --- END DECOMPRESSION EXECUTION ---

        // --- COMBINED (v2) ARCHIVE DETECTION & RESTORE ---
        // A v2 manifest can only ever come from the combined dump path (JobSource feature),
        // which only runs for jobs with directory sources - so every v2 archive necessarily
        // contains at least one directory entry. There is no "v2 but actually pure-database"
        // case to handle; v1 archives (everything else, forever) fall through unchanged below.
        const manifestVersion = await readManifestVersion(tempFile);
        if (manifestVersion === 2) {
            setStage("Restoring Database");
            const combinedResult = await restoreCombinedArchive(tempFile, input, { log, updateDetail });

            if (combinedResult.status === "Failed") {
                log(`Combined restore failed: no entries could be restored (${combinedResult.errors.map(e => e.error).join('; ')})`, 'error');
                setStage("Failed");
                await prisma.execution.update({
                    where: { id: executionId },
                    data: { status: 'Failed', endedAt: new Date(), logs: JSON.stringify(internalLogs) }
                });
            } else {
                if (combinedResult.status === "Partial") {
                    log(`Combined restore completed with some failures: ${combinedResult.errors.map(e => e.entry).join(', ')}`, 'warning');
                } else {
                    log(`Combined restore completed successfully.`, 'success');
                }
                setStage("Completed");
                await prisma.execution.update({
                    where: { id: executionId },
                    data: { status: combinedResult.status, endedAt: new Date(), logs: JSON.stringify(internalLogs) }
                });

                notify({
                    eventType: NOTIFICATION_EVENTS.RESTORE_COMPLETE,
                    data: {
                        sourceName: resolvedSourceName ?? "Combined archive",
                        databaseType: resolvedSourceType,
                        targetDatabase: targetDatabaseName,
                        backupFile: path.basename(file),
                        storageName: resolvedStorageName,
                        duration: Date.now() - restoreStartTime,
                        executionId,
                        timestamp: new Date().toISOString(),
                    },
                }).catch(() => {});
            }
            return;
        }
        // --- END COMBINED (v2) ARCHIVE DETECTION & RESTORE ---

        // --- MULTI-DB TAR DETECTION (v1, cosmetic - the actual selective restore logic lives
        // inside each adapter's own restore(), see mysql/restore.ts etc.) ---
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
            const message = e instanceof Error ? e.message : String(e);
            log(`Note: Could not check for Multi-DB TAR format: ${message}`, 'info');
        }
        // --- END MULTI-DB TAR DETECTION ---

        // 4. Restore (v1 archives only, by construction - see above)
        if (!sourceConfig || !sourceAdapter) {
            throw new Error("Missing targetSourceId");
        }
        setStage("Restoring Database");
        log(`Starting database restore on ${sourceConfig.name}...`, 'info');

        const dbConf = await resolveAdapterConfig(sourceConfig) as any;
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
                dbConf.originalDatabase = dbConf.database;
                dbConf.targetDatabaseName = targetDatabaseName;
                dbConf.database = targetDatabaseName;
            }
        }

        if (databaseMapping) {
            dbConf.databaseMapping = databaseMapping;

            // For SQLite: getDatabases() returns the filename, so a mapping entry means
            // "restore to a different file name". Translate the selected target name into
            // the adapter path so the restore lands in the right file instead of the original.
            if (sourceConfig.adapterId === 'sqlite' && dbConf.path && Array.isArray(databaseMapping)) {
                type MappingEntry = { originalName: string; targetName: string; selected: boolean };
                const rename = (databaseMapping as MappingEntry[])
                    .find(m => m.selected && m.targetName && m.targetName !== m.originalName);
                if (rename) {
                    const dir = path.dirname(dbConf.path as string);
                    dbConf.path = path.join(dir, rename.targetName);
                    log(`SQLite target path overridden by mapping: ${dbConf.path}`, 'info');
                }
            }
        }

        if (privilegedAuth) {
            dbConf.privilegedAuth = privilegedAuth;
        }

        const restoreResult = await sourceAdapter.restore(dbConf, tempFile, (msg, level?: LogLevel, type?: LogType, details?: string) => {
            let finalLevel: LogLevel = level || 'info';

            if (!level) {
                const lower = msg.toLowerCase();
                const hasActualError = (lower.includes('error') && !lower.includes('0 error')) ||
                    (lower.includes('fail') && !lower.match(/0\s+(document|failure|failed)/));
                if (hasActualError || lower.includes('fatal')) finalLevel = 'error';
                else if (lower.includes('warn')) finalLevel = 'warning';
            }

            log(msg, finalLevel, type, details);
        }, (p, detail) => {
            currentProgress = p;
            currentDetail = detail || null;
            flushLogs();
        });

        if (!restoreResult.success) {
            if (restoreResult.error) {
                log(restoreResult.error, 'error');
            }

            log(`Restore adapter reported failure. Check logs above.`, 'error');
            setStage("Failed");

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
            setStage("Completed");
            await prisma.execution.update({
                where: { id: executionId },
                data: {
                    status: 'Success',
                    endedAt: new Date(),
                    logs: JSON.stringify(internalLogs)
                }
            });

            // System notification (fire-and-forget)
            notify({
                eventType: NOTIFICATION_EVENTS.RESTORE_COMPLETE,
                data: {
                    sourceName: resolvedSourceName ?? targetSourceId,
                    databaseType: resolvedSourceType,
                    targetDatabase: targetDatabaseName,
                    backupFile: path.basename(file),
                    storageName: resolvedStorageName,
                    duration: Date.now() - restoreStartTime,
                    executionId,
                    timestamp: new Date().toISOString(),
                },
            }).catch(() => {});
        }

    } catch (error: unknown) {
        if (abortController.signal.aborted) {
            svcLog.info("Restore cancelled by user", { executionId });
            setStage("Cancelled");
            log("Restore was cancelled by user", 'warning');

            await prisma.execution.update({
                where: { id: executionId },
                data: { status: 'Cancelled', endedAt: new Date(), logs: JSON.stringify(internalLogs) }
            });
        } else {
            svcLog.error("Restore service error", {}, wrapError(error));
            setStage("Failed");
            log(`Fatal Error: ${getErrorMessage(error)}`, 'error');

            await prisma.execution.update({
                where: { id: executionId },
                data: { status: 'Failed', endedAt: new Date(), logs: JSON.stringify(internalLogs) }
            });

            // System notification (fire-and-forget)
            notify({
                eventType: NOTIFICATION_EVENTS.RESTORE_FAILURE,
                data: {
                    sourceName: resolvedSourceName ?? targetSourceId,
                    databaseType: resolvedSourceType,
                    targetDatabase: targetDatabaseName,
                    backupFile: path.basename(file),
                    storageName: resolvedStorageName,
                    error: getErrorMessage(error),
                    duration: Date.now() - restoreStartTime,
                    executionId,
                    timestamp: new Date().toISOString(),
                },
            }).catch(() => {});
        }
    } finally {
        if (tempFile) {
            await fs.promises.unlink(tempFile).catch(() => {});
        }
        await flushLogs(true);
        unregisterExecution(executionId);
        // Trigger queue so any backup jobs pending during this restore can start.
        processQueue().catch((e) => svcLog.error("Post-restore queue trigger failed", {}, wrapError(e)));
    }
}
