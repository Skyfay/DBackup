import { RunnerContext } from "../types";
import { decryptConfig } from "@/lib/crypto";
import { getTempDir } from "@/lib/temp-dir";
import path from "path";
import fs from "fs/promises";
import { isMultiDbTar, readTarManifest } from "@/lib/adapters/database/common/tar-utils";
import { logger } from "@/lib/logger";
import { wrapError } from "@/lib/errors";

const log = logger.child({ step: "02-dump" });

export async function stepExecuteDump(ctx: RunnerContext) {
    if (!ctx.job || !ctx.sourceAdapter) throw new Error("Context not initialized");

    const job = ctx.job;
    const sourceAdapter = ctx.sourceAdapter;

    ctx.log(`Starting Dump from ${job.source.name} (${job.source.type})...`);

    // 1. Prepare Paths
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const fileName = `${job.name.replace(/[^a-z0-9]/gi, '_')}_${timestamp}.sql`;
    const tempDir = getTempDir();
    const tempFile = path.join(tempDir, fileName);

    ctx.tempFile = tempFile;
    ctx.log(`Prepared temporary path: ${tempFile}`);

    // 2. Prepare Config & Metadata
    const sourceConfig = decryptConfig(JSON.parse(job.source.config));
    // Inject adapterId as type for Dialect selection (e.g. 'mariadb')
    sourceConfig.type = job.source.adapterId;

    try {
        const dbVal = sourceConfig.database;
        const options = sourceConfig.options || "";
        const isAll = options.includes("--all-databases");

        let label = 'Unknown';
        let count: number | string = 'Unknown';
        let names: string[] = [];

        if (isAll) {
            label = 'All DBs';
            count = 'All';
            // Try to fetch DB names for accurate metadata
            if (sourceAdapter.getDatabases) {
                try {
                    const fetched = await sourceAdapter.getDatabases(sourceConfig);
                    if (fetched && fetched.length > 0) {
                        names = fetched;
                        count = names.length;
                        label = `${names.length} DBs (fetched)`;
                    }
                } catch (e: unknown) {
                    const message = e instanceof Error ? e.message : String(e);
                    ctx.log(`Warning: Could not fetch DB list for metadata: ${message}`);
                }
            }
        } else if (Array.isArray(dbVal)) {
            names = dbVal;
            label = `${dbVal.length} DBs`;
            count = dbVal.length;
        } else if (typeof dbVal === 'string') {
            if (dbVal.includes(',')) {
                names = dbVal.split(',').map((s: string) => s.trim()).filter((s: string) => s.length > 0);
                label = `${names.length} DBs`;
                count = names.length;
            } else if (dbVal.trim().length > 0) {
                names = [dbVal.trim()];
                label = 'Single DB';
                count = 1;
            } else {
                label = 'No DB selected';
                count = 0;
            }
        }

        // Fetch engine version and edition
        let engineVersion = 'unknown';
        let engineEdition: string | undefined;
        if (sourceAdapter.test) {
            try {
                const testRes = await sourceAdapter.test(sourceConfig) as { success: boolean; version?: string; edition?: string };
                if (testRes.success && testRes.version) {
                    engineVersion = testRes.version;
                    ctx.log(`Detected engine version: ${engineVersion}`);
                }
                if (testRes.edition) {
                    engineEdition = testRes.edition;
                    ctx.log(`Detected engine edition: ${engineEdition}`);
                }
            } catch(_e) { /* ignore */ }
        }

        ctx.metadata = {
            label,
            count,
            names,
            jobName: job.name,
            sourceName: job.source.name,
            sourceType: job.source.type,
            adapterId: job.source.adapterId,
            engineVersion,
            engineEdition
        };

        ctx.log(`Metadata calculated: ${label}`);
    } catch (e) {
        log.error("Failed to calculate metadata", { jobName: job.name }, wrapError(e));
    }

    // 3. Execute Dump
    // Ensure config has required fields passed from the Source entity logic if needed
    let dumpResult;

    // Add detectedVersion to config for version-matched binary selection
    const sourceConfigWithVersion = {
        ...sourceConfig,
        detectedVersion: ctx.metadata?.engineVersion || undefined
    };

    // Start monitoring file size for progress updates
    const watcher = setInterval(async () => {
             // Check if file exists and get size
             try {
                 // Note: tempFile might change if adapter appends extension, but initially it starts here
                 const stats = await fs.stat(tempFile).catch(() => null);
                 if (stats && stats.size > 0) {
                     const sizeMB = (stats.size / 1024 / 1024).toFixed(2);
                     ctx.updateProgress(0, `Dumping Database (${sizeMB} MB...)`);
                 }
             } catch {}
    }, 800);

    try {
        dumpResult = await sourceAdapter.dump(sourceConfigWithVersion, tempFile, (msg, level, type, details) => ctx.log(msg, level, type, details));
    } finally {
        clearInterval(watcher);
    }

    if (!dumpResult.success) {
        throw new Error(`Dump failed: ${dumpResult.error}`);
    }

    // If adapter appended an extension (like .gz), use that path
    if (dumpResult.path && dumpResult.path !== tempFile) {
        ctx.tempFile = dumpResult.path;
    }

    ctx.dumpSize = dumpResult.size || 0;
    ctx.log(`Dump successful. Size: ${dumpResult.size} bytes`);

    // Check if the dump is a Multi-DB TAR archive and update metadata
    try {
        const dumpPath = ctx.tempFile;
        if (await isMultiDbTar(dumpPath)) {
            const manifest = await readTarManifest(dumpPath);
            if (manifest) {
                ctx.metadata = {
                    ...ctx.metadata,
                    multiDb: {
                        format: 'tar',
                        databases: manifest.databases.map(db => db.name)
                    }
                };
                ctx.log(`Multi-DB TAR archive detected: ${manifest.databases.length} databases`);
            }
        }
    } catch (e: unknown) {
        const message = e instanceof Error ? e.message : String(e);
        ctx.log(`Warning: Could not check for Multi-DB TAR format: ${message}`);
    }
}
