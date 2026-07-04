import { BackupResult } from "@/lib/core/interfaces";
import { LogLevel, LogType } from "@/lib/core/logs";
import { FirebirdConfig } from "@/lib/adapters/definitions";
import { getGbakCommand } from "./tools";
import { resolveAliasPath, buildConnectionString } from "./connection";
import fs from "fs/promises";
import path from "path";
import { spawn } from "child_process";
import { createWriteStream } from "fs";
import {
    createMultiDbTar,
    createTempDir,
    cleanupTempDir,
} from "../common/tar-utils";
import { TarFileEntry } from "../common/types";
import {
    SshClient,
    isSSHMode,
    extractSshConfig,
    remoteEnv,
    remoteBinaryCheck,
    shellEscape,
} from "@/lib/ssh";

/** Extended config with runtime fields */
type FirebirdDumpConfig = FirebirdConfig & {
    detectedVersion?: string;
};

/**
 * Dump a single database alias to a file.
 */
async function dumpSingleDatabase(
    config: FirebirdDumpConfig,
    aliasName: string,
    destinationPath: string,
    onLog: (msg: string, level?: LogLevel, type?: LogType, details?: string) => void
): Promise<{ success: boolean; size: number }> {
    if (isSSHMode(config)) {
        return dumpSingleDatabaseSSH(config, aliasName, destinationPath, onLog);
    }

    const dbPath = resolveAliasPath(config, aliasName);
    const connStr = buildConnectionString(config, dbPath);

    const args = ["-b"];
    if (config.options) args.push(...config.options.split(" ").filter((s) => s.trim().length > 0));
    args.push("-user", config.user, connStr, destinationPath);

    onLog(`Dumping database: ${aliasName}`, "info", "command", `${getGbakCommand()} ${args.join(" ")}`);

    const env = { ...process.env, ISC_PASSWORD: config.password };

    await new Promise<void>((resolve, reject) => {
        const proc = spawn(getGbakCommand(), args, { env });
        proc.stderr.on("data", (data) => {
            const msg = data.toString().trim();
            if (msg) onLog(msg);
        });
        proc.on("close", (code) => {
            if (code === 0) resolve();
            else reject(new Error(`gbak exited with code ${code}`));
        });
        proc.on("error", (err) => reject(err));
    });

    const stats = await fs.stat(destinationPath);
    if (stats.size === 0) {
        throw new Error(`Dump file for ${aliasName} is empty. Check logs/permissions.`);
    }

    return { success: true, size: stats.size };
}

/**
 * SSH variant: run gbak on the remote server and stream output (via stdout) to a local file.
 */
async function dumpSingleDatabaseSSH(
    config: FirebirdDumpConfig,
    aliasName: string,
    destinationPath: string,
    onLog: (msg: string, level?: LogLevel, type?: LogType, details?: string) => void
): Promise<{ success: boolean; size: number }> {
    const sshConfig = extractSshConfig(config)!;
    const ssh = new SshClient();
    await ssh.connect(sshConfig);

    try {
        const gbakBin = await remoteBinaryCheck(ssh, "gbak");
        const dbPath = resolveAliasPath(config, aliasName);
        const connStr = buildConnectionString(config, dbPath); // bare local path in SSH mode

        const argParts = ["-b"];
        if (config.options) argParts.push(...config.options.split(" ").filter((s) => s.trim().length > 0));
        argParts.push("-user", shellEscape(config.user), shellEscape(connStr), "stdout");

        const cmd = remoteEnv({ ISC_PASSWORD: config.password }, `${gbakBin} ${argParts.join(" ")}`);
        onLog(`Dumping database (SSH): ${aliasName}`, "info", "command", `${gbakBin} ${argParts.join(" ")}`);

        const writeStream = createWriteStream(destinationPath);

        await new Promise<void>((resolve, reject) => {
            ssh.execStream(cmd, (err, stream) => {
                if (err) return reject(err);

                stream.pipe(writeStream);

                stream.stderr.on("data", (data: any) => {
                    const msg = data.toString().trim();
                    if (msg) onLog(msg);
                });

                stream.on("exit", (code: number | null, signal?: string) => {
                    if (code === 0) resolve();
                    else reject(new Error(`Remote gbak exited with code ${code ?? "null"}${signal ? ` (signal: ${signal})` : ""}`));
                });

                stream.on("error", (err: Error) => reject(err));
                writeStream.on("error", (err: Error) => reject(err));
            });
        });

        const stats = await fs.stat(destinationPath);
        if (stats.size === 0) {
            throw new Error(`Dump file for ${aliasName} is empty. Check logs/permissions.`);
        }

        return { success: true, size: stats.size };
    } finally {
        ssh.end();
    }
}

export async function dump(
    config: FirebirdDumpConfig,
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
            const result = await dumpSingleDatabase(config, aliases[0], destinationPath, log);

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

                await dumpSingleDatabase(config, aliasName, dbFilePath, log);

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
