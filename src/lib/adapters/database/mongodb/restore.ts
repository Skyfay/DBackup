import type { ExecutionHost } from "@/lib/transport";
import { MONGORESTORE, buildConnectionArgs, maskSecrets } from "./args";
import { withMongoMeta } from "./meta";
import { BackupResult } from "@/lib/core/interfaces";
import { LogLevel, LogType } from "@/lib/core/logs";
import { MongoDBConfig } from "@/lib/adapters/definitions";
import path from "path";
import {
    isMultiDbTar,
    extractSelectedDatabases,
    createTempDir,
    cleanupTempDir,
    shouldRestoreDatabase,
    getTargetDatabaseName,
} from "../common/tar-utils";

/** Extended config with optional privileged auth for restore operations */
type MongoDBRestoreConfig = MongoDBConfig & {
    privilegedAuth?: { user: string; password: string };
    detectedVersion?: string;
    databaseMapping?: Array<{
        originalName: string;
        targetName: string;
        selected: boolean;
    }>;
    selectedDatabases?: string[];
    // Runtime fields set by restore-service
    originalDatabase?: string | string[];
    targetDatabaseName?: string;
};

/**
 * Build MongoDB connection URI from config
 */

export async function prepareRestore(
    config: MongoDBRestoreConfig,
    databases: string[],
    host: ExecutionHost,
): Promise<void> {
    if (!host) throw new Error("MongoDB adapter requires an execution host. Call it through withHost().");

    // Probe with the privileged credentials when they are configured, since
    // those are the ones the restore itself will use.
    const usageConfig: MongoDBConfig = { ...config };
    if (config.privilegedAuth) {
        usageConfig.user = config.privilegedAuth.user;
        usageConfig.password = config.privilegedAuth.password;
    }

    await withMongoMeta(usageConfig, host, async (meta) => {
        for (const dbName of databases) {
            // Null means this transport cannot probe, in which case mongorestore
            // reports any permission problem itself.
            const probe = meta.checkWritable(dbName);
            if (probe) await probe;
        }
    });
}

/**
 * Restore a single MongoDB database from an archive file
 */
async function restoreSingleDatabase(
    sourcePath: string,
    targetDb: string | undefined,
    sourceDb: string | undefined,
    config: MongoDBRestoreConfig,
    host: ExecutionHost,
    log: (msg: string, level?: LogLevel, type?: LogType, details?: string) => void,
): Promise<void> {
    const mongorestore = await host.which(...MONGORESTORE);

    // mongorestore reads the archive from a path, so it is staged onto the
    // execution host. On a direct host that is the original file with no copy.
    await host.stageInput(sourcePath, {}, async (stagedPath) => {
        const args = [
            ...buildConnectionArgs(config),
            `--archive=${stagedPath}`,
            "--gzip",
            "--drop", // Drop collections before restoring, mirroring MySQL's --clean
        ];

        if (sourceDb && targetDb && sourceDb !== targetDb) {
            args.push("--nsFrom", `${sourceDb}.*`);
            args.push("--nsTo", `${targetDb}.*`);
            log(`Remapping database: ${sourceDb} -> ${targetDb}`, "info");
        } else if (targetDb) {
            args.push("--nsInclude", `${targetDb}.*`);
        }

        log("Restoring database", "info", "command", `${mongorestore} ${maskSecrets(args, config.password)}`);

        const proc = await host.spawn([mongorestore, ...args]);
        proc.stdout.on("data", () => { /* mongorestore writes progress to stderr */ });
        proc.stderr.on("data", (data: Buffer) => {
            const msg = data.toString().trim();
            if (msg) log(`[mongorestore] ${msg}`, "info");
        });

        const { code, signal } = await proc.exit();
        if (code !== 0) {
            throw new Error(
                `mongorestore exited with code ${code ?? "null"}${signal ? ` (signal: ${signal})` : ""}`,
            );
        }
    });
}

/**
 * Capability export for combined DB+directory restores (JobSource): restores a single archive
 * file into a single target database. Thin wrapper around restoreSingleDatabase, the same
 * per-database logic restore() already uses internally for its own multi-DB case. Unlike
 * restore(), this does not run the permission check - callers must ensure the target
 * database is writable first (e.g. via prepareRestore).
 */
export async function restoreOne(
    config: MongoDBRestoreConfig,
    filePath: string,
    targetDbName: string,
    _host: ExecutionHost,
    onLog?: (msg: string, level?: LogLevel, type?: LogType, details?: string) => void,
    _onProgress?: (percentage: number, detail?: string) => void,
    originalDbName?: string
): Promise<void> {
    await restoreSingleDatabase(filePath, targetDbName, originalDbName, config, _host, onLog ?? (() => {}));
}

// LEGACY-FORMAT(read): Restores backups written before the seekable archive, a single dump
// file or a TAR of dumps. New backups go through restoreOne(). Remove once those backups no
// longer need restoring.
export async function restore(
    config: MongoDBRestoreConfig,
    sourcePath: string,
    _host: ExecutionHost,
    onLog?: (msg: string, level?: LogLevel, type?: LogType, details?: string) => void,
    onProgress?: (percentage: number) => void
): Promise<BackupResult> {
    const startedAt = new Date();
    const logs: string[] = [];

    const log = (msg: string, level: LogLevel = 'info', type: LogType = 'general', details?: string) => {
        logs.push(msg);
        if (onLog) onLog(msg, level, type, details);
    };

    let tempDir: string | null = null;

    try {
        // Check if we have advanced mapping config
        const mapping = config.databaseMapping as Array<{
            originalName: string;
            targetName: string;
            selected: boolean;
        }> | undefined;

        // Check if this is a Multi-DB TAR archive
        const isTar = await isMultiDbTar(sourcePath);

        if (isTar) {
            // ===== TAR ARCHIVE RESTORE =====
            log('Detected Multi-DB TAR archive', 'info');

            tempDir = await createTempDir('mongo-restore-');
            log(`Created temp directory: ${tempDir}`, 'info');

            // Build list of selected database names for selective extraction
            const selectedNames = mapping
                ? mapping.filter(m => m.selected).map(m => m.originalName)
                : [];

            const { manifest, files } = await extractSelectedDatabases(sourcePath, tempDir, selectedNames);
            log(`Extracted ${files.length} of ${manifest.databases.length} database archives from TAR`, 'info');

            const totalDbs = manifest.databases.length;
            let processed = 0;

            for (const dbEntry of manifest.databases) {
                // Check if database should be restored (based on mapping)
                if (!shouldRestoreDatabase(dbEntry.name, mapping)) {
                    processed++;
                    continue;
                }

                // Determine target database name (supports renaming)
                const targetDb = getTargetDatabaseName(dbEntry.name, mapping);
                const archivePath = path.join(tempDir, dbEntry.filename);

                log(`Restoring database: ${dbEntry.name} -> ${targetDb}`, 'info');

                // Prepare restore (permission check)
                await prepareRestore(config, [targetDb], _host);

                // Restore using mongorestore with nsFrom/nsTo for renaming
                await restoreSingleDatabase(archivePath, targetDb, dbEntry.name, config, _host, log);
                log(`Database ${targetDb} restored successfully`, 'success');

                processed++;
                if (onProgress) {
                    onProgress(Math.round((processed / totalDbs) * 100));
                }
            }

            log(`Multi-DB restore completed: ${processed}/${totalDbs} databases`, 'success');
        } else {
            // ===== SINGLE DATABASE RESTORE =====
            log('Detected single-database archive', 'info');

            // Determine source and target database from mapping or config
            let sourceDb: string | undefined;
            let targetDb: string | undefined;

            if (mapping && mapping.length > 0) {
                const selected = mapping.filter(m => m.selected);
                if (selected.length > 0) {
                    sourceDb = selected[0].originalName;
                    targetDb = selected[0].targetName || sourceDb;
                }
            }

            // Fallback: use originalDatabase or database as source, and targetDatabaseName for rename
            if (!sourceDb) {
                // originalDatabase is set by restore-service when targetDatabaseName differs
                const origDb = config.originalDatabase || config.database;
                sourceDb = Array.isArray(origDb) ? origDb[0] : origDb;
            }
            if (!targetDb && config.targetDatabaseName) {
                targetDb = config.targetDatabaseName;
            }
            if (!targetDb) {
                targetDb = sourceDb; // No rename, restore to same name
            }

            // Build restore arguments
            await restoreSingleDatabase(sourcePath, targetDb, sourceDb, config, _host, log);
        }

        return {
            success: true,
            logs,
            startedAt,
            completedAt: new Date(),
        };

    } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        log(`Restore failed: ${message}`, 'error');
        return {
            success: false,
            logs,
            error: message,
            startedAt,
            completedAt: new Date(),
        };
    } finally {
        if (tempDir) {
            await cleanupTempDir(tempDir);
        }
    }
}
