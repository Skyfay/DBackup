import { StorageAdapter, FileInfo } from "@/lib/core/interfaces";
import { WebDAVSchema } from "@/lib/adapters/definitions";
import { createClient, WebDAVClient, FileStat } from "webdav";
import { createReadStream, createWriteStream } from "fs";
import { Transform, Readable } from "stream";
import fs from "fs/promises";
import path from "path";
import { pipeline } from "stream/promises";
import { LogLevel, LogType } from "@/lib/core/logs";
import { logger } from "@/lib/logging/logger";
import { wrapError } from "@/lib/logging/errors";

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

export const WebDAVAdapter: StorageAdapter = {
    id: "webdav",
    type: "storage",
    name: "WebDAV",
    configSchema: WebDAVSchema,
    credentials: { primary: "USERNAME_PASSWORD" },

    async upload(config: WebDAVConfig, localPath: string, remotePath: string, onProgress?: (percent: number) => void, onLog?: (msg: string, level?: LogLevel, type?: LogType, details?: string) => void): Promise<boolean> {
        try {
            const client = getClient(config);
            const destination = resolvePath(config, remotePath);

            if (onLog) onLog(`Connecting to WebDAV server ${config.url}`, "info", "storage");

            await ensureDir(client, destination);

            if (onLog) onLog(`Starting WebDAV upload to: ${destination}`, "info", "storage");

            // Streamed, not read into a Buffer: a backup archive is routinely larger than
            // the machine's memory, and buffering it here would fail exactly on the large
            // backups that matter most. Every other adapter already uploads from a stream.
            const { size } = await fs.stat(localPath);
            let sent = 0;
            const tracker = new Transform({
                transform(chunk, _encoding, callback) {
                    sent += chunk.length;
                    if (onProgress && size > 0) onProgress(Math.min(100, Math.round((sent / size) * 100)));
                    callback(null, chunk);
                },
            });

            await pipeline(
                createReadStream(localPath),
                tracker,
                client.createWriteStream(destination, { overwrite: true })
            );

            if (onProgress) onProgress(100);
            if (onLog) onLog("WebDAV upload completed successfully", "info", "storage");
            return true;
        } catch (error: unknown) {
            log.error("WebDAV upload failed", { url: config.url, remotePath }, wrapError(error));
            if (onLog && error instanceof Error) onLog(`WebDAV upload failed: ${error.message}`, "error", "storage", error.stack);
            return false;
        }
    },

    async downloadRange(config: WebDAVConfig, remotePath: string, start: number, end: number): Promise<NodeJS.ReadableStream> {
        // An empty range is legal - a zero-length file's archive entry produces one.
        if (end < start) return Readable.from([]);

        const client = getClient(config);
        // The webdav client's range is inclusive on both ends, matching our contract.
        return client.createReadStream(resolvePath(config, remotePath), { range: { start, end } });
    },

    async download(config: WebDAVConfig, remotePath: string, localPath: string, onProgress?: (processed: number, total: number) => void, onLog?: (msg: string, level?: LogLevel, type?: LogType, details?: string) => void): Promise<boolean> {
        try {
            const client = getClient(config);
            const source = resolvePath(config, remotePath);

            if (onLog) onLog(`Downloading from WebDAV: ${source}`, "info", "storage");

            const readStream = client.createReadStream(source);

            if (onProgress) {
                try {
                    const stat = await client.stat(source) as FileStat;
                    const total = stat.size;
                    if (total > 0) {
                        let processed = 0;
                        const tracker = new Transform({
                            transform(chunk, _encoding, callback) {
                                processed += chunk.length;
                                onProgress!(processed, total);
                                callback(null, chunk);
                            }
                        });
                        await pipeline(readStream, tracker, createWriteStream(localPath));
                        return true;
                    }
                } catch {
                    // stat failed - proceed without progress
                }
            }

            await pipeline(readStream, createWriteStream(localPath));

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

            // Recursive walk - avoids Depth:infinity PROPFIND which many servers reject
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
            throw error;
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

    async ping(config: WebDAVConfig): Promise<{ success: boolean; message: string }> {
        const client = getClient(config);
        try {
            const checkPath = config.pathPrefix ? path.posix.join("/", config.pathPrefix) : "/";
            await client.exists(checkPath);
            return { success: true, message: "Connection successful" };
        } catch (error: unknown) {
            const message = error instanceof Error ? error.message : String(error);
            return { success: false, message: `WebDAV Connection failed: ${message}` };
        }
    },

    async test(config: WebDAVConfig): Promise<{ success: boolean; message: string }> {
        const ts = new Date().toISOString().slice(0, 19).replace('T', '_').replace(/:/g, '-');
        const testFileName = `.dbackup/test/connection-test-webdav-${ts}`;
        const client = getClient(config);
        const destination = resolvePath(config, testFileName);
        const subdir = config.pathPrefix
            ? path.posix.join("/", config.pathPrefix, '.dbackup/test')
            : '/.dbackup/test';
        let remoteFileCreated = false;
        try {
            if (await client.exists(subdir) === false) {
                await client.createDirectory(subdir, { recursive: true });
            }

            // 1. Write Test
            await client.putFileContents(destination, "Connection Test");
            remoteFileCreated = true;

            // 2. Delete Test
            await client.deleteFile(destination);
            remoteFileCreated = false;

            return { success: true, message: "Connection successful (Write/Delete verified)" };
        } catch (error: unknown) {
            const message = error instanceof Error ? error.message : String(error);
            return { success: false, message: `WebDAV Connection failed: ${message}` };
        } finally {
            if (remoteFileCreated) await client.deleteFile(destination).catch(() => {});
        }
    },
};
