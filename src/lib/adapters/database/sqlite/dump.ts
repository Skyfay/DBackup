import { AdapterError } from "@/lib/logging/errors";
import { DatabaseAdapter } from "@/lib/core/interfaces";
import { LogLevel, LogType } from "@/lib/core/logs";
import fs from "fs/promises";
import { getDatabases } from "./connection";

/**
 * SQLite backup via the sqlite3 `.backup` dot command, which takes a consistent
 * online snapshot rather than dumping SQL text.
 *
 * `.backup` writes to a path, so the destination is requested from the
 * transport: on a direct host that is the final file, over SSH it is a remote
 * temp file whose bytes are fetched and cleaned up afterwards. The SSH path used
 * to do that by hand and then stream the file back with `cat`.
 */
// LEGACY-FORMAT(write): Part of DatabaseAdapter.dump, which no job calls anymore. dumpOne()
// wraps it, so move the body into dumpOne() when dump() leaves the interface.
export const dump: DatabaseAdapter["dump"] = async (config, destinationPath, host, onLog, onProgress) => {
    const startedAt = new Date();
    const logs: string[] = [];

    const log = (msg: string, level: LogLevel = "info", type: LogType = "general", details?: string) => {
        logs.push(msg);
        if (onLog) onLog(msg, level, type, details);
    };

    try {
        if (!host) {
            throw new Error("SQLite adapter requires an execution host. Call it through withHost().");
        }

        const dbPath = config.path as string;
        const binary = await host.which((config.sqliteBinaryPath as string) || "sqlite3");

        log(`Starting SQLite dump of ${dbPath}...`);

        await host.captureOutput(destinationPath, {}, async (hostPath) => {
            const argv = [binary, dbPath, `.backup ${hostPath}`];
            log(`Dumping database: ${dbPath}`, "info", "command", argv.join(" "));

            const result = await host.exec(argv);
            if (result.code !== 0) {
                throw new Error(
                    `sqlite3 exited with code ${result.code}: ${result.stderr.trim() || result.stdout.trim()}`,
                );
            }
            if (result.stderr.trim()) {
                log(`[SQLite Stderr]: ${result.stderr.trim()}`);
            }
        });

        const stats = await fs.stat(destinationPath);
        onProgress?.(100);
        log(`Dump completed successfully (${stats.size} bytes).`);

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
        log(`Error during dump: ${message}`);
        return {
            success: false,
            error: message,
            logs,
            startedAt,
            completedAt: new Date(),
        };
    }
};

/**
 * The single entry a SQLite source backs up. The file is the database, so its name is the
 * only entry there is, whatever the job's selection says.
 */
export const listDumpEntries: NonNullable<DatabaseAdapter["listDumpEntries"]> = async (config, _selected, host) => {
    return getDatabases(config, host);
};

/** Snapshot of the configured file, thrown on failure as the seekable archive writer expects. */
export const dumpOne: NonNullable<DatabaseAdapter["dumpOne"]> = async (config, _dbName, destinationPath, host, onLog) => {
    const result = await dump(config, destinationPath, host, onLog);
    if (!result.success) {
        throw new AdapterError("sqlite", "dump", result.error ?? "SQLite dump failed");
    }
    return { size: result.size ?? 0 };
};
