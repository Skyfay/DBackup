import { BackupResult } from "@/lib/core/interfaces";
import { LogLevel, LogType } from "@/lib/core/logs";
import { execFileAsync } from "./connection";
import { getDialect } from "./dialects";
import { spawn } from "child_process";
import { createReadStream } from "fs";
import { waitForProcess } from "@/lib/adapters/process";
import path from "path";
import {
    isMultiDbTar,
    extractMultiDbTar,
    createTempDir,
    cleanupTempDir,
    shouldRestoreDatabase,
    getTargetDatabaseName,
} from "../common/tar-utils";

export async function prepareRestore(config: any, databases: string[]): Promise<void> {
    // Determine credentials (privileged or standard)
    const usageConfig = { ...config };
    if (config.privilegedAuth) {
        usageConfig.user = config.privilegedAuth.user;
        usageConfig.password = config.privilegedAuth.password;
    }

    const dialect = getDialect('mongodb', config.detectedVersion);
    // getConnectionArgs returns generic host/port/auth args suitable for tools like mongosh
    const args = dialect.getConnectionArgs(usageConfig);

    // Check if --quiet is needed or already in args
    if (!args.includes('--quiet')) args.unshift('--quiet');

    for (const dbName of databases) {
        // Permission check script
        const evalScript = `
        try {
            var target = db.getSiblingDB('${dbName.replace(/'/g, "\\'")}');
            target.createCollection('__perm_check_tmp');
            target.getCollection('__perm_check_tmp').drop();
        } catch(e) {
            print('ERROR: ' + e.message);
            quit(1);
        }
        `;

        try {
            // We use mongosh for eval execution
            await execFileAsync('mongosh', [...args, '--eval', evalScript]);
        } catch (e: unknown) {
            const err = e as { stdout?: string; stderr?: string; message?: string };
            const msg = err.stdout || err.stderr || err.message || "";
            if (msg.includes("not authorized") || msg.includes("Authorization") || msg.includes("requires authentication") || msg.includes("command create requires")) {
                throw new Error(`Access denied to database '${dbName}'. Permissions?`);
            }
            throw e;
        }
    }
}

/**
 * Restore a single MongoDB database from an archive file
 */
async function restoreSingleDatabase(
    sourcePath: string,
    targetDb: string | undefined,
    sourceDb: string | undefined,
    config: any,
    log: (msg: string, level?: LogLevel, type?: LogType, details?: string) => void,
    fromStdin: boolean = false
): Promise<void> {
    const args: string[] = [];

    if (config.uri) {
        args.push(`--uri=${config.uri}`);
    } else {
        args.push('--host', config.host);
        args.push('--port', String(config.port));

        if (config.user && config.password) {
            args.push('--username', config.user);
            args.push('--password', config.password);
            args.push('--authenticationDatabase', config.authenticationDatabase || 'admin');
        }
    }

    if (fromStdin) {
        args.push('--archive');
    } else {
        args.push(`--archive=${sourcePath}`);
    }
    args.push('--gzip');
    args.push('--drop'); // Drop collections before restoring (like MySQL --clean)

    // Handle database renaming with nsFrom/nsTo
    if (sourceDb && targetDb && sourceDb !== targetDb) {
        args.push('--nsFrom', `${sourceDb}.*`);
        args.push('--nsTo', `${targetDb}.*`);
        log(`Remapping database: ${sourceDb} -> ${targetDb}`, 'info');
    } else if (targetDb) {
        // If only targetDb specified (single DB archive), just restore
        args.push('--nsInclude', `${targetDb}.*`);
    }

    // Mask password in logs
    const logArgs = args.map(arg => {
        if (arg.startsWith('--password')) return '--password=******';
        if (arg.startsWith('mongodb')) return 'mongodb://...';
        return arg;
    });

    log(`Restoring database`, 'info', 'command', `mongorestore ${logArgs.join(' ')}`);

    const restoreProcess = spawn('mongorestore', args);

    if (fromStdin) {
        const readStream = createReadStream(sourcePath);
        readStream.pipe(restoreProcess.stdin);

        readStream.on('error', (err) => {
            log(`Read stream error: ${err.message}`, 'error');
            restoreProcess.kill();
        });
    }

    restoreProcess.stderr.on('data', (data) => {
        const msg = data.toString().trim();
        if (msg) log(`[mongorestore] ${msg}`, 'info');
    });

    await waitForProcess(restoreProcess, 'mongorestore');
}

export async function restore(
    config: any,
    sourcePath: string,
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

            const { manifest, files } = await extractMultiDbTar(sourcePath, tempDir);
            log(`Extracted ${files.length} database archives from TAR`, 'info');

            const totalDbs = manifest.databases.length;
            let processed = 0;

            for (const dbEntry of manifest.databases) {
                // Check if database should be restored (based on mapping)
                if (!shouldRestoreDatabase(dbEntry.name, mapping)) {
                    log(`Skipping database: ${dbEntry.name} (not selected)`, 'info');
                    processed++;
                    continue;
                }

                // Determine target database name (supports renaming)
                const targetDb = getTargetDatabaseName(dbEntry.name, mapping);
                const archivePath = path.join(tempDir, dbEntry.filename);

                log(`Restoring database: ${dbEntry.name} -> ${targetDb}`, 'info');

                // Prepare restore (permission check)
                await prepareRestore(config, [targetDb]);

                // Restore using mongorestore with nsFrom/nsTo for renaming
                await restoreSingleDatabase(archivePath, targetDb, dbEntry.name, config, log, false);
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
            const args: string[] = [];

            if (config.uri) {
                args.push(`--uri=${config.uri}`);
            } else {
                args.push('--host', config.host);
                args.push('--port', String(config.port));

                if (config.user && config.password) {
                    args.push('--username', config.user);
                    args.push('--password', config.password);
                    args.push('--authenticationDatabase', config.authenticationDatabase || 'admin');
                }
            }

            args.push('--archive');
            args.push('--gzip');
            args.push('--drop');

            // Handle database renaming with nsFrom/nsTo
            if (sourceDb && targetDb && sourceDb !== targetDb) {
                args.push('--nsFrom', `${sourceDb}.*`);
                args.push('--nsTo', `${targetDb}.*`);
                log(`Restoring database: ${sourceDb} -> ${targetDb}`, 'info');
            } else if (sourceDb) {
                log(`Restoring database: ${sourceDb}`, 'info');
            }

            // Masking for logs
            const logArgs = args.map(arg => {
                if (arg.startsWith('--password')) return '--password=******';
                if (arg.startsWith('mongodb')) return 'mongodb://...';
                return arg;
            });

            log(`Restoring database`, 'info', 'command', `mongorestore ${logArgs.join(' ')}`);

            // Spawn process
            const restoreProcess = spawn('mongorestore', args);
            const readStream = createReadStream(sourcePath);

            readStream.pipe(restoreProcess.stdin);

            restoreProcess.stderr.on('data', (data) => {
                const msg = data.toString().trim();
                if (msg) {
                    // mongorestore writes progress to stderr - log as info, not error
                    log(`[mongorestore] ${msg}`, 'info');
                }
            });

            // Handle stream errors
            readStream.on('error', (err) => {
                log(`Read stream error: ${err.message}`, 'error');
                restoreProcess.kill();
            });

            await waitForProcess(restoreProcess, 'mongorestore');
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
