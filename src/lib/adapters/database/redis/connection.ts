import { execFile } from "child_process";
import util from "util";
import { logger } from "@/lib/logging/logger";
import { wrapError } from "@/lib/logging/errors";
import { RedisConfig } from "@/lib/adapters/definitions";
import {
    SshClient,
    isSSHMode,
    extractSshConfig,
    buildRedisArgs,
    remoteBinaryCheck,
} from "@/lib/ssh";

const execFileAsync = util.promisify(execFile);
const log = logger.child({ adapter: "redis", module: "connection" });

/**
 * Build redis-cli connection arguments from config
 */
function buildConnectionArgs(config: RedisConfig): string[] {
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
export async function test(config: RedisConfig): Promise<{ success: boolean; message: string; version?: string }> {
    if (isSSHMode(config)) {
        const sshConfig = extractSshConfig(config)!;
        const ssh = new SshClient();
        try {
            await ssh.connect(sshConfig);
            const redisBin = await remoteBinaryCheck(ssh, "redis-cli");
            const args = buildRedisArgs(config);

            // TLS flag
            if ((config as any).tls) args.push("--tls");
            // Database selection
            if (config.database !== undefined && config.database !== 0) {
                args.push("-n", String(config.database));
            }

            // Ping test
            const pingResult = await ssh.exec(`${redisBin} ${args.join(" ")} PING`);
            if (pingResult.code !== 0 || !pingResult.stdout.includes("PONG")) {
                return { success: false, message: `SSH Redis PING failed: ${pingResult.stderr || pingResult.stdout}` };
            }

            // Version info
            const infoResult = await ssh.exec(`${redisBin} ${args.join(" ")} INFO server`);
            let version: string | undefined;
            if (infoResult.code === 0) {
                const valkeyMatch = infoResult.stdout.match(/valkey_version:([^\r\n]+)/);
                const redisMatch = infoResult.stdout.match(/redis_version:([^\r\n]+)/);
                version = (valkeyMatch ?? redisMatch)?.[1]?.trim();
            }

            return { success: true, message: "Connection successful (via SSH)", version };
        } catch (error: unknown) {
            const msg = error instanceof Error ? error.message : String(error);
            return { success: false, message: `SSH connection failed: ${msg}` };
        } finally {
            ssh.end();
        }
    }

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

        // Prefer valkey_version when present (Valkey servers), fall back to redis_version
        const valkeyMatch = infoResult.match(/valkey_version:([^\r\n]+)/);
        const redisMatch = infoResult.match(/redis_version:([^\r\n]+)/);
        const version = (valkeyMatch ?? redisMatch)?.[1]?.trim();

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
export async function getDatabases(config: RedisConfig): Promise<string[]> {
    if (isSSHMode(config)) {
        const sshConfig = extractSshConfig(config)!;
        const ssh = new SshClient();
        try {
            await ssh.connect(sshConfig);
            const redisBin = await remoteBinaryCheck(ssh, "redis-cli");
            const args = buildRedisArgs(config);

            const result = await ssh.exec(`${redisBin} ${args.join(" ")} CONFIG GET databases`);
            if (result.code === 0) {
                const lines = result.stdout.trim().split("\n");
                const maxDbs = parseInt(lines[1] || "16", 10);
                return Array.from({ length: maxDbs }, (_, i) => String(i));
            }
            return Array.from({ length: 16 }, (_, i) => String(i));
        } catch (error: unknown) {
            log.error("Failed to get databases via SSH", {}, wrapError(error));
            return Array.from({ length: 16 }, (_, i) => String(i));
        } finally {
            ssh.end();
        }
    }

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
