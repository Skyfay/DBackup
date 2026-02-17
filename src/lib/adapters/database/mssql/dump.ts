import { BackupResult } from "@/lib/core/interfaces";
import { LogLevel, LogType } from "@/lib/core/logs";
import { executeQuery, supportsCompression } from "./connection";
import { getDialect } from "./dialects";
import { MssqlSshTransfer, isSSHTransferEnabled } from "./ssh-transfer";
import fs from "fs/promises";
import { createReadStream, createWriteStream, existsSync } from "fs";
import path from "path";
import { pack } from "tar-stream";
import { pipeline } from "stream/promises";
import { MSSQLConfig } from "@/lib/adapters/definitions";

/**
 * Extended MSSQL config for dump operations with runtime fields
 */
type MSSQLDumpConfig = MSSQLConfig & {
    detectedVersion?: string;
    backupPath?: string;
    localBackupPath?: string;
};

/**
 * Dump MSSQL database(s) using native T-SQL BACKUP DATABASE
 *
 * NOTE: MSSQL backups are created on the SERVER filesystem, not locally.
 * File transfer modes:
 * 1. "local" - Shared filesystem (Docker volume mount, NFS, same host)
 * 2. "ssh"   - Download .bak files via SSH/SFTP from the remote SQL Server
 *
 * Config options:
 * - backupPath: Server-side path where MSSQL writes backups (default: /var/opt/mssql/backup)
 * - localBackupPath: Host-side path for local mode (Docker volume mount)
 * - sshHost/sshPort/sshUsername/...: SSH credentials for remote mode
 */
export async function dump(
    config: MSSQLDumpConfig,
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
        // Determine databases to backup
        let databases: string[] = [];
        if (Array.isArray(config.database)) {
            databases = config.database;
        } else if (config.database && config.database.includes(",")) {
            databases = config.database.split(",").map((s: string) => s.trim());
        } else if (config.database) {
            databases = [config.database];
        }

        if (databases.length === 0) {
            throw new Error("No database specified for backup");
        }

        const dialect = getDialect(config.detectedVersion);
        const serverBackupPath = config.backupPath || "/var/opt/mssql/backup";
        const useSSH = isSSHTransferEnabled(config);
        // localBackupPath is only used in local mode (Docker volume mount / shared filesystem)
        const localBackupPath = config.localBackupPath || "/tmp";

        if (useSSH) {
            log(`File transfer mode: SSH (remote server)`);
        } else {
            log(`File transfer mode: Local (shared filesystem)`);
            log(`Using backup paths - Server: ${serverBackupPath}, Local: ${localBackupPath}`);
        }

        // Check if compression is supported by this SQL Server edition
        const useCompression = await supportsCompression(config);
        if (useCompression) {
            log(`Compression enabled (supported by this SQL Server edition)`);
        } else {
            log(`Compression disabled (not supported by Express/Web editions)`);
        }

        // For multi-database backups, we'll create individual .bak files and combine them
        const tempFiles: { server: string; local: string }[] = [];
        let sshTransfer: MssqlSshTransfer | null = null;

        // Helper function to clean up temp files
        const cleanupTempFiles = async () => {
            for (const f of tempFiles) {
                await fs.unlink(f.local).catch(() => {});
            }
            // Also clean up remote .bak files when using SSH
            if (sshTransfer) {
                for (const f of tempFiles) {
                    await sshTransfer.deleteRemote(f.server).catch(() => {});
                }
                sshTransfer.end();
            }
        };

        try {
            for (const dbName of databases) {
                const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
                const bakFileName = `${dbName}_${timestamp}.bak`;
                const serverBakPath = path.posix.join(serverBackupPath, bakFileName);
                const localBakPath = useSSH
                    ? path.join("/tmp", bakFileName)  // SSH mode: always use /tmp locally
                    : path.join(localBackupPath, bakFileName);

                log(`Backing up database: ${dbName}`, "info", "command");

                // Generate backup query using dialect
                const backupQuery = dialect.getBackupQuery(dbName, serverBakPath, {
                    compression: useCompression,
                    stats: 10, // Report progress every 10%
                });

                log(`Executing backup`, "info", "command", backupQuery);

                // Execute backup command on the server
                await executeQuery(config, backupQuery);
                log(`Backup completed for: ${dbName}`);
                tempFiles.push({ server: serverBakPath, local: localBakPath });
            }

            // Retrieve .bak files - either via SSH or from local filesystem
            if (useSSH) {
                log(`Connecting via SSH to download backup file(s)...`);
                sshTransfer = new MssqlSshTransfer();
                await sshTransfer.connect(config);

                for (const f of tempFiles) {
                    log(`Downloading: ${f.server} → ${f.local}`);
                    await sshTransfer.download(f.server, f.local);
                    log(`Downloaded: ${path.basename(f.server)}`);
                }
            } else {
                // Local mode: verify files exist on the shared filesystem
                for (const f of tempFiles) {
                    if (!existsSync(f.local)) {
                        throw new Error(
                            `Backup file not found at ${f.local}. ` +
                            `Check that localBackupPath is configured correctly and matches your Docker volume mount or shared filesystem. ` +
                            `Alternatively, switch to SSH mode for remote SQL Servers.`
                        );
                    }
                }
            }

            // Copy backup file(s) to final destination
            if (tempFiles.length === 1) {
                // Single database - copy directly
                await copyFile(tempFiles[0].local, destinationPath);
                log(`Backup file copied to: ${destinationPath}`);
            } else {
                // Multiple databases - pack all .bak files into a tar archive
                // MSSQL cannot create multi-DB backups in a single file like MySQL
                log(`Packing ${tempFiles.length} backup files into archive...`);

                // Create tar archive containing all .bak files
                const tarPack = pack();
                const outputStream = createWriteStream(destinationPath);

                // Pipe tar to output file
                const pipelinePromise = pipeline(tarPack, outputStream);

                // Add each backup file to the archive
                for (const f of tempFiles) {
                    const fileName = path.basename(f.local);
                    const fileStats = await fs.stat(f.local);

                    // Create entry header
                    const entry = tarPack.entry({
                        name: fileName,
                        size: fileStats.size,
                    });

                    // Stream file contents to tar entry
                    const fileStream = createReadStream(f.local);
                    await new Promise<void>((resolve, reject) => {
                        fileStream.on("error", reject);
                        fileStream.on("end", () => {
                            entry.end();
                            resolve();
                        });
                        fileStream.pipe(entry);
                    });

                    log(`Added to archive: ${fileName}`);
                }

                // Finalize the archive
                tarPack.finalize();
                await pipelinePromise;

                log(`Archive created: ${destinationPath}`);
            }

            // Verify destination file
            const stats = await fs.stat(destinationPath);
            if (stats.size === 0) {
                throw new Error("Backup file is empty. Check permissions and disk space.");
            }

            const sizeMB = (stats.size / 1024 / 1024).toFixed(2);
            log(`Backup finished successfully. Size: ${sizeMB} MB`);

            return {
                success: true,
                path: destinationPath,
                size: stats.size,
                logs,
                startedAt,
                completedAt: new Date(),
            };
        } finally {
            // Always clean up temp .bak files (even on error/abort)
            await cleanupTempFiles();
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

/**
 * Copy file using streams (handles large files)
 */
async function copyFile(source: string, destination: string): Promise<void> {
    return new Promise((resolve, reject) => {
        const readStream = createReadStream(source);
        const writeStream = createWriteStream(destination);

        readStream.on("error", reject);
        writeStream.on("error", reject);
        writeStream.on("finish", resolve);

        readStream.pipe(writeStream);
    });
}
