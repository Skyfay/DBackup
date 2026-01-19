import { BackupResult } from "@/lib/core/interfaces";
import { execFileAsync } from "./connection";
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

    const env = { ...process.env };
    if (pass) env.PGPASSWORD = pass;

    // Use dialect for connection args if possible, but we need to force -d postgres for admin tasks
    const dialect = getDialect('postgres', config.detectedVersion);
    // Base args without DB
    const baseArgs = dialect.getConnectionArgs({ ...config, user });
    // Add maintenance DB
    const args = [...baseArgs, '-d', 'postgres'];

    for (const dbName of databases) {
        // Check existence
        try {
            // We use -t (tuples only) -A (no align) to get clean output
            const { stdout } = await execFileAsync('psql', [...args, '-t', '-A', '-c', `SELECT 1 FROM pg_database WHERE datname = '${dbName}'`], { env });

            if (stdout.trim() === '1') {
                // Exists
                continue;
            }

            // Try create
            const safeDbName = `"${dbName.replace(/"/g, '""')}"`;
            await execFileAsync('psql', [...args, '-c', `CREATE DATABASE ${safeDbName}`], { env });

        } catch (e: any) {
            const msg = e.stderr || e.message || "";
            if (msg.includes("permission denied")) {
                 throw new Error(`Access denied for user '${user}' to create database '${dbName}'. User permissions?`);
            }
            // If it failed because it exists (race condition), ignore.
             if (msg.includes("already exists")) {
                continue;
            }
            throw e;
        }
    }
}

export async function restore(config: any, sourcePath: string, onLog?: (msg: string) => void, onProgress?: (p: number) => void): Promise<BackupResult> {
    const startedAt = new Date();
    const logs: string[] = [];
    const log = (msg: string) => {
        logs.push(msg);
        if (onLog) onLog(msg);
    };

    try {
        // Get file size for progress
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

        const env = { ...process.env };
        if (config.password) {
            env.PGPASSWORD = config.password;
        }

        const dialect = getDialect('postgres', config.detectedVersion);

        // Check if we have advanced mapping config
        const mapping = config.databaseMapping as Array<{ originalName: string, targetName: string, selected: boolean }> | undefined;

        // If mapping is provided, we need to stream and filter the SQL
        if (mapping && mapping.length > 0) {
            log("Performing Selective/Mapped Restore...");

            // 1. Build map for quick lookup
            const dbMap = new Map<string, { target: string, selected: boolean }>();
            mapping.forEach(m => dbMap.set(m.originalName, { target: m.targetName, selected: m.selected }));

            // 2. Spawn psql connected to 'postgres' (default maintenance DB) because we might create/switch DBs in the stream?
            // Actually, if we map databases, the stream rewriter handles \connect or CREATE DATABASE logic potentially?
            // "postgres" is safe default.

            const args = dialect.getRestoreArgs(config, 'postgres');

            log(`Executing restore stream to: psql ${args.join(' ')}`);

            await new Promise<void>(async (resolve, reject) => {
                const psql = spawn('psql', args, { env, stdio: ['pipe', 'pipe', 'pipe'] });

                // 3. Create Transform Stream to filter/rewrite SQL
                const fileStream = createReadStream(sourcePath, { encoding: 'utf8', highWaterMark: 64 * 1024 });

                fileStream.on('data', (chunk) => {
                        updateProgress(chunk.length);
                });

                let currentDb: string | null = null;
                let skipMode = false;

                const transformer = new Transform({
                    objectMode: true, // We process lines? No, we process chunks but parse lines.
                    // Wait, text processing on buffer chunks is hard.
                    // The original code probably used a line reader or buffer splitter.
                    // I need to be careful NOT to destroy the existing complex logic below this block.
                    // I will just replace the top part and keep the transformer logic as is (via "oldString" context).
                    // THIS IS RISKY with replace_string_in_file for large blocks.
                    // I will trust the file read logic.
                });
                // ... transformer logic ...
            });
            // To ensure I don't break the complex Transformer logic, I will restart the edit and include the transformer.
        } else {
             // Simple Restore (Single DB or Full Cluster Dump being restored as is)
             let targetDb = config.database;
             // If user specified a database in "Restore to..." field (passed via config override in restore-service)
             // we use it. If not, default to 'postgres' if config.database is array or missing?
             if (Array.isArray(targetDb) || !targetDb) targetDb = 'postgres';

             const args = dialect.getRestoreArgs(config, targetDb);

             log(`Executing restore to: psql ${args.join(' ')}`);

             // ... spawn logic ...
        }

        // I will stop here and use the Edit block carefully.
    } catch(e) { throw e; } // stub
}

                    decodeStrings: false,
                    transform(chunk: string | Buffer, encoding, callback) {
                        const lines = chunk.toString().split('\n');
                        const output: string[] = [];

                        for (const line of lines) {
                            // Detect Context Switches
                            // Check CREATE DATABASE
                            const createMatch = line.match(/^CREATE DATABASE "?([^";\s]+)"? /i);
                            if (createMatch) {
                                const dbName = createMatch[1];
                                currentDb = dbName;
                                const map = dbMap.get(dbName);

                                if (map) {
                                    if (!map.selected) {
                                        skipMode = true;
                                        // Do not push line
                                    } else {
                                        skipMode = false;
                                        if (map.target !== dbName) {
                                            // Rename
                                            output.push(line.replace(`"${dbName}"`, `"${map.target}"`).replace(` ${dbName} `, ` "${map.target}" `));
                                        } else {
                                            output.push(line);
                                        }
                                    }
                                } else {
                                    // Unknown DB (maybe not analyzed?), default to include? Or skip if we are in selective mode?
                                    // Let's assume we include things not in map (like globals) but if it's a DB we didn't map, we keep it.
                                    skipMode = false;
                                    output.push(line);
                                }
                                continue;
                            }

                            // Check Connect
                            const connectMatch = line.match(/^\\connect "?([^"\s]+)"?/i);
                            if (connectMatch) {
                                const dbName = connectMatch[1];
                                const map = dbMap.get(dbName);

                                if (map) {
                                    if (!map.selected) {
                                        skipMode = true;
                                    } else {
                                        skipMode = false;
                                        if (map.target !== dbName) {
                                            output.push(line.replace(`"${dbName}"`, `"${map.target}"`).replace(` ${dbName}`, ` "${map.target}"`));
                                        } else {
                                            output.push(line);
                                        }
                                    }
                                } else {
                                    // Connect to something else (e.g. postgres)? Keep it.
                                    skipMode = false;
                                    output.push(line);
                                }
                                continue;
                            }

                            if (!skipMode) {
                                // Handle Renames inside body (ALTER DATABASE ...)
                                if (currentDb && dbMap.get(currentDb)?.target !== currentDb) {
                                    const target = dbMap.get(currentDb)!.target;
                                    // Simple heuristic replace for ALTER DATABASE "old" ...
                                    if (line.match(new RegExp(`ALTER DATABASE "?${currentDb}"?`, 'i'))) {
                                        output.push(line.replace(new RegExp(`"${currentDb}"`, 'g'), `"${target}"`).replace(new RegExp(` ${currentDb} `, 'g'), ` "${target}" `));
                                    } else {
                                        output.push(line);
                                    }
                                } else {
                                    output.push(line);
                                }
                            }
                        }

                        callback(null, output.join('\n'));
                    }
                });

                // Pipe: File -> Transformer -> PSQL
                fileStream.pipe(transformer).pipe(psql.stdin);

                try {
                    await waitForProcess(psql, 'psql', (d) => log(`stderr: ${d}`));
                    resolve();
                } catch (err) {
                    reject(err);
                }
            });

        } else {
            // Legacy / Direct Restore (Single file, no fancy mapping)
            /* eslint-disable-next-line @typescript-eslint/no-unused-vars */

            // Refactored to use Dialect
            const targetDb = config.database || 'postgres';
            const args = dialect.getRestoreArgs(config, targetDb);

            // Note: Standard psql -f does not provide progress hooks easily
            // because it opens the file internally.
            // To support progress, we MUST pipe instead of using -f, even for direct restore.
            // Let's switch to piping for consistency and progress.

            log(`Executing direct restore command: psql (piped) ${args.join(' ')}`);

            await new Promise<void>(async (resolve, reject) => {
                const psql = spawn('psql', args, { env, stdio: ['pipe', 'pipe', 'pipe'] });

                const stream = createReadStream(sourcePath);
                stream.on('data', (c) => updateProgress(c.length));
                stream.pipe(psql.stdin);

                try {
                    await waitForProcess(psql, 'psql', (d) => log(`stderr: ${d}`));
                    resolve();
                } catch (err) {
                    reject(err);
                }
            });
        }

        return {
            success: true,
            logs,
            startedAt,
            completedAt: new Date(),
        };

    } catch (error: any) {
            log(`Error: ${error.message}`);
        return {
            success: false,
            logs,
            error: error.message,
            startedAt,
            completedAt: new Date(),
        };
    }
}
