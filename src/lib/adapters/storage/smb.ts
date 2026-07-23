import { StorageAdapter, StorageSession, FileInfo, SnapshotHandle } from "@/lib/core/interfaces";
import { probeSnapshotSupport, createShadowCopy, releaseShadowCopy, findOrphanedShadowCopies } from "./smb-vss";
import { SMBSchema } from "@/lib/adapters/definitions";
import SambaClient from "samba-client";
import path from "path";
import fs from "fs/promises";
import os from "os";
import { LogLevel, LogType } from "@/lib/core/logs";
import { logger } from "@/lib/logging/logger";
import { wrapError } from "@/lib/logging/errors";

const log = logger.child({ adapter: "smb" });

function sanitizeSmbError(error: unknown, password?: string): Error {
    const original = error instanceof Error ? error : new Error(String(error));
    if (!password) return original;
    const sanitized = original.message.split(password).join("****");
    const out = new Error(sanitized);
    out.stack = original.stack?.split(password).join("****");
    return out;
}

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

/**
 * Performs a single upload on an already-created SambaClient. The directory
 * cache prevents redundant mkdir calls when reused across multiple uploads
 * in the same session.
 *
 * Note: the underlying `samba-client` library still spawns a new `smbclient`
 * subprocess for every `sendFile`/`mkdir` call, so the per-call TCP/SMB
 * negotiation overhead remains. Full connection reuse would require switching
 * to a different SMB library.
 */
async function performSmbUpload(
    client: SambaClient,
    config: SMBConfig,
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
            dirCache.add(dir);
        }

        if (onLog) onLog(`Starting SMB upload to: ${destination}`, "info", "storage");

        await client.sendFile(localPath, destination);

        if (onProgress) onProgress(100);
        if (onLog) onLog("SMB upload completed successfully", "info", "storage");
        return true;
    } catch (error: unknown) {
        const safe = sanitizeSmbError(error, config.password);
        log.error("SMB upload failed", { address: config.address, remotePath }, wrapError(safe));
        if (onLog) onLog(`SMB upload failed: ${safe.message}`, "error", "storage", safe.stack);
        return false;
    }
}

export const SMBAdapter: StorageAdapter = {
    id: "smb",
    type: "storage",
    name: "SMB (Samba)",
    configSchema: SMBSchema,
    credentials: { primary: "USERNAME_PASSWORD" },

    async openSession(config: SMBConfig, onLog?): Promise<StorageSession> {
        const client = createClient(config);
        if (onLog) onLog(`Connecting to SMB share ${config.address}`, "info", "storage");
        const dirCache = new Set<string>();
        return {
            upload: (localPath, remotePath, onProgress, uploadLog) =>
                performSmbUpload(client, config, localPath, remotePath, onProgress, uploadLog ?? onLog, dirCache),
            close: async () => { },
        };
    },

    async upload(config: SMBConfig, localPath: string, remotePath: string, onProgress?: (percent: number) => void, onLog?: (msg: string, level?: LogLevel, type?: LogType, details?: string) => void): Promise<boolean> {
        const client = createClient(config);
        if (onLog) onLog(`Connecting to SMB share ${config.address}`, "info", "storage");
        return performSmbUpload(client, config, localPath, remotePath, onProgress, onLog, new Set());
    },

    async download(config: SMBConfig, remotePath: string, localPath: string, _onProgress?: (processed: number, total: number) => void, onLog?: (msg: string, level?: LogLevel, type?: LogType, details?: string) => void): Promise<boolean> {
        try {
            const client = createClient(config);
            const source = resolvePath(config, remotePath);

            if (onLog) onLog(`Downloading from SMB: ${source}`, "info", "storage");

            await client.getFile(source, localPath);
            return true;
        } catch (error: unknown) {
            const safe = sanitizeSmbError(error, config.password);
            log.error("SMB download failed", { address: config.address, remotePath }, wrapError(safe));
            if (onLog) onLog(`SMB download failed: ${safe.message}`, "error", "storage", safe.stack);
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
                    // smbclient's "dir" command requires a glob pattern to list directory contents.
                    // "dir folder" matches the entry itself, "dir folder/*" lists its contents.
                    // For root listing (empty currentDir), "*" lists everything in the share root.
                    const listPath = currentDir ? currentDir + "/*" : "*";
                    items = await client.list(listPath);
                } catch (error: unknown) {
                    // Root directory listing failure means the share is unreachable or inaccessible.
                    // Propagate to trigger the DB fallback in the stats cache.
                    if (currentDir === startDir) throw sanitizeSmbError(error, config.password);
                    // Sub-directory listing failure (e.g. permission denied on one folder): skip silently.
                    return;
                }

                for (const item of items) {
                    // Skip . and .. entries
                    if (item.name === "." || item.name === "..") continue;

                    const fullPath = currentDir
                        ? normalize(currentDir) + "/" + item.name
                        : item.name;

                    if (item.type.includes("D")) {
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
            const safe = sanitizeSmbError(error, config.password);
            log.error("SMB list failed", { address: config.address, dir }, wrapError(safe));
            throw safe;
        }
    },

    async delete(config: SMBConfig, remotePath: string): Promise<boolean> {
        try {
            const client = createClient(config);
            const target = resolvePath(config, remotePath);

            await client.deleteFile(target);
            return true;
        } catch (error: unknown) {
            const safe = sanitizeSmbError(error, config.password);
            log.error("SMB delete failed", { address: config.address, remotePath }, wrapError(safe));
            return false;
        }
    },

    async ping(config: SMBConfig): Promise<{ success: boolean; message: string }> {
        const client = createClient(config);
        try {
            const listPath = config.pathPrefix ? `${config.pathPrefix}/*` : "*";
            await client.list(listPath);
            return { success: true, message: "Connection successful" };
        } catch (error: unknown) {
            const safe = sanitizeSmbError(error, config.password);
            return { success: false, message: `SMB Connection failed: ${safe.message}` };
        }
    },

    async test(config: SMBConfig): Promise<{ success: boolean; message: string }> {
        const ts = new Date().toISOString().slice(0, 19).replace('T', '_').replace(/:/g, '-');
        const testFileName = `.dbackup/test/connection-test-smb-${ts}`;
        const tmpPath = path.join(os.tmpdir(), `connection-test-smb-${ts}`);
        const client = createClient(config);
        const destination = resolvePath(config, testFileName);

        try {
            // Ensure test subfolder exists (two-step: samba-client does not handle nested mkdir)
            await client.mkdir(resolvePath(config, '.dbackup'), '/').catch(() => {});
            await client.mkdir(resolvePath(config, '.dbackup/test'), '/').catch(() => {});

            // Create a temp file to upload
            await fs.writeFile(tmpPath, "Connection Test");

            // 1. Write Test
            await client.sendFile(tmpPath, destination);

            // 2. Delete Test
            await client.deleteFile(destination);

            return { success: true, message: "Connection successful (Write/Delete verified)" };
        } catch (error: unknown) {
            const safe = sanitizeSmbError(error, config.password);
            return { success: false, message: `SMB Connection failed: ${safe.message}` };
        } finally {
            await client.deleteFile(destination).catch(() => {});
            await fs.unlink(tmpPath).catch(() => {});
        }
    },

    // ── Shadow copies (MS-FSRVP) ─────────────────────────────────────────────
    // Only useful for a directory source: snapshotting the place backups are written to
    // gains nothing. The role check lives in the form and the API, not here - the adapter
    // just exposes the capability.

    async supportsSnapshot(config: SMBConfig): Promise<{ supported: boolean; message: string }> {
        return probeSnapshotSupport(config);
    },

    async createSnapshot(config: SMBConfig): Promise<SnapshotHandle> {
        return createShadowCopy(config);
    },

    async releaseSnapshot(config: SMBConfig, handle: SnapshotHandle): Promise<void> {
        return releaseShadowCopy(config, handle);
    },

    async findOrphanedSnapshots(config: SMBConfig): Promise<SnapshotHandle[]> {
        return findOrphanedShadowCopies(config);
    },
};
