import { RunnerContext } from "../types";
import { decryptConfig } from "@/lib/crypto";
import path from "path";

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

    const uploadSuccess = await destAdapter.upload(destConfig, ctx.tempFile, remotePath);

    if (!uploadSuccess) {
        throw new Error("Upload failed (Adapter returned false)");
    }

    ctx.log(`Upload successful to ${remotePath}`);
}
