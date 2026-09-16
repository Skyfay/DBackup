import path from "path";
import { DatabaseAdapter } from "@/lib/core/interfaces";
import type { ExecutionHost } from "@/lib/transport";
import { AdapterError } from "@/lib/logging/errors";

export const prepareRestore: NonNullable<DatabaseAdapter["prepareRestore"]> = async () => {
    // SQLite needs no preparation: the restore replaces a single file.
};

/**
 * Move the current database aside before it is replaced.
 *
 * The direct path used fs calls and the SSH path an inline `if [ -f ... ]` shell
 * construct with a `$(date +%s)` suffix. Both are now the same argv commands
 * with the timestamp computed here, so the two modes cannot drift apart.
 */
async function backupExisting(
    host: ExecutionHost,
    dbPath: string,
    log: (msg: string) => void,
): Promise<void> {
    const existing = await host.stat(dbPath);
    if (!existing) {
        log("No existing database to back up.");
        return;
    }

    const backupPath = `${dbPath}.bak-${Date.now()}`;
    log(`Backing up existing database to ${backupPath}`);

    const copied = await host.exec(["cp", dbPath, backupPath]);
    if (copied.code !== 0) {
        throw new Error(`Could not back up the existing database: ${copied.stderr.trim()}`);
    }

    log("Removing existing database file before restore...");
    const removed = await host.exec(["rm", "-f", dbPath]);
    if (removed.code !== 0) {
        throw new Error(`Could not remove the existing database: ${removed.stderr.trim()}`);
    }
}

// LEGACY-FORMAT(read): Part of DatabaseAdapter.restore, which only older backups reach.
// restoreOne() wraps it, so move the body into restoreOne() when restore() leaves the interface.
export const restore: DatabaseAdapter["restore"] = async (config, sourcePath, host, onLog, onProgress) => {
    const startedAt = new Date();
    const logs: string[] = [];

    const log = (msg: string) => {
        logs.push(msg);
        if (onLog) onLog(msg);
    };

    try {
        if (!host) {
            throw new Error("SQLite adapter requires an execution host. Call it through withHost().");
        }

        const dbPath = config.path as string;
        const binary = await host.which((config.sqliteBinaryPath as string) || "sqlite3");

        log(`Starting SQLite restore of ${dbPath}...`);
        await backupExisting(host, dbPath, log);

        // `.restore` reads from a path, so the backup file is staged onto the
        // execution host. On a direct host that is the original file, no copy.
        await host.stageInput(sourcePath, {}, async (stagedPath) => {
            onProgress?.(50);

            const argv = [binary, dbPath, `.restore ${stagedPath}`];
            log(`Executing: ${argv.join(" ")}`);

            const result = await host.exec(argv);
            if (result.code !== 0) {
                throw new Error(
                    `SQLite restore failed with code ${result.code}: ${result.stderr.trim() || result.stdout.trim()}`,
                );
            }
            if (result.stderr.trim()) {
                log(`[SQLite Stderr]: ${result.stderr.trim()}`);
            }
        });

        onProgress?.(100);
        log("Restore completed successfully.");

        return { success: true, logs, startedAt, completedAt: new Date() };
    } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        log(`Error during restore: ${message}`);
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
 * Where a restore of this source lands, given a target name from the restore dialog.
 *
 * A SQLite source is one file and its database name is that file's name, so a different
 * target name means a sibling file in the same directory. The same rule the classic restore
 * pipeline applies. A name that is not a plain filename is refused, since it would place
 * the file somewhere the source was never configured to write.
 */
export function resolveSqliteTargetPath(configPath: string, targetDbName: string | undefined, originalDbName: string | undefined): string {
    if (!targetDbName || targetDbName === originalDbName || targetDbName === path.basename(configPath)) {
        return configPath;
    }
    if (/[/\\]/.test(targetDbName) || targetDbName === "." || targetDbName === "..") {
        throw new Error(`Invalid SQLite target name '${targetDbName}': expected a file name without a directory`);
    }
    return path.join(path.dirname(configPath), targetDbName);
}

/** Restores a snapshot produced by dumpOne, thrown on failure as the archive restore expects. */
export const restoreOne: NonNullable<DatabaseAdapter["restoreOne"]> = async (
    config, filePath, targetDbName, host, onLog, onProgress, originalDbName
) => {
    const targetPath = resolveSqliteTargetPath(config.path as string, targetDbName, originalDbName);
    const result = await restore({ ...config, path: targetPath }, filePath, host, onLog, onProgress);
    if (!result.success) {
        throw new AdapterError("sqlite", "restore", result.error ?? "SQLite restore failed");
    }
};
