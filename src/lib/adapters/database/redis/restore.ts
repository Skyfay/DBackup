import { BackupResult } from "@/lib/core/interfaces";
import { LogLevel, LogType } from "@/lib/core/logs";
import { buildConnectionArgs } from "./connection";
import { execFile } from "child_process";
import util from "util";
import { logger } from "@/lib/logging/logger";
import { RedisConfig } from "@/lib/adapters/definitions";

const execFileAsync = util.promisify(execFile);
const log = logger.child({ adapter: "redis", module: "restore" });

/**
 * Extended Redis config for restore operations
 */
type RedisRestoreConfig = RedisConfig & {
    detectedVersion?: string;
    privilegedAuth?: {
        user: string;
        password: string;
    };
};

/**
 * Prepare for Redis restore operation
 *
 * Validates that the target Redis server is accessible and that
 * the user has sufficient permissions.
 *
 * IMPORTANT: Redis RDB restore has significant limitations:
 * - Remote restore is NOT directly supported by Redis
 * - RDB files must be placed in the Redis data directory
 * - Server restart is required to load the new RDB
 */
export async function prepareRestore(config: RedisRestoreConfig, _databases: string[]): Promise<void> {
    const args = buildConnectionArgs(config);

    // Test basic connectivity
    try {
        await execFileAsync("redis-cli", [...args, "PING"]);
    } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        throw new Error(`Cannot connect to Redis/Valkey: ${message}`);
    }

    // Check if we have admin permissions (needed for potential FLUSHALL)
    try {
        const { stdout } = await execFileAsync("redis-cli", [...args, "ACL", "WHOAMI"]);
        const user = stdout.trim();

        // If not default user, check permissions
        if (user !== "default") {
            // Try to verify we have necessary permissions
            const { stdout: aclList } = await execFileAsync("redis-cli", [...args, "ACL", "LIST"]);

            // This is a basic check - in production you'd want more thorough validation
            if (!aclList.includes("allcommands") && !aclList.includes("+flushall")) {
                log.warn("User may not have FLUSHALL permission", { user });
            }
        }
    } catch {
        // ACL commands might not be available (Redis < 6) - continue anyway
    }
}

/**
 * Restore Redis from RDB backup
 *
 * LIMITATIONS:
 * Redis does not support remote RDB restore. The RDB file must be:
 * 1. Copied to the server's data directory
 * 2. Server must be restarted to load the new RDB
 *
 * This function provides guidance but cannot perform the actual restore
 * without server filesystem access.
 *
 * For a workaround, consider:
 * - SSH access to copy the file and restart Redis
 * - Docker volume mounting for containerized Redis
 * - Using RESTORE command for individual keys (very slow)
 */
export async function restore(
    config: RedisRestoreConfig,
    sourcePath: string,
    onLog?: (msg: string, level?: LogLevel, type?: LogType, details?: string) => void,
    _onProgress?: (percentage: number) => void
): Promise<BackupResult> {
    const startedAt = new Date();
    const logs: string[] = [];

    const log = (msg: string, level: LogLevel = "info", type: LogType = "general", details?: string) => {
        logs.push(msg);
        if (onLog) onLog(msg, level, type, details);
    };

    try {
        // Detect whether the target server is Redis or Valkey (both share this restore flow)
        const args = buildConnectionArgs(config);
        let engineName = "Redis";
        try {
            const { stdout: serverInfo } = await execFileAsync("redis-cli", [...args, "INFO", "server"]);
            if (/valkey_version:/.test(serverInfo)) engineName = "Valkey";
        } catch {
            // Fall back to "Redis" if INFO server can't be queried
        }
        const engineLower = engineName.toLowerCase();

        log(`Starting ${engineName} restore preparation...`, "info");

        // Verify the backup file exists
        const fs = await import("fs/promises");
        const stats = await fs.stat(sourcePath);
        log(`Backup file size: ${stats.size} bytes`, "info");

        // Get server info to provide instructions
        const { stdout: infoResult } = await execFileAsync("redis-cli", [...args, "CONFIG", "GET", "dir"]);

        const lines = infoResult.trim().split("\n");
        const dataDir = lines[1] || `/var/lib/${engineLower}`;

        const { stdout: dbFilename } = await execFileAsync("redis-cli", [...args, "CONFIG", "GET", "dbfilename"]);
        const dbLines = dbFilename.trim().split("\n");
        const rdbFilename = dbLines[1] || "dump.rdb";

        log("", "info");
        log("═══════════════════════════════════════════════════════════", "info");
        log(`⚠️  ${engineName.toUpperCase()} RESTORE REQUIRES MANUAL STEPS`, "warning");
        log("═══════════════════════════════════════════════════════════", "info");
        log("", "info");
        log(`${engineName} does not support remote RDB restore.`, "info");
        log("To complete the restore, follow these steps:", "info");
        log("", "info");
        log(`1. Stop the ${engineName} server`, "info");
        log(`2. Copy the backup file to: ${dataDir}/${rdbFilename}`, "info");
        log(`3. Ensure correct file permissions (${engineLower}:${engineLower})`, "info");
        log(`4. Start the ${engineName} server`, "info");
        log("", "info");

        // Format manual commands as collapsible details
        const systemdCommands = [
            `sudo systemctl stop ${engineLower}`,
            `sudo cp "${sourcePath}" ${dataDir}/${rdbFilename}`,
            `sudo chown ${engineLower}:${engineLower} ${dataDir}/${rdbFilename}`,
            `sudo systemctl start ${engineLower}`,
        ].join("\n");
        log("Systemd commands", "info", "command", systemdCommands);

        const dockerCommands = [
            `docker stop <${engineLower}-container>`,
            `docker cp "${sourcePath}" <${engineLower}-container>:/data/${rdbFilename}`,
            `docker start <${engineLower}-container>`,
        ].join("\n");
        log("Docker commands", "info", "command", dockerCommands);

        log("", "info");
        log("═══════════════════════════════════════════════════════════", "info");

        // Return success with instructions (the restore itself is manual)
        return {
            success: true,
            path: sourcePath,
            size: stats.size,
            logs,
            metadata: {
                requiresManualSteps: true,
                dataDir,
                rdbFilename,
            },
            startedAt,
            completedAt: new Date(),
        };
    } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        log(`Restore preparation failed: ${message}`, "error");
        return {
            success: false,
            logs,
            error: message,
            startedAt,
            completedAt: new Date(),
        };
    }
}
