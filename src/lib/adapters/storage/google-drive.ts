import { StorageAdapter, FileInfo } from "@/lib/core/interfaces";
import { GoogleDriveSchema } from "@/lib/adapters/definitions";
import { google, drive_v3 } from "googleapis";
import { Readable } from "stream";
import fs from "fs/promises";
import { createReadStream, createWriteStream } from "fs";
import path from "path";
import { pipeline } from "stream/promises";
import { LogLevel, LogType } from "@/lib/core/logs";
import { logger } from "@/lib/logger";
import { wrapError } from "@/lib/errors";

const log = logger.child({ adapter: "google-drive" });

interface GoogleDriveConfig {
    clientId: string;
    clientSecret: string;
    refreshToken?: string;
    folderId?: string;
}

/**
 * Creates an authenticated Google Drive client using OAuth2 refresh token.
 * Throws if no refresh token is available (user must authorize first).
 */
function createDriveClient(config: GoogleDriveConfig): drive_v3.Drive {
    if (!config.refreshToken) {
        throw new Error("Google Drive is not authorized. Please click 'Authorize with Google' to connect your account.");
    }

    const oauth2Client = new google.auth.OAuth2(
        config.clientId,
        config.clientSecret
    );

    oauth2Client.setCredentials({
        refresh_token: config.refreshToken,
    });

    return google.drive({ version: "v3", auth: oauth2Client });
}

/**
 * Resolves a path like "backups/mysql/daily" into a folder ID by creating
 * folders as needed. Returns the final folder ID.
 * If folderId is set, uses that as root. Otherwise uses Drive root.
 */
async function resolveOrCreatePath(
    drive: drive_v3.Drive,
    baseFolderId: string | undefined,
    relativePath: string
): Promise<string> {
    const parentId = baseFolderId || "root";

    // Get directory part only (strip filename)
    const dirPath = path.posix.dirname(relativePath);
    if (dirPath === "." || dirPath === "/") return parentId;

    const segments = dirPath.split("/").filter(Boolean);
    let currentParent = parentId;

    for (const segment of segments) {
        // Search for existing folder
        const query = `name='${segment.replace(/'/g, "\\'")}' and '${currentParent}' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false`;
        const res = await drive.files.list({
            q: query,
            fields: "files(id, name)",
            spaces: "drive",
        });

        if (res.data.files && res.data.files.length > 0) {
            currentParent = res.data.files[0].id!;
        } else {
            // Create folder
            const folder = await drive.files.create({
                requestBody: {
                    name: segment,
                    mimeType: "application/vnd.google-apps.folder",
                    parents: [currentParent],
                },
                fields: "id",
            });
            currentParent = folder.data.id!;
        }
    }

    return currentParent;
}

/**
 * Finds a file by name in a specific folder.
 */
async function findFile(
    drive: drive_v3.Drive,
    folderId: string,
    fileName: string
): Promise<drive_v3.Schema$File | null> {
    const query = `name='${fileName.replace(/'/g, "\\'")}' and '${folderId}' in parents and trashed=false`;
    const res = await drive.files.list({
        q: query,
        fields: "files(id, name, size, modifiedTime, mimeType)",
        spaces: "drive",
    });

    return res.data.files?.[0] || null;
}

/**
 * Lists all files recursively under a folder.
 * Returns flat list with relative paths.
 */
async function listFilesRecursive(
    drive: drive_v3.Drive,
    folderId: string,
    prefix: string = ""
): Promise<FileInfo[]> {
    const files: FileInfo[] = [];
    let pageToken: string | undefined;

    do {
        const res = await drive.files.list({
            q: `'${folderId}' in parents and trashed=false`,
            fields: "nextPageToken, files(id, name, size, modifiedTime, mimeType)",
            spaces: "drive",
            pageSize: 1000,
            pageToken,
        });

        for (const file of res.data.files || []) {
            const relativePath = prefix ? `${prefix}/${file.name}` : file.name!;

            if (file.mimeType === "application/vnd.google-apps.folder") {
                // Recurse into subfolder
                const subFiles = await listFilesRecursive(drive, file.id!, relativePath);
                files.push(...subFiles);
            } else {
                files.push({
                    name: file.name!,
                    path: relativePath,
                    size: parseInt(file.size || "0", 10),
                    lastModified: new Date(file.modifiedTime || Date.now()),
                });
            }
        }

        pageToken = res.data.nextPageToken || undefined;
    } while (pageToken);

    return files;
}

export const GoogleDriveAdapter: StorageAdapter = {
    id: "google-drive",
    type: "storage",
    name: "Google Drive",
    configSchema: GoogleDriveSchema,

    async upload(
        config: GoogleDriveConfig,
        localPath: string,
        remotePath: string,
        onProgress?: (percent: number) => void,
        onLog?: (msg: string, level?: LogLevel, type?: LogType, details?: string) => void
    ): Promise<boolean> {
        try {
            const drive = createDriveClient(config);
            const fileName = path.basename(remotePath);

            if (onLog) onLog(`Starting Google Drive upload: ${remotePath}`, "info", "storage");

            // Resolve or create folder structure
            const folderId = await resolveOrCreatePath(drive, config.folderId, remotePath);

            // Check if file already exists (for overwrite)
            const existing = await findFile(drive, folderId, fileName);

            // Get file size for progress tracking
            const stats = await fs.stat(localPath);
            const fileSize = stats.size;

            const media = {
                body: createReadStream(localPath),
            };

            if (existing) {
                // Update existing file
                await drive.files.update({
                    fileId: existing.id!,
                    media,
                    fields: "id, name, size",
                });
            } else {
                // Create new file
                await drive.files.create({
                    requestBody: {
                        name: fileName,
                        parents: [folderId],
                    },
                    media,
                    fields: "id, name, size",
                });
            }

            if (onProgress) onProgress(100);
            if (onLog) onLog(`Google Drive upload completed: ${remotePath} (${fileSize} bytes)`, "info", "storage");
            return true;
        } catch (error: unknown) {
            log.error("Google Drive upload failed", { remotePath }, wrapError(error));
            if (onLog) onLog(`Google Drive upload failed: ${error instanceof Error ? error.message : String(error)}`, "error", "storage");
            return false;
        }
    },

    async download(
        config: GoogleDriveConfig,
        remotePath: string,
        localPath: string,
        onProgress?: (processed: number, total: number) => void,
        onLog?: (msg: string, level?: LogLevel, type?: LogType, details?: string) => void
    ): Promise<boolean> {
        try {
            const drive = createDriveClient(config);
            const fileName = path.basename(remotePath);
            const dirPath = path.posix.dirname(remotePath);

            if (onLog) onLog(`Starting Google Drive download: ${remotePath}`, "info", "storage");

            // Actually resolve to the correct parent
            const targetFolderId = await resolveOrCreatePath(drive, config.folderId, dirPath === "." ? "dummy" : dirPath + "/dummy");

            const file = await findFile(drive, targetFolderId, fileName);
            if (!file) {
                if (onLog) onLog(`File not found: ${remotePath}`, "error", "storage");
                return false;
            }

            // Ensure local directory exists
            await fs.mkdir(path.dirname(localPath), { recursive: true });

            const res = await drive.files.get(
                { fileId: file.id!, alt: "media" },
                { responseType: "stream" }
            );

            const writeStream = createWriteStream(localPath);
            await pipeline(res.data as unknown as Readable, writeStream);

            if (onLog) onLog(`Google Drive download completed: ${remotePath}`, "info", "storage");
            return true;
        } catch (error: unknown) {
            log.error("Google Drive download failed", { remotePath }, wrapError(error));
            if (onLog) onLog(`Google Drive download failed: ${error instanceof Error ? error.message : String(error)}`, "error", "storage");
            return false;
        }
    },

    async read(config: GoogleDriveConfig, remotePath: string): Promise<string | null> {
        try {
            const drive = createDriveClient(config);
            const fileName = path.basename(remotePath);
            const dirPath = path.posix.dirname(remotePath);

            // Resolve folder path
            const folderId = dirPath === "."
                ? (config.folderId || "root")
                : await resolveOrCreatePath(drive, config.folderId, dirPath + "/dummy");

            const file = await findFile(drive, folderId, fileName);
            if (!file) return null;

            const res = await drive.files.get(
                { fileId: file.id!, alt: "media" },
                { responseType: "text" }
            );

            return res.data as string;
        } catch {
            return null;
        }
    },

    async list(config: GoogleDriveConfig, dir: string = ""): Promise<FileInfo[]> {
        try {
            const drive = createDriveClient(config);
            let rootFolderId = config.folderId || "root";

            // Navigate to subdir if specified
            if (dir && dir !== ".") {
                rootFolderId = await resolveOrCreatePath(drive, config.folderId, dir + "/dummy");
            }

            return await listFilesRecursive(drive, rootFolderId, dir || "");
        } catch (error: unknown) {
            log.error("Google Drive list failed", { dir }, wrapError(error));
            return [];
        }
    },

    async delete(config: GoogleDriveConfig, remotePath: string): Promise<boolean> {
        try {
            const drive = createDriveClient(config);
            const fileName = path.basename(remotePath);
            const dirPath = path.posix.dirname(remotePath);

            const folderId = dirPath === "."
                ? (config.folderId || "root")
                : await resolveOrCreatePath(drive, config.folderId, dirPath + "/dummy");

            const file = await findFile(drive, folderId, fileName);
            if (!file) return true; // File already gone

            await drive.files.delete({ fileId: file.id! });
            return true;
        } catch (error: unknown) {
            log.error("Google Drive delete failed", { remotePath }, wrapError(error));
            return false;
        }
    },

    async test(config: GoogleDriveConfig): Promise<{ success: boolean; message: string }> {
        try {
            const drive = createDriveClient(config);
            const folderId = config.folderId || "root";

            // Test 1: Verify we can access the folder
            if (config.folderId) {
                const folder = await drive.files.get({
                    fileId: config.folderId,
                    fields: "id, name, mimeType",
                });
                if (folder.data.mimeType !== "application/vnd.google-apps.folder") {
                    return { success: false, message: "The specified Folder ID is not a folder." };
                }
            }

            // Test 2: Write a test file
            const testFileName = `.dbackup-test-${Date.now()}`;
            const testFile = await drive.files.create({
                requestBody: {
                    name: testFileName,
                    parents: [folderId],
                },
                media: {
                    mimeType: "text/plain",
                    body: Readable.from(["Connection Test"]),
                },
                fields: "id",
            });

            // Test 3: Delete the test file
            await drive.files.delete({ fileId: testFile.data.id! });

            return { success: true, message: "Connection successful (Write/Delete verified)" };
        } catch (error: unknown) {
            const message = error instanceof Error ? error.message : String(error);

            if (message.includes("invalid_grant") || message.includes("Token has been expired")) {
                return { success: false, message: "Authorization expired. Please re-authorize with Google." };
            }
            if (message.includes("not authorized") || message.includes("Authorize")) {
                return { success: false, message: message };
            }

            return { success: false, message: `Google Drive connection failed: ${message}` };
        }
    },
};
