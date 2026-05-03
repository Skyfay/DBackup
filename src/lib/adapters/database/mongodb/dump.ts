import { BackupResult } from "@/lib/core/interfaces";
import { LogLevel, LogType } from "@/lib/core/logs";
import { spawn } from "child_process";
import { createWriteStream } from "fs";
import { waitForProcess } from "@/lib/adapters/process";
import fs from "fs/promises";
import path from "path";
import {
    createMultiDbTar,
    createTempDir,
    cleanupTempDir,
} from "../common/tar-utils";
import { TarFileEntry, TarManifest } from "../common/types";
import { MongoDBConfig } from "@/lib/adapters/definitions";
import { getDatabases } from "./connection";
import {
    SshClient,
    isSSHMode,
    extractSshConfig,
    buildMongoArgs,
    remoteBinaryCheck,
    shellEscape,
} from "@/lib/ssh";

/**
 * Extended MongoDB config for dump operations with runtime fields
 */
type MongoDBDumpConfig = MongoDBConfig & {
    detectedVersion?: string;
};

/**
 * Dump a single MongoDB database using mongodump --archive --gzip
 */
async function dumpSingleDatabase(
    dbName: string,
    outputPath: string,
    config: MongoDBDumpConfig,
    log: (msg: string, level?: LogLevel, type?: LogType, details?: string) => void
): Promise<void> {
    if (isSSHMode(config)) {
        return dumpSingleDatabaseSSH(dbName, outputPath, config, log);
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

    args.push('--db', dbName);
    args.push(`--archive=${outputPath}`);
    args.push('--gzip');

    // Add custom options
    if (config.options) {
        const parts = config.options.match(/[^\s"']+|"([^"]*)"|'([^']*)'/g) || [];
        for (const part of parts) {
            if (part.startsWith('"') && part.endsWith('"')) args.push(part.slice(1, -1));
            else if (part.startsWith("'") && part.endsWith("'")) args.push(part.slice(1, -1));
            else args.push(part);
        }
    }

    // Mask password in logs
    const logArgs = args.map(arg => {
        if (arg.startsWith('--password')) return '--password=******';
        if (arg.startsWith('mongodb')) return 'mongodb://...';
        return arg;
    });

    log(`Dumping database: ${dbName}`, 'info', 'command', `mongodump ${logArgs.join(' ')}`);

    const dumpProcess = spawn('mongodump', args);
    const stderrBuffer: string[] = [];

    dumpProcess.stderr.on('data', (data) => {
        const msg = data.toString().trim();
        if (msg) stderrBuffer.push(msg);
    });

    await waitForProcess(dumpProcess, 'mongodump');

    if (stderrBuffer.length > 0) {
        log(`mongodump output`, 'info', 'command', stderrBuffer.join('\n'));
    }
}

/**
 * SSH variant: run mongodump on the remote server with --archive to stdout, stream back.
 */
async function dumpSingleDatabaseSSH(
    dbName: string,
    outputPath: string,
    config: MongoDBDumpConfig,
    log: (msg: string, level?: LogLevel, type?: LogType, details?: string) => void
): Promise<void> {
    const sshConfig = extractSshConfig(config)!;
    const ssh = new SshClient();
    await ssh.connect(sshConfig);

    try {
        const mongodumpBin = await remoteBinaryCheck(ssh, "mongodump");
        const args = buildMongoArgs(config);

        args.push("--db", shellEscape(dbName));
        args.push("--archive"); // stdout mode
        args.push("--gzip");

        if (config.options) {
            const parts = config.options.match(/[^\s"']+|"([^"]*)"|'([^']*)'/g) || [];
            for (const part of parts) {
                if (part.startsWith('"') && part.endsWith('"')) args.push(part.slice(1, -1));
                else if (part.startsWith("'") && part.endsWith("'")) args.push(part.slice(1, -1));
                else args.push(part);
            }
        }

        const cmd = `${mongodumpBin} ${args.join(" ")}`;
        log(`Dumping database (SSH): ${dbName}`, 'info', 'command', `mongodump ${args.join(' ').replace(config.password || '___NONE___', '******')}`);

        const writeStream = createWriteStream(outputPath);

        await new Promise<void>((resolve, reject) => {
            ssh.execStream(cmd, (err, stream) => {
                if (err) return reject(err);

                stream.pipe(writeStream);

                const stderrChunks: string[] = [];
                stream.stderr.on('data', (data: any) => {
                    const msg = data.toString().trim();
                    if (msg) stderrChunks.push(msg);
                });

                stream.on('exit', (code: number | null, signal?: string) => {
                    if (stderrChunks.length > 0) {
                        log(`mongodump output`, 'info', 'command', stderrChunks.join('\n'));
                    }
                    if (code === 0) resolve();
                    else reject(new Error(`Remote mongodump exited with code ${code ?? 'null'}${signal ? ` (signal: ${signal})` : ''}`));
                });

                stream.on('error', (err: Error) => reject(err));
                writeStream.on('error', (err: Error) => reject(err));
            });
        });
    } finally {
        ssh.end();
    }
}

export async function dump(
    config: MongoDBDumpConfig,
    destinationPath: string,
    onLog?: (msg: string, level?: LogLevel, type?: LogType, details?: string) => void,
    _onProgress?: (percentage: number) => void
): Promise<BackupResult> {
    const startedAt = new Date();
    const logs: string[] = [];

    const log = (msg: string, level: LogLevel = 'info', type: LogType = 'general', details?: string) => {
        logs.push(msg);
        if (onLog) onLog(msg, level, type, details);
    };

    let tempDir: string | null = null;

    try {
        // Prepare DB list
        let dbs: string[] = [];
        if (Array.isArray(config.database)) {
            dbs = config.database;
        } else if (typeof config.database === 'string') {
            dbs = config.database.split(',').map((s: string) => s.trim()).filter(Boolean);
        }
        // Fallback: if dbs is still empty but config.database exists
        if (dbs.length === 0 && config.database) {
            const db = Array.isArray(config.database) ? config.database[0] : config.database;
            if (db) dbs = [db];
        }

        // Discover all databases if none selected (same pattern as MySQL adapter)
        if (dbs.length === 0) {
            log("No databases selected - backing up all databases");
            try {
                dbs = await getDatabases(config);
                log(`Found ${dbs.length} database(s): ${dbs.join(', ')}`);
            } catch (e: unknown) {
                const message = e instanceof Error ? e.message : String(e);
                log(`Warning: Could not fetch database list: ${message}`, 'warning');
                // Continue anyway - mongodump without --db dumps all databases
            }
        }

        // Case 1: Single Database or ALL - Direct archive dump
        if (dbs.length <= 1) {
            log(`Starting single-database dump (archive format)`, 'info');
            await dumpSingleDatabase(dbs[0] || '', destinationPath, config, log);
        }
        // Case 2: Multiple Databases - TAR archive or separate files
        else {
            const backupType = (config as any).multiDbBackupType || 'SINGLE_TAR';

            if (backupType === 'SEPARATE_FILES') {
                log(`Dumping ${dbs.length} databases as separate files: ${dbs.join(', ')}`, 'info');

                tempDir = await createTempDir('mongo-multidb-');
                log(`Created temp directory: ${tempDir}`, 'info');

                const finalFiles = [];

                for (const dbName of dbs) {
                    const dumpFilename = `${dbName}.archive`;
                    const dumpPath = path.join(tempDir, dumpFilename);

                    await dumpSingleDatabase(dbName, dumpPath, config, log);
                    log(`Database ${dbName} dumped successfully`, 'success');

                    const finalPath = path.join(path.dirname(destinationPath), dumpFilename);
                    await fs.copyFile(dumpPath, finalPath);
                    const fileStats = await fs.stat(finalPath);
                    finalFiles.push({
                        path: finalPath,
                        name: dumpFilename,
                        size: fileStats.size,
                        database: dbName,
                    });
                    log(`Prepared file: ${dumpFilename}`, 'success');
                }

                log(`SEPARATE_FILES backup ready: ${finalFiles.length} files`, 'success');
                await cleanupTempDir(tempDir);
                tempDir = null;

                return {
                    success: true,
                    files: finalFiles,
                    logs,
                    startedAt,
                    completedAt: new Date(),
                    metadata: {
                        databases: dbs,
                    },
                };
            } else {
                log(`Dumping ${dbs.length} databases using TAR archive: ${dbs.join(', ')}`, 'info');

                tempDir = await createTempDir('mongo-multidb-');
                log(`Created temp directory: ${tempDir}`, 'info');

                const tarFiles: TarFileEntry[] = [];

                for (const dbName of dbs) {
                    const dumpFilename = `${dbName}.archive`;
                    const dumpPath = path.join(tempDir, dumpFilename);

                    await dumpSingleDatabase(dbName, dumpPath, config, log);
                    log(`Database ${dbName} dumped successfully`, 'success');

                    tarFiles.push({
                        name: dumpFilename,
                        path: dumpPath,
                        dbName,
                        format: 'archive',
                    });
                }

                // Create TAR archive with manifest
                log(`Creating TAR archive with ${tarFiles.length} databases...`, 'info');
                const manifest: TarManifest = await createMultiDbTar(tarFiles, destinationPath, {
                    sourceType: 'mongodb',
                    engineVersion: config.detectedVersion || 'unknown',
                    backupType: 'SINGLE_TAR',
                });

                log(`Multi-database TAR archive created successfully`, 'success');
                log(`Manifest: ${manifest.databases.length} databases, ${manifest.totalSize} bytes`, 'info');
            }
        }

        // Verify
        const stats = await fs.stat(destinationPath);
        if (stats.size === 0) {
            throw new Error("Dump file is empty. Check logs/permissions.");
        }

        const result: any = {
            success: true,
            path: destinationPath,
            size: stats.size,
            logs,
            startedAt,
            completedAt: new Date(),
        };

        // Add metadata for multi-database backups
        if (dbs.length > 1) {
            result.metadata = {
                databases: dbs,
            };
        }

        return result;

    } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        log(`Dump failed: ${message}`, 'error');
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
