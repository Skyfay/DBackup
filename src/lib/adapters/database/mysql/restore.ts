import { BackupResult } from "@/lib/core/interfaces";
import { LogLevel, LogType } from "@/lib/core/logs";
import { execFileAsync, ensureDatabase } from "./connection";
import { getDialect } from "./dialects";
import { spawn } from "child_process";
import { createReadStream } from "fs";
import { Transform } from "stream";
import fs from "fs/promises";
import { waitForProcess } from "@/lib/adapters/process";

export async function prepareRestore(config: any, databases: string[]): Promise<void> {
    const usePrivileged = !!config.privilegedAuth;
    const user = usePrivileged ? config.privilegedAuth.user : config.user;
    const pass = usePrivileged ? config.privilegedAuth.password : config.password;

    // Dialect is needed for ensureDatabase? Actually ensureDatabase is in connection.ts
    // We should probably refactor connection.ts too, but for now we keep it simple.
    // ensureDatabase hardcodes args too... let's ignore that for this step or we open a can of worms.
    // Ideally ensureDatabase uses getConnectionArgs() from dialect.

    for (const dbName of databases) {
        if (/[^a-zA-Z0-9_$-]/.test(dbName)) {
        }

        // Manual Dialect Injection for connection args could be done here if we refactor ensureDatabase
        // For now, let's stick to existing logic in prepareRestore since it's just 'CREATE DATABASE'
        const args = ['-h', config.host, '-P', String(config.port), '-u', user, '--protocol=tcp'];
        const dialect = getDialect(config.type === 'mariadb' ? 'mariadb' : 'mysql', config.detectedVersion);

        // Use dialect for connection args (auth flags)
        const dialectArgs = dialect.getConnectionArgs({ ...config, user, disableSsl: config.disableSsl });

        // We can't easily replace the whole array without changing logic of ensureDatabase calling convention
        // But wait, ensureDatabase is imported. We can't change it here.
        // Skip for now, ensureDatabase uses hardcoded check. It should be fine.

        const env = { ...process.env };
        if (pass) env.MYSQL_PWD = pass;

        try {
            await execFileAsync('mysql', [...dialectArgs, '-e', `CREATE DATABASE IF NOT EXISTS \`${dbName}\``], { env });
        } catch (e: any) {
            if (e.message && (e.message.includes("Access denied") || e.message.includes("ERROR 1044"))) {
                throw new Error(`Access denied for user '${user}' to database '${dbName}'. User permissions?`);
            }
            throw e;
        }
    }
}

export async function restore(config: any, sourcePath: string, onLog?: (msg: string, level?: LogLevel, type?: LogType, details?: string) => void, onProgress?: (percentage: number) => void): Promise<BackupResult> {
    const startedAt = new Date();
    const logs: string[] = [];
    const log = (msg: string, level: LogLevel = 'info', type: LogType = 'general', details?: string) => {
        logs.push(msg);
        if (onLog) onLog(msg, level, type, details);
    };

    try {
        const stats = await fs.stat(sourcePath);
        const totalSize = stats.size;
        let processedSize = 0;
        let lastProgress = 0;

        const updateProgress = (chunkLen: number) => {
            if (!onProgress || totalSize === 0) return;
            processedSize += chunkLen;
            const p = Math.round((processedSize / totalSize) * 100);
            if (p > lastProgress) {
                lastProgress = p;
                onProgress(p);
            }
        };

        const dbMapping = config.databaseMapping as { originalName: string, targetName: string, selected: boolean }[] | undefined;
        const usePrivileged = !!config.privilegedAuth;
        const creationUser = usePrivileged ? config.privilegedAuth.user : config.user;
        const creationPass = usePrivileged ? config.privilegedAuth.password : config.password;

        if (dbMapping && dbMapping.length > 0) {
                const selectedDbs = dbMapping.filter(m => m.selected);
                for (const db of selectedDbs) {
                const targetName = db.targetName || db.originalName;
                await ensureDatabase(config, targetName, creationUser, creationPass, usePrivileged, logs);
                }
        } else if (config.database) {
            await ensureDatabase(config, config.database, creationUser, creationPass, usePrivileged, logs);
        }

        const dialect = getDialect(config.type === 'mariadb' ? 'mariadb' : 'mysql', config.detectedVersion);

        // Restore Args
        // Note: We might need to handle effectiveTargetDb. dialect.getRestoreArgs supports it.
        let effectiveTargetDb: string | undefined = undefined;
        if (dbMapping && dbMapping.length > 0) {
            const selected = dbMapping.filter(m => m.selected);
            if (selected.length === 1) {
                effectiveTargetDb = selected[0].targetName || selected[0].originalName;
            }
        } else if (config.database && !Array.isArray(config.database)) {
             effectiveTargetDb = config.database;
        }

        const args = dialect.getRestoreArgs(config, effectiveTargetDb);

        const env = { ...process.env };
        if(config.password) env.MYSQL_PWD = config.password;

        const mysqlProc = spawn('mysql', args, { stdio: ['pipe', 'pipe', 'pipe'], env });

        const fileStream = createReadStream(sourcePath, { highWaterMark: 64 * 1024 });

        const currentTargetName: string | null = null;
        let skipCurrentSection = false;
        let buffer = '';

        const transformStream = new Transform({
            objectMode: true,
            transform(chunk: Buffer, encoding, callback) {
                updateProgress(chunk.length);

                const useRawPass = !dbMapping && config.database;

                if (useRawPass) {
                    this.push(chunk);
                    callback();
                    return;
                }

                const data = buffer + chunk.toString();
                const lines = data.split('\n');
                buffer = lines.pop() || '';

                const output: string[] = [];

                for (const line of lines) {
                        const useMatch = line.match(/^USE `([^`]+)`;/i);
                        if (useMatch) {
                            const originalDb = useMatch[1];
                            if (dbMapping) {
                                const map = dbMapping.find(m => m.originalName === originalDb);
                                if (map) {
                                    if (!map.selected) {
                                        skipCurrentSection = true;
                                    } else {
                                        skipCurrentSection = false;
                                        const target = map.targetName || map.originalName;
                                        output.push(`USE \`${target}\`;`);
                                    }
                                } else {
                                    skipCurrentSection = false;
                                    output.push(line);
                                }
                                continue;
                            } else if (effectiveTargetDb) {
                                continue;
                            }
                        }

                        const createMatch = line.match(/^CREATE DATABASE (?:IF NOT EXISTS )?`([^`]+)`/i);
                        if (createMatch) {
                        const originalDb = createMatch[1];
                        if (dbMapping) {
                            const map = dbMapping.find(m => m.originalName === originalDb);
                            if (map && !map.selected) continue;
                        } else if (effectiveTargetDb) {
                            continue;
                        }
                        }

                        if (!skipCurrentSection) {
                            output.push(line);
                        }
                }

                if (output.length > 0) {
                    this.push(output.join('\n') + '\n');
                }
                callback();
            },
            flush(callback) {
                if (buffer) {
                    if (!skipCurrentSection) this.push(buffer);
                }
                callback();
            }
        });

        fileStream.on('error', (err) => mysqlProc.kill());
        transformStream.on('error', (err) => mysqlProc.kill());
        mysqlProc.stdin.on('error', (err) => {
        });

        fileStream.pipe(transformStream).pipe(mysqlProc.stdin);

        await waitForProcess(mysqlProc, 'mysql', (d) => {
                const msg = d.toString();
                if (!msg.includes("Using a password")) log(`MySQL: ${msg}`);
        });

        return { success: true, logs, startedAt, completedAt: new Date() };

    } catch (error: any) {
            const msg = error.message || "";
            logs.push(`Error: ${msg}`);
            return { success: false, logs, error: msg, startedAt, completedAt: new Date() };
    }
}
