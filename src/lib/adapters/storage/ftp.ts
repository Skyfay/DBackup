import { StorageAdapter, StorageSession, FileInfo, DirectoryBrowseEntry, ListTreeResult } from "@/lib/core/interfaces";
import { FTPSchema } from "@/lib/adapters/definitions";
import { createConnectionPool } from "@/lib/adapters/storage/common/connection-pool";
import { relativeToPrefix } from "@/lib/adapters/storage/common/prefix";
import { Client, FileInfo as FTPFileInfo, FTPError } from "basic-ftp";
import { createReadStream, createWriteStream } from "fs";
import { PassThrough, Readable, Writable } from "stream";
import fs from "fs/promises";
import path from "path";
import os from "os";
import { LogLevel, LogType } from "@/lib/core/logs";
import { logger } from "@/lib/logging/logger";
import { wrapError } from "@/lib/logging/errors";

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
 * Tries to extract a Date from the DBackup default filename pattern.
 * Example: MyJob_2026-06-05_10-00-00.sql.gz.enc → 2026-06-05T10:00:00Z
 *
 * Used as a fallback when the FTP server does not support MLSD and therefore
 * does not provide per-file modification timestamps.
 */
function extractDateFromFilename(name: string): Date | undefined {
    const match = name.match(/(\d{4})-(\d{2})-(\d{2})_(\d{2})-(\d{2})-(\d{2})/);
    if (match) {
        const [, year, month, day, hour, min, sec] = match;
        const d = new Date(`${year}-${month}-${day}T${hour}:${min}:${sec}Z`);
        if (!isNaN(d.getTime())) return d;
    }
    // Date-only fallback (e.g. custom template without time)
    const dateOnly = name.match(/(\d{4})-(\d{2})-(\d{2})/);
    if (dateOnly) {
        const [, year, month, day] = dateOnly;
        const d = new Date(`${year}-${month}-${day}T12:00:00Z`);
        if (!isNaN(d.getTime())) return d;
    }
    return undefined;
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

/**
 * Performs a single upload on an already-connected FTP client. The directory
 * cache prevents redundant ensureDir calls when reused across multiple uploads
 * in the same session.
 */
/** Performs a single download on an already-connected FTP client. */
async function performFtpDownload(
    client: Client,
    config: FTPConfig,
    remotePath: string,
    localPath: string,
    onProgress?: (processed: number, total: number) => void,
    onLog?: (msg: string, level?: LogLevel, type?: LogType, details?: string) => void
): Promise<boolean> {
    try {
        const source = resolvePath(config, remotePath);
        if (onLog) onLog(`Downloading from FTP: ${source}`, "info", "storage");

        if (onProgress) {
            let total = 0;
            try { total = await client.size(source); } catch { /* size not supported */ }
            client.trackProgress((info) => onProgress(info.bytesOverall, total || info.bytesOverall));
        }

        await client.downloadTo(createWriteStream(localPath), source);
        client.trackProgress();
        return true;
    } catch (error: unknown) {
        log.error("FTP download failed", { host: config.host, remotePath }, wrapError(error));
        if (onLog && error instanceof Error) onLog(`FTP download failed: ${error.message}`, "error", "storage", error.stack);
        return false;
    }
}

async function performFtpUpload(
    client: Client,
    config: FTPConfig,
    localPath: string,
    remotePath: string,
    onProgress: ((percent: number) => void) | undefined,
    onLog: ((msg: string, level?: LogLevel, type?: LogType, details?: string) => void) | undefined,
    dirCache: Set<string>
): Promise<boolean> {
    try {
        const destination = resolvePath(config, remotePath);
        const dir = path.posix.dirname(destination);

        if (!dirCache.has(dir)) {
            await ensureDir(client, destination);
            await client.cd("/");
            dirCache.add(dir);
        }

        if (onLog) onLog(`Starting FTP upload to: ${destination}`, "info", "storage");

        const stats = await fs.stat(localPath);
        const totalSize = stats.size;

        client.trackProgress((info) => {
            if (onProgress && totalSize > 0) {
                const percent = Math.round((info.bytesOverall / totalSize) * 100);
                onProgress(Math.min(percent, 100));
            }
        });

        const fileStream = createReadStream(localPath);
        try {
            await client.uploadFrom(fileStream, destination);
        } finally {
            fileStream.destroy();
        }

        client.trackProgress();

        if (onProgress) onProgress(100);
        if (onLog) onLog("FTP upload completed successfully", "info", "storage");
        return true;
    } catch (error: unknown) {
        log.error("FTP upload failed", { host: config.host, remotePath }, wrapError(error));
        if (onLog && error instanceof Error) onLog(`FTP upload failed: ${error.message}`, "error", "storage", error.stack);
        return false;
    }
}

/**
 * Whether a folder whose listing the server refused is not there.
 *
 * Servers answer a LIST of a missing folder differently: most with 550, ProFTPD with 450, and
 * vsftpd with an empty listing. A CWD into the folder settles it, which every server refuses
 * with 550 (RFC 959 "file unavailable") when the folder does not exist. Only a refusal of the
 * server gets that far, a timeout or a dropped connection is no FTPError and still fails.
 */
async function isMissingFtpFolder(client: Client, error: unknown, folder: string): Promise<boolean> {
    if (!(error instanceof FTPError)) return false;
    try {
        await client.cd(folder);
        return false;
    } catch (cdError: unknown) {
        return cdError instanceof FTPError && cdError.code === 550;
    }
}

/**
 * Recursively lists an FTP tree, separating out the symbolic links it cannot describe.
 *
 * One walker behind both `list()` and `listTree()`, so retention and collection can never
 * disagree about what is in a directory. Only the reporting differs: `list()` returns files
 * and nothing else, exactly as it always has.
 */
async function walkFtpTree(
    config: FTPConfig,
    dir: string
): Promise<{ files: FileInfo[]; symlinkPaths: string[] }> {
    let client: Client | null = null;
    try {
        client = await connectFTP(config);

        const normalize = (p: string) => p.replace(/\\/g, "/");

        const prefix = config.pathPrefix ? normalize(config.pathPrefix) : "";
        const startDir = prefix
            ? path.posix.join(prefix, dir)
            : (dir || "/");

        const files: FileInfo[] = [];
        const symlinkPaths: string[] = [];
        let warnedAboutMissingTimestamp = false;

        /**
         * Path relative to the adapter's configured root, the convention every adapter uses. The
         * prefix is compared as `path.posix.join` writes the walk, so `/backups//shop/` strips too.
         */
        const toAdapterPath = (fullPath: string): string => relativeToPrefix(normalize(fullPath), prefix);

        const walk = async (currentDir: string) => {
            let items: FTPFileInfo[];
            try {
                items = await client!.list(currentDir);
            } catch (error: unknown) {
                if (currentDir === startDir) {
                    // A subfolder nothing was written to yet is not there. It lists as empty,
                    // like on the other destinations.
                    if (dir !== "" && await isMissingFtpFolder(client!, error, currentDir)) return;
                    // Root directory listing failure: propagate so the stats cache uses DB fallback.
                    throw error;
                }
                // Sub-directory listing failure: skip silently and continue the walk.
                return;
            }

            for (const item of items) {
                // Skip . and .. entries
                if (item.name === "." || item.name === "..") continue;

                const fullPath = path.posix.join(currentDir, item.name);

                if (item.isDirectory) {
                    await walk(fullPath);
                } else if (item.isSymbolicLink) {
                    // Recorded, not stored. `LIST` output is free-form per server and `MLSD`
                    // has no facet for a link target, so there is nothing dependable to put in
                    // the archive - and a guessed target is worse than an honest gap.
                    symlinkPaths.push(toAdapterPath(fullPath));
                } else if (item.isFile) {
                    const relativePath = toAdapterPath(fullPath);

                    // modifiedAt is only available when the server supports MLSD.
                    // Fall back to parsing the timestamp from the filename (DBackup naming
                    // templates always embed yyyy-MM-dd_HH-mm-ss). Without a real timestamp
                    // all files would share new Date() and collapse into one daily GFS bucket.
                    let lastModified = item.modifiedAt;
                    if (!lastModified) {
                        lastModified = extractDateFromFilename(item.name);
                        if (!warnedAboutMissingTimestamp) {
                            log.warn(
                                "FTP server does not provide file modification times (no MLSD). " +
                                "Falling back to date extracted from the backup filename. " +
                                "This requires the Naming Template to include a date pattern (e.g. yyyy-MM-dd). " +
                                "If your template does not contain a date, GFS retention will not work correctly. " +
                                "Enable MLSD on your FTP server to remove this dependency.",
                                { host: config.host, dir }
                            );
                            warnedAboutMissingTimestamp = true;
                        }
                        if (!lastModified) {
                            log.warn(
                                "FTP: could not parse a date from the filename. " +
                                "The Naming Template likely does not contain a date pattern (yyyy-MM-dd). " +
                                "GFS retention will treat this file as the newest and may delete older backups incorrectly.",
                                { name: item.name }
                            );
                            lastModified = new Date();
                        }
                    }

                    files.push({
                        name: item.name,
                        path: relativePath,
                        size: item.size,
                        lastModified,
                    });
                }
            }
        };

        await walk(startDir);
        return { files, symlinkPaths };
    } catch (error: unknown) {
        log.error("FTP list failed", { host: config.host, dir }, wrapError(error));
        throw error;
    } finally {
        if (client) client.close();
    }
}

export const FTPAdapter: StorageAdapter = {
    id: "ftp",
    type: "storage",
    name: "FTP / FTPS",
    configSchema: FTPSchema,
    credentials: { primary: "USERNAME_PASSWORD" },

    async openSession(config: FTPConfig, onLog?, options?): Promise<StorageSession> {
        // One client per parallel transfer, never one shared between them: basic-ftp's Client
        // carries a single control connection and refuses a second operation while one is in
        // flight ("User launched a task while another one is still running"), which is not a
        // recoverable error - it closes the client and takes every queued transfer with it.
        const pool = createConnectionPool<Client>({
            limit: options?.concurrency ?? 1,
            connect: () => connectFTP(config),
            disconnect: async (client) => { client.close(); },
            isAlive: (client) => !client.closed,
        });

        // Opened right away rather than on the first transfer, so bad credentials or an
        // unreachable host fail here - where the caller can report one clear error - instead of
        // separately for every file.
        try {
            await pool.withConnection(async () => undefined);
        } catch (error) {
            await pool.close();
            throw error;
        }

        if (onLog) {
            const limit = options?.concurrency ?? 1;
            onLog(
                `Connected to FTP ${config.host}:${config.port}`
                + (limit > 1 ? ` (up to ${limit} parallel transfers)` : ''),
                "info",
                "storage"
            );
        }

        // Shared across the pool, not per client: which directories exist is a property of the
        // server, so one transfer's mkdir spares every other transfer the same check.
        const dirCache = new Set<string>();

        return {
            upload: (localPath, remotePath, onProgress, uploadLog) =>
                pool.withConnection((client) =>
                    performFtpUpload(client, config, localPath, remotePath, onProgress, uploadLog ?? onLog, dirCache)),
            download: (remotePath, localPath, onProgress) =>
                pool.withConnection((client) => performFtpDownload(client, config, remotePath, localPath, onProgress)),
            close: () => pool.close(),
        };
    },

    async upload(config: FTPConfig, localPath: string, remotePath: string, onProgress?: (percent: number) => void, onLog?: (msg: string, level?: LogLevel, type?: LogType, details?: string) => void): Promise<boolean> {
        let client: Client | null = null;
        try {
            client = await connectFTP(config);
            if (onLog) onLog(`Connected to FTP ${config.host}:${config.port}`, "info", "storage");
            return await performFtpUpload(client, config, localPath, remotePath, onProgress, onLog, new Set());
        } catch (error: unknown) {
            log.error("FTP upload failed", { host: config.host, remotePath }, wrapError(error));
            if (onLog && error instanceof Error) onLog(`FTP upload failed: ${error.message}`, "error", "storage", error.stack);
            return false;
        } finally {
            if (client) client.close();
        }
    },

    /**
     * Streams a byte range using FTP's REST command.
     *
     * FTP can seek to a start offset but has no way to express an end, so the transfer is
     * aborted once enough bytes have arrived. Aborting leaves the control connection
     * unusable, hence one connection per range - acceptable because a restore touches a
     * handful of entries, and vastly cheaper than transferring the whole archive.
     */
    async downloadRange(config: FTPConfig, remotePath: string, start: number, end: number): Promise<NodeJS.ReadableStream> {
        // An empty range is legal - a zero-length file's archive entry produces one.
        if (end < start) return Readable.from([]);

        const wanted = end - start + 1;
        const client = await connectFTP(config);
        const source = resolvePath(config, remotePath);
        const out = new PassThrough();

        let delivered = 0;
        const sink = new Writable({
            write(chunk: Buffer, _encoding, callback) {
                const take = Math.min(chunk.length, wanted - delivered);
                if (take > 0) {
                    delivered += take;
                    out.write(chunk.subarray(0, take));
                }
                if (delivered >= wanted) {
                    // Enough bytes. Closing the client aborts the data transfer, which
                    // rejects the downloadTo() promise below - that rejection is expected.
                    client.close();
                }
                callback();
            },
        });

        client.downloadTo(sink, source, start)
            .then(() => out.end())
            .catch((error: unknown) => {
                // A rejection after the range was fully delivered is our own abort.
                if (delivered >= wanted) {
                    out.end();
                    return;
                }
                log.error("FTP ranged download failed", { host: config.host, remotePath, start, end }, wrapError(error));
                out.destroy(wrapError(error));
            })
            .finally(() => client.close());

        return out;
    },

    async download(config: FTPConfig, remotePath: string, localPath: string, onProgress?: (processed: number, total: number) => void, onLog?: (msg: string, level?: LogLevel, type?: LogType, details?: string) => void): Promise<boolean> {
        let client: Client | null = null;
        try {
            client = await connectFTP(config);
            return await performFtpDownload(client, config, remotePath, localPath, onProgress, onLog);
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

    async browseDirectories(config: FTPConfig, subPath: string = ""): Promise<DirectoryBrowseEntry[]> {
        let client: Client | null = null;
        try {
            client = await connectFTP(config);
            const prefix = config.pathPrefix ? config.pathPrefix.replace(/\\/g, "/") : "";
            const startDir = prefix ? path.posix.join(prefix, subPath) : (subPath || "/");

            const items = await client.list(startDir);
            return items
                .filter((item) => item.isDirectory && item.name !== "." && item.name !== "..")
                .map((item) => ({
                    name: item.name,
                    path: subPath ? `${subPath}/${item.name}` : item.name,
                }));
        } catch (error: unknown) {
            log.error("FTP browseDirectories failed", { host: config.host, subPath }, wrapError(error));
            throw wrapError(error);
        } finally {
            if (client) client.close();
        }
    },

    async list(config: FTPConfig, dir: string = ""): Promise<FileInfo[]> {
        return (await walkFtpTree(config, dir)).files;
    },

    /**
     * Collection walk. Identical to `list()`, except that it reports the symbolic links it
     * had to leave behind.
     *
     * FTP has no standard way to read a link's target: `LIST` output is free-form per server
     * and `MLSD` has no facet for it, so there is nothing dependable to store. Rather than
     * pretend, the links are named and the run says out loud that they are not in the backup.
     */
    async listTree(config: FTPConfig, dir: string = ""): Promise<ListTreeResult> {
        const { files, symlinkPaths } = await walkFtpTree(config, dir);
        return { files, pruned: [], ...(symlinkPaths.length > 0 ? { unsupportedSymlinks: symlinkPaths } : {}) };
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

    async ping(config: FTPConfig): Promise<{ success: boolean; message: string }> {
        let client: Client | null = null;
        try {
            client = await connectFTP(config);
            await client.pwd();
            return { success: true, message: "Connection successful" };
        } catch (error: unknown) {
            const message = error instanceof Error ? error.message : String(error);
            return { success: false, message: `FTP Connection failed: ${message}` };
        } finally {
            if (client) client.close();
        }
    },

    async test(config: FTPConfig): Promise<{ success: boolean; message: string }> {
        const ts = new Date().toISOString().slice(0, 19).replace('T', '_').replace(/:/g, '-');
        const testFileName = `.dbackup/test/connection-test-ftp-${ts}`;
        const tmpPath = path.join(os.tmpdir(), `connection-test-ftp-${ts}`);
        const destination = resolvePath(config, testFileName);
        let client: Client | null = null;
        let remoteFileCreated = false;
        try {
            client = await connectFTP(config);

            // Ensure test subfolder exists
            const subdir = resolvePath(config, '.dbackup/test');
            await client.ensureDir(subdir);
            await client.cd("/");

            // Check MLSD support via FEAT command.
            // MLSD provides accurate per-file modification timestamps which are required
            // for correct GFS retention. Without MLSD, timestamps fall back to filename parsing.
            let mlsdSupported = false;
            try {
                const featResponse = await client.send("FEAT");
                mlsdSupported = featResponse.message.toUpperCase().includes("MLSD");
            } catch {
                // FEAT not supported — assume no MLSD
            }

            // Create a temp file to upload
            await fs.writeFile(tmpPath, "Connection Test");

            // 1. Write Test
            await client.uploadFrom(createReadStream(tmpPath), destination);
            remoteFileCreated = true;

            // 2. Delete Test
            await client.remove(destination);
            remoteFileCreated = false;

            const mlsdNote = mlsdSupported
                ? "MLSD supported ✓ (accurate file timestamps for GFS retention)"
                : "MLSD not supported ⚠ (GFS retention falls back to filename date — Naming Template must contain yyyy-MM-dd)";

            return { success: true, message: `Connection successful (Write/Delete verified). ${mlsdNote}` };
        } catch (error: unknown) {
            const message = error instanceof Error ? error.message : String(error);
            return { success: false, message: `FTP Connection failed: ${message}` };
        } finally {
            if (remoteFileCreated) await client?.remove(destination).catch(() => {});
            if (client) client.close();
            await fs.unlink(tmpPath).catch(() => {});
        }
    },
};
