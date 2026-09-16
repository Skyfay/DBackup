import type { ExecutionHost } from "@/lib/transport";
import { BackupResult } from "@/lib/core/interfaces";
import { LogLevel, LogType } from "@/lib/core/logs";
import { FirebirdConfig } from "@/lib/adapters/definitions";
import { getGbakCommand } from "./tools";
import { resolveAliasPath, buildConnectionString } from "./connection";
import fs from "fs/promises";
import path from "path";
import {
    createMultiDbTar,
    createTempDir,
    cleanupTempDir,
} from "../common/tar-utils";
import { TarFileEntry } from "../common/types";

/** Extended config with runtime fields */
type FirebirdDumpConfig = FirebirdConfig & {
    detectedVersion?: string;
};

/**
 * Dump a single database alias to a file.
 *
 * gbak writes to a path rather than to stdout, so the destination is requested
 * from the transport: on a direct host that is the final path, over SSH it is a
 * remote temp file whose bytes are fetched and cleaned up afterwards. The SSH
 * path used to ask gbak for "stdout" instead, which is a different gbak mode.
 */
async function dumpSingleDatabase(
    config: FirebirdDumpConfig,
    aliasName: string,
    destinationPath: string,
    host: ExecutionHost,
    onLog: (msg: string, level?: LogLevel, type?: LogType, details?: string) => void
): Promise<{ success: boolean; size: number }> {
    const gbak = await getGbakCommand(host);
    const dbPath = resolveAliasPath(config, aliasName);
    const connStr = buildConnectionString(config, dbPath);

    await host.captureOutput(destinationPath, {}, async (hostPath) => {
        const args = ["-b"];
        if (config.options) args.push(...config.options.split(" ").filter((s) => s.trim().length > 0));
        args.push("-user", config.user, connStr, hostPath);

        onLog(`Dumping database: ${aliasName}`, "info", "command", `${gbak} ${args.join(" ")}`);

        const proc = await host.spawn([gbak, ...args], { env: { ISC_PASSWORD: config.password } });
        proc.stderr.on("data", (data: Buffer) => {
            const msg = data.toString().trim();
            if (msg) onLog(msg);
        });

        const { code, signal } = await proc.exit();
        if (code !== 0) {
            throw new Error(`gbak exited with code ${code ?? "null"}${signal ? ` (signal: ${signal})` : ""}`);
        }
    });

    const stats = await fs.stat(destinationPath);
    if (stats.size === 0) {
        throw new Error(`Dump file for ${aliasName} is empty. Check logs/permissions.`);
    }

    return { success: true, size: stats.size };
}

/**
 * Capability export for combined DB+directory backups (JobSource): dumps exactly one
 * database alias to a plain file, without any TAR/manifest wrapping. Thin wrapper around the
 * same per-alias logic dump() already uses internally for its own multi-DB case.
 */
export async function dumpOne(
    config: FirebirdDumpConfig,
    dbName: string,
    destinationPath: string,
    _host: ExecutionHost,
    onLog?: (msg: string, level?: LogLevel, type?: LogType, details?: string) => void
): Promise<{ size: number }> {
    const result = await dumpSingleDatabase(config, dbName, destinationPath, _host, onLog ?? (() => {}));
    return { size: result.size };
}

// LEGACY-FORMAT(write): Writes a backup in the format used before the seekable archive.
// No job calls it anymore, only tests do. Remove it together with DatabaseAdapter.dump.
export async function dump(
    config: FirebirdDumpConfig,
    destinationPath: string,
    _host: ExecutionHost,
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
        // Determine which alias(es) to back up
        let aliases: string[] = [];
        if (Array.isArray(config.database)) aliases = config.database;
        else if (config.database && config.database.includes(",")) aliases = config.database.split(",");
        else if (config.database) aliases = [config.database];

        if (aliases.length === 0) {
            log("No database aliases selected - backing up all configured aliases");
            aliases = (config.databases || []).map((d) => d.name);
        }

        if (aliases.length === 0) {
            throw new Error("No database aliases configured");
        }

        // Single alias: direct .fbk dump (no TAR needed)
        if (aliases.length === 1) {
            const result = await dumpSingleDatabase(config, aliases[0], destinationPath, _host, log);

            const sizeMB = (result.size / 1024 / 1024).toFixed(2);
            log(`Dump finished successfully. Size: ${sizeMB} MB`);

            return {
                success: true,
                path: destinationPath,
                size: result.size,
                logs,
                startedAt,
                completedAt: new Date(),
            };
        }

        // Multiple aliases: dump each separately, then pack into TAR
        log(`Multi-database backup: ${aliases.length} databases`);

        const tempDir = await createTempDir("firebird-multidb-");
        const dbFiles: TarFileEntry[] = [];

        try {
            for (const aliasName of aliases) {
                const dbFileName = `${aliasName}.fbk`;
                const dbFilePath = path.join(tempDir, dbFileName);

                await dumpSingleDatabase(config, aliasName, dbFilePath, _host, log);

                dbFiles.push({
                    name: dbFileName,
                    path: dbFilePath,
                    dbName: aliasName,
                    format: "fbk",
                });

                log(`Completed dump for: ${aliasName}`);
            }

            log(`Creating TAR archive with ${dbFiles.length} databases...`);
            const manifest = await createMultiDbTar(dbFiles, destinationPath, {
                sourceType: "firebird",
                engineVersion: config.detectedVersion,
            });

            const stats = await fs.stat(destinationPath);
            const sizeMB = (stats.size / 1024 / 1024).toFixed(2);
            log(`Multi-DB backup finished successfully. Size: ${sizeMB} MB`);

            return {
                success: true,
                path: destinationPath,
                size: stats.size,
                logs,
                startedAt,
                completedAt: new Date(),
                metadata: {
                    multiDb: {
                        format: "tar",
                        databases: manifest.databases.map((d) => d.name),
                    },
                },
            };
        } finally {
            await cleanupTempDir(tempDir);
        }
    } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        log(`Error: ${message}`, "error");
        return {
            success: false,
            logs,
            error: message,
            startedAt,
            completedAt: new Date(),
        };
    }
}
