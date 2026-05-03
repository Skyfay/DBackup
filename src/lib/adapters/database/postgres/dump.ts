import { BackupResult } from "@/lib/core/interfaces";
import { LogLevel, LogType } from "@/lib/core/logs";
import { spawn } from "child_process";
import fs from "fs/promises";
import { createWriteStream } from "fs";
import path from "path";
import {
    createMultiDbTar,
    createTempDir,
    cleanupTempDir,
} from "../common/tar-utils";
import { TarFileEntry, TarManifest } from "../common/types";
import { PostgresConfig } from "@/lib/adapters/definitions";
import { getDatabases } from "./connection";
import {
    SshClient,
    isSSHMode,
    extractSshConfig,
    buildPsqlArgs,
    remoteEnv,
    remoteBinaryCheck,
    shellEscape,
} from "@/lib/ssh";

/**
 * Extended PostgreSQL config for dump operations with runtime fields
 */
type PostgresDumpConfig = PostgresConfig & {
    detectedVersion?: string;
    pgCompression?: string;
};

/**
 * Builds the -Z flag arguments for pg_dump based on the pgCompression job setting.
 *
 * pgCompression values:
 *   ""        - legacy behavior: -Z 6 (gzip level 6, all pg versions)
 *   "NONE"    - no compression: -Z 0
 *   "GZIP:N"  - gzip level N (numeric syntax, all pg versions)
 *   "LZ4:N"   - lz4 level N (requires pg14+)
 *   "ZSTD:N"  - zstd level N (requires pg16+)
 */
function buildCompressionArgs(pgCompression: string | undefined): string[] {
    if (!pgCompression || pgCompression === "") {
        // Legacy: keep original behavior for existing jobs
        return ["-Z", "6"];
    }
    if (pgCompression === "NONE") {
        return ["-Z", "0"];
    }
    const colonIdx = pgCompression.indexOf(":");
    if (colonIdx === -1) return ["-Z", "6"];
    const algo = pgCompression.slice(0, colonIdx).toUpperCase();
    const level = pgCompression.slice(colonIdx + 1);
    if (algo === "GZIP") {
        // Use numeric syntax for broadest pg version compatibility
        return ["-Z", level];
    }
    if (algo === "LZ4") {
        return ["-Z", `lz4:${level}`];
    }
    if (algo === "ZSTD") {
        return ["-Z", `zstd:${level}`];
    }
    // Unknown algo - fall back to legacy
    return ["-Z", "6"];
}

/**
 * Dump a single PostgreSQL database using pg_dump with custom format (-Fc)
 */
async function dumpSingleDatabase(
    dbName: string,
    outputPath: string,
    config: PostgresDumpConfig,
    env: NodeJS.ProcessEnv,
    log: (msg: string, level?: LogLevel, type?: LogType, details?: string) => void
): Promise<void> {
    if (isSSHMode(config)) {
        return dumpSingleDatabaseSSH(dbName, outputPath, config, log);
    }

    const args = [
        '-h', config.host,
        '-p', String(config.port),
        '-U', config.user,
        '-F', 'c', // Custom format (compressed, binary)
        ...buildCompressionArgs(config.pgCompression),
        '-d', dbName,
    ];

    // Add custom options if provided
    if (config.options) {
        const parts = config.options.match(/[^\s"']+|"([^"]*)"|'([^']*)'/g) || [];
        for (const part of parts) {
            if (part.startsWith('"') && part.endsWith('"')) {
                args.push(part.slice(1, -1));
            } else if (part.startsWith("'") && part.endsWith("'")) {
                args.push(part.slice(1, -1));
            } else {
                args.push(part);
            }
        }
    }

    log(`Dumping database: ${dbName}`, 'info', 'command', `pg_dump ${args.join(' ')}`);

    const dumpProcess = spawn('pg_dump', args, { env });
    const writeStream = createWriteStream(outputPath);

    dumpProcess.stdout.pipe(writeStream);

    dumpProcess.stderr.on('data', (data) => {
        const msg = data.toString().trim();
        if (msg && !msg.includes('NOTICE:')) {
            log(msg, 'info');
        }
    });

    await new Promise<void>((resolve, reject) => {
        dumpProcess.on('close', (code) => {
            if (code === 0) resolve();
            else reject(new Error(`pg_dump for ${dbName} exited with code ${code}`));
        });
        dumpProcess.on('error', (err) => reject(err));
        writeStream.on('error', (err) => reject(err));
    });
}

/**
 * SSH variant: run pg_dump on the remote server and stream custom-format output to a local file.
 */
async function dumpSingleDatabaseSSH(
    dbName: string,
    outputPath: string,
    config: PostgresDumpConfig,
    log: (msg: string, level?: LogLevel, type?: LogType, details?: string) => void
): Promise<void> {
    const sshConfig = extractSshConfig(config)!;
    const ssh = new SshClient();
    await ssh.connect(sshConfig);

    try {
        const pgDumpBin = await remoteBinaryCheck(ssh, "pg_dump");
        const args = buildPsqlArgs(config);

        const dumpArgs = [
            ...args,
            "-F", "c",
            ...buildCompressionArgs(config.pgCompression),
            "-d", shellEscape(dbName),
        ];

        if (config.options) {
            const parts = config.options.match(/[^\s"']+|"([^"]*)"|'([^']*)'/g) || [];
            for (const part of parts) {
                if (part.startsWith('"') && part.endsWith('"')) {
                    dumpArgs.push(part.slice(1, -1));
                } else if (part.startsWith("'") && part.endsWith("'")) {
                    dumpArgs.push(part.slice(1, -1));
                } else {
                    dumpArgs.push(part);
                }
            }
        }

        const env: Record<string, string | undefined> = {};
        if (config.password) env.PGPASSWORD = config.password;

        const cmd = remoteEnv(env, `${pgDumpBin} ${dumpArgs.join(" ")}`);
        log(`Dumping database (SSH): ${dbName}`, 'info', 'command', `pg_dump ${dumpArgs.join(' ')}`);

        const writeStream = createWriteStream(outputPath);

        await new Promise<void>((resolve, reject) => {
            ssh.execStream(cmd, (err, stream) => {
                if (err) return reject(err);

                stream.pipe(writeStream);

                stream.stderr.on('data', (data: any) => {
                    const msg = data.toString().trim();
                    if (msg && !msg.includes('NOTICE:')) {
                        log(msg, 'info');
                    }
                });

                stream.on('exit', (code: number | null, signal?: string) => {
                    if (code === 0) resolve();
                    else reject(new Error(`Remote pg_dump for ${dbName} exited with code ${code ?? 'null'}${signal ? ` (signal: ${signal})` : ''}`));
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
    config: PostgresDumpConfig,
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
        const env = { ...process.env };
        if (config.password) {
            env.PGPASSWORD = config.password;
        }

        // Determine databases
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

        // Auto-discover all databases if none specified
        if (dbs.length === 0) {
            log("No DB selected - auto-discovering all databases…", "info");
            dbs = await getDatabases(config);
            log(`Discovered ${dbs.length} database(s): ${dbs.join(", ")}`, "info");
            if (dbs.length === 0) {
                throw new Error("No databases found on the server");
            }
        }

        // Case 1: Single Database - Direct dump with custom format
        if (dbs.length <= 1) {
            log(`Starting single-database dump (custom format)`, 'info');
            await dumpSingleDatabase(dbs[0], destinationPath, config, env, log);
        }
        // Case 2: Multiple Databases - Either separate files or TAR archive
        else {
            const backupType = (config as any).multiDbBackupType || 'SINGLE_TAR';
            log(`Dumping ${dbs.length} databases (${backupType}): ${dbs.join(', ')}`, 'info');

            // Create temp directory for individual dumps
            tempDir = await createTempDir('pg-multidb-');
            log(`Created temp directory: ${tempDir}`, 'info');

            const dumpedFiles: Array<{ path: string; name: string; size: number; database: string }> = [];
            const tarFiles: TarFileEntry[] = [];

            // Dump each database individually with custom format
            for (const dbName of dbs) {
                const dumpFilename = `${dbName}.dump`;
                const dumpPath = path.join(tempDir, dumpFilename);

                await dumpSingleDatabase(dbName, dumpPath, config, env, log);
                log(`Database ${dbName} dumped successfully`, 'success');

                const stats = await fs.stat(dumpPath);
                dumpedFiles.push({
                    path: dumpPath,
                    name: dumpFilename,
                    size: stats.size,
                    database: dbName,
                });

                if (backupType === 'SINGLE_TAR') {
                    tarFiles.push({
                        name: dumpFilename,
                        path: dumpPath,
                        dbName,
                        format: 'custom',
                    });
                }
            }

            // Handle based on backup type
            if (backupType === 'SEPARATE_FILES') {
                // Copy each file to final destination with database name prefix
                log(`Preparing ${dumpedFiles.length} separate backup files...`, 'info');

                const finalFiles = [];
                for (const file of dumpedFiles) {
                    const finalPath = path.join(path.dirname(destinationPath), `${file.database}.dump`);
                    await fs.copyFile(file.path, finalPath);
                    finalFiles.push({
                        path: finalPath,
                        name: `${file.database}.dump`,
                        size: file.size,
                        database: file.database,
                    });
                    log(`Prepared file: ${file.database}.dump`, 'success');
                }

                log(`SEPARATE_FILES backup ready: ${finalFiles.length} files`, 'success');
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
                // Create TAR archive with manifest
                log(`Creating TAR archive with ${tarFiles.length} databases...`, 'info');
                const manifest: TarManifest = await createMultiDbTar(tarFiles, destinationPath, {
                    sourceType: 'postgres',
                    engineVersion: config.detectedVersion || 'unknown',
                    backupType: 'SINGLE_TAR',
                });

                log(`Multi-database TAR archive created successfully`, 'success');
                log(`Manifest: ${manifest.databases.length} databases, ${manifest.totalSize} bytes`, 'info');
            }
        }

        const stats = await fs.stat(destinationPath);

        return {
            success: true,
            path: destinationPath,
            size: stats.size,
            logs,
            startedAt,
            completedAt: new Date(),
        };

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
        // Cleanup temp directory
        if (tempDir) {
            await cleanupTempDir(tempDir);
        }
    }
}
