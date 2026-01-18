import { RunnerContext } from "../types";
import { decryptConfig } from "@/lib/crypto";
import path from "path";
import fs from "fs/promises";
import { BackupMetadata } from "@/lib/core/interfaces";

export async function stepUpload(ctx: RunnerContext) {
    if (!ctx.job || !ctx.destAdapter || !ctx.tempFile) throw new Error("Context not ready for upload");

    const job = ctx.job;
    const destAdapter = ctx.destAdapter;

    ctx.log(`Starting Upload to ${job.destination.name} (${job.destination.type})...`);

    const destConfig = decryptConfig(JSON.parse(job.destination.config));

    // Define remote path (Standard: /backups/JobName/FileName)
    // We maintain 'backups/' root prefix as per convention
    const remotePath = `/backups/${job.name}/${path.basename(ctx.tempFile)}`;
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
                count: typeof ctx.metadata?.count === 'number' ? ctx.metadata.count : 0
            },
            timestamp: new Date().toISOString(),
            originalFileName: path.basename(ctx.tempFile)
        };

        const metaPath = ctx.tempFile + ".meta.json";
        await fs.writeFile(metaPath, JSON.stringify(metadata, null, 2));

        ctx.log(`Uploading metadata sidecar: ${path.basename(metaPath)}`);
        // We upload to the same path but with .meta.json appended
        // e.g. /backups/Job/file.sql.meta.json
        await destAdapter.upload(destConfig, metaPath, remotePath + ".meta.json");

        // Try to delete temp metadata file
        await fs.unlink(metaPath).catch(() => {});
    } catch (e: any) {
        ctx.log(`Warning: Failed to generate/upload metadata: ${e.message}`);
    }

    const uploadSuccess = await destAdapter.upload(destConfig, ctx.tempFile, remotePath);

    if (!uploadSuccess) {
        throw new Error("Upload failed (Adapter returned false)");
    }

    ctx.log(`Upload successful to ${remotePath}`);
}
