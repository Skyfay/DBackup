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
import { calculateFileChecksum, verifyFileChecksum } from "@/lib/crypto/checksum";
import { getTempDir } from "@/lib/temp-dir";
import { PIPELINE_STAGES } from "@/lib/core/logs";

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

    // --- CHECKSUM CALCULATION ---
    ctx.log("Calculating SHA-256 checksum...");
    const checksum = await calculateFileChecksum(ctx.tempFile);
    ctx.log(`Checksum: ${checksum}`);

    // --- PRIVACY SETTING: include actor in metadata? ---
    const privacySetting = await prisma.systemSetting.findUnique({ where: { key: "privacy.includeActorInMetadata" } });
    const includeActor = privacySetting ? privacySetting.value === 'true' : true;

    const triggerInfo = ctx.triggerInfo;
    const trigger: BackupMetadata['trigger'] = triggerInfo
        ? {
            type: triggerInfo.type as BackupMetadata['trigger']['type'],
            ...(includeActor && triggerInfo.label ? { actor: triggerInfo.label } : {}),
          }
        : undefined;

    // --- METADATA SIDECAR (created once, uploaded to each destination) ---
    const metadata: BackupMetadata = {
        version: 1,
        jobId: job.id,
        jobName: job.name,
        sourceName: job.source.name,
        sourceType: job.source.adapterId,
        sourceId: job.source.id,
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
        multiDb: ctx.metadata?.multiDb,
        trigger,
        locked: ctx.lock === true,
    };

    const metaPath = ctx.tempFile + ".meta.json";
    await fs.writeFile(metaPath, JSON.stringify(metadata, null, 2));

    // --- SEQUENTIAL UPLOAD TO ALL DESTINATIONS ---
    const remotePath = `${job.name}/${path.basename(ctx.tempFile)}`;
    const totalDests = ctx.destinations.length;

    ctx.setStage(PIPELINE_STAGES.UPLOADING);

    // Collect destinations that need post-upload integrity verification
    const verifyQueue: { dest: typeof ctx.destinations[number]; destLabel: string }[] = [];

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

        try {
            // Upload metadata sidecar
            ctx.log(`${destLabel} Uploading metadata sidecar...`);
            await dest.adapter.upload(
                dest.config,
                metaPath,
                remotePath + ".meta.json",
                undefined,
                (msg, level, type, details) => ctx.log(`${destLabel} ${msg}`, level, type, details)
            );

            // Upload main backup file
            const uploadSuccess = await dest.adapter.upload(
                dest.config,
                ctx.tempFile,
                remotePath,
                destProgress,
                (msg, level, type, details) => ctx.log(`${destLabel} ${msg}`, level, type, details)
            );

            if (!uploadSuccess) {
                throw new Error("Adapter returned false");
            }

            dest.uploadResult = { success: true, path: remotePath };
            ctx.log(`${destLabel} Upload complete: ${remotePath}`);

            // Queue integrity verification for local storage
            if (dest.adapterId === "local-filesystem") {
                verifyQueue.push({ dest, destLabel });
            }

        } catch (e: unknown) {
            const message = e instanceof Error ? e.message : String(e);
            dest.uploadResult = { success: false, error: message };
            ctx.log(`${destLabel} Upload FAILED: ${message}`, 'error');
        }
    }

    // Cleanup temp metadata file
    await fs.unlink(metaPath).catch(() => {});

    // --- POST-UPLOAD VERIFICATION ---
    ctx.setStage(PIPELINE_STAGES.VERIFYING);

    if (verifyQueue.length > 0) {
        for (const { dest, destLabel } of verifyQueue) {
            try {
                ctx.log(`${destLabel} Verifying upload integrity...`);
                const verifyPath = path.join(getTempDir(), `verify_${Date.now()}_${path.basename(ctx.tempFile)}`);
                const downloadOk = await dest.adapter.download(dest.config, remotePath, verifyPath);
                if (downloadOk) {
                    const result = await verifyFileChecksum(verifyPath, checksum);
                    if (result.valid) {
                        ctx.log(`${destLabel} Integrity check passed ✓`, 'success');
                    } else {
                        ctx.log(`${destLabel} WARNING: Integrity check FAILED! Expected: ${result.expected}, Got: ${result.actual}`, 'warning');
                    }
                    await fs.unlink(verifyPath).catch(() => {});
                }
            } catch (e: unknown) {
                const message = e instanceof Error ? e.message : String(e);
                ctx.log(`${destLabel} Integrity verification skipped: ${message}`, 'warning');
            }
        }
    } else {
        ctx.log("No local destinations - skipping integrity verification");
    }

    // --- EVALUATE RESULTS ---
    const successCount = ctx.destinations.filter(d => d.uploadResult?.success).length;
    const failCount = ctx.destinations.filter(d => d.uploadResult && !d.uploadResult.success).length;

    // Set finalRemotePath to first successful upload (backward compat)
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
}
