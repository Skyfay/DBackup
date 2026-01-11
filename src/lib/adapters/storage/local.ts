import { StorageAdapter } from "@/lib/core/interfaces";
import { z } from "zod";
import fs from "fs/promises";
import path from "path";
import { existsSync, mkdirSync } from "fs";

export const LocalFileSystemAdapter: StorageAdapter = {
    id: "local-filesystem",
    type: "storage",
    name: "Local Filesystem",
    configSchema: z.object({
        basePath: z.string().min(1, "Base path is required"),
    }),

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

    async list(config: { basePath: string }, remotePath: string = ""): Promise<string[]> {
        try {
            const dirPath = path.join(config.basePath, remotePath);
            if (!existsSync(dirPath)) {
                return [];
            }

            const files = await fs.readdir(dirPath);
            // This is a simple list, might want to make it recursive or return more info later
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
