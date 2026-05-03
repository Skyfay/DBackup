import { RunnerContext } from "../types";
import { decryptConfig } from "@/lib/crypto";
import { getTempDir } from "@/lib/temp-dir";
import path from "path";
import fs from "fs/promises";
import { isMultiDbTar, readTarManifest } from "@/lib/adapters/database/common/tar-utils";
import { logger } from "@/lib/logger";
import { wrapError } from "@/lib/errors";
import { getBackupFileExtension } from "@/lib/backup-extensions";
import { formatBytes } from "@/lib/utils";
import prisma from "@/lib/prisma";
import { formatInTimeZone } from "date-fns-tz";

const log = logger.child({ step: "02-dump" });

export async function stepExecuteDump(ctx: RunnerContext) {
    if (!ctx.job || !ctx.sourceAdapter) throw new Error("Context not initialized");

    const job = ctx.job;
    const sourceAdapter = ctx.sourceAdapter;

    ctx.log(`Starting Dump from ${job.source.name} (${job.source.type})...`);

    // 1. Prepare Settings (timezone and filename pattern)
    const [tzSetting, patternSetting] = await Promise.all([
        prisma.systemSetting.findUnique({ where: { key: "system.timezone" } }),
        prisma.systemSetting.findUnique({ where: { key: "system.filenamePattern" } }),
    ]);
    const timezone = tzSetting?.value || "UTC";
    const pattern = patternSetting?.value || "{name}_yyyy-MM-dd_HH-mm-ss";

    // 2. Prepare Config & Metadata
    const sourceConfig = decryptConfig(JSON.parse(job.source.config));
    // Inject adapterId as type for Dialect selection (e.g. 'mariadb')
    sourceConfig.type = job.source.adapterId;

    // Inject multiDbBackupType for handling multiple databases
    sourceConfig.multiDbBackupType = job.multiDbBackupType || 'SINGLE_TAR';

    // Inject databases from Job (always takes precedence over source config).
    // An empty job selection means "backup all" - clear the source's default database
    // so each adapter's auto-discovery logic triggers instead of using the source default.
    const jobDatabases: string[] = (() => {
        try {
            const parsed = JSON.parse(job.databases || "[]");
            return Array.isArray(parsed) ? parsed : [];
        } catch { return []; }
    })();

    // 3. Generate filename with timezone and custom pattern
    const dbNameRaw = jobDatabases.length === 0
        ? 'all'
        : jobDatabases.map(db => db.replace(/[^a-z0-9]/gi, '_')).join('_');

    const sanitizedName = job.name.replace(/[^a-z0-9]/gi, '_');
    const escapeName = (text: string) => text.replace(/'/g, "''");
    let datePattern = pattern
        .replace('{name}', `'${escapeName(sanitizedName)}'`)
        .replace('{db_name}', `'${escapeName(dbNameRaw)}'`);

    const ext = getBackupFileExtension(job.source.adapterId);
    const fileName = formatInTimeZone(new Date(), timezone, datePattern) + `.${ext}`;
    const tempDir = getTempDir();
    const tempFile = path.join(tempDir, fileName);

    ctx.tempFile = tempFile;
    ctx.log(`Prepared temporary path: ${tempFile}`);
    if (jobDatabases.length > 0) {
        sourceConfig.database = jobDatabases;
        ctx.log(`Using ${jobDatabases.length} database(s) from job config: ${jobDatabases.join(', ')}`);
    } else {
        // No explicit DB selection in job = backup all → clear source default so adapters auto-discover
        sourceConfig.database = [];
    }

    // Inject PostgreSQL native compression setting (only consumed by the postgres adapter)
    if (job.pgCompression !== undefined) {
        sourceConfig.pgCompression = job.pgCompression;
    }

    try {
        const dbVal = sourceConfig.database;
        const options = sourceConfig.options || "";
        const isAll = options.includes("--all-databases");

        let label = 'Unknown';
        let count: number = 0;
        let names: string[] = [];

        if (isAll) {
            label = 'All DBs';
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
            names = dbVal.filter((s: string) => s && s.trim().length > 0);
            if (names.length > 0) {
                label = `${names.length} DBs`;
                count = names.length;
            } else {
                // Empty array = no DB selected, try to discover all databases
                label = 'All DBs';
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
            }
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
                // Empty string = no DB selected, try to discover all databases
                label = 'All DBs';
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
            }
        } else {
            // dbVal is undefined/null (e.g. MongoDB with no specific DB selected)
            // Try to fetch DB names for accurate metadata (adapter dumps all DBs by default)
            label = 'All DBs';
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
    const dumpStart = Date.now();
    const watcher = setInterval(async () => {
             // Check if file exists and get size
             try {
                 const stats = await fs.stat(tempFile).catch(() => null);
                 if (stats && stats.size > 0) {
                     const elapsed = (Date.now() - dumpStart) / 1000;
                     const speed = elapsed > 0 ? Math.round(stats.size / elapsed) : 0;
                     const sizeMB = (stats.size / 1024 / 1024).toFixed(2);
                     const speedStr = formatBytes(speed);
                     ctx.updateDetail(`${sizeMB} MB dumped – ${speedStr}/s`);
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

    // Handle both single file and multiple files (SEPARATE_FILES mode)
    if (dumpResult.files && dumpResult.files.length > 0) {
        // SEPARATE_FILES mode: multiple files
        // Apply the filename pattern to each database file
        const renamedFiles = [];

        for (const dumpFile of dumpResult.files) {
            // Generate filename for this specific database using the pattern
            const dbSpecificDbName = dumpFile.database.replace(/[^a-z0-9]/gi, '_');
            const escapeName = (text: string) => text.replace(/'/g, "''");
            let dbSpecificPattern = pattern
                .replace('{name}', `'${escapeName(sanitizedName)}'`)
                .replace('{db_name}', `'${escapeName(dbSpecificDbName)}'`);

            const dbSpecificFileName = formatInTimeZone(new Date(), timezone, dbSpecificPattern) + `.${ext}`;
            const dbSpecificPath = path.join(path.dirname(dumpFile.path), dbSpecificFileName);

            // Rename the file to the new name
            if (dumpFile.path !== dbSpecificPath) {
                await fs.rename(dumpFile.path, dbSpecificPath);
                ctx.log(`Renamed ${dumpFile.database} backup to: ${dbSpecificFileName}`);
            }

            renamedFiles.push({
                path: dbSpecificPath,
                name: dbSpecificFileName,
                database: dumpFile.database,
                size: dumpFile.size
            });
        }

        ctx.dumpFiles = renamedFiles;
        ctx.dumpSize = renamedFiles.reduce((sum, f) => sum + f.size, 0);
        ctx.log(`Dump successful (${renamedFiles.length} separate files). Total size: ${ctx.dumpSize} bytes`);
        // Create a manifest file for reference
        const manifestPath = path.join(getTempDir(), `${path.basename(tempFile)}.manifest.json`);
        await fs.writeFile(manifestPath, JSON.stringify({
            format: 'separate_files',
            files: renamedFiles.map(f => ({ name: f.name, database: f.database, size: f.size }))
        }, null, 2));
    } else if (dumpResult.path) {
        // Single file mode
        if (dumpResult.path !== tempFile) {
            ctx.tempFile = dumpResult.path;
        } else {
            ctx.tempFile = tempFile;
        }
        ctx.dumpSize = dumpResult.size || 0;
        ctx.log(`Dump successful. Size: ${dumpResult.size} bytes`);
    } else {
        throw new Error("Dump result has neither path nor files");
    }

    // If metadata has no DB names yet (auto-discovered during dump), fetch them now
    if (ctx.metadata && (!ctx.metadata.names || ctx.metadata.names.length === 0)) {
        try {
            if (sourceAdapter.getDatabases) {
                ctx.log(`Attempting post-dump DB discovery...`);
                const discovered = await sourceAdapter.getDatabases(sourceConfig);
                if (discovered && discovered.length > 0) {
                    ctx.metadata.names = discovered;
                    ctx.metadata.count = discovered.length;
                    ctx.metadata.label = `${discovered.length} DBs (auto-discovered)`;
                    ctx.log(`Updated metadata with ${discovered.length} auto-discovered database(s): ${discovered.join(', ')}`);
                } else {
                    ctx.log(`Post-dump DB discovery returned no databases`);
                }
            } else {
                ctx.log(`Adapter does not support getDatabases`);
            }
        } catch (e: unknown) {
            const errMsg = e instanceof Error ? e.message : String(e);
            ctx.log(`Post-dump DB discovery failed: ${errMsg}`, 'warning');
        }
    }

    // Check if we have separate files (SEPARATE_FILES mode) or a Multi-DB TAR archive
    if (ctx.dumpFiles && ctx.dumpFiles.length > 0) {
        // SEPARATE_FILES mode
        ctx.metadata = {
            ...ctx.metadata,
            multiDb: {
                format: 'separate_files',
                databases: ctx.dumpFiles.map(f => f.database)
            }
        };
        ctx.log(`Separate files mode detected: ${ctx.dumpFiles.length} databases`);
    } else if (ctx.tempFile) {
        // Check if it's a Multi-DB TAR archive
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

                    // Rename file to .tar extension to reflect actual format
                    if (!dumpPath.endsWith('.tar')) {
                        const tarPath = dumpPath.replace(/\.[^.]+$/, '.tar');
                        await fs.rename(dumpPath, tarPath);
                        ctx.tempFile = tarPath;
                        ctx.log(`Renamed backup file to .tar extension: ${path.basename(tarPath)}`);
                    }
                }
            }
        } catch (e: unknown) {
            const message = e instanceof Error ? e.message : String(e);
            ctx.log(`Warning: Could not check for Multi-DB TAR format: ${message}`);
        }
    }
}
