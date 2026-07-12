import { BackupResult } from "@/lib/core/interfaces";
import { LogLevel, LogType } from "@/lib/core/logs";
import { FirebirdConfig } from "@/lib/adapters/definitions";
import { getGbakCommand } from "./tools";
import { resolveAliasPath, buildConnectionString } from "./connection";
import { spawn } from "child_process";
import fs from "fs/promises";
import { randomUUID } from "crypto";
import path from "path";
import { waitForProcess } from "@/lib/adapters/process";
import {
    isMultiDbTar,
    extractSelectedDatabases,
    createTempDir,
    cleanupTempDir,
    shouldRestoreDatabase,
    getTargetDatabaseName,
} from "../common/tar-utils";
import { formatBytes } from "@/lib/utils";
import {
    SshClient,
    isSSHMode,
    extractSshConfig,
    remoteEnv,
    remoteBinaryCheck,
    shellEscape,
} from "@/lib/ssh";

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
    onLog: (msg: string, level?: LogLevel, type?: LogType, details?: string) => void,
    onProgress?: (percentage: number, detail?: string) => void
): Promise<void> {
    if (isSSHMode(config)) {
        return restoreSingleFileSSH(config, sourcePath, targetPath, onLog, onProgress);
    }

    const connStr = buildConnectionString(config, targetPath);

    const args = ["-rep"];
    if (config.options) args.push(...config.options.split(" ").filter((s) => s.trim().length > 0));
    args.push("-user", config.user, sourcePath, connStr);

    onLog(`Restoring to: ${targetPath}`, "info", "command", `${getGbakCommand()} ${args.join(" ")}`);

    const env = { ...process.env, ISC_PASSWORD: config.password };
    const proc = spawn(getGbakCommand(), args, { env });
    await waitForProcess(proc, "gbak", (msg) => {
        const trimmed = msg.trim();
        if (trimmed) onLog(trimmed);
    });
    onProgress?.(100);
}

/**
 * SSH variant: upload the .fbk file to a remote temp location, then run gbak
 * on the target itself to restore into the local alias path.
 */
async function restoreSingleFileSSH(
    config: FirebirdRestoreConfig,
    sourcePath: string,
    targetPath: string,
    onLog: (msg: string, level?: LogLevel, type?: LogType, details?: string) => void,
    onProgress?: (percentage: number, detail?: string) => void
): Promise<void> {
    const stats = await fs.stat(sourcePath);
    const totalSize = stats.size;

    const sshConfig = extractSshConfig(config)!;
    const ssh = new SshClient();
    await ssh.connect(sshConfig);

    const remoteTempFile = `/tmp/dbackup_restore_${randomUUID()}.fbk`;

    try {
        const gbakBin = await remoteBinaryCheck(ssh, "gbak");
        const connStr = buildConnectionString(config, targetPath);

        onLog(`Uploading dump to remote server via SFTP (${(totalSize / 1024 / 1024).toFixed(1)} MB)...`, "info");
        const uploadStart = Date.now();
        await ssh.uploadFile(sourcePath, remoteTempFile, (transferred, total) => {
            if (onProgress && total > 0) {
                // Upload = 0-90% of total progress
                const uploadPercent = Math.round((transferred / total) * 90);
                const elapsed = (Date.now() - uploadStart) / 1000;
                const speed = elapsed > 0 ? transferred / elapsed : 0;
                onProgress(uploadPercent, `${formatBytes(transferred)} / ${formatBytes(total)} - ${formatBytes(speed)}/s`);
            }
        });
        onProgress?.(90);

        const argParts = ["-rep"];
        if (config.options) argParts.push(...config.options.split(" ").filter((s) => s.trim().length > 0));
        argParts.push("-user", shellEscape(config.user), shellEscape(remoteTempFile), shellEscape(connStr));

        const cmd = remoteEnv({ ISC_PASSWORD: config.password }, `${gbakBin} ${argParts.join(" ")}`);
        onLog(`Restoring to (SSH): ${targetPath}`, "info", "command", `${gbakBin} ${argParts.join(" ")}`);
        onProgress?.(95, "Executing restore command...");

        await new Promise<void>((resolve, reject) => {
            ssh.execStream(cmd, (err, stream) => {
                if (err) return reject(err);

                stream.on("data", () => {});

                stream.stderr.on("data", (data: any) => {
                    const msg = data.toString().trim();
                    if (msg) onLog(msg);
                });

                stream.on("exit", (code: number | null, signal?: string) => {
                    if (code === 0) {
                        onProgress?.(100);
                        resolve();
                    } else {
                        reject(new Error(`Remote gbak exited with code ${code ?? "null"}${signal ? ` (signal: ${signal})` : ""}`));
                    }
                });

                stream.on("error", (err: Error) => reject(err));
            });
        });
    } finally {
        await ssh.exec(`rm -f ${shellEscape(remoteTempFile)}`).catch(() => {});
        ssh.end();
    }
}

export async function restore(
    config: FirebirdRestoreConfig,
    sourcePath: string,
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

                    await restoreSingleFile(config, dbFile, targetPath, log, onProgress);
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

        await restoreSingleFile(config, sourcePath, targetPath, log, onProgress);

        return { success: true, logs, startedAt, completedAt: new Date() };
    } catch (error: unknown) {
        const msg = error instanceof Error ? error.message : String(error);
        log(`Error: ${msg}`, "error");
        return { success: false, logs, error: msg, startedAt, completedAt: new Date() };
    }
}
