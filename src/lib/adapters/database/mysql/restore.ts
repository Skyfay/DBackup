import type { ExecutionHost } from "@/lib/transport";
import { BackupResult } from "@/lib/core/interfaces";
import { LogLevel, LogType } from "@/lib/core/logs";
import { MySQLConfig, MariaDBConfig } from "@/lib/adapters/definitions";
import { ensureDatabase } from "./connection";
import { getDialect } from "./dialects";
import fs from "fs/promises";
import { Transform } from "stream";
import path from "path";
import {
    isMultiDbTar,
    extractSelectedDatabases,
    createTempDir,
    cleanupTempDir,
    shouldRestoreDatabase,
    getTargetDatabaseName,
} from "../common/tar-utils";
import { formatBytes } from "@/lib/utils";
import { MYSQL_CLIENT, buildConnectionArgs, withAuthArgs } from "./args";

/** Extended config with runtime fields for restore operations */
type MySQLRestoreConfig = (MySQLConfig | MariaDBConfig) & {
    type?: string;
    detectedVersion?: string;
    privilegedAuth?: { user: string; password: string };
    databaseMapping?: { originalName: string; targetName: string; selected: boolean }[];
    selectedDatabases?: string[];
    originalDatabase?: string;
};

/**
 * Returns a Transform stream that rewrites database-name references in a mysqldump
 * SQL stream when restoring to a different name.
 *
 * mysqldump always emits `USE \`originalDb\`;` and
 * `CREATE DATABASE ... \`originalDb\`` lines that would override the target
 * database specified on the mysql CLI.  This transform replaces those lines so
 * the entire dump lands in `targetDb`.
 */
function createDatabaseRenameStream(originalDb: string, targetDb: string): Transform {
    let buffer = '';
    const escaped = originalDb.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

    return new Transform({
        transform(chunk, _encoding, callback) {
            buffer += chunk.toString('utf8');
            const lines = buffer.split('\n');
            buffer = lines.pop() ?? '';

            const out = lines.map(line => {
                // USE `originalDb`;
                if (line === `USE \`${originalDb}\`;`) return `USE \`${targetDb}\`;`;
                // CREATE DATABASE ... `originalDb` ...
                if (/^CREATE DATABASE\b/.test(line) && line.includes(`\`${originalDb}\``)) {
                    return line.replace(new RegExp(`\\\`${escaped}\\\``, 'g'), `\`${targetDb}\``);
                }
                // ALTER DATABASE `originalDb` ...
                if (/^ALTER DATABASE\b/.test(line) && line.includes(`\`${originalDb}\``)) {
                    return line.replace(new RegExp(`\\\`${escaped}\\\``, 'g'), `\`${targetDb}\``);
                }
                return line;
            });

            callback(null, out.join('\n') + '\n');
        },
        flush(callback) {
            if (!buffer) { callback(); return; }
            let line = buffer;
            if (line === `USE \`${originalDb}\`;`) line = `USE \`${targetDb}\`;`;
            if (/^CREATE DATABASE\b/.test(line) && line.includes(`\`${originalDb}\``)) {
                line = line.replace(new RegExp(`\\\`${escaped}\\\``, 'g'), `\`${targetDb}\``);
            }
            callback(null, line);
        }
    });
}

const MAX_STDERR_LOG_LINES = 50;
const MAX_STDERR_LINE_LENGTH = 500;

function createStderrHandler(
    onLog: (msg: string, level?: LogLevel, type?: LogType, details?: string) => void,
    secrets?: string[]
) {
    let stderrCount = 0;
    let suppressed = 0;
    let buffer = '';

    // Build redaction list from provided secrets (filter empty/undefined)
    const redactList = (secrets || []).filter(s => s && s.length > 0);

    function redact(text: string): string {
        let result = text;
        for (const secret of redactList) {
            // Replace all occurrences of the secret with ******
            while (result.includes(secret)) {
                result = result.replace(secret, '******');
            }
        }
        return result;
    }

    return {
        handle(data: string) {
            // Buffer incoming chunks and split by newlines to get complete lines
            buffer += data;
            const lines = buffer.split('\n');
            // Keep last incomplete line in buffer
            buffer = lines.pop() || '';

            for (const raw of lines) {
                const msg = redact(raw.trim());
                if (!msg || msg.includes("Using a password") || msg.includes("Deprecated program name")) continue;

                // Always log actual MySQL error lines (ERROR xxxx) and separator lines
                const isError = /^ERROR\s+\d+/.test(msg);

                if (isError) {
                    onLog(`MySQL: ${msg}`, 'error');
                    continue;
                }

                stderrCount++;
                if (stderrCount <= MAX_STDERR_LOG_LINES) {
                    const truncated = msg.length > MAX_STDERR_LINE_LENGTH
                        ? msg.slice(0, MAX_STDERR_LINE_LENGTH) + '... (truncated)'
                        : msg;
                    onLog(`MySQL: ${truncated}`);
                } else {
                    suppressed++;
                }
            }
        },
        flush() {
            // Flush remaining buffer
            if (buffer.trim()) {
                const msg = redact(buffer.trim());
                const isError = /^ERROR\s+\d+/.test(msg);
                if (isError) {
                    onLog(`MySQL: ${msg}`, 'error');
                } else if (stderrCount <= MAX_STDERR_LOG_LINES) {
                    const truncated = msg.length > MAX_STDERR_LINE_LENGTH
                        ? msg.slice(0, MAX_STDERR_LINE_LENGTH) + '... (truncated)'
                        : msg;
                    onLog(`MySQL: ${truncated}`);
                } else {
                    suppressed++;
                }
            }
            if (suppressed > 0) {
                onLog(`MySQL: ... ${suppressed} additional stderr line(s) suppressed`, 'warning');
            }
        }
    };
}

export async function prepareRestore(config: MySQLRestoreConfig, databases: string[], _host: ExecutionHost): Promise<void> {
    const usePrivileged = !!config.privilegedAuth;
    const user = usePrivileged ? config.privilegedAuth!.user : config.user;
    const pass = usePrivileged ? config.privilegedAuth!.password : config.password;

    for (const dbName of databases) {
        await ensureDatabase(config, dbName, user, pass, usePrivileged, [], _host);
    }
}

const DIAGNOSTICS_QUERY =
    "SELECT CONCAT('max_allowed_packet=', @@global.max_allowed_packet, " +
    "' innodb_buffer_pool_size=', @@global.innodb_buffer_pool_size, " +
    "' log_bin=', @@global.log_bin, " +
    "' innodb_flush_log_at_trx_commit=', @@global.innodb_flush_log_at_trx_commit)";

/**
 * After a failed restore, work out whether the server is still there.
 *
 * A restore that dies mid-stream is usually an OOM kill rather than a SQL error,
 * and the mysql client's own message does not say so. Previously only the SSH
 * path reported this.
 */
async function logPostFailureDiagnostics(
    config: MySQLRestoreConfig,
    host: ExecutionHost,
    mysqlBin: string,
    authArgs: string[],
    onLog: (msg: string, level?: LogLevel, type?: LogType, details?: string) => void,
): Promise<void> {
    try {
        const alive = await host.exec([
            mysqlBin, ...authArgs, ...buildConnectionArgs(config, host), "-N", "-e", "SELECT 'alive'",
        ]);
        if (alive.stdout.includes("alive")) {
            onLog("Post-failure check: MySQL server is still running", "warning");
        } else {
            onLog(
                `Post-failure check: MySQL server NOT responding - ${alive.stderr.trim() || alive.stdout.trim()}`,
                "error",
            );
        }
    } catch {
        onLog("Post-failure check: Could not reach MySQL server (likely crashed/OOM-killed)", "error");
    }

    try {
        // dmesg needs root on most hosts, so a failure here is expected and quiet.
        const oom = await host.exec(["sh", "-c", "dmesg 2>/dev/null | grep -i 'oom\\|killed process' | tail -3"]);
        if (oom.stdout.trim()) {
            onLog(`OOM killer detected: ${oom.stdout.trim()}`, "error");
        }
    } catch {
        // Not available, nothing to report.
    }
}

/**
 * Restore a single SQL file to a specific database.
 *
 * Pass `originalDb` when the target name differs from the name embedded in the
 * dump. The rewrite happens in a Node transform on the way in, which replaces
 * the remote `sed` pipeline the SSH path used to build. That pipeline embedded
 * database names into a sed expression, so a name containing `/`, `\` or `&`
 * silently corrupted the restore.
 */
async function restoreSingleFile(
    config: MySQLRestoreConfig,
    sourcePath: string,
    targetDb: string,
    host: ExecutionHost,
    onLog: (msg: string, level?: LogLevel, type?: LogType, details?: string) => void,
    onProgress?: (percentage: number, detail?: string) => void,
    originalDb?: string
): Promise<void> {
    const { size: totalSize } = await fs.stat(sourcePath);

    const mysqlBin = await host.which(...MYSQL_CLIENT);
    const dialect = getDialect(config.type === 'mariadb' ? 'mariadb' : 'mysql', config.detectedVersion);
    const args = dialect.getRestoreArgs(config, targetDb, host);

    await withAuthArgs(host, config.password, async (authArgs) => {
        // Best effort: server limits explain most restore failures after the fact.
        try {
            const diag = await host.exec([
                mysqlBin, ...authArgs, ...buildConnectionArgs(config, host), "-N", "-e", DIAGNOSTICS_QUERY,
            ]);
            if (diag.code === 0 && diag.stdout.trim()) {
                onLog(`Server settings: ${diag.stdout.trim()}`);
            }
        } catch {
            // Diagnostics are non-critical.
        }

        const needsRename = Boolean(originalDb && originalDb !== targetDb);
        const transferStart = Date.now();

        try {
            await host.stageInput(
                sourcePath,
                {
                    transform: needsRename
                        ? () => createDatabaseRenameStream(originalDb!, targetDb)
                        : undefined,
                    onProgress: (transferred) => {
                        if (!onProgress || totalSize <= 0) return;
                        // Staging occupies the first 90% of the reported progress.
                        const percent = Math.min(90, Math.round((transferred / totalSize) * 90));
                        const elapsed = (Date.now() - transferStart) / 1000;
                        const speed = elapsed > 0 ? transferred / elapsed : 0;
                        onProgress(
                            percent,
                            `${formatBytes(transferred)} / ${formatBytes(totalSize)} - ${formatBytes(speed)}/s`,
                        );
                    },
                },
                async (stagedPath) => {
                    onProgress?.(95, 'Executing restore command...');
                    onLog(`Restoring to database: ${targetDb}`, 'info', 'command', `${mysqlBin} ${args.join(' ')}`);

                    const secrets = [config.password, config.privilegedAuth?.password].filter(Boolean) as string[];
                    const stderr = createStderrHandler(onLog, secrets);

                    const proc = await host.spawn([mysqlBin, ...authArgs, ...args], { stdinFile: stagedPath });
                    proc.stdout.on('data', () => { /* mysql writes nothing useful here */ });
                    proc.stderr.on('data', (data: Buffer) => stderr.handle(data.toString()));

                    const { code, signal } = await proc.exit();
                    stderr.flush();
                    if (code !== 0) {
                        throw new Error(
                            `mysql exited with code ${code ?? 'null'}${signal ? ` (signal: ${signal})` : ''}`,
                        );
                    }
                    onProgress?.(100, '');
                },
            );
        } catch (error) {
            await logPostFailureDiagnostics(config, host, mysqlBin, authArgs, onLog);
            throw error;
        }
    });
}

/**
 * Capability export for combined DB+directory restores (JobSource): restores a single plain
 * dump file into a single target database. Thin wrapper around restoreSingleFile, the same
 * per-database logic restore() already uses internally for its own multi-DB case. Unlike
 * restore(), this does not create the target database - callers must ensure it exists first
 * (e.g. via ensureDatabase/prepareRestore).
 */
export async function restoreOne(
    config: MySQLRestoreConfig,
    filePath: string,
    targetDbName: string,
    _host: ExecutionHost,
    onLog?: (msg: string, level?: LogLevel, type?: LogType, details?: string) => void,
    onProgress?: (percentage: number, detail?: string) => void,
    originalDbName?: string
): Promise<void> {
    await restoreSingleFile(config, filePath, targetDbName, _host, onLog ?? (() => {}), onProgress, originalDbName);
}

// LEGACY-FORMAT(read): Restores backups written before the seekable archive, a single dump
// file or a TAR of dumps. New backups go through restoreOne(). Remove once those backups no
// longer need restoring.
export async function restore(config: MySQLRestoreConfig, sourcePath: string, _host: ExecutionHost, onLog?: (msg: string, level?: LogLevel, type?: LogType, details?: string) => void, onProgress?: (percentage: number, detail?: string) => void): Promise<BackupResult> {
    const startedAt = new Date();
    const logs: string[] = [];
    const log = (msg: string, level: LogLevel = 'info', type: LogType = 'general', details?: string) => {
        logs.push(msg);
        if (onLog) onLog(msg, level, type, details);
    };

    try {
        const dbMapping = config.databaseMapping;
        const usePrivileged = !!config.privilegedAuth;
        const creationUser = usePrivileged ? config.privilegedAuth!.user : config.user;
        const creationPass = usePrivileged ? config.privilegedAuth!.password : config.password;

        // Check if this is a Multi-DB TAR archive
        if (await isMultiDbTar(sourcePath)) {
            log(`Detected Multi-DB TAR archive`);

            const tempDir = await createTempDir("mysql-restore-");

            try {
                // Build list of selected database names for selective extraction
                const selectedNames = dbMapping
                    ? dbMapping.filter(m => m.selected).map(m => m.originalName)
                    : [];

                const { manifest, files } = await extractSelectedDatabases(sourcePath, tempDir, selectedNames);
                log(`Archive contains ${manifest.databases.length} database(s): ${manifest.databases.map(d => d.name).join(', ')}`);
                if (selectedNames.length > 0) {
                    log(`Selectively extracted ${files.length} of ${manifest.databases.length} database(s)`);
                }

                let restoredCount = 0;

                for (const dbEntry of manifest.databases) {
                    // Check if this database should be restored
                    if (!shouldRestoreDatabase(dbEntry.name, dbMapping)) {
                        continue;
                    }

                    const targetDb = getTargetDatabaseName(dbEntry.name, dbMapping);
                    const dbFile = files.find(f => path.basename(f) === dbEntry.filename);

                    if (!dbFile) {
                        throw new Error(`Database file not found in archive: ${dbEntry.filename}`);
                    }

                    // Ensure target database exists
                    await ensureDatabase(config, targetDb, creationUser, creationPass, usePrivileged, logs, _host);

                    // Restore this database
                    await restoreSingleFile(config, dbFile, targetDb, _host, log, onProgress, dbEntry.name);
                    log(`Restored database: ${dbEntry.name} → ${targetDb}`);
                    restoredCount++;
                }

                log(`Multi-DB restore completed: ${restoredCount} database(s) restored`);

                return { success: true, logs, startedAt, completedAt: new Date() };
            } finally {
                await cleanupTempDir(tempDir);
            }
        }

        // Single-DB restore (regular SQL file)
        let targetDb: string;
        let originalDb: string | undefined;

        if (dbMapping && dbMapping.length > 0) {
            const selected = dbMapping.filter(m => m.selected);
            if (selected.length === 0) {
                throw new Error("No databases selected for restore");
            }
            originalDb = selected[0].originalName;
            targetDb = selected[0].targetName || originalDb;
            await ensureDatabase(config, targetDb, creationUser, creationPass, usePrivileged, logs, _host);
        } else if (config.database) {
            targetDb = Array.isArray(config.database) ? config.database[0] : config.database;
            originalDb = config.originalDatabase;
            await ensureDatabase(config, targetDb, creationUser, creationPass, usePrivileged, logs, _host);
        } else {
            throw new Error("No target database specified for restore");
        }

        await restoreSingleFile(config, sourcePath, targetDb, _host, log, onProgress, originalDb);

        return { success: true, logs, startedAt, completedAt: new Date() };

    } catch (error: unknown) {
        const msg = error instanceof Error ? error.message : String(error);
        log(`Error: ${msg}`, 'error');
        return { success: false, logs, error: msg, startedAt, completedAt: new Date() };
    }
}
