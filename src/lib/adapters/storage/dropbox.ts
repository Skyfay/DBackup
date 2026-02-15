import { StorageAdapter, FileInfo } from "@/lib/core/interfaces";
import { DropboxSchema } from "@/lib/adapters/definitions";
import { Dropbox } from "dropbox";
import fs from "fs/promises";
import { createReadStream, createWriteStream } from "fs";
import path from "path";
import { pipeline } from "stream/promises";
import { Readable } from "stream";
import { LogLevel, LogType } from "@/lib/core/logs";
import { logger } from "@/lib/logger";
import { wrapError } from "@/lib/errors";

const log = logger.child({ adapter: "dropbox" });

interface DropboxConfig {
    clientId: string;
    clientSecret: string;
    refreshToken?: string;
    folderPath?: string;
}

// Dropbox limits simple upload to 150 MB
const UPLOAD_CHUNK_SIZE = 8 * 1024 * 1024; // 8 MB per chunk for session upload
const SIMPLE_UPLOAD_LIMIT = 150 * 1024 * 1024; // 150 MB

/**
 * Creates an authenticated Dropbox client using OAuth2 refresh token.
 * The SDK handles automatic token refresh with clientId + clientSecret + refreshToken.
 */
function createDropboxClient(config: DropboxConfig): Dropbox {
    if (!config.refreshToken) {
        throw new Error("Dropbox is not authorized. Please click 'Authorize with Dropbox' to connect your account.");
    }

    return new Dropbox({
        clientId: config.clientId,
        clientSecret: config.clientSecret,
        refreshToken: config.refreshToken,
        fetch: fetch,
    });
}

/**
 * Builds the full Dropbox path from the configured base folder + relative path.
 * Dropbox paths must start with "/" and be lowercase-normalized by the API.
 */
function buildDropboxPath(basePath: string | undefined, relativePath: string): string {
    const base = basePath?.replace(/\/+$/, "") || "";
    const rel = relativePath.replace(/^\/+/, "");
    const fullPath = `${base}/${rel}`;
    // Ensure path starts with /
    return fullPath.startsWith("/") ? fullPath : `/${fullPath}`;
}

/**
 * Ensures all parent folders exist for a given path.
 * Dropbox auto-creates parent folders on upload, but for explicit folder creation.
 */
async function ensureFolderExists(dbx: Dropbox, folderPath: string): Promise<void> {
    const dirPath = path.posix.dirname(folderPath);
    if (dirPath === "/" || dirPath === ".") return;

    try {
        await dbx.filesCreateFolderV2({ path: dirPath, autorename: false });
    } catch (error: unknown) {
        // Ignore "path/conflict/folder" errors — folder already exists
        const errStr = JSON.stringify(error);
        if (!errStr.includes("path/conflict") && !errStr.includes("already exists")) {
            throw error;
        }
    }
}

/**
 * Recursively lists all files under a Dropbox folder.
 */
async function listFilesRecursive(
    dbx: Dropbox,
    folderPath: string,
    basePrefix: string
): Promise<FileInfo[]> {
    const files: FileInfo[] = [];

    let result = await dbx.filesListFolder({
        path: folderPath,
        recursive: true,
        limit: 2000,
    });

    const processEntries = (entries: typeof result.result.entries) => {
        for (const entry of entries) {
            if (entry[".tag"] === "file") {
                // Build relative path by stripping the base folder path
                let relativePath = entry.path_display || entry.path_lower || "";
                if (basePrefix && relativePath.startsWith(basePrefix)) {
                    relativePath = relativePath.slice(basePrefix.length).replace(/^\//, "");
                }

                files.push({
                    name: entry.name,
                    path: relativePath,
                    size: (entry as any).size || 0,
                    lastModified: new Date((entry as any).server_modified || Date.now()),
                });
            }
        }
    };

    processEntries(result.result.entries);

    while (result.result.has_more) {
        result = await dbx.filesListFolderContinue({
            cursor: result.result.cursor,
        });
        processEntries(result.result.entries);
    }

    return files;
}

export const DropboxAdapter: StorageAdapter = {
    id: "dropbox",
    type: "storage",
    name: "Dropbox",
    configSchema: DropboxSchema,

    async upload(
        config: DropboxConfig,
        localPath: string,
        remotePath: string,
        onProgress?: (percent: number) => void,
        onLog?: (msg: string, level?: LogLevel, type?: LogType, details?: string) => void
    ): Promise<boolean> {
        try {
            const dbx = createDropboxClient(config);
            const dropboxPath = buildDropboxPath(config.folderPath, remotePath);

            if (onLog) onLog(`Starting Dropbox upload: ${dropboxPath}`, "info", "storage");

            const stats = await fs.stat(localPath);
            const fileSize = stats.size;

            if (fileSize <= SIMPLE_UPLOAD_LIMIT) {
                // Simple upload for files <= 150 MB
                const contents = await fs.readFile(localPath);
                await dbx.filesUpload({
                    path: dropboxPath,
                    contents,
                    mode: { ".tag": "overwrite" },
                    autorename: false,
                });
            } else {
                // Session upload for large files
                const fileStream = createReadStream(localPath, { highWaterMark: UPLOAD_CHUNK_SIZE });
                let sessionId: string | undefined;
                let offset = 0;

                for await (const chunk of fileStream) {
                    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);

                    if (!sessionId) {
                        // Start session
                        const startRes = await dbx.filesUploadSessionStart({
                            close: false,
                            contents: buffer,
                        });
                        sessionId = startRes.result.session_id;
                        offset = buffer.length;
                    } else {
                        const isLast = offset + buffer.length >= fileSize;

                        if (isLast) {
                            // Finish session
                            await dbx.filesUploadSessionFinish({
                                cursor: { session_id: sessionId, offset },
                                commit: {
                                    path: dropboxPath,
                                    mode: { ".tag": "overwrite" },
                                    autorename: false,
                                },
                                contents: buffer,
                            });
                        } else {
                            // Append to session
                            await dbx.filesUploadSessionAppendV2({
                                cursor: { session_id: sessionId, offset },
                                close: false,
                                contents: buffer,
                            });
                        }
                        offset += buffer.length;
                    }

                    if (onProgress) {
                        onProgress(Math.min(99, Math.round((offset / fileSize) * 100)));
                    }
                }
            }

            if (onProgress) onProgress(100);
            if (onLog) onLog(`Dropbox upload completed: ${dropboxPath} (${fileSize} bytes)`, "info", "storage");
            return true;
        } catch (error: unknown) {
            log.error("Dropbox upload failed", { remotePath }, wrapError(error));
            if (onLog) onLog(`Dropbox upload failed: ${error instanceof Error ? error.message : String(error)}`, "error", "storage");
            return false;
        }
    },

    async download(
        config: DropboxConfig,
        remotePath: string,
        localPath: string,
        onProgress?: (processed: number, total: number) => void,
        onLog?: (msg: string, level?: LogLevel, type?: LogType, details?: string) => void
    ): Promise<boolean> {
        try {
            const dbx = createDropboxClient(config);
            const dropboxPath = buildDropboxPath(config.folderPath, remotePath);

            if (onLog) onLog(`Starting Dropbox download: ${dropboxPath}`, "info", "storage");

            // Ensure local directory exists
            await fs.mkdir(path.dirname(localPath), { recursive: true });

            const res = await dbx.filesDownload({ path: dropboxPath });
            const fileData = (res.result as any).fileBinary;

            if (fileData) {
                await fs.writeFile(localPath, fileData);
            } else {
                // Some environments return result differently
                const buffer = Buffer.from(JSON.stringify(res.result));
                await fs.writeFile(localPath, buffer);
            }

            if (onLog) onLog(`Dropbox download completed: ${dropboxPath}`, "info", "storage");
            return true;
        } catch (error: unknown) {
            log.error("Dropbox download failed", { remotePath }, wrapError(error));
            if (onLog) onLog(`Dropbox download failed: ${error instanceof Error ? error.message : String(error)}`, "error", "storage");
            return false;
        }
    },

    async read(config: DropboxConfig, remotePath: string): Promise<string | null> {
        try {
            const dbx = createDropboxClient(config);
            const dropboxPath = buildDropboxPath(config.folderPath, remotePath);

            const res = await dbx.filesDownload({ path: dropboxPath });
            const fileData = (res.result as any).fileBinary;

            if (fileData) {
                return Buffer.isBuffer(fileData) ? fileData.toString("utf-8") : String(fileData);
            }

            return null;
        } catch {
            return null;
        }
    },

    async list(config: DropboxConfig, dir: string = ""): Promise<FileInfo[]> {
        try {
            const dbx = createDropboxClient(config);
            const basePath = config.folderPath?.replace(/\/+$/, "") || "";
            const listPath = dir && dir !== "."
                ? buildDropboxPath(config.folderPath, dir)
                : (basePath || "");

            return await listFilesRecursive(dbx, listPath, basePath);
        } catch (error: unknown) {
            log.error("Dropbox list failed", { dir }, wrapError(error));
            return [];
        }
    },

    async delete(config: DropboxConfig, remotePath: string): Promise<boolean> {
        try {
            const dbx = createDropboxClient(config);
            const dropboxPath = buildDropboxPath(config.folderPath, remotePath);

            await dbx.filesDeleteV2({ path: dropboxPath });
            return true;
        } catch (error: unknown) {
            // If file doesn't exist, treat as success
            const errStr = String(error);
            if (errStr.includes("path_lookup/not_found") || errStr.includes("not_found")) {
                return true;
            }
            log.error("Dropbox delete failed", { remotePath }, wrapError(error));
            return false;
        }
    },

    async test(config: DropboxConfig): Promise<{ success: boolean; message: string }> {
        try {
            const dbx = createDropboxClient(config);
            const basePath = config.folderPath?.replace(/\/+$/, "") || "";

            // Test 1: Verify we can access the account
            const account = await dbx.usersGetCurrentAccount();
            const displayName = account.result.name?.display_name || "Unknown";

            // Test 2: Verify folder path exists (or root)
            if (basePath) {
                try {
                    const meta = await dbx.filesGetMetadata({ path: basePath });
                    if (meta.result[".tag"] !== "folder") {
                        return { success: false, message: `The specified path "${basePath}" is not a folder.` };
                    }
                } catch {
                    // Try to create the folder
                    try {
                        await dbx.filesCreateFolderV2({ path: basePath, autorename: false });
                    } catch (createErr: unknown) {
                        const errStr = JSON.stringify(createErr);
                        if (!errStr.includes("path/conflict")) {
                            return { success: false, message: `Folder "${basePath}" does not exist and could not be created.` };
                        }
                    }
                }
            }

            // Test 3: Write and delete a test file
            const testPath = basePath
                ? `${basePath}/.dbackup-test-${Date.now()}`
                : `/.dbackup-test-${Date.now()}`;

            await dbx.filesUpload({
                path: testPath,
                contents: Buffer.from("Connection Test"),
                mode: { ".tag": "overwrite" },
            });

            await dbx.filesDeleteV2({ path: testPath });

            return {
                success: true,
                message: `Connection successful — Account: ${displayName} (Write/Delete verified)`,
            };
        } catch (error: unknown) {
            const message = error instanceof Error ? error.message : String(error);

            if (message.includes("invalid_access_token") || message.includes("expired_access_token")) {
                return { success: false, message: "Authorization expired. Please re-authorize with Dropbox." };
            }
            if (message.includes("not authorized") || message.includes("Authorize")) {
                return { success: false, message };
            }

            return { success: false, message: `Dropbox connection failed: ${message}` };
        }
    },
};
