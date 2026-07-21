import { StorageAdapter, StorageSession, FileInfo, DirectoryBrowseEntry } from "@/lib/core/interfaces";
import { normalizeSshPrivateKey } from "@/lib/ssh/pkcs8-compat";
import { SFTPSchema } from "@/lib/adapters/definitions";
import Client from "ssh2-sftp-client";
import { createReadStream } from "fs";
import path from "path";
import { LogLevel, LogType } from "@/lib/core/logs";
import { logger } from "@/lib/logging/logger";
import { wrapError } from "@/lib/logging/errors";

const log = logger.child({ adapter: "sftp" });

interface SFTPConfig {
    host: string;
    port: number;
    username: string;
    password?: string;
    privateKey?: string;
    passphrase?: string;
    pathPrefix?: string;
}

const connectSFTP = async (config: SFTPConfig): Promise<Client> => {
    // PKCS#8 encrypted keys (BEGIN ENCRYPTED PRIVATE KEY) are not supported by
    // ssh2-sftp-client. Decrypt them in-memory via Node.js crypto first.
    let privateKey = config.privateKey;
    if (privateKey?.includes("BEGIN ENCRYPTED PRIVATE KEY")) {
        if (!config.passphrase) {
            throw new Error("This private key is passphrase-protected. Please provide the passphrase.");
        }
        privateKey = normalizeSshPrivateKey(privateKey, config.passphrase);
    }
    const sftp = new Client();
    await sftp.connect({
        host: config.host,
        port: config.port,
        username: config.username,
        password: config.password,
        privateKey,
        // passphrase only needed for non-PKCS#8-encrypted keys
        passphrase: privateKey !== config.privateKey ? undefined : config.passphrase,
    });
    return sftp;
};

/**
 * Performs a single upload on an already-connected SFTP client. The directory
 * cache prevents redundant mkdir calls when reused across multiple uploads
 * (e.g. metadata sidecar + backup file in the same session).
 */
async function performSftpUpload(
    sftp: Client,
    config: SFTPConfig,
    localPath: string,
    remotePath: string,
    onProgress: ((percent: number) => void) | undefined,
    onLog: ((msg: string, level?: LogLevel, type?: LogType, details?: string) => void) | undefined,
    dirCache: Set<string>
): Promise<boolean> {
    try {
        const destination = config.pathPrefix
            ? path.posix.join(config.pathPrefix, remotePath)
            : remotePath;

        const remoteDir = path.posix.dirname(destination);
        if (!dirCache.has(remoteDir)) {
            if (await sftp.exists(remoteDir) !== 'd') {
                if (onLog) onLog(`Creating remote directory: ${remoteDir}`, 'info', 'storage');
                await sftp.mkdir(remoteDir, true);
            }
            dirCache.add(remoteDir);
        }

        if (onLog) onLog(`Starting SFTP upload to: ${destination}`, 'info', 'storage');

        const stats = await import('fs').then(fs => fs.promises.stat(localPath));
        const totalSize = stats.size;

        const fileStream = createReadStream(localPath);
        try {
            await sftp.put(fileStream, destination, {
                step: (total_transferred: any, _chunk: any, _total: any) => {
                    if (onProgress && totalSize > 0) {
                        const percent = Math.round((total_transferred / totalSize) * 100);
                        onProgress(percent);
                    }
                }
            } as any);
        } finally {
            fileStream.destroy();
        }

        if (onLog) onLog(`SFTP upload completed successfully`, 'info', 'storage');
        return true;
    } catch (error: unknown) {
        log.error("SFTP upload failed", { host: config.host, remotePath }, wrapError(error));
        if (onLog && error instanceof Error) onLog(`SFTP upload failed: ${error.message}`, 'error', 'storage', error.stack);
        return false;
    }
}

export const SFTPAdapter: StorageAdapter = {
    id: "sftp",
    type: "storage",
    name: "SFTP (SSH)",
    configSchema: SFTPSchema,
    credentials: { primary: "SSH_KEY" },

    async openSession(config: SFTPConfig, onLog?): Promise<StorageSession> {
        const sftp = await connectSFTP(config);
        if (onLog) onLog(`Connected to SFTP ${config.host}:${config.port}`, 'info', 'storage');
        const dirCache = new Set<string>();
        return {
            upload: (localPath, remotePath, onProgress, uploadLog) =>
                performSftpUpload(sftp, config, localPath, remotePath, onProgress, uploadLog ?? onLog, dirCache),
            close: async () => {
                await sftp.end().catch(() => { });
            },
        };
    },

    async upload(config: SFTPConfig, localPath: string, remotePath: string, onProgress?: (percent: number) => void, onLog?: (msg: string, level?: LogLevel, type?: LogType, details?: string) => void): Promise<boolean> {
        let sftp: Client | null = null;
        try {
            sftp = await connectSFTP(config);
            if (onLog) onLog(`Connected to SFTP ${config.host}:${config.port}`, 'info', 'storage');
            return await performSftpUpload(sftp, config, localPath, remotePath, onProgress, onLog, new Set());
        } catch (error: unknown) {
            log.error("SFTP upload failed", { host: config.host, remotePath }, wrapError(error));
            if (onLog && error instanceof Error) onLog(`SFTP upload failed: ${error.message}`, 'error', 'storage', error.stack);
            return false;
        } finally {
            if (sftp) await sftp.end();
        }
    },

    async list(config: SFTPConfig, dir: string = ""): Promise<FileInfo[]> {
        let sftp: Client | null = null;
        try {
            sftp = await connectSFTP(config);

            // Normalize path helper
            const normalize = (p: string) => p.replace(/\\/g, '/');

            // Determine where to start listing
            const prefix = config.pathPrefix ? normalize(config.pathPrefix) : "";
            const startDir = prefix
                ? path.posix.join(prefix, dir)
                : (dir || ".");

            const files: FileInfo[] = [];

            // Helper for recursive listing
            const walk = async (currentDir: string) => {
                const items = await sftp!.list(currentDir);

                for (const item of items) {
                    const fullPath = path.posix.join(currentDir, item.name);

                    if (item.type === 'd') {
                        await walk(fullPath);
                    } else if (item.type === '-') {
                        // Calculate UI-friendly relative path
                        // e.g. /home/user/backups/Job1/file.sql -> Job1/file.sql (if prefix is /home/user/backups)
                        let relativePath = fullPath;

                        // Strip the prefix part to make it relative to the "root" of the adapter
                        if (prefix && fullPath.startsWith(prefix)) {
                            relativePath = fullPath.substring(prefix.length);
                        }

                        // Remove leading slash
                        if (relativePath.startsWith('/')) relativePath = relativePath.substring(1);

                        files.push({
                            name: item.name,
                            path: relativePath,
                            size: item.size,
                            lastModified: new Date(item.modifyTime),
                        });
                    }
                }
            };

            // Start walking if directory exists
            const type = await sftp.exists(startDir);
            if (type === 'd') {
                await walk(startDir);
            }

            return files;

        } catch (error) {
            log.error("SFTP list failed", { host: config.host, dir }, wrapError(error));
            throw error;
        } finally {
            if (sftp) await sftp.end();
        }
    },

    async browseDirectories(config: SFTPConfig, subPath: string = ""): Promise<DirectoryBrowseEntry[]> {
        let sftp: Client | null = null;
        try {
            sftp = await connectSFTP(config);
            const startDir = config.pathPrefix
                ? path.posix.join(config.pathPrefix, subPath)
                : (subPath || ".");

            const type = await sftp.exists(startDir);
            if (type !== 'd') return [];

            const items = await sftp.list(startDir);
            return items
                .filter((item) => item.type === 'd')
                .map((item) => ({
                    name: item.name,
                    path: subPath ? `${subPath}/${item.name}` : item.name,
                }));
        } catch (error) {
            log.error("SFTP browseDirectories failed", { host: config.host, subPath }, wrapError(error));
            throw error;
        } finally {
            if (sftp) await sftp.end();
        }
    },

    async download(config: SFTPConfig, remotePath: string, localPath: string, onProgress?: (processed: number, total: number) => void): Promise<boolean> {
        let sftp: Client | null = null;
        try {
            sftp = await connectSFTP(config);

            const source = config.pathPrefix
                ? path.posix.join(config.pathPrefix, remotePath)
                : remotePath;

            if (onProgress) {
                const stat = await sftp.stat(source);
                const total = stat.size;
                let processed = 0;
                await sftp.fastGet(source, localPath, {
                    step: (transferred) => {
                        processed = transferred;
                        onProgress(processed, total);
                    }
                });
            } else {
                await sftp.get(source, localPath);
            }
            return true;
        } catch (error) {
            log.error("SFTP download failed", { host: config.host, remotePath }, wrapError(error));
            return false;
        } finally {
            if (sftp) await sftp.end();
        }
    },

    async read(config: SFTPConfig, remotePath: string): Promise<string | null> {
        let sftp: Client | null = null;
        try {
            sftp = await connectSFTP(config);

            const source = config.pathPrefix
                ? path.posix.join(config.pathPrefix, remotePath)
                : remotePath;

            // get returns Buffer or string depending on options/destination
            // passing undefined as dst makes it return a buffer
            const buffer = await sftp.get(source);
            if (buffer instanceof Buffer) {
                return buffer.toString('utf-8');
            }
            return null;
        } catch (_error) {
            // Quietly fail if file not found (expected for missing .meta.json)
            return null;
        } finally {
            if (sftp) await sftp.end();
        }
    },

    async delete(config: SFTPConfig, remotePath: string): Promise<boolean> {
        let sftp: Client | null = null;
        try {
            sftp = await connectSFTP(config);

            const source = config.pathPrefix
                ? path.posix.join(config.pathPrefix, remotePath)
                : remotePath;

            await sftp.delete(source);
            return true;
        } catch (error) {
            log.error("SFTP delete failed", { host: config.host, remotePath }, wrapError(error));
            return false;
        } finally {
            if (sftp) await sftp.end();
        }
    },

    async ping(config: SFTPConfig): Promise<{ success: boolean; message: string }> {
        let sftp: Client | null = null;
        try {
            sftp = await connectSFTP(config);
            const checkPath = config.pathPrefix || '.';
            await sftp.stat(checkPath);
            return { success: true, message: "Connection successful" };
        } catch (error: unknown) {
            const message = error instanceof Error ? error.message : String(error);
            return { success: false, message: `SFTP Connection failed: ${message}` };
        } finally {
            if (sftp) await sftp.end();
        }
    },

    async test(config: SFTPConfig): Promise<{ success: boolean; message: string }> {
        let sftp: Client | null = null;
        const ts = new Date().toISOString().slice(0, 19).replace('T', '_').replace(/:/g, '-');
        const testFileName = `.dbackup/test/connection-test-sftp-${ts}`;
        const destination = config.pathPrefix
            ? path.posix.join(config.pathPrefix, testFileName)
            : testFileName;
        const subdir = config.pathPrefix
            ? path.posix.join(config.pathPrefix, '.dbackup/test')
            : '.dbackup/test';
        let remoteFileCreated = false;
        try {
            sftp = await connectSFTP(config);

            if (await sftp.exists(subdir) !== 'd') {
                await sftp.mkdir(subdir, true);
            }

            // 1. Write Test
            await sftp.put(Buffer.from("Connection Test"), destination);
            remoteFileCreated = true;

            // 2. Delete Test
            await sftp.delete(destination);
            remoteFileCreated = false;

            return { success: true, message: "Connection successful (Write/Delete verified)" };
        } catch (error: unknown) {
            const message = error instanceof Error ? error.message : String(error);
            return { success: false, message: `SFTP Connection failed: ${message}` };
        } finally {
            if (remoteFileCreated) await sftp?.delete(destination).catch(() => {});
            if (sftp) await sftp.end();
        }
    }

};
