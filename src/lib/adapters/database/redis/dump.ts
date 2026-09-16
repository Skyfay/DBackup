import type { ExecutionHost } from "@/lib/transport";
import { BackupResult } from "@/lib/core/interfaces";
import { LogLevel, LogType } from "@/lib/core/logs";
import fs from "fs/promises";
import { RedisConfig } from "@/lib/adapters/definitions";
import { REDIS_CLI, buildConnectionArgs, maskSecrets } from "./args";
import { REDIS_SNAPSHOT_ENTRY } from "./constants";
import { AdapterError } from "@/lib/logging/errors";

/**
 * Dump Redis using an RDB snapshot.
 *
 * `redis-cli --rdb` writes to a file rather than stdout, so the destination is
 * requested from the transport: on a direct host that is the final path, over
 * SSH it is a remote temp file whose bytes are fetched and cleaned up afterwards.
 *
 * Note: the RDB contains ALL databases (0-15), not only the selected one.
 */
export async function dump(
    config: RedisConfig,
    destinationPath: string,
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
        if (!host) {
            throw new Error("Redis adapter requires an execution host. Call it through withHost().");
        }

        log("Starting Redis RDB backup...", "info");

        const redisCli = await host.which(...REDIS_CLI);
        const args = buildConnectionArgs(config);

        await host.captureOutput(destinationPath, {}, async (hostPath) => {
            const argv = [redisCli, ...args, "--rdb", hostPath];
            log("Executing redis-cli", "info", "command", maskSecrets(argv, config.password));

            const result = await host.exec(argv);
            if (result.code !== 0) {
                const detail = result.stderr.trim() || result.stdout.trim();
                throw new Error(`redis-cli exited with code ${result.code}: ${detail}`);
            }
            if (result.stdout.trim()) {
                log(result.stdout.trim(), "info");
            }
        });

        const stats = await fs.stat(destinationPath);
        if (stats.size === 0) {
            throw new Error("RDB dump file is empty");
        }

        log(`RDB backup completed successfully (${stats.size} bytes)`, "success");

        return {
            success: true,
            path: destinationPath,
            size: stats.size,
            logs,
            startedAt,
            completedAt: new Date(),
        };
    } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        log(`Backup failed: ${message}`, "error");
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
 * A Redis backup is always one snapshot of the whole server, whichever logical databases
 * the job selected, so it is always exactly one entry.
 */
export async function listDumpEntries(): Promise<string[]> {
    return [REDIS_SNAPSHOT_ENTRY];
}

/** RDB snapshot of the whole server, thrown on failure as the seekable archive writer expects. */
export async function dumpOne(
    config: RedisConfig,
    _dbName: string,
    destinationPath: string,
    host: ExecutionHost,
    onLog?: (msg: string, level?: LogLevel, type?: LogType, details?: string) => void
): Promise<{ size: number }> {
    const result = await dump(config, destinationPath, host, onLog);
    if (!result.success) {
        throw new AdapterError("redis", "dump", result.error ?? "RDB backup failed");
    }
    return { size: result.size ?? 0 };
}
