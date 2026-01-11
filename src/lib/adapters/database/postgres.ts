import { DatabaseAdapter, BackupResult } from "@/lib/core/interfaces";
import { PostgresSchema } from "@/lib/adapters/definitions";
import { exec } from "child_process";
import fs from "fs/promises";
import util from "util";

const execAsync = util.promisify(exec);

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

            let command = `pg_dump -h ${config.host} -p ${config.port} -U ${config.user}`;

            if (config.options) {
                command += ` ${config.options}`;
            }

            // Custom format is often better for restores, but plain text is more generic.
            // Let's stick to default or let user specify in options, but we redirect output.
            command += ` -f "${destinationPath}" ${config.database}`;

            logs.push(`Executing command: ${command}`);

            const { stdout, stderr } = await execAsync(command, { env });

            // pg_dump might output info to stderr even on success
            if (stderr) {
                logs.push(`stderr: ${stderr}`);
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

            let command = `psql -h ${config.host} -p ${config.port} -U ${config.user} -d ${config.database} -f "${sourcePath}"`;

            logs.push(`Executing restore command: ${command}`);

            const { stdout, stderr } = await execAsync(command, { env });
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
            // Simple query to check connection
            const command = `psql -h ${config.host} -p ${config.port} -U ${config.user} -d ${config.database} -c "SELECT 1"`;

            await execAsync(command, { env });
            return { success: true, message: "Connection successful" };
        } catch (error: any) {
             return { success: false, message: "Connection failed: " + (error.stderr || error.message) };
        }
    }
}
