import { RunnerContext } from "../types";
import { decryptConfig } from "@/lib/crypto";
import path from "path";
import os from "os";

export async function stepExecuteDump(ctx: RunnerContext) {
    if (!ctx.job || !ctx.sourceAdapter) throw new Error("Context not initialized");

    const job = ctx.job;
    const sourceAdapter = ctx.sourceAdapter;

    ctx.log(`Starting Dump from ${job.source.name} (${job.source.type})...`);

    // 1. Prepare Paths
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const fileName = `${job.name.replace(/[^a-z0-9]/gi, '_')}_${timestamp}.sql`;
    const tempDir = os.tmpdir();
    const tempFile = path.join(tempDir, fileName);

    ctx.tempFile = tempFile;
    ctx.log(`Prepared temporary path: ${tempFile}`);

    // 2. Prepare Config & Metadata
    const sourceConfig = decryptConfig(JSON.parse(job.source.config));

    try {
        const dbVal = sourceConfig.database;
        const options = sourceConfig.options || "";
        const isAll = options.includes("--all-databases");

        let label = 'Unknown';
        let count: number | string = 'Unknown';

        if (isAll) {
            label = 'All DBs';
            count = 'All';
        } else if (Array.isArray(dbVal)) {
            label = `${dbVal.length} DBs`;
            count = dbVal.length;
        } else if (typeof dbVal === 'string') {
            if (dbVal.includes(',')) {
                const parts = dbVal.split(',').filter((s: string) => s.trim().length > 0);
                label = `${parts.length} DBs`;
                count = parts.length;
            } else if (dbVal.trim().length > 0) {
                label = 'Single DB';
                count = 1;
            } else {
                label = 'No DB selected';
                count = 0;
            }
        }

        ctx.metadata = {
            label,
            count,
            jobName: job.name,
            sourceName: job.source.name,
            sourceType: job.source.type,
            adapterId: job.source.adapterId
        };

        ctx.log(`Metadata calculated: ${label}`);
    } catch (e) {
        console.error(`[Job ${job.name}] Failed to calculate metadata:`, e);
    }

    // 3. Execute Dump
    // Ensure config has required fields passed from the Source entity logic if needed
    const dumpResult = await sourceAdapter.dump(sourceConfig, tempFile);

    if (!dumpResult.success) {
        throw new Error(`Dump failed: ${dumpResult.error}`);
    }

    // If adapter appended an extension (like .gz), use that path
    if (dumpResult.path && dumpResult.path !== tempFile) {
        ctx.tempFile = dumpResult.path;
    }

    ctx.dumpSize = dumpResult.size || 0;
    ctx.log(`Dump successful. Size: ${dumpResult.size} bytes`);
}
