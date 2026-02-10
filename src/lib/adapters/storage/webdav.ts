import { StorageAdapter, FileInfo } from "@/lib/core/interfaces";
import { WebDAVSchema } from "@/lib/adapters/definitions";
import { createClient, WebDAVClient, FileStat } from "webdav";
import { createWriteStream } from "fs";
import fs from "fs/promises";
import path from "path";
import { pipeline } from "stream/promises";
import { LogLevel, LogType } from "@/lib/core/logs";
import { logger } from "@/lib/logger";
import { wrapError } from "@/lib/errors";

const log = logger.child({ adapter: "webdav" });

interface WebDAVConfig {
    url: string;
    username: string;
    password?: string;
    pathPrefix?: string;
}

function getClient(config: WebDAVConfig): WebDAVClient {
    return createClient(config.url, {
        username: config.username,
        password: config.password,
    });
}

function resolvePath(config: WebDAVConfig, relativePath: string): string {
    if (config.pathPrefix) {
        return path.posix.join("/", config.pathPrefix, relativePath);
    }
    return path.posix.join("/", relativePath);
}

async function ensureDir(client: WebDAVClient, remotePath: string): Promise<void> {
    const dir = path.posix.dirname(remotePath);
    if (dir && dir !== "/" && dir !== ".") {
        if (await client.exists(dir) === false) {
            await client.createDirectory(dir, { recursive: true });
        }
    }
}

export const WebDAVStorageAdapter: StorageAdapter = {
    id: "webdav",
    type: "storage",
    name: "WebDAV",
    configSchema: WebDAVSchema,

    async upload(config: WebDAVConfig, localPath: string, remotePath: string, onProgress?: (percent: number) => void, onLog?: (msg: string, level?: LogLevel, type?: LogType, details?: string) => void): Promise<boolean> {
        try {
            const client = getClient(config);
            const destination = resolvePath(config, remotePath);

            if (onLog) onLog(`Connecting to WebDAV server ${config.url}`, "info", "storage");

            await ensureDir(client, destination);

            if (onLog) onLog(`Starting WebDAV upload to: ${destination}`, "info", "storage");

            const fileBuffer = await fs.readFile(localPath);
            await client.putFileContents(destination, fileBuffer);

            if (onProgress) onProgress(100);
            if (onLog) onLog("WebDAV upload completed successfully", "info", "storage");
            return true;
        } catch (error: unknown) {
            log.error("WebDAV upload failed", { url: config.url, remotePath }, wrapError(error));
            if (onLog && error instanceof Error) onLog(`WebDAV upload failed: ${error.message}`, "error", "storage", error.stack);
            return false;
        }
    },

    async download(config: WebDAVConfig, remotePath: string, localPath: string, _onProgress?: (processed: number, total: number) => void, onLog?: (msg: string, level?: LogLevel, type?: LogType, details?: string) => void): Promise<boolean> {
        try {
            const client = getClient(config);
            const source = resolvePath(config, remotePath);

            if (onLog) onLog(`Downloading from WebDAV: ${source}`, "info", "storage");

            const readStream = client.createReadStream(source);
            const writeStream = createWriteStream(localPath);
            await pipeline(readStream, writeStream);

            return true;
        } catch (error: unknown) {
            log.error("WebDAV download failed", { url: config.url, remotePath }, wrapError(error));
            if (onLog && error instanceof Error) onLog(`WebDAV download failed: ${error.message}`, "error", "storage", error.stack);
            return false;
        }
    },

    async read(config: WebDAVConfig, remotePath: string): Promise<string | null> {
        try {
            const client = getClient(config);
            const source = resolvePath(config, remotePath);

            const content = await client.getFileContents(source, { format: "text" });
            return content as string;
        } catch {
            // Quietly fail if file not found (expected for missing .meta.json)
            return null;
        }
    },

    async list(config: WebDAVConfig, dir: string = ""): Promise<FileInfo[]> {
        try {
            const client = getClient(config);

            const prefix = config.pathPrefix || "";
            const startDir = prefix
                ? path.posix.join("/", prefix, dir)
                : (dir ? path.posix.join("/", dir) : "/");

            const files: FileInfo[] = [];
            const prefixPath = prefix ? path.posix.join("/", prefix) : "";

            // Recursive walk — avoids Depth:infinity PROPFIND which many servers reject
            const walk = async (currentDir: string) => {
                const items = await client.getDirectoryContents(currentDir) as FileStat[];

                for (const item of items) {
                    if (item.type === "directory") {
                        await walk(item.filename);
                    } else {
                        let relativePath = item.filename;
                        if (prefixPath && relativePath.startsWith(prefixPath)) {
                            relativePath = relativePath.substring(prefixPath.length);
                        }
                        if (relativePath.startsWith("/")) relativePath = relativePath.substring(1);

                        files.push({
                            name: item.basename,
                            path: relativePath,
                            size: item.size,
                            lastModified: new Date(item.lastmod),
                        });
                    }
                }
            };

            await walk(startDir);

            return files;
        } catch (error: unknown) {
            log.error("WebDAV list failed", { url: config.url, dir }, wrapError(error));
            return [];
        }
    },

    async delete(config: WebDAVConfig, remotePath: string): Promise<boolean> {
        try {
            const client = getClient(config);
            const target = resolvePath(config, remotePath);

            await client.deleteFile(target);
            return true;
        } catch (error: unknown) {
            log.error("WebDAV delete failed", { url: config.url, remotePath }, wrapError(error));
            return false;
        }
    },

    async test(config: WebDAVConfig): Promise<{ success: boolean; message: string }> {
        const testFileName = `.connection-test-${Date.now()}`;
        try {
            const client = getClient(config);
            const destination = resolvePath(config, testFileName);

            // Ensure pathPrefix directory exists if set
            if (config.pathPrefix) {
                const prefixDir = path.posix.join("/", config.pathPrefix);
                if (await client.exists(prefixDir) === false) {
                    await client.createDirectory(prefixDir, { recursive: true });
                }
            }

            // 1. Write Test
            await client.putFileContents(destination, "Connection Test");

            // 2. Delete Test
            await client.deleteFile(destination);

            return { success: true, message: "Connection successful (Write/Delete verified)" };
        } catch (error: unknown) {
            const message = error instanceof Error ? error.message : String(error);
            return { success: false, message: `WebDAV Connection failed: ${message}` };
        }
    },
};
