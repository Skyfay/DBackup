import { StorageAdapter, FileInfo, DirectoryBrowseEntry, StorageReadOptions } from "@/lib/core/interfaces";
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
import { STATELESS_READ_CONCURRENCY } from "@/lib/adapters/storage/common/read-concurrency";
import { createListingGuard } from "@/lib/adapters/storage/common/listing-limits";
import { collectCapped, isFileTooLarge, readLimitOf, textOf } from "@/lib/adapters/storage/common/read-limit";
import { urlHost } from "@/lib/adapters/dialed-hosts";
import { reachOf } from "@/lib/network/reach-policy";
import { webdavAgents } from "./webdav-agents";
import { listDavFolder } from "./webdav-listing";

const log = logger.child({ adapter: "webdav" });

interface WebDAVConfig {
    url: string;
    username: string;
    password?: string;
    pathPrefix?: string;
}

/**
 * The client of a connection. Its agents connect only to the host of the URL, so a redirect to
 * another host fails instead of reaching a host the local network check never read, see
 * `webdav-agents.ts`, and for a tenant that blocks the local network only to checked addresses.
 */
function getClient(config: WebDAVConfig): WebDAVClient {
    return createClient(config.url, {
        username: config.username,
        password: config.password,
        ...webdavAgents(urlHost(config.url) ?? "", reachOf(config)),
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

/** A folder of a listing as one key: normalized, with a leading and without a trailing slash. */
function folderKey(folder: string): string {
    const normalized = path.posix.normalize(`/${folder.replace(/\\/g, "/")}`);
    return normalized.length > 1 ? normalized.replace(/\/+$/, "") : normalized;
}

/** Whether the folder `child` lies below `parent`, both keys of `folderKey`, and is not `parent` itself. */
function strictlyBelow(child: string, parent: string): boolean {
    return child !== parent && child.startsWith(parent === "/" ? "/" : `${parent}/`);
}

/**
 * The bytes of a file, at most the limit of the read, see `read-limit.ts`. Streamed, so a server
 * that sends more stops at the first chunk past it. Null when the file is not there.
 */
async function readCappedBytes(config: WebDAVConfig, remotePath: string, options?: StorageReadOptions): Promise<Buffer | null> {
    try {
        const client = getClient(config);
        const source = resolvePath(config, remotePath);
        return await collectCapped(client.createReadStream(source), readLimitOf(options));
    } catch (error) {
        if (isFileTooLarge(error)) throw error;
        // Quietly fail if file not found (expected for missing .meta.json)
        return null;
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

    readConcurrency: STATELESS_READ_CONCURRENCY,

    async read(config: WebDAVConfig, remotePath: string, options?: StorageReadOptions): Promise<string | null> {
        return textOf(await readCappedBytes(config, remotePath, options));
    },

    readBytes: readCappedBytes,

    async browseDirectories(config: WebDAVConfig, subPath: string = ""): Promise<DirectoryBrowseEntry[]> {
        try {
            const client = getClient(config);
            const prefix = config.pathPrefix || "";
            const startDir = prefix
                ? path.posix.join("/", prefix, subPath)
                : (subPath ? path.posix.join("/", subPath) : "/");

            // Depth 1: the collection's own children, which is exactly one tree level. The answer is
            // read up to `WEBDAV_MAX_LISTING_BYTES`, see `listDavFolder`.
            const items = await listDavFolder(client, config.url, startDir);
            return items
                .filter((item) => item.type === "directory")
                .map((item) => ({
                    name: item.basename,
                    path: subPath ? `${subPath}/${item.basename}` : item.basename,
                }));
        } catch (error: unknown) {
            log.error("WebDAV browseDirectories failed", { url: config.url, subPath }, wrapError(error));
            throw error;
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
            // The server may belong to a customer and answers with whatever names it likes. Every
            // entry, a folder too, passes the guard as it arrives, see `listing-limits.ts`, and the
            // walk goes only down: into a folder strictly below the one it lists and never into one
            // it listed before, so a folder that names itself or one above it as a child ends.
            const guard = createListingGuard();
            const visited = new Set<string>();

            // Recursive walk - avoids Depth:infinity PROPFIND which many servers reject
            const walk = async (currentDir: string) => {
                const current = folderKey(currentDir);
                if (visited.has(current)) return;
                visited.add(current);
                // The answer of one folder is bounded too, see `listDavFolder`.
                const items = await listDavFolder(client, config.url, currentDir);

                for (const item of items) {
                    guard.add(item.filename);
                    if (item.type === "directory") {
                        if (strictlyBelow(folderKey(item.filename), current)) await walk(item.filename);
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
            // A folder nothing was uploaded to yet is not there. It lists as empty, like on the
            // other destinations, instead of failing the refresh of the storage numbers after every run.
            if ((error as { status?: number } | null)?.status === 404) return [];
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
