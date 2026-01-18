import { DatabaseAdapter, BackupResult } from "@/lib/core/interfaces";
import { PostgresSchema } from "@/lib/adapters/definitions";
import { execFile, spawn } from "child_process";
import fs from "fs/promises";
import { createWriteStream } from "fs";
import util from "util";

const execFileAsync = util.promisify(execFile);

export const PostgresAdapter: DatabaseAdapter = {
    id: "postgres",
    type: "database",
    name: "PostgreSQL",
    configSchema: PostgresSchema,

    async dump(config: any, destinationPath: string): Promise<BackupResult> {
        const startedAt = new Date();
        const logs: string[] = [];

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

                logs.push(`Executing command: pg_dump ${args.join(' ')}`);

                const { stdout, stderr } = await execFileAsync('pg_dump', args, { env });

                // pg_dump might output info to stderr even on success
                if (stderr) {
                    logs.push(`stderr: ${stderr}`);
                }
            }
            // Case 2: Multiple Databases (Pipe output sequentially)
            else {
                logs.push(`Dumping multiple databases: ${dbs.join(', ')}`);
                const writeStream = createWriteStream(destinationPath);

                for (const db of dbs) {
                    logs.push(`Starting dump for ${db}...`);
                    // Use --create so the dump file knows to create the DB context
                    const args = [...baseArgs, '--create', db];

                    await new Promise<void>((resolve, reject) => {
                        const child = spawn('pg_dump', args, { env });

                        // Pipe stdout to file, but don't close the stream when this child exits
                        child.stdout.pipe(writeStream, { end: false });

                        child.stderr.on('data', (data) => {
                            logs.push(`[${db}] stderr: ${data.toString()}`);
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
                    logs.push(`Completed dump for ${db}`);
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
            logs.push(`Error: ${error.message}`);
            return {
                success: false,
                logs,
                error: error.message,
                startedAt,
                completedAt: new Date(),
            };
        }
    },

    async restore(config: any, sourcePath: string): Promise<BackupResult> {
        const startedAt = new Date();
        const logs: string[] = [];

        try {
            const env = { ...process.env };
            if (config.password) {
                env.PGPASSWORD = config.password;
            }

            const args: string[] = [
                '-h', config.host,
                '-p', String(config.port),
                '-U', config.user,
                '-d', config.database,
                '-f', sourcePath
            ];

            logs.push(`Executing restore command: psql ${args.join(' ')}`);

            const { stdout, stderr } = await execFileAsync('psql', args, { env });
             if (stderr) {
                logs.push(`stderr: ${stderr}`);
            }

            return {
                success: true,
                logs,
                startedAt,
                completedAt: new Date(),
            };

        } catch (error: any) {
             logs.push(`Error: ${error.message}`);
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
