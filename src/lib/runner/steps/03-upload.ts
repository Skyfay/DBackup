import { RunnerContext } from "../types";
import path from "path";
import fs from "fs/promises";
import prisma from "@/lib/prisma";
import { createReadStream, createWriteStream } from "fs";
import { pipeline } from "stream/promises";
import { BackupMetadata } from "@/lib/core/interfaces";
import { getProfileMasterKey } from "@/services/backup/encryption-service";
import { createEncryptionStream } from "@/lib/crypto/stream";
import { getCompressionStream, getCompressionExtension, CompressionType } from "@/lib/crypto/compression";
import { ProgressMonitorStream } from "@/lib/streams/progress-monitor";
import { formatBytes } from "@/lib/utils";
import { calculateFileChecksums } from "@/lib/crypto/checksum";
import { PIPELINE_STAGES } from "@/lib/core/logs";
import { withStorageSession } from "./upload-helpers";
import { verificationService } from "@/services/storage/verification-service";

export async function stepUpload(ctx: RunnerContext) {
    if (!ctx.job || ctx.destinations.length === 0 || !ctx.tempFile) throw new Error("Context not ready for upload");

    const job = ctx.job;
    const compression = (job as any).compression as CompressionType;

    // Determine Action Label for UI
    const actions: string[] = [];
    if (compression && compression !== 'NONE') actions.push("Compressing");
    if (job.encryptionProfileId) actions.push("Encrypting");
    const processingLabel = actions.length > 0 ? actions.join(" & ") : "Processing";

    if (actions.length > 0) {
        ctx.setStage(PIPELINE_STAGES.PROCESSING);
    } else {
        ctx.setStage(PIPELINE_STAGES.UPLOADING);
    }

    // --- PIPELINE CONSTRUCTION (once, shared across all destinations) ---
    let currentFile = ctx.tempFile;
    const transformStreams: any[] = [];

    const sourceStat = await fs.stat(ctx.tempFile);
    const sourceSize = sourceStat.size;
    const progressMonitor = new ProgressMonitorStream(sourceSize, (processed, total, percent, speed) => {
        ctx.updateDetail(`${processingLabel} (${formatBytes(processed)} / ${formatBytes(total)}) – ${formatBytes(speed)}/s`);
        ctx.updateStageProgress(percent);
    });

    // 1. Compression Step
    let compressionMeta: CompressionType | undefined = undefined;
    if (compression && compression !== 'NONE') {
        const compStream = getCompressionStream(compression);
        if (compStream) {
            ctx.log(`Compression enabled: ${compression}`);
            transformStreams.push(compStream);
            currentFile += getCompressionExtension(compression);
            compressionMeta = compression;
        }
    }

    // 2. Encryption Step
    let encryptionMeta: BackupMetadata['encryption'] = undefined;
    let getAuthTagCallback: (() => Buffer) | null = null;

    if (job.encryptionProfileId) {
        try {
            ctx.log(`Encryption enabled. Profile ID: ${job.encryptionProfileId}`);

            const masterKey = await getProfileMasterKey(job.encryptionProfileId);
            const { stream: encryptStream, getAuthTag, iv } = createEncryptionStream(masterKey);

            transformStreams.push(encryptStream);
            currentFile += ".enc";

            getAuthTagCallback = getAuthTag;

            encryptionMeta = {
                enabled: true,
                profileId: job.encryptionProfileId,
                algorithm: 'aes-256-gcm',
                iv: iv.toString('hex'),
                authTag: ''
            };

        } catch (error: unknown) {
            const message = error instanceof Error ? error.message : String(error);
            throw new Error(`Encryption setup failed: ${message}`);
        }
    }

    // EXECUTE PIPELINE
    if (transformStreams.length > 0) {
        ctx.log(`Processing pipeline -> ${path.basename(currentFile)}`);
        transformStreams.unshift(progressMonitor);

        try {
            const inputFile = ctx.tempFile;

            await pipeline([
                createReadStream(inputFile),
                ...transformStreams,
                createWriteStream(currentFile)
            ]);

            await fs.unlink(inputFile);
            ctx.tempFile = currentFile;

            const finalStat = await fs.stat(currentFile);
            ctx.dumpSize = finalStat.size;
            ctx.log(`Pipeline complete. Final size: ${formatBytes(ctx.dumpSize)}`);

            if (encryptionMeta && getAuthTagCallback) {
                encryptionMeta.authTag = getAuthTagCallback().toString('hex');
                ctx.log("Encryption successful (AuthTag generated).");
            }
        } catch (e: unknown) {
            const message = e instanceof Error ? e.message : String(e);
            throw new Error(`Pipeline processing failed: ${message}`);
        }
    }

    // --- CHECKSUM CALCULATION (SHA-256 + MD5 in single stream pass) ---
    ctx.log("Calculating checksums...");
    const { sha256: checksum, md5: checksumMd5 } = await calculateFileChecksums(ctx.tempFile);
    ctx.log(`SHA-256: ${checksum}`);
    ctx.log(`MD5:     ${checksumMd5}`);

    // --- PRIVACY SETTING: include actor in metadata? ---
    const privacySetting = await prisma.systemSetting.findUnique({ where: { key: "privacy.includeActorInMetadata" } });
    const includeActor = privacySetting ? privacySetting.value === 'true' : true;

    const triggerInfo = ctx.triggerInfo;
    const trigger: BackupMetadata['trigger'] = triggerInfo
        ? {
            type: triggerInfo.type as NonNullable<BackupMetadata['trigger']>['type'],
            ...(includeActor && triggerInfo.label ? { actor: triggerInfo.label } : {}),
          }
        : undefined;

    // --- METADATA SIDECAR (created once, uploaded to each destination) ---
    const metadata: BackupMetadata = {
        version: 1,
        jobId: job.id,
        jobName: job.name,
        sourceName: job.source?.name ?? (ctx.sources.length > 0 ? `${ctx.sources.length} directory source(s)` : 'Unknown'),
        sourceType: job.source?.adapterId ?? 'directory-only',
        sourceId: job.source?.id ?? '',
        databases: {
            count: typeof ctx.metadata?.count === 'number' ? ctx.metadata.count : 0,
            names: Array.isArray(ctx.metadata?.names) ? ctx.metadata.names : undefined
        },
        engineVersion: ctx.metadata?.engineVersion,
        engineEdition: ctx.metadata?.engineEdition,
        timestamp: new Date().toISOString(),
        originalFileName: path.basename(ctx.tempFile),
        compression: compressionMeta,
        encryption: encryptionMeta,
        checksum,
        checksumMd5,
        multiDb: ctx.metadata?.multiDb,
        combined: ctx.metadata?.combined,
        trigger,
        locked: ctx.lock === true,
    };

    const metaPath = ctx.tempFile + ".meta.json";
    await fs.writeFile(metaPath, JSON.stringify(metadata, null, 2));

    // --- SEQUENTIAL UPLOAD TO ALL DESTINATIONS ---
    const remotePath = `${job.name}/${path.basename(ctx.tempFile)}`;
    const totalDests = ctx.destinations.length;

    ctx.setStage(PIPELINE_STAGES.UPLOADING);

    for (let i = 0; i < totalDests; i++) {
        const dest = ctx.destinations[i];
        const destLabel = `[${dest.configName}]`;
        const uploadStart = Date.now();
        const destProgress = (percent: number) => {
            // Distribute progress across destinations
            const basePercent = (i / totalDests) * 100;
            const slicePercent = (percent / totalDests);
            const combinedPercent = Math.round(basePercent + slicePercent);
            if (ctx.dumpSize && ctx.dumpSize > 0) {
                const uploadedBytes = Math.round((percent / 100) * ctx.dumpSize);
                const elapsed = (Date.now() - uploadStart) / 1000;
                const speed = elapsed > 0 ? Math.round(uploadedBytes / elapsed) : 0;
                ctx.updateDetail(`${dest.configName} - ${formatBytes(uploadedBytes)} / ${formatBytes(ctx.dumpSize)} – ${formatBytes(speed)}/s`);
            } else {
                ctx.updateDetail(`${dest.configName} (${percent}%)`);
            }
            ctx.updateStageProgress(combinedPercent);
        };

        ctx.log(`${destLabel} Starting upload...`);

        const sessionLog: (msg: string, level?: any, type?: any, details?: any) => void =
            (msg, level, type, details) => ctx.log(`${destLabel} ${msg}`, level, type, details);

        try {
            await withStorageSession(dest.adapter, dest.config, sessionLog, async (session) => {
                // Upload metadata sidecar
                ctx.log(`${destLabel} Uploading metadata sidecar...`);
                await session.upload(
                    metaPath,
                    remotePath + ".meta.json",
                    undefined,
                    sessionLog
                );

                // Upload main backup file (pass checksums so adapters can store them natively)
                const uploadSuccess = await session.upload(
                    ctx.tempFile!,
                    remotePath,
                    destProgress,
                    sessionLog,
                    { checksumSha256: checksum, checksumMd5 }
                );

                if (!uploadSuccess) {
                    throw new Error("Adapter returned false");
                }
            });

            dest.uploadResult = { success: true, path: remotePath };
            ctx.log(`${destLabel} Upload complete: ${remotePath}`);
            const dbCount = typeof metadata.databases === 'object' && 'count' in metadata.databases
                ? (metadata.databases as { count: number }).count
                : (Array.isArray(metadata.databases) ? metadata.databases.length : 0);
            const dbInfoLabel = metadata.combined
                ? (metadata.combined.databases > 0
                    ? `${metadata.combined.databases} DB${metadata.combined.databases === 1 ? '' : 's'} + ${metadata.combined.directorySources} Dir${metadata.combined.directorySources === 1 ? '' : 's'}`
                    : `${metadata.combined.directorySources} Directory Source${metadata.combined.directorySources === 1 ? '' : 's'}`)
                : (dbCount <= 1 ? "Single DB" : `${dbCount} DBs`);
            const richEntry = {
                name: path.basename(remotePath),
                path: remotePath,
                size: ctx.dumpSize ?? 0,
                lastModified: new Date(),
                jobName: metadata.jobName,
                sourceName: metadata.sourceName,
                sourceType: metadata.sourceType,
                engineVersion: metadata.engineVersion,
                engineEdition: metadata.engineEdition,
                dbInfo: { count: dbCount, label: dbInfoLabel },
                isEncrypted: metadata.encryption?.enabled,
                encryptionProfileId: metadata.encryption?.profileId,
                compression: metadata.compression,
                locked: metadata.locked ?? false,
                trigger: metadata.trigger as { type: string; actor?: string } | undefined,
                checksum: metadata.checksum,
                checksumMd5: metadata.checksumMd5,
            };
            import("@/services/storage/storage-service").then(({ storageService }) => {
                storageService.appendStorageListCacheEntry(dest.configId, richEntry).catch(() => {});
            });

        } catch (e: unknown) {
            const message = e instanceof Error ? e.message : String(e);
            dest.uploadResult = { success: false, error: message };
            ctx.log(`${destLabel} Upload FAILED: ${message}`, 'error');
        }
    }

    // Cleanup temp metadata file
    await fs.unlink(metaPath).catch(() => {});

    // --- EVALUATE RESULTS (before verification so summary appears in Uploading stage) ---
    const successCount = ctx.destinations.filter(d => d.uploadResult?.success).length;
    const failCount = ctx.destinations.filter(d => d.uploadResult && !d.uploadResult.success).length;

    const firstSuccess = ctx.destinations.find(d => d.uploadResult?.success);
    if (firstSuccess) {
        ctx.finalRemotePath = firstSuccess.uploadResult!.path;
    }

    if (successCount === 0) {
        throw new Error(`All ${failCount} destination upload(s) failed`);
    }

    if (failCount > 0) {
        ctx.status = "Partial";
        ctx.log(`Upload summary: ${successCount}/${totalDests} successful, ${failCount} failed`, 'warning');
    } else {
        ctx.log(`Upload summary: All ${successCount} destination(s) successful`);
    }

    // --- POST-UPLOAD VERIFICATION ---
    const postVerifySetting = await prisma.systemSetting.findUnique({ where: { key: "backup.postUploadVerify" } });
    const postVerifyEnabled = postVerifySetting?.value === 'true';

    // Always verify local destinations (native, no bandwidth cost); verify remote only if setting enabled
    const destinationsToVerify = ctx.destinations.filter(d =>
        d.uploadResult?.success && (d.adapterId === "local-filesystem" || postVerifyEnabled)
    );

    if (destinationsToVerify.length > 0) {
        ctx.setStage(PIPELINE_STAGES.VERIFYING);

        for (const dest of destinationsToVerify) {
            const destLabel = `[${dest.configName}]`;
            try {
                ctx.log(`${destLabel} Verifying upload integrity...`);
                const verifyResult = await verificationService.verifyFile(dest.configId, remotePath, 'post-upload');
                if (verifyResult.status === 'passed') {
                    ctx.log(`${destLabel} Integrity check passed`, 'success');
                } else if (verifyResult.status === 'failed') {
                    ctx.log(`${destLabel} WARNING: Integrity check FAILED. Expected: ${verifyResult.expectedChecksum}, Got: ${verifyResult.actualChecksum}`, 'warning');
                } else {
                    ctx.log(`${destLabel} Integrity verification skipped: ${verifyResult.status}`, 'info');
                }
            } catch (e: unknown) {
                const message = e instanceof Error ? e.message : String(e);
                ctx.log(`${destLabel} Integrity verification error: ${message}`, 'warning');
            }
        }
    }

}
