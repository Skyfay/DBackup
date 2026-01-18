import { BackupResult } from "@/lib/core/interfaces";
import { execFileAsync } from "./connection";
import { spawn } from "child_process";
import { createWriteStream } from "fs";
import fs from "fs/promises";
import { waitForProcess } from "@/lib/adapters/process";

export async function dump(config: any, destinationPath: string, onLog?: (msg: string) => void, onProgress?: (percentage: number) => void): Promise<BackupResult> {
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

                const child = spawn('pg_dump', args, { env });

                // Pipe stdout to file, but don't close the stream when this child exits
                child.stdout.pipe(writeStream, { end: false });

                // Use shared process monitor
                await waitForProcess(child, `pg_dump for ${db}`, (msg) => log(`[${db}] stderr: ${msg}`));

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
}
