import { LogLevel, LogType } from "@/lib/core/logs";
import { BackupResult } from "@/lib/core/interfaces";
import { execFileAsync } from "./connection";
import { getDialect } from "./dialects";
import { spawn } from "child_process";
import { createReadStream } from "fs";
import { Transform, TransformCallback } from "stream";
import fs from "fs/promises";
// import { waitForProcess } from "@/lib/adapters/process";
import { getPostgresBinary } from "./version-utils";

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

/**
 * Detect if a backup file is in PostgreSQL custom format or plain SQL
 */
async function isCustomFormat(filePath: string): Promise<boolean> {
    try {
        const buffer = Buffer.alloc(5);
        const handle = await fs.open(filePath, 'r');
        await handle.read(buffer, 0, 5, 0);
        await handle.close();

        // Custom format starts with "PGDMP" magic bytes
        return buffer.toString('ascii', 0, 5) === 'PGDMP';
    } catch {
        return false;
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

        // Handle Privileged Auth
        const priv = config.privilegedAuth;
        const user = (priv && priv.user) ? priv.user : config.user;
        const password = (priv && priv.password) ? priv.password : config.password;

        if (password) {
            env.PGPASSWORD = password;
        } else {
             log("No password provided for connection.", "warning");
        }

        log(`Prepared connection: ${user}@${config.host}:${config.port} (Privileged: ${!!priv})`, "info");
        // Create usage config with correct user
        const usageConfig = { ...config, user };

        // const dialect = getDialect('postgres', config.detectedVersion);

        // Detect backup format
        const isCustom = await isCustomFormat(sourcePath);
        log(`Detected backup format: ${isCustom ? 'Custom (binary)' : 'Plain SQL'}`, 'info');

        // Check if we have advanced mapping config
        const mapping = config.databaseMapping as Array<{ originalName: string, targetName: string, selected: boolean }> | undefined;

        // Multi-DB Restore with Mapping
        if (mapping && mapping.length > 0) {
            const selectedDbs = mapping.filter(m => m.selected);
            if (selectedDbs.length === 0) {
                throw new Error("No databases selected for restore.");
            }

            log(`Performing Selective/Mapped Restore: ${selectedDbs.length} database(s)`, 'info');
            selectedDbs.forEach(db => {
                log(`  ${db.originalName} → ${db.targetName || db.originalName}`, 'info');
            });

            if (isCustom && selectedDbs.length > 1) {
                log("ERROR: Custom-format dumps only support single database.", 'error');
                log("Solution: Use Plain SQL format (without -Fc flag) for multi-database backups.", 'error');
                throw new Error("Multi-database restore requires Plain SQL format, not Custom format. Please recreate backup without -Fc flag.");
            }

            if (isCustom) {
                // Custom Format: Single DB restore via pg_restore
                log("Using pg_restore for custom-format restore", 'info');

                const targetDb = selectedDbs[0].targetName || selectedDbs[0].originalName;

                // Use version-matched pg_restore binary
                const pgRestoreBinary = await getPostgresBinary('pg_restore', config.detectedVersion);
                log(`Using ${pgRestoreBinary} for PostgreSQL ${config.detectedVersion}`, 'info');

                const args = [
                    '-h', usageConfig.host,
                    '-p', String(usageConfig.port),
                    '-U', usageConfig.user,
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

log("Starting restore process", "info", "command", `${pgRestoreBinary} ${args.join(' ')}`);

            await new Promise<void>((resolve, reject) => {
                const pgRestore = spawn(pgRestoreBinary, args, { env, stdio: ['ignore', 'pipe', 'pipe'] });

                let stderrBuffer = "";
                let stdoutBuffer = "";

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
                        const text = data.toString();
                        stdoutBuffer += text;
                        const lines = text.trim().split('\n');
                        lines.forEach((line: string) => {
                            if (line) log(line, 'info');
                        });
                    });
                }

                pgRestore.on('close', (code) => {
                    if (code === 0) {
                        resolve();
                    } else if (code === 1 && stderrBuffer.includes('warning') && stderrBuffer.includes('errors ignored')) {
                        // Exit code 1 with "errors ignored" means warnings, not fatal errors
                        log('Restore completed with warnings (non-fatal, likely compatibility issues)', 'warning');
                        resolve();
                    } else {
                        if (stdoutBuffer.trim()) {
                            log(`Captured stdout: ${stdoutBuffer.trim()}`, 'error');
                        }
                        if (stderrBuffer.trim()) {
                            log(`Captured stderr: ${stderrBuffer.trim()}`, 'error');
                        }

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
            } else {
                // Plain SQL Format: Multi-DB restore via psql with SQL filtering
                log("Using psql for plain-SQL multi-database restore", 'info');

                // Use version-matched psql binary
                const psqlBinary = await getPostgresBinary('psql', config.detectedVersion);
                log(`Using ${psqlBinary} for PostgreSQL ${config.detectedVersion}`, 'info');

                // Build database map for filtering
                const dbMap = new Map(selectedDbs.map(m => [
                    m.originalName,
                    { selected: m.selected, target: m.targetName || m.originalName }
                ]));

                const args = [
                    '-h', usageConfig.host,
                    '-p', String(usageConfig.port),
                    '-U', usageConfig.user,
                    '-d', 'postgres', // Connect to maintenance DB
                    '-w'
                    // Note: Removed -v ON_ERROR_STOP=1 as it causes restricted mode
                    // which blocks \connect commands when reading from stdin
                ];

                log("Starting multi-database restore", "info", "command", `${psqlBinary} ${args.join(' ')} < ${sourcePath}`);

                await new Promise<void>((resolve, reject) => {
                    log("Spawning psql process...", 'info');
                    const psql = spawn(psqlBinary, args, { env, stdio: ['pipe', 'pipe', 'pipe'] });

                    let stderrBuffer = "";
                    let stdoutBuffer = "";
                    let psqlStarted = false;
                    let streamPiped = false;

                    // Timeout detection
                    const startTimeout = setTimeout(() => {
                        if (!psqlStarted) {
                            log("ERROR: psql process did not start within 10 seconds", 'error');
                            psql.kill();
                            reject(new Error("psql process startup timeout"));
                        }
                    }, 10000);

                    psql.on('spawn', () => {
                        psqlStarted = true;
                        clearTimeout(startTimeout);
                        log("psql process spawned successfully", 'info');
                    });

                    if (psql.stderr) {
                        psql.stderr.on('data', (data) => {
                            const text = data.toString();
                            stderrBuffer += text;
                            const lines = text.trim().split('\n');
                            lines.forEach((line: string) => {
                                // Filter out noise - only log actual errors
                                if (line &&
                                    !line.includes('NOTICE:') &&
                                    !line.includes('backslash commands are restricted') &&
                                    line.toLowerCase().includes('error')) {
                                    log(line, 'error');
                                }
                            });
                        });
                    }

                    if (psql.stdout) {
                        psql.stdout.on('data', (data) => {
                            const text = data.toString();
                            stdoutBuffer += text;
                            // Don't log stdout - it's too verbose (SET, (1 row), etc.)
                            // We only care about errors in stderr
                        });
                    }

                    // Stream SQL file through transformer
                    log("Creating file stream and transformer...", 'info');
                    const fileStream = createReadStream(sourcePath, { encoding: 'utf8', highWaterMark: 64 * 1024 });

                    fileStream.on('data', (chunk) => {
                        updateProgress(chunk.length);
                    });

                    fileStream.on('error', (err) => {
                        log(`File stream error: ${err.message}`, 'error');
                        reject(err);
                    });

                    let currentDb: string | null = null;
                    let skipMode = false;

                    const transformer = new Transform({
                        decodeStrings: false,
                        transform(chunk: string | Buffer, encoding: BufferEncoding, callback: TransformCallback) {
                            const lines = chunk.toString().split('\n');
                            const output: string[] = [];

                            for (const line of lines) {
                                // Skip DROP DATABASE and DROP USER statements
                                // prepareRestore already created DBs, and we can't drop current user
                                if (line.match(/^DROP DATABASE/i) || line.match(/^DROP (ROLE|USER)/i)) {
                                    // Skip this line entirely
                                    continue;
                                }

                                // Skip CREATE USER/ROLE if it's trying to create a user that already exists
                                // This prevents "role already exists" errors
                                if (line.match(/^CREATE (ROLE|USER)/i)) {
                                    // Skip - we assume users already exist
                                    continue;
                                }

                                // Detect CREATE DATABASE
                                const createMatch = line.match(/^CREATE DATABASE "?([^";\ s]+)"?/i);
                                if (createMatch) {
                                    const dbName = createMatch[1];
                                    currentDb = dbName;

                                    // Skip PostgreSQL system databases
                                    const systemDatabases = ['template0', 'template1', 'postgres'];
                                    if (systemDatabases.includes(dbName)) {
                                        skipMode = true;
                                        continue;
                                    }

                                    const map = dbMap.get(dbName);

                                    if (map) {
                                        if (!map.selected) {
                                            skipMode = true;
                                        } else {
                                            skipMode = false;
                                            // Skip CREATE DATABASE - prepareRestore already created it
                                            // Just track currentDb for \connect statements
                                        }
                                    } else {
                                        // Database not in mapping - skip it
                                        skipMode = true;
                                    }
                                    continue;
                                }

                                // Detect \connect
                                const connectMatch = line.match(/^\\connect "?([^"\s]+)"?/i);
                                if (connectMatch) {
                                    const dbName = connectMatch[1];

                                    // Skip system databases
                                    const systemDatabases = ['template0', 'template1', 'postgres'];
                                    if (systemDatabases.includes(dbName)) {
                                        skipMode = true;
                                        continue;
                                    }

                                    const map = dbMap.get(dbName);

                                    if (map) {
                                        if (!map.selected) {
                                            skipMode = true;
                                            // Skip the \connect statement itself for unselected DBs
                                            continue;
                                        } else {
                                            skipMode = false;
                                            if (map.target !== dbName) {
                                                output.push(line.replace(new RegExp(`"?${dbName}"?`, 'g'), `"${map.target}"`));
                                            } else {
                                                output.push(line);
                                            }
                                        }
                                    } else {
                                        // Database not in mapping - skip it
                                        skipMode = true;
                                        continue;
                                    }
                                    continue;
                                }

                                if (!skipMode) {
                                    // Handle renames in ALTER DATABASE statements
                                    const dbEntry = currentDb ? dbMap.get(currentDb) : undefined;
                                    if (dbEntry && dbEntry.target !== currentDb) {
                                        const target = dbEntry.target;
                                        if (line.match(new RegExp(`ALTER DATABASE "?${currentDb}"?`, 'i'))) {
                                            output.push(line.replace(new RegExp(`"?${currentDb}"?`, 'g'), `"${target}"`));
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

                    log("Piping file stream through transformer to psql stdin...", 'info');

                    fileStream.pipe(transformer).pipe(psql.stdin!);

                    streamPiped = true;
                    log("Stream piping initiated", 'info');

                    // Check if stream actually starts flowing
                    const streamTimeout = setTimeout(() => {
                        if (streamPiped && !psql.stdin?.writable) {
                            log("ERROR: psql stdin became unwritable", 'error');
                        }
                    }, 5000);

                    transformer.on('error', (err) => {
                        clearTimeout(streamTimeout);
                        log(`Transformer error: ${err.message}`, 'error');
                        reject(err);
                    });

                    psql.stdin?.on('error', (err) => {
                        clearTimeout(streamTimeout);
                        log(`psql stdin error: ${err.message}`, 'error');
                        // Don't reject - might be normal (like EPIPE when psql closes early)
                    });

                    psql.on('close', (code) => {
                        clearTimeout(streamTimeout);
                        log(`psql process closed with code ${code}`, 'info');
                        if (code === 0) {
                            resolve();
                        } else {
                            if (stdoutBuffer.trim()) {
                                log(`Captured stdout: ${stdoutBuffer.trim()}`, 'error');
                            }
                            if (stderrBuffer.trim()) {
                                log(`Captured stderr: ${stderrBuffer.trim()}`, 'error');
                            }

                            let errorMsg = `psql exited with code ${code}`;
                            if (stderrBuffer.trim()) {
                                errorMsg += `. Error: ${stderrBuffer.trim()}`;
                            }
                            reject(new Error(errorMsg));
                        }
                    });

                    psql.on('error', (err) => {
                        reject(new Error(`Failed to start psql: ${err.message}`));
                    });
                });
            }

        } else {
            // Direct Restore (Single DB or no mapping)
            const targetDb = config.database || 'postgres';

            // Use version-matched pg_restore binary
            const pgRestoreBinary = await getPostgresBinary('pg_restore', config.detectedVersion);
            log(`Using ${pgRestoreBinary} for PostgreSQL ${config.detectedVersion}`, 'info');

            // Use pg_restore for custom format dumps (binary)
            // pg_restore can handle both custom and plain formats
            const args = [
                '-h', usageConfig.host,
                '-p', String(usageConfig.port),
                '-U', usageConfig.user,
                '-d', targetDb,
                '-w', // Never prompt for password
                '--clean', // Clean (drop) database objects before recreating
                '--if-exists', // Use IF EXISTS when dropping
                '--no-owner', // Skip ownership restoration (prevents permission errors)
                '--no-acl', // Skip ACL restoration (prevents permission errors)
                '--no-comments', // Skip comments (prevents version-specific syntax issues)
                '--no-tablespaces', // Skip tablespace assignments
                '--no-security-labels', // Skip security labels
                '-v', // Verbose
                sourcePath // File path
            ];

            log("Starting direct restore command", "info", "command", `${pgRestoreBinary} ${args.join(' ')}`);

            await new Promise<void>((resolve, reject) => {
                const pgRestore = spawn(pgRestoreBinary, args, { env, stdio: ['ignore', 'pipe', 'pipe'] });

                // Capture both stderr and stdout for detailed error messages
                let stderrBuffer = "";
                let stdoutBuffer = "";

                if (pgRestore.stderr) {
                    pgRestore.stderr.on('data', (data) => {
                        const text = data.toString();
                        stderrBuffer += text;
                        // Log immediately
                        const lines = text.trim().split('\n');
                        lines.forEach((line: string) => {
                            if (line && !line.includes('NOTICE:')) { // Filter out notices
                                log(line, 'info');
                            }
                        });
                    });
                }

                if (pgRestore.stdout) {
                    pgRestore.stdout.on('data', (data) => {
                        const text = data.toString();
                        stdoutBuffer += text;
                        const lines = text.trim().split('\n');
                        lines.forEach((line: string) => {
                            if (line) log(line, 'info');
                        });
                    });
                }

                pgRestore.on('close', (code) => {
                    if (code === 0) {
                        resolve();
                    } else if (code === 1 && stderrBuffer.includes('warning') && stderrBuffer.includes('errors ignored')) {
                        // Exit code 1 with "errors ignored" means warnings, not fatal errors
                        log('Restore completed with warnings (non-fatal, likely compatibility issues)', 'warning');
                        resolve();
                    } else {
                        // Log all captured output
                        if (stdoutBuffer.trim()) {
                            log(`Captured stdout: ${stdoutBuffer.trim()}`, 'error');
                        }
                        if (stderrBuffer.trim()) {
                            log(`Captured stderr: ${stderrBuffer.trim()}`, 'error');
                        }

                        let errorMsg = `pg_restore exited with code ${code}`;
                        if (stderrBuffer.trim()) {
                            errorMsg += `. Error: ${stderrBuffer.trim()}`;
                        } else if (stdoutBuffer.trim()) {
                            errorMsg += `. Output: ${stdoutBuffer.trim()}`;
                        } else {
                            errorMsg += '. No error output captured. Possible issues: wrong credentials, database does not exist, or permission denied.';
                        }
                        reject(new Error(errorMsg));
                    }
                });

                pgRestore.on('error', (err) => {
                    reject(new Error(`Failed to start pg_restore: ${err.message}`));
                });
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
