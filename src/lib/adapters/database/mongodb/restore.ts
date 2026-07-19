import { BackupResult } from "@/lib/core/interfaces";
import { LogLevel, LogType } from "@/lib/core/logs";
import { MongoClient } from "mongodb";
import { MongoDBConfig } from "@/lib/adapters/definitions";
import { spawn } from "child_process";
import { createReadStream } from "fs";
import fs from "fs/promises";
import { waitForProcess } from "@/lib/adapters/process";
import path from "path";
import { randomUUID } from "crypto";
import {
    isMultiDbTar,
    extractSelectedDatabases,
    createTempDir,
    cleanupTempDir,
    shouldRestoreDatabase,
    getTargetDatabaseName,
} from "../common/tar-utils";
import {
    SshClient,
    isSSHMode,
    extractSshConfig,
    buildMongoArgs,
    remoteBinaryCheck,
    shellEscape,
} from "@/lib/ssh";

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
function buildConnectionUri(config: MongoDBConfig): string {
    if (config.uri) {
        return config.uri;
    }

    const auth = config.user && config.password
        ? `${encodeURIComponent(config.user)}:${encodeURIComponent(config.password)}@`
        : "";
    const authDb = config.authenticationDatabase || "admin";
    const authParam = config.user ? `?authSource=${authDb}` : "";

    return `mongodb://${auth}${config.host}:${config.port}/${authParam}`;
}

export async function prepareRestore(config: MongoDBRestoreConfig, databases: string[]): Promise<void> {
    if (isSSHMode(config)) {
        // In SSH mode, we trust mongorestore to create databases. Skip the permission check.
        return;
    }

    // Determine credentials (privileged or standard)
    const usageConfig: MongoDBConfig = { ...config };
    if (config.privilegedAuth) {
        usageConfig.user = config.privilegedAuth.user;
        usageConfig.password = config.privilegedAuth.password;
    }

    let client: MongoClient | null = null;

    try {
        const uri = buildConnectionUri(usageConfig);
        client = new MongoClient(uri, {
            connectTimeoutMS: 10000,
            serverSelectionTimeoutMS: 10000,
        });

        await client.connect();

        for (const dbName of databases) {
            try {
                // Test write permission by creating and dropping a temporary collection
                const targetDb = client.db(dbName);
                await targetDb.createCollection("__perm_check_tmp");
                await targetDb.collection("__perm_check_tmp").drop();
            } catch (e: unknown) {
                const err = e as { message?: string; codeName?: string };
                const msg = err.message || err.codeName || "";
                if (msg.includes("not authorized") || msg.includes("Authorization") || msg.includes("requires authentication") || msg.includes("command create requires")) {
                    throw new Error(`Access denied to database '${dbName}'. Permissions?`);
                }
                throw e;
            }
        }
    } finally {
        if (client) {
            await client.close().catch(() => {});
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
    config: MongoDBRestoreConfig,
    log: (msg: string, level?: LogLevel, type?: LogType, details?: string) => void,
    fromStdin: boolean = false
): Promise<void> {
    if (isSSHMode(config)) {
        return restoreSingleDatabaseSSH(sourcePath, targetDb, sourceDb, config, log);
    }

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

/**
 * SSH variant: upload archive via SFTP, then run mongorestore on the remote server.
 * Uses SFTP protocol which guarantees data integrity (unlike piping through exec stdin).
 */
async function restoreSingleDatabaseSSH(
    sourcePath: string,
    targetDb: string | undefined,
    sourceDb: string | undefined,
    config: MongoDBRestoreConfig,
    log: (msg: string, level?: LogLevel, type?: LogType, details?: string) => void
): Promise<void> {
    const sshConfig = extractSshConfig(config)!;
    const ssh = new SshClient();
    await ssh.connect(sshConfig);

    const remoteTempFile = `/tmp/dbackup_mongorestore_${randomUUID()}.archive`;

    try {
        const mongorestoreBin = await remoteBinaryCheck(ssh, "mongorestore");
        const args = buildMongoArgs(config);

        args.push(`--archive=${shellEscape(remoteTempFile)}`);
        args.push("--gzip");
        args.push("--drop");

        if (sourceDb && targetDb && sourceDb !== targetDb) {
            args.push("--nsFrom", shellEscape(`${sourceDb}.*`));
            args.push("--nsTo", shellEscape(`${targetDb}.*`));
            log(`Remapping database: ${sourceDb} -> ${targetDb}`, 'info');
        } else if (targetDb) {
            args.push("--nsInclude", shellEscape(`${targetDb}.*`));
        }

        // 1. Upload archive to remote via SFTP
        const totalSize = (await fs.stat(sourcePath)).size;
        log(`Uploading archive to remote server via SFTP (${(totalSize / 1024 / 1024).toFixed(1)} MB)...`, 'info');
        await ssh.uploadFile(sourcePath, remoteTempFile);

        // Verify upload integrity
        try {
            const sizeCheck = await ssh.exec(`stat -c '%s' ${shellEscape(remoteTempFile)} 2>/dev/null || stat -f '%z' ${shellEscape(remoteTempFile)}`);
            const remoteSize = parseInt(sizeCheck.stdout.trim(), 10);
            if (remoteSize !== totalSize) {
                throw new Error(`Upload size mismatch! Local: ${totalSize}, Remote: ${remoteSize}`);
            }
            log(`Upload verified: ${(remoteSize / 1024 / 1024).toFixed(1)} MB`);
        } catch (e) {
            if (e instanceof Error && e.message.includes('mismatch')) throw e;
        }

        // 2. Run mongorestore on the remote server
        const cmd = `${mongorestoreBin} ${args.join(" ")}`;
        log(`Restoring database (SSH)`, 'info', 'command', `mongorestore ${args.join(' ').replace(config.password || '___NONE___', '******')}`);

        await new Promise<void>((resolve, reject) => {
            ssh.execStream(cmd, (err, stream) => {
                if (err) return reject(err);

                stream.on('data', () => {});

                stream.stderr.on('data', (data: any) => {
                    const msg = data.toString().trim();
                    if (msg) log(`[mongorestore] ${msg}`, 'info');
                });

                stream.on('exit', (code: number | null, signal?: string) => {
                    if (code === 0) resolve();
                    else reject(new Error(`Remote mongorestore exited with code ${code ?? 'null'}${signal ? ` (signal: ${signal})` : ''}`));
                });

                stream.on('error', (err: Error) => reject(err));
            });
        });
    } finally {
        // Cleanup remote temp file
        await ssh.exec(`rm -f ${shellEscape(remoteTempFile)}`).catch(() => {});
        ssh.end();
    }
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
    onLog?: (msg: string, level?: LogLevel, type?: LogType, details?: string) => void,
    _onProgress?: (percentage: number, detail?: string) => void,
    originalDbName?: string
): Promise<void> {
    await restoreSingleDatabase(filePath, targetDbName, originalDbName, config, onLog ?? (() => {}), false);
}

export async function restore(
    config: MongoDBRestoreConfig,
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
