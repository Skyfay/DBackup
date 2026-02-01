import { RunnerContext } from "../types";
import { decryptConfig } from "@/lib/crypto";
import path from "path";
import fs from "fs/promises";
import { createReadStream, createWriteStream, statSync } from "fs";
import { pipeline } from "stream/promises";
import { BackupMetadata } from "@/lib/core/interfaces";
import { getProfileMasterKey } from "@/services/encryption-service";
import { createEncryptionStream } from "@/lib/crypto-stream";
import { getCompressionStream, getCompressionExtension, CompressionType } from "@/lib/compression";
import { ProgressMonitorStream } from "@/lib/streams/progress-monitor";
import { formatBytes } from "@/lib/utils";

export async function stepUpload(ctx: RunnerContext) {
    if (!ctx.job || !ctx.destAdapter || !ctx.tempFile) throw new Error("Context not ready for upload");

    const job = ctx.job;
    // Cast job to any because Prisma Client types might lag slightly in IDE or strict checks
    const compression = (job as any).compression as CompressionType;
    const destAdapter = ctx.destAdapter;

    // Determine Action Label for UI
    const actions: string[] = [];
    if (compression && compression !== 'NONE') actions.push("Compressing");
    if (job.encryptionProfileId) actions.push("Encrypting");
    const processingLabel = actions.length > 0 ? actions.join(" & ") : "Processing";

    // Set Initial Stage
    // If we have transformations, we start with "Encrypting/Compressing".
    // Otherwise we go straight to "Uploading Backup".
    if (actions.length > 0) {
        ctx.updateProgress(0, processingLabel + "...");
    } else {
        ctx.updateProgress(0, "Uploading Backup...");
    }

    ctx.log(`Starting Upload to ${job.destination.name} (${job.destination.type})...`);

    // --- PIPELINE CONSTRUCTION ---
    // We construct a pipeline: Source -> [Compression] -> [Encryption] -> NewTempFile

    let currentFile = ctx.tempFile;
    const transformStreams: any[] = [];


    // 0. Progress Monitor for Local Processing
    const sourceSize = statSync(ctx.tempFile).size;
    const progressMonitor = new ProgressMonitorStream(sourceSize, (processed, total, percent) => {
        ctx.updateProgress(percent, `${processingLabel} (${formatBytes(processed)} / ${formatBytes(total)})`);
    });
    // Add monitor FIRST
    // Only if we actually have transforms. If no compression/encryption, we skip local processing.

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
                authTag: '' // Will be filled after stream
            };

        } catch (error: any) {
            throw new Error(`Encryption setup failed: ${error.message}`);
        }
    }

    // EXECUTE PIPELINE
    if (transformStreams.length > 0) {
        // Reuse the already set stage "Encrypting..." or "Compressing..."
        ctx.log(`Processing pipeline -> ${path.basename(currentFile)}`);

        // Inject Progress Monitor at the start
        transformStreams.unshift(progressMonitor);

        try {
            const inputFile = ctx.tempFile;

            await pipeline([
                createReadStream(inputFile),
                ...transformStreams,
                createWriteStream(currentFile)
            ]);

            // Cleanup old file
            await fs.unlink(inputFile);
            ctx.tempFile = currentFile;

            // Finalize Metadata
            if (encryptionMeta && getAuthTagCallback) {
                encryptionMeta.authTag = getAuthTagCallback().toString('hex');
                ctx.log("Encryption successful (AuthTag generated).");
            }
        } catch (e: any) {
            throw new Error(`Pipeline processing failed: ${e.message}`);
        }
    }

    const destConfig = decryptConfig(JSON.parse(job.destination.config));

    // Define remote path (Standard: JobName/FileName)
    // We let the adapter configuration determine the root (via pathPrefix or basePath)
    const remotePath = `${job.name}/${path.basename(ctx.tempFile)}`;
    ctx.finalRemotePath = remotePath;

    // Create and upload metadata sidecar
    try {
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
            // Add Multi-DB TAR metadata if present
            multiDb: ctx.metadata?.multiDb
        };

        const metaPath = ctx.tempFile + ".meta.json";
        await fs.writeFile(metaPath, JSON.stringify(metadata, null, 2));

        // Switch stage to Uploading before starting metadata upload
        // This ensures "Preparing destination" logs for metadata appear in the Upload group
        ctx.updateProgress(0, "Uploading Backup...");

        ctx.log(`Uploading metadata sidecar: ${path.basename(metaPath)}`);
        // We upload to the same path but with .meta.json appended
        // e.g. /backups/Job/file.sql.meta.json
        await destAdapter.upload(
            destConfig,
            metaPath,
            remotePath + ".meta.json",
            undefined,
            (msg, level, type, details) => ctx.log(msg, level, type, details)
        );

        // Try to delete temp metadata file
        await fs.unlink(metaPath).catch(() => {});

    } catch (e: any) {
        ctx.log(`Warning: Failed to generate/upload metadata: ${e.message}`);
    }

    // Main Upload
    // We update progress but keep the stage name "Uploading Backup..."
    const uploadSuccess = await destAdapter.upload(destConfig, ctx.tempFile, remotePath, (percent) => {
        ctx.updateProgress(percent, `Uploading Backup (${percent}%)`);
    }, (msg, level, type, details) => ctx.log(msg, level, type, details));

    if (!uploadSuccess) {
        throw new Error("Upload failed (adapter returned false).");
    }

    ctx.log(`Upload complete: ${remotePath}`);
}
