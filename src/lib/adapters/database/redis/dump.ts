import { BackupResult } from "@/lib/core/interfaces";
import { LogLevel, LogType } from "@/lib/core/logs";
import { spawn } from "child_process";
import fs from "fs/promises";
import { buildConnectionArgs } from "./connection";

/**
 * Dump Redis database using RDB snapshot
 *
 * Uses `redis-cli --rdb` to download the RDB file directly from the server.
 * This is the recommended method for remote backups.
 *
 * Note: RDB contains ALL databases (0-15), not just the selected one.
 */
export async function dump(
    config: any,
    destinationPath: string,
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
        log("Starting Redis RDB backup...", "info");

        // Build connection args
        const args = buildConnectionArgs(config);

        // Add --rdb flag with destination path
        args.push("--rdb", destinationPath);

        // Mask password in logs
        const logArgs = args.map(arg => {
            if (arg === config.password) return "******";
            return arg;
        });
        const command = `redis-cli ${logArgs.join(" ")}`;
        log("Executing redis-cli", "info", "command", command);

        // Execute redis-cli --rdb
        const rdbProcess = spawn("redis-cli", args);

        let stderr = "";

        rdbProcess.stderr.on("data", (data) => {
            stderr += data.toString();
        });

        rdbProcess.stdout.on("data", (data) => {
            const msg = data.toString().trim();
            if (msg) log(msg, "info");
        });

        // Wait for process to complete
        await new Promise<void>((resolve, reject) => {
            rdbProcess.on("close", (code) => {
                if (code === 0) {
                    resolve();
                } else {
                    reject(new Error(`redis-cli exited with code ${code}: ${stderr}`));
                }
            });
            rdbProcess.on("error", reject);
        });

        // Verify the dump file exists and has content
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
