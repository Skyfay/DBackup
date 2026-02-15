import { StorageAdapter, FileInfo } from "@/lib/core/interfaces";
import { OneDriveSchema } from "@/lib/adapters/definitions";
import { Client } from "@microsoft/microsoft-graph-client";
import fs from "fs/promises";
import { createReadStream, createWriteStream } from "fs";
import path from "path";
import { Readable } from "stream";
import { pipeline } from "stream/promises";
import { LogLevel, LogType } from "@/lib/core/logs";
import { logger } from "@/lib/logger";
import { wrapError } from "@/lib/errors";

const log = logger.child({ adapter: "onedrive" });

interface OneDriveConfig {
    clientId: string;
    clientSecret: string;
    refreshToken?: string;
    folderPath?: string;
}

// Microsoft OAuth token endpoint
const TOKEN_URL = "https://login.microsoftonline.com/common/oauth2/v2.0/token";

// OneDrive upload session threshold: files > 4 MB should use upload session
const SIMPLE_UPLOAD_LIMIT = 4 * 1024 * 1024; // 4 MB
const UPLOAD_CHUNK_SIZE = 10 * 1024 * 1024; // 10 MB chunks for upload session (must be multiple of 320 KiB)

/**
 * Refreshes the access token using the stored refresh token.
 * Microsoft OAuth requires periodic token refresh (access tokens expire after ~1h).
 */
async function getAccessToken(config: OneDriveConfig): Promise<string> {
    if (!config.refreshToken) {
        throw new Error("OneDrive is not authorized. Please click 'Authorize with Microsoft' to connect your account.");
    }

    const body = new URLSearchParams({
        client_id: config.clientId,
        client_secret: config.clientSecret,
        refresh_token: config.refreshToken,
        grant_type: "refresh_token",
        scope: "Files.ReadWrite.All offline_access",
    });

    const res = await fetch(TOKEN_URL, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body,
    });

    if (!res.ok) {
        const errorText = await res.text();
        throw new Error(`Failed to refresh OneDrive access token: ${res.status} - ${errorText}`);
    }

    const data = await res.json();
    return data.access_token;
}

/**
 * Creates an authenticated Microsoft Graph client using OAuth2 refresh token.
 * The client automatically uses the access token for all API calls.
 */
function createGraphClient(accessToken: string): Client {
    return Client.init({
        authProvider: (done) => {
            done(null, accessToken);
        },
    });
}

/**
 * Builds the OneDrive API path for a given file path relative to the user's drive root.
 * Uses the /me/drive/root:/path:/... format for path-based API access.
 */
function buildDrivePath(basePath: string | undefined, relativePath: string): string {
    const base = basePath?.replace(/^\/+|\/+$/g, "") || "";
    const rel = relativePath.replace(/^\/+/, "");
    const fullPath = base ? `${base}/${rel}` : rel;
    return fullPath;
}

/**
 * Gets the drive item path for API calls.
 * Returns "/me/drive/root:/{path}:" for path-based access.
 */
function driveItemPath(filePath: string): string {
    return `/me/drive/root:/${filePath}:`;
}

/**
 * Ensures all parent folders exist for a given path.
 * OneDrive auto-creates parent folders on upload, but this is used for explicit folder creation.
 */
async function ensureFolderExists(client: Client, folderPath: string): Promise<void> {
    const segments = folderPath.split("/").filter(Boolean);
    let currentPath = "";

    for (const segment of segments) {
        const parentPath = currentPath
            ? `/me/drive/root:/${currentPath}:/children`
            : "/me/drive/root/children";

        try {
            await client.api(parentPath).post({
                name: segment,
                folder: {},
                "@microsoft.graph.conflictBehavior": "fail",
            });
        } catch (error: unknown) {
            // Ignore conflict errors — folder already exists
            const errStr = String(error);
            if (!errStr.includes("nameAlreadyExists") && !errStr.includes("409")) {
                throw error;
            }
        }

        currentPath = currentPath ? `${currentPath}/${segment}` : segment;
    }
}

/**
 * Lists all files recursively under a OneDrive folder.
 * Returns a flat list with relative paths.
 */
async function listFilesRecursive(
    client: Client,
    folderPath: string,
    prefix: string
): Promise<FileInfo[]> {
    const files: FileInfo[] = [];

    const apiPath = folderPath
        ? `/me/drive/root:/${folderPath}:/children`
        : "/me/drive/root/children";

    let url: string | null = apiPath;

    while (url) {
        const res = await client.api(url)
            .select("id,name,size,lastModifiedDateTime,folder,file")
            .top(200)
            .get();

        for (const item of res.value || []) {
            const relativePath = prefix ? `${prefix}/${item.name}` : item.name;

            if (item.folder) {
                // Recurse into subfolder
                const subFolderPath = folderPath
                    ? `${folderPath}/${item.name}`
                    : item.name;
                const subFiles = await listFilesRecursive(client, subFolderPath, relativePath);
                files.push(...subFiles);
            } else {
                files.push({
                    name: item.name,
                    path: relativePath,
                    size: item.size || 0,
                    lastModified: new Date(item.lastModifiedDateTime || Date.now()),
                });
            }
        }

        // Handle pagination
        url = res["@odata.nextLink"] || null;
    }

    return files;
}

export const OneDriveAdapter: StorageAdapter = {
    id: "onedrive",
    type: "storage",
    name: "Microsoft OneDrive",
    configSchema: OneDriveSchema,

    async upload(
        config: OneDriveConfig,
        localPath: string,
        remotePath: string,
        onProgress?: (percent: number) => void,
        onLog?: (msg: string, level?: LogLevel, type?: LogType, details?: string) => void
    ): Promise<boolean> {
        try {
            const accessToken = await getAccessToken(config);
            const client = createGraphClient(accessToken);
            const drivePath = buildDrivePath(config.folderPath, remotePath);
            const fileName = path.basename(drivePath);
            const dirPath = path.posix.dirname(drivePath);

            if (onLog) onLog(`Starting OneDrive upload: ${drivePath}`, "info", "storage");

            // Ensure parent folder exists
            if (dirPath && dirPath !== ".") {
                await ensureFolderExists(client, dirPath);
            }

            const stats = await fs.stat(localPath);
            const fileSize = stats.size;

            if (fileSize <= SIMPLE_UPLOAD_LIMIT) {
                // Simple upload for small files (< 4 MB)
                const contents = await fs.readFile(localPath);
                await client
                    .api(`${driveItemPath(drivePath)}/content`)
                    .put(contents);
            } else {
                // Create upload session for large files
                const session = await client
                    .api(`${driveItemPath(drivePath)}/createUploadSession`)
                    .post({
                        item: {
                            "@microsoft.graph.conflictBehavior": "replace",
                            name: fileName,
                        },
                    });

                const uploadUrl = session.uploadUrl;
                const fileStream = createReadStream(localPath, { highWaterMark: UPLOAD_CHUNK_SIZE });
                let offset = 0;

                for await (const chunk of fileStream) {
                    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
                    const end = offset + buffer.length - 1;

                    await fetch(uploadUrl, {
                        method: "PUT",
                        headers: {
                            "Content-Range": `bytes ${offset}-${end}/${fileSize}`,
                            "Content-Length": String(buffer.length),
                        },
                        body: buffer,
                    });

                    offset += buffer.length;

                    if (onProgress) {
                        onProgress(Math.min(99, Math.round((offset / fileSize) * 100)));
                    }
                }
            }

            if (onProgress) onProgress(100);
            if (onLog) onLog(`OneDrive upload completed: ${drivePath} (${fileSize} bytes)`, "info", "storage");
            return true;
        } catch (error: unknown) {
            log.error("OneDrive upload failed", { remotePath }, wrapError(error));
            if (onLog) onLog(`OneDrive upload failed: ${error instanceof Error ? error.message : String(error)}`, "error", "storage");
            return false;
        }
    },

    async download(
        config: OneDriveConfig,
        remotePath: string,
        localPath: string,
        onProgress?: (processed: number, total: number) => void,
        onLog?: (msg: string, level?: LogLevel, type?: LogType, details?: string) => void
    ): Promise<boolean> {
        try {
            const accessToken = await getAccessToken(config);
            const client = createGraphClient(accessToken);
            const drivePath = buildDrivePath(config.folderPath, remotePath);

            if (onLog) onLog(`Starting OneDrive download: ${drivePath}`, "info", "storage");

            // Ensure local directory exists
            await fs.mkdir(path.dirname(localPath), { recursive: true });

            // Get the download URL from the drive item
            const item = await client
                .api(driveItemPath(drivePath))
                .select("id,size,@microsoft.graph.downloadUrl")
                .get();

            const downloadUrl = item["@microsoft.graph.downloadUrl"];
            if (!downloadUrl) {
                throw new Error("Could not get download URL for file");
            }

            // Download using streaming fetch
            const res = await fetch(downloadUrl);
            if (!res.ok || !res.body) {
                throw new Error(`Download failed with status ${res.status}`);
            }

            const writeStream = createWriteStream(localPath);
            await pipeline(Readable.fromWeb(res.body as any), writeStream);

            if (onLog) onLog(`OneDrive download completed: ${drivePath}`, "info", "storage");
            return true;
        } catch (error: unknown) {
            log.error("OneDrive download failed", { remotePath }, wrapError(error));
            if (onLog) onLog(`OneDrive download failed: ${error instanceof Error ? error.message : String(error)}`, "error", "storage");
            return false;
        }
    },

    async read(config: OneDriveConfig, remotePath: string): Promise<string | null> {
        try {
            const accessToken = await getAccessToken(config);
            const client = createGraphClient(accessToken);
            const drivePath = buildDrivePath(config.folderPath, remotePath);

            // Get the download URL
            const item = await client
                .api(driveItemPath(drivePath))
                .select("@microsoft.graph.downloadUrl")
                .get();

            const downloadUrl = item["@microsoft.graph.downloadUrl"];
            if (!downloadUrl) return null;

            const res = await fetch(downloadUrl);
            if (!res.ok) return null;

            return await res.text();
        } catch {
            return null;
        }
    },

    async list(config: OneDriveConfig, dir: string = ""): Promise<FileInfo[]> {
        try {
            const accessToken = await getAccessToken(config);
            const client = createGraphClient(accessToken);
            const basePath = config.folderPath?.replace(/^\/+|\/+$/g, "") || "";
            const listPath = dir && dir !== "."
                ? (basePath ? `${basePath}/${dir}` : dir)
                : basePath;

            return await listFilesRecursive(client, listPath, dir || "");
        } catch (error: unknown) {
            log.error("OneDrive list failed", { dir }, wrapError(error));
            return [];
        }
    },

    async delete(config: OneDriveConfig, remotePath: string): Promise<boolean> {
        try {
            const accessToken = await getAccessToken(config);
            const client = createGraphClient(accessToken);
            const drivePath = buildDrivePath(config.folderPath, remotePath);

            await client.api(driveItemPath(drivePath)).delete();
            return true;
        } catch (error: unknown) {
            // If file doesn't exist, treat as success
            const errStr = String(error);
            if (errStr.includes("itemNotFound") || errStr.includes("404")) {
                return true;
            }
            log.error("OneDrive delete failed", { remotePath }, wrapError(error));
            return false;
        }
    },

    async test(config: OneDriveConfig): Promise<{ success: boolean; message: string }> {
        try {
            const accessToken = await getAccessToken(config);
            const client = createGraphClient(accessToken);

            // Test 1: Verify we can access the drive
            const drive = await client.api("/me/drive").select("id,owner").get();
            const ownerName = drive.owner?.user?.displayName || "Unknown";

            // Test 2: Verify folder path exists (or root)
            const basePath = config.folderPath?.replace(/^\/+|\/+$/g, "") || "";
            if (basePath) {
                try {
                    const folder = await client
                        .api(driveItemPath(basePath))
                        .select("id,folder")
                        .get();
                    if (!folder.folder) {
                        return { success: false, message: `The specified path "${basePath}" is not a folder.` };
                    }
                } catch {
                    // Try to create the folder
                    try {
                        await ensureFolderExists(client, basePath);
                    } catch (createErr: unknown) {
                        return { success: false, message: `Folder "${basePath}" does not exist and could not be created.` };
                    }
                }
            }

            // Test 3: Write and delete a test file
            const testFileName = `.dbackup-test-${Date.now()}.txt`;
            const testPath = basePath ? `${basePath}/${testFileName}` : testFileName;

            await client
                .api(`${driveItemPath(testPath)}/content`)
                .put(Buffer.from("Connection Test"));

            await client.api(driveItemPath(testPath)).delete();

            return {
                success: true,
                message: `Connection successful — Owner: ${ownerName} (Write/Delete verified)`,
            };
        } catch (error: unknown) {
            const message = error instanceof Error ? error.message : String(error);

            if (message.includes("invalid_grant") || message.includes("AADSTS")) {
                return { success: false, message: "Authorization expired. Please re-authorize with Microsoft." };
            }
            if (message.includes("not authorized") || message.includes("Authorize")) {
                return { success: false, message };
            }

            return { success: false, message: `OneDrive connection failed: ${message}` };
        }
    },
};
