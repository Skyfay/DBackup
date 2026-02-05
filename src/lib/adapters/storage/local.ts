import { StorageAdapter, FileInfo } from "@/lib/core/interfaces";
import { LogLevel, LogType } from "@/lib/core/logs";
import { LocalStorageSchema } from "@/lib/adapters/definitions";
import fs from "fs/promises";
import path from "path";
import { existsSync, statSync, createReadStream, createWriteStream } from "fs";
import { pipeline } from "stream/promises";
import { logger } from "@/lib/logger";
import { wrapError, AdapterError } from "@/lib/errors";

const log = logger.child({ adapter: "local-filesystem" });

// Helper to prevent path traversal
function resolveSafePath(basePath: string, relativePath: string): string {
    const resolvedBase = path.resolve(basePath);
    const resolvedTarget = path.resolve(resolvedBase, relativePath);

    if (!resolvedTarget.startsWith(resolvedBase)) {
        throw new AdapterError("local-filesystem", `Access denied: Illegal path traversal detected. Base: ${resolvedBase}, Target: ${resolvedTarget}`);
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

            if (onLog) onLog(`Preparing local destination: ${destDir}`, 'info', 'general');

            if (!existsSync(destDir)) {
                await fs.mkdir(destDir, { recursive: true });
            }

            // fs.copyFile does not support progress, so we use streams
            const size = statSync(localPath).size;
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
            if (!existsSync(sourcePath)) {
                log.warn("File not found for download", { sourcePath });
                return false;
            }

            const localDir = path.dirname(localPath);
            if (!existsSync(localDir)) {
                await fs.mkdir(localDir, { recursive: true });
            }

            // Use streaming copy to track progress
            const size = statSync(sourcePath).size;
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
             if (!existsSync(sourcePath)) return null;
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
            if (!existsSync(dirPath)) {
                return [];
            }

            const entries = await fs.readdir(dirPath, { withFileTypes: true, recursive: true });

            const files: FileInfo[] = [];

            for (const entry of entries) {
                if (entry.isFile()) {
                    // With recursive: true, entry.name is just the filename, entry.path is the directory
                    const fullPath = path.join(entry.parentPath || entry.path, entry.name); // Node 20+ uses parentPath
                    const relativePath = path.relative(config.basePath, fullPath);
                    const stats = statSync(fullPath);

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
            log.error("Local list failed", { remotePath }, wrapError(error));
            return [];
        }
    },

    async delete(config: { basePath: string }, remotePath: string): Promise<boolean> {
        try {
            const targetPath = resolveSafePath(config.basePath, remotePath);
            if (!existsSync(targetPath)) return true; // Already gone

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
        try {
            // Ensure dir exists logic is same as upload, but test explicitly checks if we can write
            if (!existsSync(config.basePath)) {
                await fs.mkdir(config.basePath, { recursive: true });
            }

            // 1. Write
            await fs.writeFile(testFile, "Connection Test");

            // 2. Delete
            await fs.unlink(testFile);

            return { success: true, message: `Access to ${config.basePath} verified (Read/Write)` };
        } catch (error: unknown) {
             const message = error instanceof Error ? error.message : String(error);
             return { success: false, message: `Access failed: ${message}` };
        }
    }
};
