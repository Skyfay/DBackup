import { StorageAdapter, FileInfo } from "@/lib/core/interfaces";
import { LogLevel, LogType } from "@/lib/core/logs";
import { LocalStorageSchema } from "@/lib/adapters/definitions";
import fs from "fs/promises";
import path from "path";
import { createReadStream, createWriteStream } from "fs";
import { pipeline } from "stream/promises";
import { logger } from "@/lib/logging/logger";
import { wrapError, AdapterError } from "@/lib/logging/errors";

const log = logger.child({ adapter: "local-filesystem" });

// Helper to prevent path traversal
function resolveSafePath(basePath: string, relativePath: string): string {
    const resolvedBase = path.resolve(basePath);
    const resolvedTarget = path.resolve(resolvedBase, relativePath);

    if (!resolvedTarget.startsWith(resolvedBase)) {
        throw new AdapterError("local-filesystem", "path-validation", `Access denied: Illegal path traversal detected. Base: ${resolvedBase}, Target: ${resolvedTarget}`);
    }
    return resolvedTarget;
}

export const LocalFileSystemAdapter: StorageAdapter = {
    id: "local-filesystem",
    type: "storage",
    name: "Local Filesystem",
    configSchema: LocalStorageSchema,

    async upload(config: { basePath: string }, localPath: string, remotePath: string, onProgress?: (percent: number) => void, onLog?: (msg: string, level?: LogLevel, type?: LogType, details?: string) => void): Promise<boolean> {
        let destPath: string;
        try {
            destPath = resolveSafePath(config.basePath, remotePath);
        } catch (error: unknown) {
            log.error("Local upload security check failed", { basePath: config.basePath, remotePath }, wrapError(error));
            if (onLog && error instanceof Error) onLog(error.message, 'error', 'security');
            throw error; // Rethrow to fail explicitly
        }

        try {
            const destDir = path.dirname(destPath);

            await fs.mkdir(destDir, { recursive: true });

            // fs.copyFile does not support progress, so we use streams
            const fileStat = await fs.stat(localPath);
            const size = fileStat.size;
            let processed = 0;

            const sourceStream = createReadStream(localPath);
            const destStream = createWriteStream(destPath);

            if (onProgress) {
                sourceStream.on('data', (chunk) => {
                    processed += chunk.length;
                    const percent = size > 0 ? Math.round((processed / size) * 100) : 0;
                    onProgress(percent);
                });
            }

            await pipeline(sourceStream, destStream);
            return true;
        } catch (error: unknown) {
            log.error("Local upload failed", { localPath, remotePath }, wrapError(error));
            if (onLog && error instanceof Error) onLog(`Local upload failed: ${error.message}`, 'error', 'general', error.stack);
            return false;
        }
    },

    async download(
        config: { basePath: string },
        remotePath: string,
        localPath: string,
        onProgress?: (processed: number, total: number) => void,
        _onLog?: (msg: string, level?: LogLevel, type?: LogType, details?: string) => void
    ): Promise<boolean> {
        let sourcePath: string;
        try {
            sourcePath = resolveSafePath(config.basePath, remotePath);
        } catch (error) {
             log.error("Local download security check failed", { basePath: config.basePath, remotePath }, wrapError(error));
             throw error;
        }

        try {
            try {
                await fs.access(sourcePath);
            } catch {
                log.warn("File not found for download", { sourcePath });
                return false;
            }

            const localDir = path.dirname(localPath);
            await fs.mkdir(localDir, { recursive: true });

            // Use streaming copy to track progress
            const fileStat = await fs.stat(sourcePath);
            const size = fileStat.size;
            let processed = 0;

            const sourceStream = createReadStream(sourcePath);
            const destStream = createWriteStream(localPath);

            if (onProgress) {
                sourceStream.on('data', (chunk) => {
                    processed += chunk.length;
                    onProgress(processed, size);
                });
            }

            await pipeline(sourceStream, destStream);
            return true;
        } catch (error) {
            log.error("Local download failed", { remotePath, localPath }, wrapError(error));
            return false;
        }
    },

    async read(config: { basePath: string }, remotePath: string): Promise<string | null> {
        try {
             const sourcePath = resolveSafePath(config.basePath, remotePath);
             try {
                 await fs.access(sourcePath);
             } catch {
                 return null;
             }
             return await fs.readFile(sourcePath, 'utf-8');
        } catch (error) {
            // Rethrow security errors
            if (error instanceof Error && error.message.includes("Access denied")) throw error;
            log.error("Local read failed", { remotePath }, wrapError(error));
            return null;
        }
    },

    async list(config: { basePath: string }, remotePath: string = ""): Promise<FileInfo[]> {
        try {
            const dirPath = resolveSafePath(config.basePath, remotePath);
            await fs.access(dirPath);

            const entries = await fs.readdir(dirPath, { withFileTypes: true, recursive: true });

            const files: FileInfo[] = [];

            for (const entry of entries) {
                if (entry.isFile()) {
                    // With recursive: true, entry.name is just the filename, entry.path is the directory
                    const fullPath = path.join(entry.parentPath || entry.path, entry.name); // Node 20+ uses parentPath
                    const relativePath = path.relative(config.basePath, fullPath);
                    const stats = await fs.stat(fullPath);

                    files.push({
                        name: entry.name,
                        path: relativePath,
                        size: stats.size,
                        lastModified: stats.mtime
                    });
                }
            }
            return files;
        } catch (error) {
            if (error instanceof Error && error.message.includes("Access denied")) throw error;
            // A subfolder that does not exist yet is a legitimate empty-result case (no backups for this job yet).
            const nodeErr = error as NodeJS.ErrnoException;
            if (remotePath !== "" && nodeErr.code === "ENOENT") return [];
            // Any other error on a root listing or non-ENOENT failures: throw so the stats cache
            // triggers its DB fallback and sets scanError=true, preventing a false 0-byte snapshot.
            log.error("Local list failed", { remotePath }, wrapError(error));
            throw error;
        }
    },

    async delete(config: { basePath: string }, remotePath: string): Promise<boolean> {
        try {
            const targetPath = resolveSafePath(config.basePath, remotePath);
            try {
                await fs.access(targetPath);
            } catch {
                return true; // Already gone
            }

            await fs.unlink(targetPath);
            return true;
        } catch (error) {
             if (error instanceof Error && error.message.includes("Access denied")) throw error;
             log.error("Local delete failed", { remotePath }, wrapError(error));
             return false;
        }
    },

    async test(config: { basePath: string }): Promise<{ success: boolean; message: string }> {
        const testFile = path.join(config.basePath, `.connection-test-${Date.now()}`);
        let written = false;
        try {
            await fs.mkdir(config.basePath, { recursive: true });

            // 1. Write
            await fs.writeFile(testFile, "Connection Test");
            written = true;

            // 2. Delete
            await fs.unlink(testFile);
            written = false;

            return { success: true, message: `Access to ${config.basePath} verified (Read/Write)` };
        } catch (error: unknown) {
             const message = error instanceof Error ? error.message : String(error);
             return { success: false, message: `Access failed: ${message}` };
        } finally {
            if (written) await fs.unlink(testFile).catch(() => {});
        }
    }
};
