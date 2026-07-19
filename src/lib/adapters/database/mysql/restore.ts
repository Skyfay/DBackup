import { BackupResult } from "@/lib/core/interfaces";
import { LogLevel, LogType } from "@/lib/core/logs";
import { MySQLConfig, MariaDBConfig } from "@/lib/adapters/definitions";
import { ensureDatabase } from "./connection";
import { getDialect } from "./dialects";
import { getMysqlCommand } from "./tools";
import { spawn } from "child_process";
import { createReadStream } from "fs";
import fs from "fs/promises";
import { Transform } from "stream";
import { randomUUID } from "crypto";
import path from "path";
import { waitForProcess } from "@/lib/adapters/process";
import {
    isMultiDbTar,
    extractSelectedDatabases,
    createTempDir,
    cleanupTempDir,
    shouldRestoreDatabase,
    getTargetDatabaseName,
} from "../common/tar-utils";
import { formatBytes } from "@/lib/utils";
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

export async function prepareRestore(config: MySQLRestoreConfig, databases: string[]): Promise<void> {
    const usePrivileged = !!config.privilegedAuth;
    const user = usePrivileged ? config.privilegedAuth!.user : config.user;
    const pass = usePrivileged ? config.privilegedAuth!.password : config.password;

    for (const dbName of databases) {
        await ensureDatabase(config, dbName, user, pass, usePrivileged, []);
    }
}

/**
 * Restore a single SQL file to a specific database.
 * Pass `originalDb` when the target name differs from the name embedded in the
 * dump - the function will rewrite `USE` / `CREATE DATABASE` references inline.
 */
async function restoreSingleFile(
    config: MySQLRestoreConfig,
    sourcePath: string,
    targetDb: string,
    onLog: (msg: string, level?: LogLevel, type?: LogType, details?: string) => void,
    onProgress?: (percentage: number, detail?: string) => void,
    originalDb?: string
): Promise<void> {
    if (isSSHMode(config)) {
        return restoreSingleFileSSH(config, sourcePath, targetDb, onLog, onProgress, originalDb);
    }

    const stats = await fs.stat(sourcePath);
    const totalSize = stats.size;
    let processedSize = 0;
    let lastProgress = 0;

    const dialect = getDialect(config.type === 'mariadb' ? 'mariadb' : 'mysql', config.detectedVersion);
    const args = dialect.getRestoreArgs(config, targetDb);

    onLog(`Restoring to database: ${targetDb}`, 'info', 'command', `${getMysqlCommand()} ${args.join(' ')}`);

    await withLocalMyCnf(config.password, async (cnfPath) => {
        const finalArgs = cnfPath ? [`--defaults-file=${cnfPath}`, ...args] : args;
        const mysqlProc = spawn(getMysqlCommand(), finalArgs, { stdio: ['pipe', 'pipe', 'pipe'] });
        const fileStream = createReadStream(sourcePath, { highWaterMark: 64 * 1024 });

        fileStream.on('data', (chunk) => {
            if (onProgress && totalSize > 0) {
                processedSize += chunk.length;
                const p = Math.round((processedSize / totalSize) * 100);
                if (p > lastProgress) {
                    lastProgress = p;
                    onProgress(p);
                }
            }
        });

        fileStream.on('error', () => mysqlProc.kill());
        mysqlProc.stdin.on('error', () => { /* ignore broken pipe */ });

        const needsRename = originalDb && originalDb !== targetDb;
        if (needsRename) {
            fileStream
                .pipe(createDatabaseRenameStream(originalDb!, targetDb))
                .pipe(mysqlProc.stdin);
        } else {
            fileStream.pipe(mysqlProc.stdin);
        }

        const stderr = createStderrHandler(onLog);
        await waitForProcess(mysqlProc, 'mysql', (d) => {
            stderr.handle(d.toString());
        });
        stderr.flush();
    });
}

/**
 * SSH variant: upload SQL file to remote temp location, then run mysql restore locally.
 * Uses upload-then-restore pattern (like PostgreSQL) to avoid SSH channel streaming issues.
 */
async function restoreSingleFileSSH(
    config: MySQLRestoreConfig,
    sourcePath: string,
    targetDb: string,
    onLog: (msg: string, level?: LogLevel, type?: LogType, details?: string) => void,
    onProgress?: (percentage: number, detail?: string) => void,
    originalDb?: string
): Promise<void> {
    const stats = await fs.stat(sourcePath);
    const totalSize = stats.size;

    const sshConfig = extractSshConfig(config)!;
    const ssh = new SshClient();
    await ssh.connect(sshConfig);

    const remoteTempFile = `/tmp/dbackup_restore_${randomUUID()}.sql`;

    try {
        const mysqlBin = await remoteBinaryCheck(ssh, "mariadb", "mysql");
        const args = buildMysqlArgs(config);
        args.push("--max-allowed-packet=64M");
        args.push(shellEscape(targetDb));

        // Pre-restore diagnostics: query server settings
        try {
            const diagArgs = buildMysqlArgs(config);
            await withRemoteMyCnf(ssh, config.password, async (cnfPath) => {
                const cnfPrefix = cnfPath ? `--defaults-file=${shellEscape(cnfPath)} ` : "";
                const diagCmd = `${mysqlBin} ${cnfPrefix}${diagArgs.join(" ")} -N -e "SELECT CONCAT('max_allowed_packet=', @@global.max_allowed_packet, ' innodb_buffer_pool_size=', @@global.innodb_buffer_pool_size, ' log_bin=', @@global.log_bin, ' innodb_flush_log_at_trx_commit=', @@global.innodb_flush_log_at_trx_commit)"`;
                const diagResult = await ssh.exec(diagCmd);
                if (diagResult.code === 0 && diagResult.stdout.trim()) {
                    onLog(`Server settings: ${diagResult.stdout.trim()}`);
                }
            });
        } catch {
            // Diagnostics are non-critical
        }

        // 1. Upload SQL file to remote temp location via SFTP (guarantees data integrity)
        onLog(`Uploading dump to remote server via SFTP (${(totalSize / 1024 / 1024).toFixed(1)} MB)...`, 'info');
        const uploadStart = Date.now();
        await ssh.uploadFile(sourcePath, remoteTempFile, (transferred, total) => {
            if (onProgress && total > 0) {
                // Upload = 0-90% of total progress
                const uploadPercent = Math.round((transferred / total) * 90);
                const elapsed = (Date.now() - uploadStart) / 1000;
                const speed = elapsed > 0 ? transferred / elapsed : 0;
                onProgress(uploadPercent, `${formatBytes(transferred)} / ${formatBytes(total)} - ${formatBytes(speed)}/s`);
            }
        });

        // Clear upload progress detail
        onProgress?.(90);

        // Verify upload integrity
        try {
            const sizeCheck = await ssh.exec(`stat -c '%s' ${shellEscape(remoteTempFile)} 2>/dev/null || stat -f '%z' ${shellEscape(remoteTempFile)}`);
            const remoteSize = parseInt(sizeCheck.stdout.trim(), 10);
            if (remoteSize !== totalSize) {
                throw new Error(`Upload size mismatch! Local: ${totalSize}, Remote: ${remoteSize}`);
            }
            onLog(`Upload verified: ${(remoteSize / 1024 / 1024).toFixed(1)} MB`, 'success');
        } catch (e) {
            if (e instanceof Error && e.message.includes('mismatch')) throw e;
            // stat command failed - non-critical
        }

        // 2. Run mysql restore on the remote server from the uploaded file.
        // When restoring to a different name, rewrite USE/CREATE DATABASE refs via sed
        // so the dump lands in targetDb regardless of what mysqldump embedded.
        const needsRename = originalDb && originalDb !== targetDb;
        let catPart: string;
        if (needsRename) {
            // Escape single quotes for embedding inside single-quoted sed patterns.
            // MySQL identifiers cannot contain '/', '\' or '&' in practice, but
            // we escape single quotes defensively.
            const orig = originalDb!.replace(/'/g, "'\\''");
            const tgt = targetDb.replace(/'/g, "'\\''");
            catPart = [
                `sed`,
                `-e '/^USE /s/\`${orig}\`/\`${tgt}\`/g'`,
                `-e '/^CREATE DATABASE /s/\`${orig}\`/\`${tgt}\`/g'`,
                `-e '/^ALTER DATABASE /s/\`${orig}\`/\`${tgt}\`/g'`,
                `${shellEscape(remoteTempFile)}`,
            ].join(' ');
        } else {
            catPart = `cat ${shellEscape(remoteTempFile)}`;
        }
        const _restoreCmd = `${catPart} | ${mysqlBin} ${args.join(" ")}`;
        onLog(`Restoring to database (SSH): ${targetDb}`, 'info', 'command', `${mysqlBin} ${args.join(" ")}`);
        onProgress?.(95, 'Executing restore command...');

        await withRemoteMyCnf(ssh, config.password, async (cnfPath) => {
            const cnfPrefix = cnfPath ? `--defaults-file=${shellEscape(cnfPath)} ` : "";
            const cmdWithCnf = `${catPart} | ${mysqlBin} ${cnfPrefix}${args.join(" ")}`;

            await new Promise<void>((resolve, reject) => {
                const secrets = [config.password, config.privilegedAuth?.password].filter(Boolean) as string[];
                const stderr = createStderrHandler(onLog, secrets);

                ssh.execStream(cmdWithCnf, (err, stream) => {
                    if (err) return reject(err);

                    stream.on('data', () => {});

                    stream.stderr.on('data', (data: any) => {
                        stderr.handle(data.toString());
                    });

                    stream.on('exit', (code: number | null, signal?: string) => {
                        stderr.flush();
                        if (code === 0) {
                            onProgress?.(100, '');
                            resolve();
                        } else {
                            reject(new Error(`Remote mysql exited with code ${code ?? 'null'}${signal ? ` (signal: ${signal})` : ''}`));
                        }
                    });

                    stream.on('error', (err: Error) => reject(err));
                });
            });
        });
    } catch (error) {
        // Post-failure diagnostics: check if MySQL server is still alive
        try {
            const mysqlBinFallback = await remoteBinaryCheck(ssh, "mariadb", "mysql").catch(() => "mysql");
            const aliveArgs = buildMysqlArgs(config);
            await withRemoteMyCnf(ssh, config.password, async (cnfPath) => {
                const cnfPrefix = cnfPath ? `--defaults-file=${shellEscape(cnfPath)} ` : "";
                const aliveCheck = await ssh.exec(
                    `${mysqlBinFallback} ${cnfPrefix}${aliveArgs.join(" ")} -N -e "SELECT 'alive'" 2>&1`
                );
                if (aliveCheck.stdout.includes('alive')) {
                    onLog(`Post-failure check: MySQL server is still running`, 'warning');
                } else {
                    onLog(`Post-failure check: MySQL server NOT responding - ${aliveCheck.stderr.trim() || aliveCheck.stdout.trim()}`, 'error');
                }
            });
        } catch {
            onLog(`Post-failure check: Could not reach MySQL server (likely crashed/OOM-killed)`, 'error');
        }

        // Check for OOM kills on the host
        try {
            const oomCheck = await ssh.exec(`dmesg 2>/dev/null | grep -i 'oom\\|killed process' | tail -3`);
            if (oomCheck.stdout.trim()) {
                onLog(`OOM killer detected: ${oomCheck.stdout.trim()}`, 'error');
            }
        } catch {
            // dmesg might require root
        }

        throw error;
    } finally {
        // Cleanup remote temp file
        await ssh.exec(`rm -f ${shellEscape(remoteTempFile)}`).catch(() => {});
        ssh.end();
    }
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
    onLog?: (msg: string, level?: LogLevel, type?: LogType, details?: string) => void,
    onProgress?: (percentage: number, detail?: string) => void,
    originalDbName?: string
): Promise<void> {
    await restoreSingleFile(config, filePath, targetDbName, onLog ?? (() => {}), onProgress, originalDbName);
}

export async function restore(config: MySQLRestoreConfig, sourcePath: string, onLog?: (msg: string, level?: LogLevel, type?: LogType, details?: string) => void, onProgress?: (percentage: number, detail?: string) => void): Promise<BackupResult> {
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
                    await ensureDatabase(config, targetDb, creationUser, creationPass, usePrivileged, logs);

                    // Restore this database
                    await restoreSingleFile(config, dbFile, targetDb, log, onProgress, dbEntry.name);
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
            await ensureDatabase(config, targetDb, creationUser, creationPass, usePrivileged, logs);
        } else if (config.database) {
            targetDb = Array.isArray(config.database) ? config.database[0] : config.database;
            originalDb = config.originalDatabase;
            await ensureDatabase(config, targetDb, creationUser, creationPass, usePrivileged, logs);
        } else {
            throw new Error("No target database specified for restore");
        }

        await restoreSingleFile(config, sourcePath, targetDb, log, onProgress, originalDb);

        return { success: true, logs, startedAt, completedAt: new Date() };

    } catch (error: unknown) {
        const msg = error instanceof Error ? error.message : String(error);
        log(`Error: ${msg}`, 'error');
        return { success: false, logs, error: msg, startedAt, completedAt: new Date() };
    }
}
