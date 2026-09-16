import type { ExecutionHost } from "@/lib/transport";
import { BackupResult } from "@/lib/core/interfaces";
import { LogLevel, LogType } from "@/lib/core/logs";
import { REDIS_CLI, buildConnectionArgs } from "./args";
import { logger } from "@/lib/logging/logger";
import { RedisConfig } from "@/lib/adapters/definitions";
import { AdapterError } from "@/lib/logging/errors";

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
export async function prepareRestore(
    config: RedisRestoreConfig,
    _databases: string[],
    host: ExecutionHost,
): Promise<void> {
    const redisCli = await host.which(...REDIS_CLI);
    const args = buildConnectionArgs(config);

    const ping = await host.exec([redisCli, ...args, "PING"]);
    if (ping.code !== 0 || !ping.stdout.includes("PONG")) {
        const detail = ping.stderr.trim() || ping.stdout.trim();
        throw new Error(`Cannot connect to Redis/Valkey: ${detail}`);
    }

    // Best effort permission probe. ACL commands do not exist before Redis 6,
    // so a failure here is not a reason to stop.
    const whoami = await host.exec([redisCli, ...args, "ACL", "WHOAMI"]);
    if (whoami.code !== 0) return;

    const user = whoami.stdout.trim();
    if (user === "default") return;

    const aclList = await host.exec([redisCli, ...args, "ACL", "LIST"]);
    if (aclList.code !== 0) return;
    if (!aclList.stdout.includes("allcommands") && !aclList.stdout.includes("+flushall")) {
        log.warn("User may not have FLUSHALL permission", { user });
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
    host: ExecutionHost,
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
        const redisCli = await host.which(...REDIS_CLI);
        const args = buildConnectionArgs(config);
        let engineName = "Redis";
        const serverInfo = await host.exec([redisCli, ...args, "INFO", "server"]);
        if (serverInfo.code === 0 && /valkey_version:/.test(serverInfo.stdout)) {
            engineName = "Valkey";
        }
        const engineLower = engineName.toLowerCase();

        log(`Starting ${engineName} restore preparation...`, "info");

        // Verify the backup file exists
        const fs = await import("fs/promises");
        const stats = await fs.stat(sourcePath);
        log(`Backup file size: ${stats.size} bytes`, "info");

        // Where the server keeps its RDB, so the instructions name a real path.
        const dirResult = await host.exec([redisCli, ...args, "CONFIG", "GET", "dir"]);
        const dataDir = dirResult.stdout.trim().split("\n")[1] || `/var/lib/${engineLower}`;

        const nameResult = await host.exec([redisCli, ...args, "CONFIG", "GET", "dbfilename"]);
        const rdbFilename = nameResult.stdout.trim().split("\n")[1] || "dump.rdb";

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

/**
 * Counterpart to dumpOne. Redis cannot load an RDB remotely, so this runs the same manual
 * restore guidance as restore() and only throws when that preparation itself failed.
 */
export async function restoreOne(
    config: RedisRestoreConfig,
    filePath: string,
    _targetDbName: string,
    host: ExecutionHost,
    onLog?: (msg: string, level?: LogLevel, type?: LogType, details?: string) => void,
    onProgress?: (percentage: number, detail?: string) => void
): Promise<void> {
    const result = await restore(config, filePath, host, onLog, onProgress);
    if (!result.success) {
        throw new AdapterError("redis", "restore", result.error ?? "Restore preparation failed");
    }
}
