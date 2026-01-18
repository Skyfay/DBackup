import { DatabaseAdapter, BackupResult } from "@/lib/core/interfaces";
import { PostgresSchema } from "@/lib/adapters/definitions";
import { execFile, spawn } from "child_process";
import fs from "fs/promises";
import { createWriteStream, createReadStream } from "fs";
import { Transform } from "stream";
import readline from "readline";
import util from "util";

const execFileAsync = util.promisify(execFile);

export const PostgresAdapter: DatabaseAdapter = {
    id: "postgres",
    type: "database",
    name: "PostgreSQL",
    configSchema: PostgresSchema,

    async analyzeDump(sourcePath: string): Promise<string[]> {
        const dbs = new Set<string>();
        try {
            // Use grep for fast scanning of large files (avoid reading GBs into Node)
            // Search for: CREATE DATABASE ... or \connect ...
            const { stdout } = await execFileAsync('grep', ['-E', '^CREATE DATABASE |^\\\\connect ', sourcePath], {
                maxBuffer: 10 * 1024 * 1024 // 10MB buffer for matched lines
            });

            const lines = stdout.split('\n');
            for (const line of lines) {
                // Matches: CREATE DATABASE "dbname" or CREATE DATABASE dbname
                const createMatch = line.match(/^CREATE DATABASE "?([^";\s]+)"? /i);
                if (createMatch) dbs.add(createMatch[1]);

                // Matches: \connect "dbname"
                const connectMatch = line.match(/^\\connect "?([^"\s]+)"?/i);
                if (connectMatch) dbs.add(connectMatch[1]);
            }
        } catch (e: any) {
            // grep returns exit code 1 if no matches found, which is fine
            if (e.code !== 1) {
                 console.error("Error analyzing Postgres dump:", e);
            }
            // If grep fails (e.g. not found), we return empty or try fallback?
            // In our Docker env, grep should exist.
        }
        return Array.from(dbs);
    },

    async dump(config: any, destinationPath: string, onLog?: (msg: string) => void): Promise<BackupResult> {
        const startedAt = new Date();
        const logs: string[] = [];

        const log = (msg: string) => {
            logs.push(msg);
            if (onLog) onLog(msg);
        };

        try {
            // Postgres uses PGPASSWORD env var typically or .pgpass file, but we can set env for the command
            const env = { ...process.env };
            if (config.password) {
                env.PGPASSWORD = config.password;
            }

            const baseArgs: string[] = [
                '-h', config.host,
                '-p', String(config.port),
                '-U', config.user
            ];

            if (config.options) {
                 // Basic tokenization respecting quotes
                 const parts = config.options.match(/[^\s"']+|"([^"]*)"|'([^']*)'/g) || [];
                 for (const part of parts) {
                     if (part.startsWith('"') && part.endsWith('"')) {
                        baseArgs.push(part.slice(1, -1));
                     } else if (part.startsWith("'") && part.endsWith("'")) {
                        baseArgs.push(part.slice(1, -1));
                     } else {
                        baseArgs.push(part);
                     }
                 }
            }

            // Determine databases
            let dbs: string[] = [];
            if (Array.isArray(config.database)) {
                dbs = config.database;
            } else if (typeof config.database === 'string') {
                dbs = config.database.split(',').map((s: string) => s.trim()).filter(Boolean);
            }
            if (dbs.length === 0 && config.database) dbs = [config.database];

            // Case 1: Single Database (Default optimized path)
            if (dbs.length === 1) {
                // Custom format is often better for restores, but plain text is more generic.
                // Let's stick to default or let user specify in options, but we redirect output.
                const args = [...baseArgs, '-f', destinationPath, dbs[0]];

                log(`Executing command: pg_dump ${args.join(' ')}`);

                const { stdout, stderr } = await execFileAsync('pg_dump', args, { env });

                // pg_dump might output info to stderr even on success
                if (stderr) {
                    log(`stderr: ${stderr}`);
                }
            }
            // Case 2: Multiple Databases (Pipe output sequentially)
            else {
                log(`Dumping multiple databases: ${dbs.join(', ')}`);
                const writeStream = createWriteStream(destinationPath);

                for (const db of dbs) {
                    log(`Starting dump for ${db}...`);
                    // Use --create so the dump file knows to create the DB context
                    const args = [...baseArgs, '--create', db];

                    await new Promise<void>((resolve, reject) => {
                        const child = spawn('pg_dump', args, { env });

                        // Pipe stdout to file, but don't close the stream when this child exits
                        child.stdout.pipe(writeStream, { end: false });

                        child.stderr.on('data', (data) => {
                            log(`[${db}] stderr: ${data.toString()}`);
                        });

                        child.on('error', (err) => {
                            reject(new Error(`Failed to start pg_dump for ${db}: ${err.message}`));
                        });

                        child.on('close', (code) => {
                            if (code === 0) {
                                resolve();
                            } else {
                                reject(new Error(`pg_dump for ${db} exited with code ${code}`));
                            }
                        });
                    });
                    log(`Completed dump for ${db}`);
                }

                writeStream.end();
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
    },

    async restore(config: any, sourcePath: string, onLog?: (msg: string) => void, onProgress?: (p: number) => void): Promise<BackupResult> {
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

            // Check if we have advanced mapping config
            const mapping = config.databaseMapping as Array<{ originalName: string, targetName: string, selected: boolean }> | undefined;

            // If mapping is provided, we need to stream and filter the SQL
            if (mapping && mapping.length > 0) {
                log("Performing Selective/Mapped Restore...");

                // 1. Build map for quick lookup
                const dbMap = new Map<string, { target: string, selected: boolean }>();
                mapping.forEach(m => dbMap.set(m.originalName, { target: m.targetName, selected: m.selected }));

                // 2. Spawn psql connected to 'postgres' (default maintenance DB)
                // We do NOT use -f here, we pipe via stdin
                const args = [
                    '-h', config.host,
                    '-p', String(config.port),
                    '-U', config.user,
                    '-d', 'postgres' // Connect to default DB to issue CREATE DATABASE commands
                ];

                log(`Executing restore stream to: psql ${args.join(' ')}`);

                await new Promise<void>((resolve, reject) => {
                    const psql = spawn('psql', args, { env, stdio: ['pipe', 'pipe', 'pipe'] });

                    psql.stderr.on('data', (d) => log(`stderr: ${d}`));
                    // psql.stdout.on('data', (d) => logs.push(`stdout: ${d}`)); // Verbose

                    psql.on('close', (code) => {
                        if (code === 0) resolve();
                        else reject(new Error(`psql exited with code ${code}`));
                    });

                    psql.on('error', (err) => reject(err));

                    // 3. Create Transform Stream to filter/rewrite SQL
                    const fileStream = createReadStream(sourcePath, { encoding: 'utf8', highWaterMark: 64 * 1024 });

                    fileStream.on('data', (chunk) => {
                         updateProgress(chunk.length);
                    });

                    let currentDb: string | null = null;
                    let skipMode = false;

                    const transformer = new Transform({
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
                });

            } else {
                // Legacy / Direct Restore (Single file, no fancy mapping)
                const args: string[] = [
                    '-h', config.host,
                    '-p', String(config.port),
                    '-U', config.user,
                    '-d', config.database, // Target DB from UI form main input (fallback)
                    '-f', sourcePath
                ];

                // Note: Standard psql -f does not provide progress hooks easily
                // because it opens the file internally.
                // To support progress, we MUST pipe instead of using -f, even for direct restore.
                // Let's switch to piping for consistency and progress.

                log(`Executing direct restore command: psql (piped)`);

                // Remove -f sourcePath and add proper connection args
                const pipeArgs = [
                     '-h', config.host,
                    '-p', String(config.port),
                    '-U', config.user,
                    '-d', config.database
                ];

                await new Promise<void>((resolve, reject) => {
                    const psql = spawn('psql', pipeArgs, { env, stdio: ['pipe', 'pipe', 'pipe'] });

                    psql.stderr.on('data', (d) => log(`stderr: ${d}`));

                    psql.on('close', (code) => {
                        if (code === 0) resolve();
                        else reject(new Error(`psql exited with code ${code}`));
                    });

                    psql.on('error', (err) => reject(err));

                    const stream = createReadStream(sourcePath);
                    stream.on('data', (c) => updateProgress(c.length));
                    stream.pipe(psql.stdin);
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
    },

    async test(config: any): Promise<{ success: boolean; message: string }> {
        try {
            const env = { ...process.env, PGPASSWORD: config.password };
            const args = ['-h', config.host, '-p', String(config.port), '-U', config.user, '-d', 'postgres', '-c', 'SELECT 1'];

            await execFileAsync('psql', args, { env });
            return { success: true, message: "Connection successful" };
        } catch (error: any) {
             return { success: false, message: "Connection failed: " + (error.stderr || error.message) };
        }
    },

    async getDatabases(config: any): Promise<string[]> {
        const env = { ...process.env, PGPASSWORD: config.password };
        // -t = tuples only (no header/footer), -A = unaligned
        const args = ['-h', config.host, '-p', String(config.port), '-U', config.user, '-d', 'postgres', '-t', '-A', '-c', 'SELECT datname FROM pg_database WHERE datistemplate = false;'];

        const { stdout } = await execFileAsync('psql', args, { env });
        return stdout.split('\n').map(s => s.trim()).filter(s => s);
    }
};
