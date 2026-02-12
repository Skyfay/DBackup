import { StorageAdapter, FileInfo } from "@/lib/core/interfaces";
import { FTPSchema } from "@/lib/adapters/definitions";
import { Client, FileInfo as FTPFileInfo } from "basic-ftp";
import { createReadStream, createWriteStream } from "fs";
import fs from "fs/promises";
import path from "path";
import os from "os";
import { LogLevel, LogType } from "@/lib/core/logs";
import { logger } from "@/lib/logger";
import { wrapError } from "@/lib/errors";

const log = logger.child({ adapter: "ftp" });

interface FTPConfig {
    host: string;
    port: number;
    username: string;
    password?: string;
    tls: boolean;
    pathPrefix?: string;
}

/**
 * Creates and connects an FTP client with the given config.
 */
async function connectFTP(config: FTPConfig): Promise<Client> {
    const client = new Client();
    client.ftp.verbose = false;

    await client.access({
        host: config.host,
        port: config.port,
        user: config.username,
        password: config.password || "",
        secure: config.tls,
        secureOptions: config.tls ? { rejectUnauthorized: false } : undefined,
    });

    return client;
}

/**
 * Resolves a remote path with the optional pathPrefix.
 */
function resolvePath(config: FTPConfig, relativePath: string): string {
    if (config.pathPrefix) {
        return path.posix.join(config.pathPrefix, relativePath);
    }
    return relativePath;
}

/**
 * Ensures the remote directory for a file path exists.
 */
async function ensureDir(client: Client, remotePath: string): Promise<void> {
    const dir = path.posix.dirname(remotePath);
    if (dir && dir !== "/" && dir !== ".") {
        await client.ensureDir(dir);
    }
}

export const FTPAdapter: StorageAdapter = {
    id: "ftp",
    type: "storage",
    name: "FTP / FTPS",
    configSchema: FTPSchema,

    async upload(config: FTPConfig, localPath: string, remotePath: string, onProgress?: (percent: number) => void, onLog?: (msg: string, level?: LogLevel, type?: LogType, details?: string) => void): Promise<boolean> {
        let client: Client | null = null;
        try {
            client = await connectFTP(config);

            if (onLog) onLog(`Connected to FTP ${config.host}:${config.port}`, "info", "storage");

            const destination = resolvePath(config, remotePath);

            // Ensure directory exists
            await ensureDir(client, destination);

            if (onLog) onLog(`Starting FTP upload to: ${destination}`, "info", "storage");

            // Track progress
            const stats = await fs.stat(localPath);
            const totalSize = stats.size;

            client.trackProgress((info) => {
                if (onProgress && totalSize > 0) {
                    const percent = Math.round((info.bytesOverall / totalSize) * 100);
                    onProgress(Math.min(percent, 100));
                }
            });

            await client.uploadFrom(createReadStream(localPath), destination);

            client.trackProgress();

            if (onProgress) onProgress(100);
            if (onLog) onLog("FTP upload completed successfully", "info", "storage");
            return true;
        } catch (error: unknown) {
            log.error("FTP upload failed", { host: config.host, remotePath }, wrapError(error));
            if (onLog && error instanceof Error) onLog(`FTP upload failed: ${error.message}`, "error", "storage", error.stack);
            return false;
        } finally {
            if (client) client.close();
        }
    },

    async download(config: FTPConfig, remotePath: string, localPath: string, onProgress?: (processed: number, total: number) => void, onLog?: (msg: string, level?: LogLevel, type?: LogType, details?: string) => void): Promise<boolean> {
        let client: Client | null = null;
        try {
            client = await connectFTP(config);

            const source = resolvePath(config, remotePath);

            if (onLog) onLog(`Downloading from FTP: ${source}`, "info", "storage");

            client.trackProgress((info) => {
                if (onProgress) {
                    onProgress(info.bytesOverall, info.bytesOverall);
                }
            });

            await client.downloadTo(createWriteStream(localPath), source);

            client.trackProgress();
            return true;
        } catch (error: unknown) {
            log.error("FTP download failed", { host: config.host, remotePath }, wrapError(error));
            if (onLog && error instanceof Error) onLog(`FTP download failed: ${error.message}`, "error", "storage", error.stack);
            return false;
        } finally {
            if (client) client.close();
        }
    },

    async read(config: FTPConfig, remotePath: string): Promise<string | null> {
        const tmpPath = path.join(os.tmpdir(), `ftp-read-${Date.now()}-${Math.random().toString(36).slice(2)}`);
        let client: Client | null = null;
        try {
            client = await connectFTP(config);

            const source = resolvePath(config, remotePath);
            await client.downloadTo(createWriteStream(tmpPath), source);

            const content = await fs.readFile(tmpPath, "utf-8");
            return content;
        } catch {
            // Quietly fail if file not found (expected for missing .meta.json)
            return null;
        } finally {
            if (client) client.close();
            await fs.unlink(tmpPath).catch(() => {});
        }
    },

    async list(config: FTPConfig, dir: string = ""): Promise<FileInfo[]> {
        let client: Client | null = null;
        try {
            client = await connectFTP(config);

            const normalize = (p: string) => p.replace(/\\/g, "/");

            const prefix = config.pathPrefix ? normalize(config.pathPrefix) : "";
            const startDir = prefix
                ? path.posix.join(prefix, dir)
                : (dir || "/");

            const files: FileInfo[] = [];

            const walk = async (currentDir: string) => {
                let items: FTPFileInfo[];
                try {
                    items = await client!.list(currentDir);
                } catch {
                    return;
                }

                for (const item of items) {
                    // Skip . and .. entries
                    if (item.name === "." || item.name === "..") continue;

                    const fullPath = path.posix.join(currentDir, item.name);

                    if (item.isDirectory) {
                        await walk(fullPath);
                    } else if (item.isFile) {
                        // Calculate relative path (strip prefix)
                        let relativePath = normalize(fullPath);
                        if (prefix && relativePath.startsWith(prefix)) {
                            relativePath = relativePath.substring(prefix.length);
                        }
                        if (relativePath.startsWith("/")) relativePath = relativePath.substring(1);

                        files.push({
                            name: item.name,
                            path: relativePath,
                            size: item.size,
                            lastModified: item.modifiedAt || new Date(),
                        });
                    }
                }
            };

            await walk(startDir);
            return files;
        } catch (error: unknown) {
            log.error("FTP list failed", { host: config.host, dir }, wrapError(error));
            return [];
        } finally {
            if (client) client.close();
        }
    },

    async delete(config: FTPConfig, remotePath: string): Promise<boolean> {
        let client: Client | null = null;
        try {
            client = await connectFTP(config);

            const target = resolvePath(config, remotePath);
            await client.remove(target);
            return true;
        } catch (error: unknown) {
            log.error("FTP delete failed", { host: config.host, remotePath }, wrapError(error));
            return false;
        } finally {
            if (client) client.close();
        }
    },

    async test(config: FTPConfig): Promise<{ success: boolean; message: string }> {
        const testFileName = `.connection-test-${Date.now()}`;
        const tmpPath = path.join(os.tmpdir(), testFileName);
        let client: Client | null = null;
        try {
            client = await connectFTP(config);

            const destination = resolvePath(config, testFileName);

            // Ensure pathPrefix directory exists if set
            if (config.pathPrefix) {
                await client.ensureDir(config.pathPrefix);
                await client.cd("/");
            }

            // Create a temp file to upload
            await fs.writeFile(tmpPath, "Connection Test");

            // 1. Write Test
            await client.uploadFrom(createReadStream(tmpPath), destination);

            // 2. Delete Test
            await client.remove(destination);

            return { success: true, message: "Connection successful (Write/Delete verified)" };
        } catch (error: unknown) {
            const message = error instanceof Error ? error.message : String(error);
            return { success: false, message: `FTP Connection failed: ${message}` };
        } finally {
            if (client) client.close();
            await fs.unlink(tmpPath).catch(() => {});
        }
    },
};
