import { BackupResult } from "@/lib/core/interfaces";
import { LogLevel, LogType } from "@/lib/core/logs";
import { executeQuery, executeParameterizedQuery } from "./connection";
import { getDialect } from "./dialects";
import { MssqlSshTransfer, isSSHTransferEnabled } from "./ssh-transfer";
import fs from "fs/promises";
import { createReadStream, createWriteStream } from "fs";
import path from "path";
import { extract } from "tar-stream";
import { MSSQLConfig } from "@/lib/adapters/definitions";

/**
 * Extended MSSQL config for restore operations with runtime fields
 */
type MSSQLRestoreConfig = MSSQLConfig & {
    detectedVersion?: string;
    backupPath?: string;
    localBackupPath?: string;
    privilegedAuth?: {
        user: string;
        password: string;
    };
    databaseMapping?: Array<{
        originalName: string;
        targetName: string;
        selected: boolean;
    }>;
};

/**
 * Prepare restore by validating target databases
 */
export async function prepareRestore(config: MSSQLRestoreConfig, databases: string[]): Promise<void> {
    // Check if target databases can be created/overwritten
    for (const dbName of databases) {
        // Validate database name (only allow safe characters)
        if (!/^[a-zA-Z0-9_]+$/.test(dbName)) {
            throw new Error(`Invalid database name: ${dbName}`);
        }

        try {
            // Check if database exists and if we can access it
            // Use parameterized query for safety (even with validated input)
            const result = await executeParameterizedQuery(
                config,
                `SELECT state_desc FROM sys.databases WHERE name = @dbName`,
                { dbName }
            );

            if (result.recordset.length > 0) {
                const state = result.recordset[0].state_desc;
                if (state !== "ONLINE") {
                    throw new Error(`Database '${dbName}' is not online (state: ${state})`);
                }
                // Database exists and is online - will be overwritten
            }
            // Database doesn't exist - will be created
        } catch (error: unknown) {
            const message = error instanceof Error ? error.message : String(error);
            if (message.includes("Invalid database name")) {
                throw error;
            }
            // Connection/permission errors
            throw new Error(`Cannot prepare restore for '${dbName}': ${message}`);
        }
    }
}

/**
 * Restore MSSQL database from .bak file
 */
export async function restore(
    config: MSSQLRestoreConfig,
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
        const serverBackupPath = config.backupPath || "/var/opt/mssql/backup";
        const useSSH = isSSHTransferEnabled(config);
        const localBackupPath = config.localBackupPath || "/tmp";

        if (useSSH) {
            log(`File transfer mode: SSH (remote server)`);
        } else {
            log(`File transfer mode: Local (shared filesystem)`);
        }

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

        // Check if the source is a TAR archive (multi-DB backup)
        const isTarArchive = await checkIfTarArchive(sourcePath);

        // List of .bak files to restore
        const bakFiles: { serverPath: string; localPath: string; dbName: string }[] = [];

        // Extract temp directory for staging
        const stagingDir = "/tmp";

        if (isTarArchive) {
            log(`Detected TAR archive - extracting backup files...`);
            const extractedFiles = await extractTarArchive(sourcePath, stagingDir, log);

            for (const extracted of extractedFiles) {
                const serverPath = path.posix.join(serverBackupPath, path.basename(extracted));
                bakFiles.push({
                    serverPath,
                    localPath: extracted,
                    dbName: path.basename(extracted).replace(/_\d{4}-\d{2}-\d{2}.*\.bak$/, "")
                });
            }
            log(`Extracted ${bakFiles.length} backup file(s)`);
        } else {
            // Single .bak file
            const fileName = path.basename(sourcePath);
            const serverBakPath = path.posix.join(serverBackupPath, fileName);
            const localBakPath = path.join(stagingDir, fileName);

            // Stage the file locally first (copy to staging dir)
            if (sourcePath !== localBakPath) {
                await copyFile(sourcePath, localBakPath);
            }

            const dbName = Array.isArray(config.database) ? config.database[0] : (config.database || "database");
            bakFiles.push({ serverPath: serverBakPath, localPath: localBakPath, dbName });
        }

        // Transfer .bak files to the SQL Server
        let sshTransfer: MssqlSshTransfer | null = null;

        try {
            if (useSSH) {
                // SSH mode: upload .bak files to the remote server
                log(`Connecting via SSH to upload backup file(s)...`);
                sshTransfer = new MssqlSshTransfer();
                await sshTransfer.connect(config);

                for (const bakFile of bakFiles) {
                    log(`Uploading: ${path.basename(bakFile.localPath)} → ${bakFile.serverPath}`);
                    await sshTransfer.upload(bakFile.localPath, bakFile.serverPath);
                    log(`Uploaded: ${path.basename(bakFile.localPath)}`);
                }
            } else {
                // Local mode: copy .bak files to the shared filesystem path
                for (const bakFile of bakFiles) {
                    const localTarget = path.join(localBackupPath, path.basename(bakFile.localPath));
                    if (bakFile.localPath !== localTarget) {
                        log(`Copying backup file to server...`);
                        await copyFile(bakFile.localPath, localTarget);
                        log(`Backup file staged at: ${bakFile.serverPath} (local: ${localTarget})`);
                    }
                }
            }

            // Restore each backup file via T-SQL
            for (const bakFile of bakFiles) {
                // Find matching target database
                const targetDb = targetDatabases.find(t => t.original === bakFile.dbName)
                    || targetDatabases[0]; // Fallback to first target if no match

                log(`Restoring from: ${bakFile.serverPath}`);

                // Get file list from backup to determine logical names
                const fileListQuery = `RESTORE FILELISTONLY FROM DISK = '${bakFile.serverPath}'`;
                const fileListResult = await executeQuery(config, fileListQuery);

                const logicalFiles = fileListResult.recordset.map((row: any) => ({
                    logicalName: row.LogicalName,
                    type: row.Type, // D = Data, L = Log
                    physicalName: row.PhysicalName,
                }));

                log(`Backup contains ${logicalFiles.length} file(s)`);

                log(`Restoring database: ${targetDb.original} -> ${targetDb.target}`);

                // Build MOVE clauses for file relocation
                const moveOptions: { logicalName: string; physicalPath: string }[] = [];

                for (const file of logicalFiles) {
                    const ext = file.type === "D" ? ".mdf" : ".ldf";
                    const newPhysicalPath = `/var/opt/mssql/data/${targetDb.target}${ext}`;
                    moveOptions.push({
                        logicalName: file.logicalName,
                        physicalPath: newPhysicalPath,
                    });
                }

                const restoreQuery = dialect.getRestoreQuery(targetDb.target, bakFile.serverPath, {
                    replace: true,
                    recovery: true,
                    stats: 10,
                    moveFiles: targetDb.original !== targetDb.target ? moveOptions : undefined,
                });

                log(`Executing restore`, "info", "command", restoreQuery);

                try {
                    await executeQuery(config, restoreQuery);
                    log(`Restore completed for: ${targetDb.target}`);
                } catch (error: unknown) {
                    const message = error instanceof Error ? error.message : String(error);
                    log(`Restore failed for ${targetDb.target}: ${message}`, "error");
                    throw error;
                }

                // Remove this target from the list so we don't restore to it again
                const idx = targetDatabases.indexOf(targetDb);
                if (idx > -1) targetDatabases.splice(idx, 1);
            }
        } finally {
            // Clean up staged backup files (local temp)
            for (const bakFile of bakFiles) {
                await fs.unlink(bakFile.localPath).catch(() => {});
            }
            // Clean up remote .bak files uploaded via SSH
            if (sshTransfer) {
                for (const bakFile of bakFiles) {
                    await sshTransfer.deleteRemote(bakFile.serverPath).catch(() => {});
                }
                sshTransfer.end();
            }
        }

        log(`Restore finished successfully`);

        return {
            success: true,
            path: sourcePath,
            logs,
            startedAt,
            completedAt: new Date(),
        };
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

/**
 * Check if a file is a TAR archive by reading magic bytes
 */
async function checkIfTarArchive(filePath: string): Promise<boolean> {
    try {
        const fd = await fs.open(filePath, "r");
        const buffer = Buffer.alloc(512);
        await fd.read(buffer, 0, 512, 0);
        await fd.close();

        // TAR files have "ustar" at offset 257 (POSIX tar)
        // or check for valid tar header
        const ustarMagic = buffer.slice(257, 262).toString();
        if (ustarMagic === "ustar") {
            return true;
        }

        // Also check if filename in header ends with .bak
        const headerName = buffer.slice(0, 100).toString().replace(/\0/g, "").trim();
        if (headerName.endsWith(".bak")) {
            return true;
        }

        return false;
    } catch {
        return false;
    }
}

/**
 * Extract .bak files from a TAR archive
 */
async function extractTarArchive(
    tarPath: string,
    outputDir: string,
    log: (msg: string, level?: LogLevel, type?: LogType, details?: string) => void
): Promise<string[]> {
    const extractedFiles: string[] = [];

    return new Promise((resolve, reject) => {
        const extractor = extract();

        extractor.on("entry", async (header, stream, next) => {
            if (header.name.endsWith(".bak")) {
                const outputPath = path.join(outputDir, header.name);
                log(`Extracting: ${header.name}`);

                const writeStream = createWriteStream(outputPath);

                stream.pipe(writeStream);

                writeStream.on("finish", () => {
                    extractedFiles.push(outputPath);
                    next();
                });

                writeStream.on("error", (err) => {
                    reject(err);
                });
            } else {
                // Skip non-.bak files
                stream.resume();
                next();
            }
        });

        extractor.on("finish", () => {
            resolve(extractedFiles);
        });

        extractor.on("error", (err) => {
            reject(err);
        });

        createReadStream(tarPath).pipe(extractor);
    });
}
