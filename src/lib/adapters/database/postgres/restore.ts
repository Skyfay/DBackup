import { LogLevel, LogType } from "@/lib/core/logs";
import { BackupResult } from "@/lib/core/interfaces";
import { execFileAsync } from "./connection";
import { getDialect } from "./dialects";
import { spawn } from "child_process";
import fs from "fs/promises";
import path from "path";
import { getPostgresBinary } from "./version-utils";
import {
    isMultiDbTar,
    extractMultiDbTar,
    createTempDir,
    cleanupTempDir,
    shouldRestoreDatabase,
    getTargetDatabaseName,
} from "../common/tar-utils";

export async function prepareRestore(config: any, databases: string[]): Promise<void> {
    const usePrivileged = !!config.privilegedAuth;
    const user = usePrivileged ? config.privilegedAuth.user : config.user;
    const pass = usePrivileged ? config.privilegedAuth.password : config.password;

    const env = { ...process.env };
    if (pass) env.PGPASSWORD = pass;

    const dialect = getDialect('postgres', config.detectedVersion);
    const baseArgs = dialect.getConnectionArgs({ ...config, user });
    const args = [...baseArgs, '-d', 'postgres'];

    for (const dbName of databases) {
        try {
            const { stdout } = await execFileAsync('psql', [...args, '-t', '-A', '-c', `SELECT 1 FROM pg_database WHERE datname = '${dbName}'`], { env });

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
    config: any,
    env: NodeJS.ProcessEnv,
    log: (msg: string, level?: LogLevel, type?: LogType, details?: string) => void
): Promise<void> {
    const pgRestoreBinary = await getPostgresBinary('pg_restore', config.detectedVersion);

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

    log(`Restoring to database: ${targetDb}`, 'info', 'command', `${pgRestoreBinary} ${args.join(' ')}`);

    await new Promise<void>((resolve, reject) => {
        const pgRestore = spawn(pgRestoreBinary, args, { env, stdio: ['ignore', 'pipe', 'pipe'] });

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
                log('Restore completed with warnings (non-fatal)', 'warning');
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

            const { manifest, files } = await extractMultiDbTar(sourcePath, tempDir);
            log(`Extracted ${files.length} database dumps from TAR`, 'info');

            const totalDbs = manifest.databases.length;
            let processed = 0;

            for (const dbEntry of manifest.databases) {
                if (!shouldRestoreDatabase(dbEntry.name, mapping)) {
                    log(`Skipping database: ${dbEntry.name} (not selected)`, 'info');
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
                targetDb = config.database || 'postgres';
            }

            log(`Restoring single database to: ${targetDb}`, 'info');

            const pgRestoreBinary = await getPostgresBinary('pg_restore', config.detectedVersion);
            log(`Using ${pgRestoreBinary} for PostgreSQL ${config.detectedVersion}`, 'info');

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
