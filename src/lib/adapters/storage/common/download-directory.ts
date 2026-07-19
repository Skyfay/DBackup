import fs from "fs/promises";
import path from "path";
import { minimatch } from "minimatch";
import { StorageAdapter, AdapterConfig, DirectoryDownloadResult, DirectoryFileEntry } from "@/lib/core/interfaces";
import { LogLevel, LogType } from "@/lib/core/logs";

/**
 * Returns true if relativePath matches any of the given glob patterns.
 * matchBase lets a slash-free pattern (e.g. "*.tmp") match against the basename at any
 * depth, while a pattern containing a slash (e.g. "cache/**") matches the full relative path.
 */
export function matchesAnyExcludePattern(relativePath: string, patterns?: string[]): boolean {
    if (!patterns || patterns.length === 0) return false;
    return patterns.some((pattern) => pattern.trim().length > 0 && minimatch(relativePath, pattern, { dot: true, matchBase: true }));
}

/** Strips a queried remotePath prefix from a FileInfo.path (which list() returns relative to the adapter root). */
export function toRelativePath(filePath: string, remotePath: string): string {
    const normalizedFile = filePath.replace(/\\/g, "/").replace(/^\/+/, "");
    const normalizedRoot = remotePath.replace(/\\/g, "/").replace(/^\/+|\/+$/g, "");
    if (normalizedRoot && normalizedFile.startsWith(`${normalizedRoot}/`)) {
        return normalizedFile.slice(normalizedRoot.length + 1);
    }
    if (normalizedRoot && normalizedFile === normalizedRoot) {
        return path.basename(normalizedFile);
    }
    return normalizedFile;
}

type OnProgress = (processedBytes: number, totalBytes: number, processedFiles: number, totalFiles: number) => void;
type OnLog = (msg: string, level?: LogLevel, type?: LogType, details?: string) => void;

/**
 * Generic fallback for StorageAdapter.downloadDirectory: lists the remote directory tree
 * (adapters already implement recursive list()) and downloads each file individually via
 * the adapter's existing download(). Used by every storage adapter that doesn't implement
 * downloadDirectory natively (all except Rsync, which has its own optimized implementation
 * to preserve its delta-transfer advantage).
 */
export async function downloadDirectoryGeneric(
    adapter: StorageAdapter,
    config: AdapterConfig,
    remotePath: string,
    localPath: string,
    excludePatterns?: string[],
    onProgress?: OnProgress,
    onLog?: OnLog
): Promise<DirectoryDownloadResult> {
    const allFiles = await adapter.list(config, remotePath);

    const entries: { relativePath: string; sourcePath: string; size: number; lastModified: Date }[] = [];
    for (const file of allFiles) {
        const relativePath = toRelativePath(file.path, remotePath);
        if (matchesAnyExcludePattern(relativePath, excludePatterns)) continue;
        entries.push({ relativePath, sourcePath: file.path, size: file.size, lastModified: file.lastModified });
    }

    const totalBytes = entries.reduce((sum, e) => sum + e.size, 0);
    const totalFiles = entries.length;
    let processedBytes = 0;
    let processedFiles = 0;

    const resultEntries: DirectoryFileEntry[] = [];

    for (const entry of entries) {
        const localFilePath = path.join(localPath, entry.relativePath);
        await fs.mkdir(path.dirname(localFilePath), { recursive: true });

        const success = await adapter.download(config, entry.sourcePath, localFilePath, undefined, onLog);
        if (!success) {
            onLog?.(`Failed to download ${entry.sourcePath}, skipping`, "warning");
            continue;
        }

        processedBytes += entry.size;
        processedFiles++;
        onProgress?.(processedBytes, totalBytes, processedFiles, totalFiles);

        resultEntries.push({ relativePath: entry.relativePath, size: entry.size, lastModified: entry.lastModified });
    }

    return { files: resultEntries.length, bytes: processedBytes, entries: resultEntries };
}

/**
 * Dispatches to the adapter's native downloadDirectory() if implemented (e.g. Rsync),
 * otherwise falls back to the generic list()+download() loop.
 */
export async function downloadDirectory(
    adapter: StorageAdapter,
    config: AdapterConfig,
    remotePath: string,
    localPath: string,
    excludePatterns?: string[],
    onProgress?: OnProgress,
    onLog?: OnLog
): Promise<DirectoryDownloadResult> {
    if (adapter.downloadDirectory) {
        return adapter.downloadDirectory(config, remotePath, localPath, excludePatterns, onProgress, onLog);
    }
    return downloadDirectoryGeneric(adapter, config, remotePath, localPath, excludePatterns, onProgress, onLog);
}
