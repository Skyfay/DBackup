import { execFile } from "child_process";
import util from "util";
import { logger } from "@/lib/logger";
import { wrapError } from "@/lib/errors";

const execFileAsync = util.promisify(execFile);
const log = logger.child({ adapter: "redis", module: "connection" });

/**
 * Build redis-cli connection arguments from config
 */
function buildConnectionArgs(config: any): string[] {
    const args: string[] = [];

    args.push("-h", config.host);
    args.push("-p", String(config.port));

    // Authentication
    if (config.username) {
        args.push("--user", config.username);
    }
    if (config.password) {
        args.push("-a", config.password);
    }

    // TLS
    if (config.tls) {
        args.push("--tls");
    }

    // Database selection
    if (config.database !== undefined && config.database !== 0) {
        args.push("-n", String(config.database));
    }

    return args;
}

/**
 * Test connection to Redis server
 */
export async function test(config: any): Promise<{ success: boolean; message: string; version?: string }> {
    try {
        const args = buildConnectionArgs(config);

        // Test with PING command
        const pingArgs = [...args, "PING"];
        const { stdout: pingResult } = await execFileAsync("redis-cli", pingArgs);

        if (!pingResult.trim().includes("PONG")) {
            return { success: false, message: "Redis did not respond with PONG" };
        }

        // Get version info
        const infoArgs = [...args, "INFO", "server"];
        const { stdout: infoResult } = await execFileAsync("redis-cli", infoArgs);

        // Parse redis_version from INFO output
        const versionMatch = infoResult.match(/redis_version:([^\r\n]+)/);
        const version = versionMatch ? versionMatch[1].trim() : undefined;

        return {
            success: true,
            message: "Connection successful",
            version
        };
    } catch (error: unknown) {
        const err = error as { stderr?: string; message?: string };
        const errorMsg = err.stderr || err.message || "Unknown error";
        return {
            success: false,
            message: `Connection failed: ${errorMsg}`
        };
    }
}

/**
 * Get list of available databases
 *
 * Redis uses numbered databases (0-15 by default).
 * This function returns all configured databases.
 * Note: Redis databases are always available, even if empty.
 */
export async function getDatabases(config: any): Promise<string[]> {
    try {
        const baseArgs = buildConnectionArgs({ ...config, database: 0 });

        // Get the number of configured databases
        const configArgs = [...baseArgs, "CONFIG", "GET", "databases"];
        const { stdout: configResult } = await execFileAsync("redis-cli", configArgs);

        // Parse: "databases\n16\n" -> 16
        const lines = configResult.trim().split("\n");
        const maxDbs = parseInt(lines[1] || "16", 10);

        // Return all database indices as strings
        const databases: string[] = [];
        for (let i = 0; i < maxDbs; i++) {
            databases.push(String(i));
        }

        return databases;
    } catch (error: unknown) {
        log.error("Failed to get databases", {}, wrapError(error));
        // Return default 16 databases on error
        return Array.from({ length: 16 }, (_, i) => String(i));
    }
}

export { buildConnectionArgs };
