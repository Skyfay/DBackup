import { StorageAdapter, FileInfo } from "@/lib/core/interfaces";
import { SMBSchema } from "@/lib/adapters/definitions";
import SambaClient from "samba-client";
import path from "path";
import fs from "fs/promises";
import os from "os";
import { LogLevel, LogType } from "@/lib/core/logs";
import { logger } from "@/lib/logger";
import { wrapError } from "@/lib/errors";

const log = logger.child({ adapter: "smb" });

interface SMBConfig {
    address: string;
    username: string;
    password?: string;
    domain?: string;
    maxProtocol: string;
    pathPrefix?: string;
}

/**
 * Creates a SambaClient instance with the given config.
 * The `directory` option is set to pathPrefix if provided.
 */
function createClient(config: SMBConfig): SambaClient {
    return new SambaClient({
        address: config.address,
        username: config.username || "guest",
        password: config.password,
        domain: config.domain,
        maxProtocol: config.maxProtocol || "SMB3",
    });
}

/**
 * Joins the pathPrefix with a relative path using forward slashes.
 */
function resolvePath(config: SMBConfig, relativePath: string): string {
    if (config.pathPrefix) {
        return config.pathPrefix.replace(/\\/g, "/") + "/" + relativePath.replace(/\\/g, "/");
    }
    return relativePath.replace(/\\/g, "/");
}

/**
 * Ensures the parent directory of the given remote path exists.
 */
async function ensureDir(client: SambaClient, remotePath: string): Promise<void> {
    const dir = path.posix.dirname(remotePath);
    if (dir && dir !== "." && dir !== "/") {
        try {
            await client.mkdir(dir, "/");
        } catch {
            // Directory may already exist, ignore errors
        }
    }
}

export const SMBStorageAdapter: StorageAdapter = {
    id: "smb",
    type: "storage",
    name: "SMB (Samba)",
    configSchema: SMBSchema,

    async upload(config: SMBConfig, localPath: string, remotePath: string, onProgress?: (percent: number) => void, onLog?: (msg: string, level?: LogLevel, type?: LogType, details?: string) => void): Promise<boolean> {
        try {
            const client = createClient(config);
            const destination = resolvePath(config, remotePath);

            if (onLog) onLog(`Connecting to SMB share ${config.address}`, "info", "storage");

            // Ensure remote directory exists
            await ensureDir(client, destination);

            if (onLog) onLog(`Starting SMB upload to: ${destination}`, "info", "storage");

            await client.sendFile(localPath, destination);

            if (onProgress) onProgress(100);
            if (onLog) onLog("SMB upload completed successfully", "info", "storage");
            return true;
        } catch (error: unknown) {
            log.error("SMB upload failed", { address: config.address, remotePath }, wrapError(error));
            if (onLog && error instanceof Error) onLog(`SMB upload failed: ${error.message}`, "error", "storage", error.stack);
            return false;
        }
    },

    async download(config: SMBConfig, remotePath: string, localPath: string, _onProgress?: (processed: number, total: number) => void, onLog?: (msg: string, level?: LogLevel, type?: LogType, details?: string) => void): Promise<boolean> {
        try {
            const client = createClient(config);
            const source = resolvePath(config, remotePath);

            if (onLog) onLog(`Downloading from SMB: ${source}`, "info", "storage");

            await client.getFile(source, localPath);
            return true;
        } catch (error: unknown) {
            log.error("SMB download failed", { address: config.address, remotePath }, wrapError(error));
            if (onLog && error instanceof Error) onLog(`SMB download failed: ${error.message}`, "error", "storage", error.stack);
            return false;
        }
    },

    async read(config: SMBConfig, remotePath: string): Promise<string | null> {
        const tmpPath = path.join(os.tmpdir(), `smb-read-${Date.now()}-${Math.random().toString(36).slice(2)}`);
        try {
            const client = createClient(config);
            const source = resolvePath(config, remotePath);

            await client.getFile(source, tmpPath);
            const content = await fs.readFile(tmpPath, "utf-8");
            return content;
        } catch {
            // Quietly fail if file not found (expected for missing .meta.json)
            return null;
        } finally {
            await fs.unlink(tmpPath).catch(() => {});
        }
    },

    async list(config: SMBConfig, dir: string = ""): Promise<FileInfo[]> {
        try {
            const client = createClient(config);

            const normalize = (p: string) => p.replace(/\\/g, "/");

            const prefix = config.pathPrefix ? normalize(config.pathPrefix) : "";
            const startDir = prefix
                ? prefix + (dir ? "/" + normalize(dir) : "")
                : (dir || "");

            const files: FileInfo[] = [];

            const walk = async (currentDir: string) => {
                let items: Array<{ name: string; type: string; size: number; modifyTime: Date }>;
                try {
                    items = await client.list(currentDir || "/");
                } catch {
                    return;
                }

                for (const item of items) {
                    // Skip . and .. entries
                    if (item.name === "." || item.name === "..") continue;

                    const fullPath = currentDir
                        ? normalize(currentDir) + "/" + item.name
                        : item.name;

                    if (item.type === "D") {
                        await walk(fullPath);
                    } else {
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
                            lastModified: item.modifyTime,
                        });
                    }
                }
            };

            await walk(startDir);
            return files;
        } catch (error: unknown) {
            log.error("SMB list failed", { address: config.address, dir }, wrapError(error));
            return [];
        }
    },

    async delete(config: SMBConfig, remotePath: string): Promise<boolean> {
        try {
            const client = createClient(config);
            const target = resolvePath(config, remotePath);

            await client.deleteFile(target);
            return true;
        } catch (error: unknown) {
            log.error("SMB delete failed", { address: config.address, remotePath }, wrapError(error));
            return false;
        }
    },

    async test(config: SMBConfig): Promise<{ success: boolean; message: string }> {
        const testFileName = `.connection-test-${Date.now()}`;
        try {
            const client = createClient(config);
            const destination = resolvePath(config, testFileName);

            // Ensure pathPrefix directory exists if set
            if (config.pathPrefix) {
                try {
                    await client.mkdir(config.pathPrefix, "/");
                } catch {
                    // Directory may already exist
                }
            }

            // Create a temp file to upload
            const tmpPath = path.join(os.tmpdir(), testFileName);
            await fs.writeFile(tmpPath, "Connection Test");

            try {
                // 1. Write Test
                await client.sendFile(tmpPath, destination);

                // 2. Delete Test
                await client.deleteFile(destination);

                return { success: true, message: "Connection successful (Write/Delete verified)" };
            } finally {
                await fs.unlink(tmpPath).catch(() => {});
            }
        } catch (error: unknown) {
            const message = error instanceof Error ? error.message : String(error);
            return { success: false, message: `SMB Connection failed: ${message}` };
        }
    },
};
