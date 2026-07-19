import { LogLevel, LogType } from "@/lib/core/logs";
import { BackupResult } from "@/lib/core/interfaces";
import { execFileAsync } from "./connection";
import { getDialect } from "./dialects";
import { spawn } from "child_process";
import fs from "fs/promises";
import path from "path";
import {
    isMultiDbTar,
    extractSelectedDatabases,
    createTempDir,
    cleanupTempDir,
    shouldRestoreDatabase,
    getTargetDatabaseName,
} from "../common/tar-utils";
import { PostgresConfig } from "@/lib/adapters/definitions";
import {
    SshClient,
    isSSHMode,
    extractSshConfig,
    buildPsqlArgs,
    remoteEnv,
    remoteBinaryCheck,
    shellEscape,
} from "@/lib/ssh";
import { randomUUID } from "crypto";

/**
 * Extended PostgreSQL config for restore operations with runtime fields
 */
type PostgresRestoreConfig = PostgresConfig & {
    detectedVersion?: string;
    privilegedAuth?: {
        user: string;
        password: string;
    };
    databaseMapping?: Array<{
        originalName: string;
        targetName: string;
        selected: boolean;
    }>;
};

export async function prepareRestore(config: PostgresRestoreConfig, databases: string[]): Promise<void> {
    if (isSSHMode(config)) {
        return prepareRestoreSSH(config, databases);
    }

    const usePrivileged = !!config.privilegedAuth;
    const user = usePrivileged ? config.privilegedAuth!.user : config.user;
    const pass = usePrivileged ? config.privilegedAuth!.password : config.password;

    const env = { ...process.env };
    if (pass) env.PGPASSWORD = pass;

    const dialect = getDialect('postgres', config.detectedVersion);
    const baseArgs = dialect.getConnectionArgs({ ...config, user });
    const args = [...baseArgs, '-d', 'postgres'];

    for (const dbName of databases) {
        try {
            // Use dollar-quoting to safely pass the database name as a literal value
            const safeLiteral = dbName.replace(/'/g, "''");
            const { stdout } = await execFileAsync('psql', [...args, '-t', '-A', '-c', `SELECT 1 FROM pg_database WHERE datname = '${safeLiteral}'`], { env });

            if (stdout.trim() === '1') {
                continue;
            }

            const safeDbName = `"${dbName.replace(/"/g, '""')}"`;
            await execFileAsync('psql', [...args, '-c', `CREATE DATABASE ${safeDbName}`], { env });

        } catch (e: unknown) {
            const err = e as { stderr?: string; message?: string };
            const msg = err.stderr || err.message || "";
            if (msg.includes("permission denied")) {
                throw new Error(`Access denied for user '${user}' to create database '${dbName}'. User permissions?`);
            }
            if (msg.includes("already exists")) {
                continue;
            }
            throw e;
        }
    }
}

/**
 * SSH variant: create databases on the remote server via psql.
 */
async function prepareRestoreSSH(config: PostgresRestoreConfig, databases: string[]): Promise<void> {
    const sshConfig = extractSshConfig(config)!;
    const ssh = new SshClient();
    await ssh.connect(sshConfig);

    try {
        const usePrivileged = !!config.privilegedAuth;
        const user = usePrivileged ? config.privilegedAuth!.user : config.user;
        const pass = usePrivileged ? config.privilegedAuth!.password : config.password;

        const args = buildPsqlArgs(config, user);
        const env: Record<string, string | undefined> = {};
        if (pass) env.PGPASSWORD = pass;

        for (const dbName of databases) {
            const safeLiteral = dbName.replace(/'/g, "''");
            const checkCmd = remoteEnv(env, `psql ${args.join(" ")} -d postgres -t -A -c ${shellEscape(`SELECT 1 FROM pg_database WHERE datname = '${safeLiteral}'`)}`);
            const checkResult = await ssh.exec(checkCmd);
            if (checkResult.stdout.trim() === '1') continue;

            const safeDbName = `"${dbName.replace(/"/g, '""')}"`;
            const createCmd = remoteEnv(env, `psql ${args.join(" ")} -d postgres -c ${shellEscape(`CREATE DATABASE ${safeDbName}`)}`);
            const createResult = await ssh.exec(createCmd);

            if (createResult.code !== 0) {
                const msg = createResult.stderr;
                if (msg.includes("permission denied")) {
                    throw new Error(`Access denied for user '${user}' to create database '${dbName}'. User permissions?`);
                }
                if (msg.includes("already exists")) continue;
                throw new Error(`Failed to create database '${dbName}': ${msg}`);
            }
        }
    } finally {
        ssh.end();
    }
}

/**
 * Detect if a backup file is in PostgreSQL custom format
 */
async function isCustomFormat(filePath: string): Promise<boolean> {
    try {
        const buffer = Buffer.alloc(5);
        const handle = await fs.open(filePath, 'r');
        await handle.read(buffer, 0, 5, 0);
        await handle.close();
        return buffer.toString('ascii', 0, 5) === 'PGDMP';
    } catch {
        return false;
    }
}

/**
 * Restore a single PostgreSQL database using pg_restore
 */
async function restoreSingleDatabase(
    sourcePath: string,
    targetDb: string,
    config: PostgresRestoreConfig,
    env: NodeJS.ProcessEnv,
    log: (msg: string, level?: LogLevel, type?: LogType, details?: string) => void
): Promise<void> {
    if (isSSHMode(config)) {
        return restoreSingleDatabaseSSH(sourcePath, targetDb, config, log);
    }

    const args = [
        '-h', config.host,
        '-p', String(config.port),
        '-U', config.user,
        '-d', targetDb,
        '-w',
        '--clean',
        '--if-exists',
        '--no-owner',
        '--no-acl',
        '--no-comments',
        '--no-tablespaces',
        '--no-security-labels',
        '-v',
        sourcePath
    ];

    log(`Restoring to database: ${targetDb}`, 'info', 'command', `pg_restore ${args.join(' ')}`);

    await new Promise<void>((resolve, reject) => {
        const pgRestore = spawn('pg_restore', args, { env, stdio: ['ignore', 'pipe', 'pipe'] });

        let stderrBuffer = "";

        if (pgRestore.stderr) {
            pgRestore.stderr.on('data', (data) => {
                const text = data.toString();
                stderrBuffer += text;
                const lines = text.trim().split('\n');
                lines.forEach((line: string) => {
                    if (line && !line.includes('NOTICE:')) {
                        log(line, 'info');
                    }
                });
            });
        }

        if (pgRestore.stdout) {
            pgRestore.stdout.on('data', (data) => {
                const lines = data.toString().trim().split('\n');
                lines.forEach((line: string) => {
                    if (line) log(line, 'info');
                });
            });
        }

        pgRestore.on('close', (code) => {
            if (code === 0) {
                resolve();
            } else if (code === 1 && stderrBuffer.includes('warning') && stderrBuffer.includes('errors ignored')) {
                if (stderrBuffer.includes('transaction_timeout')) {
                    log('Restore completed - pg_restore 18 sent SET transaction_timeout which is unsupported on PostgreSQL < 17. This is cosmetic and does not affect the restore.', 'warning');
                } else {
                    log('Restore completed with warnings (non-fatal)', 'warning');
                }
                resolve();
            } else {
                let errorMsg = `pg_restore exited with code ${code}`;
                if (stderrBuffer.trim()) {
                    errorMsg += `. Error: ${stderrBuffer.trim()}`;
                }
                reject(new Error(errorMsg));
            }
        });

        pgRestore.on('error', (err) => {
            reject(new Error(`Failed to start pg_restore: ${err.message}`));
        });
    });
}

/**
 * SSH variant: upload dump to remote temp file, run pg_restore there, then cleanup.
 * pg_restore with custom format needs seekable input, so we can't just pipe stdin.
 */
async function restoreSingleDatabaseSSH(
    sourcePath: string,
    targetDb: string,
    config: PostgresRestoreConfig,
    log: (msg: string, level?: LogLevel, type?: LogType, details?: string) => void
): Promise<void> {
    const sshConfig = extractSshConfig(config)!;
    const ssh = new SshClient();
    await ssh.connect(sshConfig);

    const remoteTempFile = `/tmp/dbackup_restore_${randomUUID()}.dump`;

    try {
        const pgRestoreBin = await remoteBinaryCheck(ssh, "pg_restore");
        const args = buildPsqlArgs(config);

        const env: Record<string, string | undefined> = {};
        const priv = config.privilegedAuth;
        const pass = (priv && priv.password) ? priv.password : config.password;
        if (pass) env.PGPASSWORD = pass;

        // 1. Upload dump file to remote temp location via SFTP (guarantees data integrity)
        log(`Uploading dump to remote via SFTP: ${remoteTempFile}`, 'info');
        await ssh.uploadFile(sourcePath, remoteTempFile);

        // 2. Run pg_restore on the remote
        const restoreArgs = [
            ...args,
            "-d", shellEscape(targetDb),
            "-w",
            "--clean",
            "--if-exists",
            "--no-owner",
            "--no-acl",
            "--no-comments",
            "--no-tablespaces",
            "--no-security-labels",
            "-v",
            shellEscape(remoteTempFile),
        ];

        const cmd = remoteEnv(env, `${pgRestoreBin} ${restoreArgs.join(" ")}`);
        log(`Restoring database (SSH): ${targetDb}`, 'info', 'command', `pg_restore ${restoreArgs.join(' ')}`);

        const result = await ssh.exec(cmd);

        if (result.code !== 0 && result.code !== 1) {
            throw new Error(`Remote pg_restore exited with code ${result.code}. Error: ${result.stderr}`);
        }

        if (result.code === 1 && result.stderr.includes('warning')) {
            if (result.stderr.includes('transaction_timeout')) {
                log('Restore completed - pg_restore 18 sent SET transaction_timeout which is unsupported on PostgreSQL < 17. This is cosmetic and does not affect the restore.', 'warning');
            } else {
                log('Restore completed with warnings (non-fatal)', 'warning');
            }
        }

        if (result.stderr) {
            const lines = result.stderr.trim().split('\n');
            for (const line of lines) {
                if (line && !line.includes('NOTICE:')) {
                    log(line, 'info');
                }
            }
        }
    } finally {
        // 3. Cleanup remote temp file
        await ssh.exec(`rm -f ${shellEscape(remoteTempFile)}`).catch(() => {});
        ssh.end();
    }
}

/**
 * Capability export for combined DB+directory restores (JobSource): restores a single plain
 * dump file into a single target database. Thin wrapper around restoreSingleDatabase, the
 * same per-database logic restore() already uses internally for its own multi-DB case.
 * Unlike restore(), this does not create the target database - callers must ensure it exists
 * first (e.g. via prepareRestore).
 */
export async function restoreOne(
    config: PostgresRestoreConfig,
    filePath: string,
    targetDbName: string,
    onLog?: (msg: string, level?: LogLevel, type?: LogType, details?: string) => void
): Promise<void> {
    const env = { ...process.env };
    const priv = config.privilegedAuth;
    const user = (priv && priv.user) ? priv.user : config.user;
    const password = (priv && priv.password) ? priv.password : config.password;
    if (password) env.PGPASSWORD = password;
    const usageConfig = { ...config, user };
    await restoreSingleDatabase(filePath, targetDbName, usageConfig, env, onLog ?? (() => {}));
}

export async function restore(
    config: PostgresRestoreConfig,
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
        const env = { ...process.env };

        const priv = config.privilegedAuth;
        const user = (priv && priv.user) ? priv.user : config.user;
        const password = (priv && priv.password) ? priv.password : config.password;

        if (password) {
            env.PGPASSWORD = password;
        } else {
            log("No password provided for connection.", "warning");
        }

        log(`Prepared connection: ${user}@${config.host}:${config.port} (Privileged: ${!!priv})`, "info");

        const usageConfig = { ...config, user };

        const mapping = config.databaseMapping as Array<{
            originalName: string;
            targetName: string;
            selected: boolean;
        }> | undefined;

        const isTar = await isMultiDbTar(sourcePath);

        if (isTar) {
            // ===== TAR ARCHIVE RESTORE =====
            log('Detected Multi-DB TAR archive', 'info');

            tempDir = await createTempDir('pg-restore-');
            log(`Created temp directory: ${tempDir}`, 'info');

            // Build list of selected database names for selective extraction
            const selectedNames = mapping
                ? mapping.filter(m => m.selected).map(m => m.originalName)
                : [];

            const { manifest, files } = await extractSelectedDatabases(sourcePath, tempDir, selectedNames);
            log(`Extracted ${files.length} of ${manifest.databases.length} database dumps from TAR`, 'info');

            const totalDbs = manifest.databases.length;
            let processed = 0;

            for (const dbEntry of manifest.databases) {
                if (!shouldRestoreDatabase(dbEntry.name, mapping)) {
                    processed++;
                    continue;
                }

                const targetDb = getTargetDatabaseName(dbEntry.name, mapping);
                const dumpPath = path.join(tempDir, dbEntry.filename);

                log(`Restoring database: ${dbEntry.name} -> ${targetDb}`, 'info');

                await prepareRestore(usageConfig, [targetDb]);
                await restoreSingleDatabase(dumpPath, targetDb, usageConfig, env, log);
                log(`Database ${targetDb} restored successfully`, 'success');

                processed++;
                if (onProgress) {
                    onProgress(Math.round((processed / totalDbs) * 100));
                }
            }

            log(`Multi-DB restore completed: ${processed}/${totalDbs} databases`, 'success');
        } else {
            // ===== SINGLE DATABASE RESTORE =====
            const isCustom = await isCustomFormat(sourcePath);
            log(`Detected backup format: ${isCustom ? 'Custom (binary)' : 'Plain SQL'}`, 'info');

            if (!isCustom) {
                throw new Error('Plain SQL format is no longer supported. Please use custom format (-Fc) backups.');
            }

            let targetDb: string;

            if (mapping && mapping.length > 0) {
                const selected = mapping.filter(m => m.selected);
                if (selected.length === 0) {
                    throw new Error("No databases selected for restore.");
                }
                if (selected.length > 1) {
                    throw new Error("Single-database backup cannot be restored to multiple databases.");
                }
                targetDb = selected[0].targetName || selected[0].originalName;
            } else {
                const db = Array.isArray(config.database) ? config.database[0] : config.database;
                targetDb = db || 'postgres';
            }

            log(`Restoring single database to: ${targetDb}`, 'info');

            await prepareRestore(usageConfig, [targetDb]);
            await restoreSingleDatabase(sourcePath, targetDb, usageConfig, env, log);
        }

        return {
            success: true,
            logs,
            startedAt,
            completedAt: new Date(),
        };

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
    } finally {
        if (tempDir) {
            await cleanupTempDir(tempDir);
        }
    }
}
