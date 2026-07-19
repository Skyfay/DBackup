import { BackupResult } from "@/lib/core/interfaces";
import { LogLevel, LogType } from "@/lib/core/logs";
import { MySQLConfig, MariaDBConfig } from "@/lib/adapters/definitions";
import { getDialect } from "./dialects";
import { getMysqldumpCommand } from "./tools";
import { getDatabases } from "./connection";
import fs from "fs/promises";
import path from "path";
import { spawn } from "child_process";
import { createWriteStream } from "fs";
import {
    createMultiDbTar,
    createTempDir,
    cleanupTempDir,
} from "../common/tar-utils";
import { TarFileEntry } from "../common/types";
import {
    SshClient,
    isSSHMode,
    extractSshConfig,
    buildMysqlArgs,
    withLocalMyCnf,
    withRemoteMyCnf,
    remoteBinaryCheck,
    shellEscape,
} from "@/lib/ssh";

/** Extended config with runtime fields */
type MySQLDumpConfig = (MySQLConfig | MariaDBConfig) & {
    type?: string;
    detectedVersion?: string;
};

/**
 * Dump a single database to a file
 */
async function dumpSingleDatabase(
    config: MySQLDumpConfig,
    dbName: string,
    destinationPath: string,
    onLog: (msg: string, level?: LogLevel, type?: LogType, details?: string) => void
): Promise<{ success: boolean; size: number }> {
    if (isSSHMode(config)) {
        return dumpSingleDatabaseSSH(config, dbName, destinationPath, onLog);
    }

    const dialect = getDialect(config.type === 'mariadb' ? 'mariadb' : 'mysql', config.detectedVersion);
    const args = dialect.getDumpArgs(config, [dbName]);

    const safeCmd = `${getMysqldumpCommand()} ${args.join(' ').replace(config.password || '___NONE___', '******')}`;
    onLog(`Dumping database: ${dbName}`, 'info', 'command', safeCmd);

    return withLocalMyCnf(config.password, async (cnfPath) => {
        const finalArgs = cnfPath ? [`--defaults-file=${cnfPath}`, ...args] : args;
        const dumpProcess = spawn(getMysqldumpCommand(), finalArgs);
        const writeStream = createWriteStream(destinationPath);

        dumpProcess.stdout.pipe(writeStream);

        dumpProcess.stderr.on('data', (data) => {
            const msg = data.toString().trim();
            // Filter benign warnings from MariaDB tools
            if (msg.includes("Using a password") || msg.includes("Deprecated program name")) return;
            onLog(msg);
        });

        await new Promise<void>((resolve, reject) => {
            dumpProcess.on('close', (code) => {
                if (code === 0) resolve();
                else reject(new Error(`${getMysqldumpCommand()} exited with code ${code}`));
            });
            dumpProcess.on('error', (err) => reject(err));
            writeStream.on('error', (err: Error) => reject(err));
        });

        const stats = await fs.stat(destinationPath);
        if (stats.size === 0) {
            throw new Error(`Dump file for ${dbName} is empty. Check logs/permissions.`);
        }

        return { success: true, size: stats.size };
    });
}

/**
 * SSH variant: run mysqldump on the remote server and stream output to a local file.
 */
async function dumpSingleDatabaseSSH(
    config: MySQLDumpConfig,
    dbName: string,
    destinationPath: string,
    onLog: (msg: string, level?: LogLevel, type?: LogType, details?: string) => void
): Promise<{ success: boolean; size: number }> {
    const sshConfig = extractSshConfig(config)!;
    const ssh = new SshClient();
    await ssh.connect(sshConfig);

    try {
        const dumpBin = await remoteBinaryCheck(ssh, "mariadb-dump", "mysqldump");
        const args = buildMysqlArgs(config);

        // Limit INSERT size to ~16KB to prevent OOM during restore on low-memory servers
        args.push("--net-buffer-length=16384");

        // Add dump-specific options
        if ((config as any).options) {
            args.push(...(config as any).options.split(' ').filter((s: string) => s.trim().length > 0));
        }
        args.push("--databases", shellEscape(dbName));

        const writeStream = createWriteStream(destinationPath);

        await withRemoteMyCnf(ssh, config.password, async (cnfPath) => {
            const cnfPrefix = cnfPath ? `--defaults-file=${shellEscape(cnfPath)} ` : "";
            const cmd = `${dumpBin} ${cnfPrefix}${args.join(" ")}`;
            onLog(`Dumping database (SSH): ${dbName}`, 'info', 'command', `${dumpBin} ${args.join(" ")}`);

            await new Promise<void>((resolve, reject) => {
                ssh.execStream(cmd, (err, stream) => {
                    if (err) return reject(err);

                    stream.pipe(writeStream);

                    stream.stderr.on('data', (data: any) => {
                        const msg = data.toString().trim();
                        if (msg.includes("Using a password") || msg.includes("Deprecated program name")) return;
                        onLog(msg);
                    });

                    stream.on('exit', (code: number | null, signal?: string) => {
                        if (code === 0) resolve();
                        else reject(new Error(`Remote mysqldump exited with code ${code ?? 'null'}${signal ? ` (signal: ${signal})` : ''}`));
                    });

                    stream.on('error', (err: Error) => reject(err));
                    writeStream.on('error', (err: Error) => reject(err));
                });
            });
        });

        const stats = await fs.stat(destinationPath);
        if (stats.size === 0) {
            throw new Error(`Dump file for ${dbName} is empty. Check logs/permissions.`);
        }

        return { success: true, size: stats.size };
    } finally {
        ssh.end();
    }
}

/**
 * Capability export for combined DB+directory backups (JobSource): dumps exactly one
 * database to a plain file, without any TAR/manifest wrapping. Thin wrapper around the
 * same per-database logic dump() already uses internally for its own multi-DB case.
 */
export async function dumpOne(
    config: MySQLDumpConfig,
    dbName: string,
    destinationPath: string,
    onLog?: (msg: string, level?: LogLevel, type?: LogType, details?: string) => void
): Promise<{ size: number }> {
    const result = await dumpSingleDatabase(config, dbName, destinationPath, onLog ?? (() => {}));
    return { size: result.size };
}

export async function dump(config: MySQLDumpConfig, destinationPath: string, onLog?: (msg: string, level?: LogLevel, type?: LogType, details?: string) => void, _onProgress?: (percentage: number) => void): Promise<BackupResult> {
    const startedAt = new Date();
    const logs: string[] = [];
    const log = (msg: string, level: LogLevel = 'info', type: LogType = 'general', details?: string) => {
        logs.push(msg);
        if (onLog) onLog(msg, level, type, details);
    };

    try {
        // Determine databases to backup
        let dbs: string[] = [];
        if (Array.isArray(config.database)) dbs = config.database;
        else if (config.database && config.database.includes(',')) dbs = config.database.split(',');
        else if (config.database) dbs = [config.database];

        if (dbs.length === 0) {
            log("No databases selected - backing up all databases");
            dbs = await getDatabases(config);
            log(`Found ${dbs.length} database(s): ${dbs.join(', ')}`);
        }

        if (dbs.length === 0) {
            throw new Error("No databases found on server");
        }

        // Single DB: Direct dump (no TAR needed)
        if (dbs.length === 1) {
            const result = await dumpSingleDatabase(config, dbs[0], destinationPath, log);

            const sizeMB = (result.size / 1024 / 1024).toFixed(2);
            log(`Dump finished successfully. Size: ${sizeMB} MB`);

            return {
                success: true,
                path: destinationPath,
                size: result.size,
                logs,
                startedAt,
                completedAt: new Date(),
            };
        }

        // Multi-DB: Dump each database separately, then pack into TAR
        log(`Multi-database backup: ${dbs.length} databases`);

        const tempDir = await createTempDir("mysql-multidb-");
        const dbFiles: TarFileEntry[] = [];

        try {
            for (const dbName of dbs) {
                const dbFileName = `${dbName}.sql`;
                const dbFilePath = path.join(tempDir, dbFileName);

                await dumpSingleDatabase(config, dbName, dbFilePath, log);

                dbFiles.push({
                    name: dbFileName,
                    path: dbFilePath,
                    dbName,
                    format: "sql",
                });

                log(`Completed dump for: ${dbName}`);
            }

            // Create TAR archive with manifest
            log(`Creating TAR archive with ${dbFiles.length} databases...`);
            const manifest = await createMultiDbTar(dbFiles, destinationPath, {
                sourceType: config.type === 'mariadb' ? 'mariadb' : 'mysql',
                engineVersion: config.detectedVersion,
            });

            const stats = await fs.stat(destinationPath);
            const sizeMB = (stats.size / 1024 / 1024).toFixed(2);
            log(`Multi-DB backup finished successfully. Size: ${sizeMB} MB`);

            return {
                success: true,
                path: destinationPath,
                size: stats.size,
                logs,
                startedAt,
                completedAt: new Date(),
                metadata: {
                    multiDb: {
                        format: 'tar',
                        databases: manifest.databases.map(d => d.name),
                    },
                },
            };
        } finally {
            // Always cleanup temp files
            await cleanupTempDir(tempDir);
        }

    } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        log(`Error: ${message}`, 'error');
        return {
            success: false,
            logs,
            error: message,
            startedAt,
            completedAt: new Date(),
        };
    }
}
