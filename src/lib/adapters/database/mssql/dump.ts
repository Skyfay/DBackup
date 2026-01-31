import { BackupResult } from "@/lib/core/interfaces";
import { LogLevel, LogType } from "@/lib/core/logs";
import { executeQuery } from "./connection";
import { getDialect } from "./dialects";
import fs from "fs/promises";
import { createReadStream, createWriteStream } from "fs";
import path from "path";

/**
 * Dump MSSQL database(s) using native T-SQL BACKUP DATABASE
 *
 * NOTE: MSSQL backups are created on the SERVER filesystem, not locally.
 * This requires either:
 * 1. A shared volume between the app and MSSQL server (Docker)
 * 2. The backup path being accessible to this application
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
        const backupPath = config.backupPath || "/var/opt/mssql/backup";

        // For multi-database backups, we'll create individual .bak files and combine them
        const tempFiles: string[] = [];

        for (const dbName of databases) {
            const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
            const bakFileName = `${dbName}_${timestamp}.bak`;
            const serverBakPath = path.posix.join(backupPath, bakFileName);

            log(`Backing up database: ${dbName}`, "info", "command");

            // Generate backup query using dialect
            const backupQuery = dialect.getBackupQuery(dbName, serverBakPath, {
                compression: true,
                stats: 10, // Report progress every 10%
            });

            log(`Executing backup`, "info", "command", backupQuery);

            try {
                // Execute backup command on the server
                await executeQuery(config, backupQuery);
                log(`Backup completed for: ${dbName}`);
                tempFiles.push(serverBakPath);
            } catch (error: any) {
                log(`Backup failed for ${dbName}: ${error.message}`, "error");
                throw error;
            }
        }

        // Copy backup file(s) from server path to destination
        // This assumes the backup path is accessible to the application (e.g., shared volume)
        if (tempFiles.length === 1) {
            // Single database - copy directly
            const sourcePath = tempFiles[0];
            try {
                await copyFile(sourcePath, destinationPath);
                log(`Backup file copied to: ${destinationPath}`);

                // Clean up server-side backup
                await fs.unlink(sourcePath).catch(() => {});
            } catch (_copyError: any) {
                log(`Warning: Could not copy backup file. It may still be at: ${sourcePath}`, "warning");
                // Return the server path if local copy failed
                return {
                    success: true,
                    path: sourcePath,
                    logs,
                    startedAt,
                    completedAt: new Date(),
                    metadata: { serverPath: sourcePath }
                };
            }
        } else {
            // Multiple databases - for now, use the first one
            // TODO: Implement tar/archive combining multiple .bak files
            const sourcePath = tempFiles[0];
            try {
                await copyFile(sourcePath, destinationPath);
                log(`Backup file copied to: ${destinationPath}`);

                // Store metadata about all backup files
                // Clean up
                for (const f of tempFiles) {
                    await fs.unlink(f).catch(() => {});
                }
            } catch (_copyError: any) {
                log(`Warning: Multi-DB backup files at server: ${tempFiles.join(", ")}`, "warning");
            }
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
    } catch (error: any) {
        log(`Error: ${error.message}`, "error");
        return {
            success: false,
            logs,
            error: error.message,
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
