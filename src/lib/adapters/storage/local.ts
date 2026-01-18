import { StorageAdapter, FileInfo } from "@/lib/core/interfaces";
import { LocalStorageSchema } from "@/lib/adapters/definitions";
import fs from "fs/promises";
import path from "path";
import { existsSync, statSync } from "fs";

export const LocalFileSystemAdapter: StorageAdapter = {
    id: "local-filesystem",
    type: "storage",
    name: "Local Filesystem",
    configSchema: LocalStorageSchema,

    async upload(config: { basePath: string }, localPath: string, remotePath: string): Promise<boolean> {
        try {
            const destPath = path.join(config.basePath, remotePath);
            const destDir = path.dirname(destPath);

            if (!existsSync(destDir)) {
                await fs.mkdir(destDir, { recursive: true });
            }

            await fs.copyFile(localPath, destPath);
            return true;
        } catch (error) {
            console.error("Local upload failed:", error);
            return false;
        }
    },

    async download(config: { basePath: string }, remotePath: string, localPath: string): Promise<boolean> {
        try {
            const sourcePath = path.join(config.basePath, remotePath);

            if (!existsSync(sourcePath)) {
                console.error("File not found:", sourcePath);
                return false;
            }

            const localDir = path.dirname(localPath);
            if (!existsSync(localDir)) {
                await fs.mkdir(localDir, { recursive: true });
            }

            await fs.copyFile(sourcePath, localPath);
            return true;
        } catch (error) {
            console.error("Local download failed:", error);
            return false;
        }
    },

    async read(config: { basePath: string }, remotePath: string): Promise<string | null> {
        try {
            const sourcePath = path.join(config.basePath, remotePath);
            if (!existsSync(sourcePath)) return null;
            return await fs.readFile(sourcePath, 'utf-8');
        } catch (error) {
            console.error("Local read failed:", error);
            return null;
        }
    },

    async list(config: { basePath: string }, remotePath: string = ""): Promise<FileInfo[]> {
        try {
            const dirPath = path.join(config.basePath, remotePath);
            if (!existsSync(dirPath)) {
                return [];
            }

            const entries = await fs.readdir(dirPath, { withFileTypes: true, recursive: true });

            const files: FileInfo[] = [];

            for (const entry of entries) {
                if (entry.isFile()) {
                    // With recursive: true, entry.name is just the filename, entry.path is the directory
                    const fullPath = path.join(entry.parentPath || entry.path, entry.name); // Node 20+ uses parentPath
                    const relativePath = path.relative(config.basePath, fullPath);
                    const stats = statSync(fullPath);

                    files.push({
                        name: entry.name,
                        path: relativePath,
                        size: stats.size,
                        lastModified: stats.mtime
                    });
                }
            }
            return files;
        } catch (error) {
            console.error("Local list failed:", error);
            return [];
        }
    },

    async delete(config: { basePath: string }, remotePath: string): Promise<boolean> {
        try {
            const targetPath = path.join(config.basePath, remotePath);
            if (!existsSync(targetPath)) return true; // Already gone

            await fs.unlink(targetPath);
            return true;
        } catch (error) {
             console.error("Local delete failed:", error);
             return false;
        }
    }
};
