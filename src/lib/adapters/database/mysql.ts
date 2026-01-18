import { DatabaseAdapter, BackupResult } from "@/lib/core/interfaces";
import { MySQLSchema } from "@/lib/adapters/definitions";
import { execFile, spawn } from "child_process";
import fs from "fs/promises";
import { createReadStream } from "fs";
import { Transform } from "stream";
import { pipeline } from "stream/promises";
import util from "util";

const execFileAsync = util.promisify(execFile);

async function ensureDatabase(config: any, dbName: string, user: string, pass: string | undefined, privileged: boolean, logs: string[]) {
    const args = ['-h', config.host, '-P', String(config.port), '-u', user, '--protocol=tcp'];
    const env = { ...process.env };
    if (pass) env.MYSQL_PWD = pass;

    try {
       await execFileAsync('mysql', [...args, '-e', `CREATE DATABASE IF NOT EXISTS \`${dbName}\``], { env });
       logs.push(`Database '${dbName}' ensured.`);
       if (privileged) {
            const grantQuery = `GRANT ALL PRIVILEGES ON \`${dbName}\`.* TO '${config.user}'@'%'; GRANT ALL PRIVILEGES ON \`${dbName}\`.* TO '${config.user}'@'localhost'; FLUSH PRIVILEGES;`;
            await execFileAsync('mysql', [...args, '-e', grantQuery], { env });
            logs.push(`Permissions granted for '${dbName}'.`);
       }
    } catch(e: any) {
        logs.push(`Warning ensures DB '${dbName}': ${e.message}`);
    }
}

export const MySQLAdapter: DatabaseAdapter = {
    id: "mysql",
    type: "database",
    name: "MySQL / MariaDB",
    configSchema: MySQLSchema,

    async analyzeDump(sourcePath: string): Promise<string[]> {
        const dbs = new Set<string>();

        try {
            // Use grep for fast scan
            // Search for: USE `...`; | CREATE DATABASE ... | -- Current Database: ...
            const { stdout } = await execFileAsync('grep', ['-E', '^USE |CREATE DATABASE |-- Current Database:', sourcePath], { maxBuffer: 10 * 1024 * 1024 });

            const lines = stdout.split('\n');
            for (const line of lines) {
                // 1. Look for USE statements (most reliable for multi-db context)
                // Matches: USE `dbname`;
                const useMatch = line.match(/^USE `([^`]+)`;/i);
                if (useMatch) {
                    dbs.add(useMatch[1]);
                }

                // 2. Look for CREATE DATABASE
                // Matches: CREATE DATABASE `foo` ...
                // Matches: CREATE DATABASE IF NOT EXISTS `foo` ...
                // Matches: CREATE DATABASE /*!32312 IF NOT EXISTS*/ `foo` ...
                // We use a broader regex: CREATE DATABASE [anything/comments] `name`
                const createMatch = line.match(/CREATE DATABASE .*?`([^`]+)`/i);
                if (createMatch) {
                    dbs.add(createMatch[1]);
                }

                // 3. Look for standard mysqldump comments
                // Matches: -- Current Database: `foo`
                const currentMatch = line.match(/-- Current Database: `([^`]+)`/i);
                if (currentMatch) {
                    dbs.add(currentMatch[1]);
                }
            }
        } catch (e: any) {
            // grep exit code 1 means no matches
            if (e.code !== 1) {
                console.error("Error analyzing MySQL dump:", e);
            }
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
            // Determine databases to backup
            let dbs: string[] = [];
            if(Array.isArray(config.database)) dbs = config.database;
            else if(config.database && config.database.includes(',')) dbs = config.database.split(',');
            else if(config.database) dbs = [config.database];

            const args: string[] = [
                '-h', config.host,
                '-P', String(config.port),
                '-u', config.user,
                '--protocol=tcp'
            ];

            const env = { ...process.env };
            if (config.password) {
                env.MYSQL_PWD = config.password;
            }

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

            if (dbs.length > 1) {
                args.push('--databases', ...dbs);
            } else if (dbs.length === 1) {
                args.push(dbs[0]);
            }

            args.push(`--result-file=${destinationPath}`);

            // No password in args anymore
            log(`Executing command: mysqldump ${args.join(' ')}`);

            const { stdout, stderr } = await execFileAsync('mysqldump', args, { env });

            if (stderr) {
                log(`stderr: ${stderr}`);
            }

            // Check file size
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

            const dbMapping = config.databaseMapping as { originalName: string, targetName: string, selected: boolean }[] | undefined;
            const usePrivileged = !!config.privilegedAuth;
            const creationUser = usePrivileged ? config.privilegedAuth.user : config.user;
            const creationPass = usePrivileged ? config.privilegedAuth.password : config.password;

            // Determine operation mode
            // Mode 1: Mapping (Advanced) -> Explicitly selective or renaming
            // Mode 2: Force Target (Simple) -> User specified a single target DB, we must dump everything there
            // Mode 3: Passive (Full/Auto) -> No specific target enforcement, let the dump dictate (e.g. multi-db restore without rename)

            // For now, if config.database is set, we treat it as "Target".
            // Ideally we'd know if it was overridden.
            // Assumption: If the user is using the "Simple Restore" UI, they picked a target source & optional database name.
            // If they provided a database name, they expect content to go there.

            // To ensure we don't break "Full Restore", we really need to know if the user INTENDED to override.
            // But let's assume if there is NO mapping, and there IS a config.database, we are in "Single Target" mode.
            // Most MySQL Adapters have a default DB (e.g. 'mysql' or 'app').
            // So config.database is almost ALWAYS set.
            // This makes it risky to always strip USE.

            // New Heuristic:
            // If config.database is set, AND the user didn't request a mapping, we typically just run `mysql db < file`.
            // As we saw, this fails for Multi-DB dumps attempting to target a specific DB.
            // So we will implement a Stream Processor that strips USE/CREATE DATABASE *only if* we are ignoring the dump's structure.

            // Let's implement a universal Stream Restore that covers all cases.

            // Pre-Ensure Target DB(s)
            if (dbMapping && dbMapping.length > 0) {
                 const selectedDbs = dbMapping.filter(m => m.selected);
                 for (const db of selectedDbs) {
                    const targetName = db.targetName || db.originalName;
                    await ensureDatabase(config, targetName, creationUser, creationPass, usePrivileged, logs);
                 }
            } else if (config.database) {
                // Ensure the single target database exists
                await ensureDatabase(config, config.database, creationUser, creationPass, usePrivileged, logs);
            }

            return new Promise((resolve, reject) => {
                const args = [
                    '-h', config.host,
                    '-P', String(config.port),
                    '-u', config.user,
                    '--protocol=tcp'
                ];
                const env = { ...process.env };
                if(config.password) env.MYSQL_PWD = config.password;

                // If we are in "Single Target" mode, we connect directly to that DB
                const singleTargetDb = (!dbMapping || dbMapping.length === 0) && config.database ? config.database : null;
                if (singleTargetDb) {
                     args.push(singleTargetDb);
                }

                const mysqlProc = spawn('mysql', args, { stdio: ['pipe', 'pipe', 'pipe'], env });

                mysqlProc.stderr.on('data', (d) => {
                    const msg = d.toString();
                    if (!msg.includes("Using a password")) log(`MySQL: ${msg}`);
                });

                mysqlProc.on('error', (err) => reject({ success: false, logs, error: err.message, startedAt, completedAt: new Date() }));

                // Track completion
                let isCompleted = false;
                const finish = (code: number) => {
                    if (isCompleted) return;
                    isCompleted = true;
                    if (code === 0) {
                        resolve({ success: true, logs, startedAt, completedAt: new Date() });
                    } else {
                        resolve({ success: false, logs, error: `MySQL exited with code ${code}`, startedAt, completedAt: new Date() });
                    }
                };

                mysqlProc.on('close', finish);

                const fileStream = createReadStream(sourcePath, { highWaterMark: 64 * 1024 });

                // Stream Transformer for Progress & Filtering
                let currentTargetName: string | null = null;
                let skipCurrentSection = false;

                // Helper to chunk-split lines (simple version for streams)
                // Note: For perfect SQL parsing we'd need a real parser, but line-based grep is standard for dumps.
                // We use a Transform that buffers lines.
                let buffer = '';

                const transformStream = new Transform({
                    objectMode: true, // We process chunks but might emit lines? No, let's keep it buffer based for speed.
                    transform(chunk: Buffer, encoding, callback) {
                        // 1. Progress
                        updateProgress(chunk.length);

                        // 2. Filter Logic (if needed)
                        if (!dbMapping && !singleTargetDb) {
                            // Direct Pass-through (Fastest)
                            this.push(chunk);
                            callback();
                            return;
                        }

                        // String processing for filtering
                        // CAUTION: This is slower than raw pipe. But needed for selective restore.
                        // Ideally we only do this if dbMapping is present.

                        let data = buffer + chunk.toString();
                        const lines = data.split('\n');
                        buffer = lines.pop() || ''; // Keep last partial line

                        const output: string[] = [];

                        for (const line of lines) {
                             // Logic for filtering
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
                                         skipCurrentSection = false; // Default include?
                                         output.push(line);
                                     }
                                     continue;
                                 } else if (singleTargetDb) {
                                     // Ignore USE in single target mode
                                    continue;
                                 }
                             }

                             const createMatch = line.match(/^CREATE DATABASE (?:IF NOT EXISTS )?`([^`]+)`/i);
                             if (createMatch) {
                                const originalDb = createMatch[1];
                                if (dbMapping) {
                                    const map = dbMapping.find(m => m.originalName === originalDb);
                                    if (map && !map.selected) continue; // Skip create
                                } else if (singleTargetDb) {
                                    continue; // Skip create in single target
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

                // Handle Pipe Errors
                fileStream.on('error', (err) => mysqlProc.kill());
                transformStream.on('error', (err) => mysqlProc.kill());
                mysqlProc.stdin.on('error', (err) => {
                     // Usually EPIPE if mysql closes early
                     // log(`MySQL Stdin Error: ${err.message}`);
                });

                // EXECUTE PIPELINE
                fileStream.pipe(transformStream).pipe(mysqlProc.stdin);
            });

        } catch (error: any) {
             const msg = error.message || "";
             logs.push(`Error: ${msg}`);
             return { success: false, logs, error: msg, startedAt, completedAt: new Date() };
        }
    },

    async test(config: any): Promise<{ success: boolean; message: string }> {
        try {
            // Force protocol=tcp to ensure we connect via network port (vital for Docker on localhost)
            const args = ['ping', '-h', config.host, '-P', String(config.port), '-u', config.user, '--protocol=tcp', '--connect-timeout=5'];

             if (config.password) {
                args.push(`-p${config.password}`);
            }

            await execFileAsync('mysqladmin', args);
            return { success: true, message: "Connection successful" };
        } catch (error: any) {
            return { success: false, message: "Connection failed: " + (error.stderr || error.message) };
        }
    },

    async getDatabases(config: any): Promise<string[]> {
        const args = ['-h', config.host, '-P', String(config.port), '-u', config.user, '--protocol=tcp'];
        if (config.password) {
            args.push(`-p${config.password}`);
        }
        args.push('-e', 'SHOW DATABASES', '--skip-column-names');

        const { stdout } = await execFileAsync('mysql', args);
        const sysDbs = ['information_schema', 'mysql', 'performance_schema', 'sys'];
        return stdout.split('\n').map(s => s.trim()).filter(s => s && !sysDbs.includes(s));
    }
};

