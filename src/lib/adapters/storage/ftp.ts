import { StorageAdapter, StorageSession, FileInfo } from "@/lib/core/interfaces";
import { FTPSchema } from "@/lib/adapters/definitions";
import { Client, FileInfo as FTPFileInfo } from "basic-ftp";
import { createReadStream, createWriteStream } from "fs";
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

export const FTPAdapter: StorageAdapter = {
    id: "ftp",
    type: "storage",
    name: "FTP / FTPS",
    configSchema: FTPSchema,
    credentials: { primary: "USERNAME_PASSWORD" },

    async openSession(config: FTPConfig, onLog?): Promise<StorageSession> {
        const client = await connectFTP(config);
        if (onLog) onLog(`Connected to FTP ${config.host}:${config.port}`, "info", "storage");
        const dirCache = new Set<string>();
        return {
            upload: (localPath, remotePath, onProgress, uploadLog) =>
                performFtpUpload(client, config, localPath, remotePath, onProgress, uploadLog ?? onLog, dirCache),
            close: async () => {
                client.close();
            },
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

    async download(config: FTPConfig, remotePath: string, localPath: string, onProgress?: (processed: number, total: number) => void, onLog?: (msg: string, level?: LogLevel, type?: LogType, details?: string) => void): Promise<boolean> {
        let client: Client | null = null;
        try {
            client = await connectFTP(config);

            const source = resolvePath(config, remotePath);

            if (onLog) onLog(`Downloading from FTP: ${source}`, "info", "storage");

            if (onProgress) {
                let total = 0;
                try { total = await client.size(source); } catch { /* size not supported */ }
                client.trackProgress((info) => {
                    onProgress(info.bytesOverall, total || info.bytesOverall);
                });
            }

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
            let warnedAboutMissingTimestamp = false;

            const walk = async (currentDir: string) => {
                let items: FTPFileInfo[];
                try {
                    items = await client!.list(currentDir);
                } catch (error: unknown) {
                    // Root directory listing failure: propagate so the stats cache uses DB fallback.
                    if (currentDir === startDir) throw error;
                    // Sub-directory listing failure: skip silently and continue the walk.
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
            return files;
        } catch (error: unknown) {
            log.error("FTP list failed", { host: config.host, dir }, wrapError(error));
            throw error;
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
        const destination = resolvePath(config, testFileName);
        let client: Client | null = null;
        let remoteFileCreated = false;
        try {
            client = await connectFTP(config);

            // Ensure pathPrefix directory exists if set
            if (config.pathPrefix) {
                await client.ensureDir(config.pathPrefix);
                await client.cd("/");
            }

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
