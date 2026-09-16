import type { ExecutionHost } from "@/lib/transport";
import { BackupResult } from "@/lib/core/interfaces";
import { LogLevel, LogType } from "@/lib/core/logs";
import { FirebirdConfig } from "@/lib/adapters/definitions";
import { getGbakCommand } from "./tools";
import { resolveAliasPath, buildConnectionString } from "./connection";
import fs from "fs/promises";
import path from "path";
import {
    isMultiDbTar,
    extractSelectedDatabases,
    createTempDir,
    cleanupTempDir,
    shouldRestoreDatabase,
    getTargetDatabaseName,
} from "../common/tar-utils";
import { formatBytes } from "@/lib/utils";

/** Extended config with runtime fields for restore operations */
type FirebirdRestoreConfig = FirebirdConfig & {
    detectedVersion?: string;
    /** Literal target path, set by the restore pipeline when the user typed one into the target field. */
    targetDatabaseName?: string;
    databaseMapping?: { originalName: string; targetName: string; selected: boolean }[];
};

/**
 * Restore a single .fbk file to a target path.
 * gbak -rep creates the database if the path doesn't exist yet, or replaces
 * it in place if it does - so no separate create-vs-replace branch is needed
 * (confirmed default: always replace, no extra confirmation). The target is
 * always a literal filesystem path here - see restore() for how it's derived
 * (either the user-provided target field, or the originally configured alias).
 */
async function restoreSingleFile(
    config: FirebirdRestoreConfig,
    sourcePath: string,
    targetPath: string,
    host: ExecutionHost,
    onLog: (msg: string, level?: LogLevel, type?: LogType, details?: string) => void,
    onProgress?: (percentage: number, detail?: string) => void
): Promise<void> {
    const gbak = await getGbakCommand(host);
    const connStr = buildConnectionString(config, targetPath);
    const { size: totalSize } = await fs.stat(sourcePath);
    const transferStart = Date.now();

    // gbak reads the backup from a path, so it is staged onto the execution
    // host. On a direct host that is the original file with no copy at all.
    await host.stageInput(
        sourcePath,
        {
            onProgress: (transferred) => {
                if (!onProgress || totalSize <= 0) return;
                // Staging occupies the first 90% of the reported progress.
                const percent = Math.min(90, Math.round((transferred / totalSize) * 90));
                const elapsed = (Date.now() - transferStart) / 1000;
                const speed = elapsed > 0 ? transferred / elapsed : 0;
                onProgress(percent, `${formatBytes(transferred)} / ${formatBytes(totalSize)} - ${formatBytes(speed)}/s`);
            },
        },
        async (stagedPath) => {
            const args = ["-rep"];
            if (config.options) args.push(...config.options.split(" ").filter((s) => s.trim().length > 0));
            args.push("-user", config.user, stagedPath, connStr);

            onLog(`Restoring to: ${targetPath}`, "info", "command", `${gbak} ${args.join(" ")}`);
            onProgress?.(95, "Executing restore command...");

            const proc = await host.spawn([gbak, ...args], { env: { ISC_PASSWORD: config.password } });
            proc.stderr.on("data", (data: Buffer) => {
                const msg = data.toString().trim();
                if (msg) onLog(msg);
            });

            const { code, signal } = await proc.exit();
            if (code !== 0) {
                throw new Error(`gbak exited with code ${code ?? "null"}${signal ? ` (signal: ${signal})` : ""}`);
            }
            onProgress?.(100);
        },
    );
}

/**
 * Capability export for combined DB+directory restores (JobSource): restores a single .fbk
 * file into a single target path. Thin wrapper around restoreSingleFile, the same per-alias
 * logic restore() already uses internally for its own multi-DB case.
 */
export async function restoreOne(
    config: FirebirdRestoreConfig,
    filePath: string,
    targetDbName: string,
    _host: ExecutionHost,
    onLog?: (msg: string, level?: LogLevel, type?: LogType, details?: string) => void,
    onProgress?: (percentage: number, detail?: string) => void
): Promise<void> {
    await restoreSingleFile(config, filePath, targetDbName, _host, onLog ?? (() => {}), onProgress);
}

// LEGACY-FORMAT(read): Restores backups written before the seekable archive, a single dump
// file or a TAR of dumps. New backups go through restoreOne(). Remove once those backups no
// longer need restoring.
export async function restore(
    config: FirebirdRestoreConfig,
    sourcePath: string,
    _host: ExecutionHost,
    onLog?: (msg: string, level?: LogLevel, type?: LogType, details?: string) => void,
    onProgress?: (percentage: number, detail?: string) => void
): Promise<BackupResult> {
    const startedAt = new Date();
    const logs: string[] = [];
    const log = (msg: string, level: LogLevel = "info", type: LogType = "general", details?: string) => {
        logs.push(msg);
        if (onLog) onLog(msg, level, type, details);
    };

    try {
        const dbMapping = config.databaseMapping;

        // Check if this is a Multi-DB TAR archive
        if (await isMultiDbTar(sourcePath)) {
            log(`Detected Multi-DB TAR archive`);

            const tempDir = await createTempDir("firebird-restore-");

            try {
                const selectedNames = dbMapping
                    ? dbMapping.filter((m) => m.selected).map((m) => m.originalName)
                    : [];

                const { manifest, files } = await extractSelectedDatabases(sourcePath, tempDir, selectedNames);
                log(`Archive contains ${manifest.databases.length} database(s): ${manifest.databases.map((d) => d.name).join(", ")}`);
                if (selectedNames.length > 0) {
                    log(`Selectively extracted ${files.length} of ${manifest.databases.length} database(s)`);
                }

                let restoredCount = 0;

                for (const dbEntry of manifest.databases) {
                    if (!shouldRestoreDatabase(dbEntry.name, dbMapping)) {
                        continue;
                    }

                    // targetName is a literal filesystem path here, not an alias name - the
                    // restore UI prefills it with the source alias's configured path, but the
                    // user can edit it to any path (no live server query to verify against).
                    const targetPath = getTargetDatabaseName(dbEntry.name, dbMapping);
                    const dbFile = files.find((f) => path.basename(f) === dbEntry.filename);

                    if (!dbFile) {
                        throw new Error(`Database file not found in archive: ${dbEntry.filename}`);
                    }

                    await restoreSingleFile(config, dbFile, targetPath, _host, log, onProgress);
                    log(`Restored database: ${dbEntry.name} → ${targetPath}`);
                    restoredCount++;
                }

                log(`Multi-DB restore completed: ${restoredCount} database(s) restored`);

                return { success: true, logs, startedAt, completedAt: new Date() };
            } finally {
                await cleanupTempDir(tempDir);
            }
        }

        // Single-DB restore. `config.targetDatabaseName` is set by the restore pipeline
        // only when the user typed something into the target field - and that's always a
        // literal path now (the field is prefilled with one, not an alias name). When the
        // field was left empty, fall back to resolving the originally configured alias.
        let targetPath: string;

        if (dbMapping && dbMapping.length > 0) {
            const selected = dbMapping.filter((m) => m.selected);
            if (selected.length === 0) {
                throw new Error("No databases selected for restore");
            }
            targetPath = selected[0].targetName || selected[0].originalName;
        } else if (config.targetDatabaseName) {
            targetPath = config.targetDatabaseName;
        } else if (config.database) {
            const aliasName = Array.isArray(config.database) ? config.database[0] : config.database;
            targetPath = resolveAliasPath(config, aliasName);
        } else {
            throw new Error("No target database specified for restore");
        }

        await restoreSingleFile(config, sourcePath, targetPath, _host, log, onProgress);

        return { success: true, logs, startedAt, completedAt: new Date() };
    } catch (error: unknown) {
        const msg = error instanceof Error ? error.message : String(error);
        log(`Error: ${msg}`, "error");
        return { success: false, logs, error: msg, startedAt, completedAt: new Date() };
    }
}
