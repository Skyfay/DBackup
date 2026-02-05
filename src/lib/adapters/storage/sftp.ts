import { StorageAdapter, FileInfo } from "@/lib/core/interfaces";
import { SFTPSchema } from "@/lib/adapters/definitions";
import Client from "ssh2-sftp-client";
import { createReadStream } from "fs";
import path from "path";
import { LogLevel, LogType } from "@/lib/core/logs";
import { logger } from "@/lib/logger";
import { wrapError } from "@/lib/errors";

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
    const sftp = new Client();
    await sftp.connect({
        host: config.host,
        port: config.port,
        username: config.username,
        password: config.password,
        privateKey: config.privateKey,
        passphrase: config.passphrase,
    });
    return sftp;
};

export const SFTPStorageAdapter: StorageAdapter = {
    id: "sftp",
    type: "storage",
    name: "SFTP (SSH)",
    configSchema: SFTPSchema,

    async upload(config: SFTPConfig, localPath: string, remotePath: string, onProgress?: (percent: number) => void, onLog?: (msg: string, level?: LogLevel, type?: LogType, details?: string) => void): Promise<boolean> {
        let sftp: Client | null = null;
        try {
            sftp = await connectSFTP(config);
            if (onLog) onLog(`Connected to SFTP ${config.host}:${config.port}`, 'info', 'storage');

            const destination = config.pathPrefix
                ? path.posix.join(config.pathPrefix, remotePath)
                : remotePath;

            // Ensure directory exists
            const remoteDir = path.posix.dirname(destination);
            if (await sftp.exists(remoteDir) !== 'd') {
                if (onLog) onLog(`Creating remote directory: ${remoteDir}`, 'info', 'storage');
                await sftp.mkdir(remoteDir, true);
            }

            if (onLog) onLog(`Starting SFTP upload to: ${destination}`, 'info', 'storage');

            // Use fastPut for local files (more efficient than streams for files on disk)
            // or put with fs stream if we want better progress tracking support?
            // ssh2-sftp-client put() supports streams and returns promise.
            // But fastPut is faster for file-to-file.
            // Let's use put() with ReadStream to match our architecture and handle progress if possible (though ssh2-sftp-client progress is step based usually).

            // Actually, put() accepts a stream.
            const stats = await import('fs').then(fs => fs.promises.stat(localPath));
            const totalSize = stats.size;

            // Note: ssh2-sftp-client default 'step' progress might not be granualr enough for small files, but works.
            // However, the signature is (total_transferred, chunk, total).

            await sftp.put(createReadStream(localPath), destination, {
                step: (total_transferred: any, _chunk: any, _total: any) => {
                    if (onProgress && totalSize > 0) {
                        // total param in callback is total bytes to transfer, which is known if we pass it, but put() with stream might not know it unless we checked.
                        // We use our known totalSize.
                        const percent = Math.round((total_transferred / totalSize) * 100);
                        onProgress(percent);
                    }
                }
            } as any);

            if (onLog) onLog(`SFTP upload completed successfully`, 'info', 'storage');
            return true;
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
            return [];
        } finally {
            if (sftp) await sftp.end();
        }
    },

    async download(config: SFTPConfig, remotePath: string, localPath: string): Promise<boolean> {
        let sftp: Client | null = null;
        try {
            sftp = await connectSFTP(config);

            const source = config.pathPrefix
                ? path.posix.join(config.pathPrefix, remotePath)
                : remotePath;

            await sftp.get(source, localPath);
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

    async test(config: SFTPConfig): Promise<{ success: boolean; message: string }> {
        let sftp: Client | null = null;
        const testFileName = `.connection-test-${Date.now()}`;
        try {
            sftp = await connectSFTP(config);

            const destination = config.pathPrefix
                ? path.posix.join(config.pathPrefix, testFileName)
                : testFileName;

            // Ensure directory exists if needed - though createWriteStream/put usually needs dir exist
            if (config.pathPrefix) {
                const remoteDir = config.pathPrefix;
                if (await sftp.exists(remoteDir) !== 'd') {
                     await sftp.mkdir(remoteDir, true);
                }
            }

            // 1. Write Test
            await sftp.put(Buffer.from("Connection Test"), destination);

            // 2. Delete Test
            await sftp.delete(destination);

            return { success: true, message: "Connection successful (Write/Delete verified)" };
        } catch (error: unknown) {
            const message = error instanceof Error ? error.message : String(error);
            return { success: false, message: `SFTP Connection failed: ${message}` };
        } finally {
            if (sftp) await sftp.end();
        }
    }

};
