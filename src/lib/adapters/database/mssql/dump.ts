import { BackupResult } from "@/lib/core/interfaces";
import { LogLevel, LogType } from "@/lib/core/logs";
import { executeQuery, supportsCompression } from "./connection";
import { getDialect } from "./dialects";
import fs from "fs/promises";
import { createReadStream, createWriteStream, existsSync } from "fs";
import path from "path";
import { pack } from "tar-stream";
import { pipeline } from "stream/promises";

/**
 * Dump MSSQL database(s) using native T-SQL BACKUP DATABASE
 *
 * NOTE: MSSQL backups are created on the SERVER filesystem, not locally.
 * This requires either:
 * 1. A shared volume between the app and MSSQL server (Docker)
 * 2. The backup path being accessible to this application
 *
 * Config options:
 * - backupPath: Server-side path where MSSQL writes backups (default: /var/opt/mssql/backup)
 * - localBackupPath: Optional host-side path if different from backupPath (e.g., Docker volume mount)
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
        // localBackupPath is where the host can access the backup files (Docker volume mount)
        // Default to /tmp which is the standard mount in our docker-compose
        const localBackupPath = config.localBackupPath || "/tmp";

        log(`Using backup paths - Server: ${serverBackupPath}, Local: ${localBackupPath}`);

        // Check if compression is supported by this SQL Server edition
        const useCompression = await supportsCompression(config);
        if (useCompression) {
            log(`Compression enabled (supported by this SQL Server edition)`);
        } else {
            log(`Compression disabled (not supported by Express/Web editions)`);
        }

        // For multi-database backups, we'll create individual .bak files and combine them
        const tempFiles: { server: string; local: string }[] = [];

        // Helper function to clean up temp files
        const cleanupTempFiles = async () => {
            for (const f of tempFiles) {
                await fs.unlink(f.local).catch(() => {});
            }
        };

        try {
            for (const dbName of databases) {
                const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
                const bakFileName = `${dbName}_${timestamp}.bak`;
                const serverBakPath = path.posix.join(serverBackupPath, bakFileName);
                const localBakPath = path.join(localBackupPath, bakFileName);

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

            // Copy backup file(s) from local backup path to destination
            // The local backup path corresponds to the mounted volume on the host
            if (tempFiles.length === 1) {
                // Single database - copy directly
                const localSourcePath = tempFiles[0].local;
                const serverSourcePath = tempFiles[0].server;

                // Verify source file exists
                if (!existsSync(localSourcePath)) {
                    throw new Error(`Backup file not found at ${localSourcePath}. Check that localBackupPath is configured correctly and matches the Docker volume mount.`);
                }

                try {
                    await copyFile(localSourcePath, destinationPath);
                    log(`Backup file copied to: ${destinationPath}`);
                } catch (copyError: unknown) {
                    const message = copyError instanceof Error ? copyError.message : String(copyError);
                    log(`Warning: Could not copy backup file from ${localSourcePath}: ${message}`, "warning");
                    // Return the server path if local copy failed
                    return {
                        success: true,
                        path: serverSourcePath,
                        logs,
                        startedAt,
                        completedAt: new Date(),
                        metadata: { serverPath: serverSourcePath, localPath: localSourcePath }
                    };
                }
            } else {
                // Multiple databases - pack all .bak files into a tar archive
                // MSSQL cannot create multi-DB backups in a single file like MySQL
                log(`Packing ${tempFiles.length} backup files into archive...`);

                // Verify all source files exist first
                for (const f of tempFiles) {
                    if (!existsSync(f.local)) {
                        throw new Error(`Backup file not found at ${f.local}. Check that localBackupPath is configured correctly and matches the Docker volume mount.`);
                    }
                }

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
