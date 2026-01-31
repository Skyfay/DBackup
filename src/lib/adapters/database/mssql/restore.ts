import { BackupResult } from "@/lib/core/interfaces";
import { LogLevel, LogType } from "@/lib/core/logs";
import { executeQuery } from "./connection";
import { getDialect } from "./dialects";
import fs from "fs/promises";
import { createReadStream, createWriteStream } from "fs";
import path from "path";

/**
 * Prepare restore by validating target databases
 */
export async function prepareRestore(config: any, databases: string[]): Promise<void> {
    // Check if target databases can be created/overwritten
    for (const dbName of databases) {
        // Validate database name (prevent SQL injection)
        if (!/^[a-zA-Z0-9_]+$/.test(dbName)) {
            throw new Error(`Invalid database name: ${dbName}`);
        }

        try {
            // Check if database exists and if we can access it
            const result = await executeQuery(
                config,
                `SELECT state_desc FROM sys.databases WHERE name = '${dbName}'`
            );

            if (result.recordset.length > 0) {
                const state = result.recordset[0].state_desc;
                if (state !== "ONLINE") {
                    throw new Error(`Database '${dbName}' is not online (state: ${state})`);
                }
                // Database exists and is online - will be overwritten
            }
            // Database doesn't exist - will be created
        } catch (error: any) {
            if (error.message.includes("Invalid database name")) {
                throw error;
            }
            // Connection/permission errors
            throw new Error(`Cannot prepare restore for '${dbName}': ${error.message}`);
        }
    }
}

/**
 * Restore MSSQL database from .bak file
 */
export async function restore(
    config: any,
    sourcePath: string,
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
        const dialect = getDialect(config.detectedVersion);
        const backupPath = config.backupPath || "/var/opt/mssql/backup";

        // Determine target database(s) from config
        const dbMapping = config.databaseMapping as
            | { originalName: string; targetName: string; selected: boolean }[]
            | undefined;

        let targetDatabases: { original: string; target: string }[] = [];

        if (dbMapping && dbMapping.length > 0) {
            targetDatabases = dbMapping
                .filter((m) => m.selected)
                .map((m) => ({
                    original: m.originalName,
                    target: m.targetName || m.originalName,
                }));
        } else if (config.database) {
            const dbName = Array.isArray(config.database) ? config.database[0] : config.database;
            targetDatabases = [{ original: dbName, target: dbName }];
        }

        if (targetDatabases.length === 0) {
            throw new Error("No target database specified for restore");
        }

        // Copy backup file to server-accessible location
        const fileName = path.basename(sourcePath);
        const serverBakPath = path.posix.join(backupPath, fileName);

        log(`Copying backup file to server...`);
        await copyFile(sourcePath, serverBakPath);
        log(`Backup file staged at: ${serverBakPath}`);

        // Get file list from backup to determine logical names
        const fileListQuery = `RESTORE FILELISTONLY FROM DISK = '${serverBakPath}'`;
        const fileListResult = await executeQuery(config, fileListQuery);

        const logicalFiles = fileListResult.recordset.map((row: any) => ({
            logicalName: row.LogicalName,
            type: row.Type, // D = Data, L = Log
            physicalName: row.PhysicalName,
        }));

        log(`Backup contains ${logicalFiles.length} file(s)`);

        // Restore each target database
        for (const { original, target } of targetDatabases) {
            log(`Restoring database: ${original} -> ${target}`);

            // Build MOVE clauses for file relocation
            const moveOptions: { logicalName: string; physicalPath: string }[] = [];

            for (const file of logicalFiles) {
                // If we're renaming the database, we need to relocate files
                const ext = file.type === "D" ? ".mdf" : ".ldf";
                const newPhysicalPath = `/var/opt/mssql/data/${target}${ext}`;
                moveOptions.push({
                    logicalName: file.logicalName,
                    physicalPath: newPhysicalPath,
                });
            }

            const restoreQuery = dialect.getRestoreQuery(target, serverBakPath, {
                replace: true,
                recovery: true,
                stats: 10,
                moveFiles: original !== target ? moveOptions : undefined,
            });

            log(`Executing restore`, "info", "command", restoreQuery);

            try {
                await executeQuery(config, restoreQuery);
                log(`Restore completed for: ${target}`);
            } catch (error: any) {
                log(`Restore failed for ${target}: ${error.message}`, "error");
                throw error;
            }
        }

        // Clean up staged backup file
        await fs.unlink(serverBakPath).catch(() => {});

        log(`Restore finished successfully`);

        return {
            success: true,
            path: sourcePath,
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
 * Copy file using streams
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
