import { StorageAdapter, FileInfo, DirectoryBrowseEntry, ListTreeOptions, ListTreeResult, PrunedDirectory } from "@/lib/core/interfaces";
import { canPruneDirectory } from "@/lib/exclude-patterns";
import { calculateFileChecksum } from "@/lib/crypto/checksum";
import { LogLevel, LogType } from "@/lib/core/logs";
import { LocalStorageSchema } from "@/lib/adapters/definitions";
import fs from "fs/promises";
import path from "path";
import { createReadStream, createWriteStream } from "fs";
import { Readable } from "stream";
import { execFile } from "child_process";
import { promisify } from "util";

const execFileAsync = promisify(execFile);
import { pipeline } from "stream/promises";
import { logger } from "@/lib/logging/logger";
import { wrapError, AdapterError } from "@/lib/logging/errors";
import { STATELESS_READ_CONCURRENCY } from "@/lib/adapters/storage/common/read-concurrency";

const log = logger.child({ adapter: "local-filesystem" });

/**
 * Resolves a remote path against the adapter's configured root, refusing anything that
 * escapes it.
 *
 * Every remote path in DBackup is relative to the adapter's own root, so a leading slash
 * means "the root of this adapter", never the root of the host filesystem. It has to be
 * stripped before resolving: `path.resolve(base, "/restore")` yields `/restore`, because an
 * absolute second argument discards the base entirely - which would reject perfectly
 * ordinary target paths like `/restore` that the UI itself suggests. Every other adapter
 * already behaves this way by using `path.posix.join()`.
 *
 * Stripping is safe: the containment check below still runs on the resolved result, so
 * `/../etc/passwd` and `/restore/../../etc/passwd` are both still rejected.
 */
function resolveSafePath(basePath: string, relativePath: string): string {
    const resolvedBase = path.resolve(basePath);
    const relativeToRoot = relativePath.replace(/^[/\\]+/, "");
    const resolvedTarget = path.resolve(resolvedBase, relativeToRoot);

    // Compared against `base + separator`, not the bare base: a plain prefix check would
    // accept a sibling directory whose name merely starts with the base name (base
    // "/srv/data" would let "/srv/dataEVIL/secret" through).
    if (resolvedTarget !== resolvedBase && !resolvedTarget.startsWith(resolvedBase + path.sep)) {
        throw new AdapterError("local-filesystem", "path-validation", `Access denied: Illegal path traversal detected. Base: ${resolvedBase}, Target: ${resolvedTarget}`);
    }
    return resolvedTarget;
}

/**
 * Walks a local source tree for collection: skipping what is excluded, reporting as it goes,
 * and stopping when asked.
 *
 * Deliberately separate from `list()`, which stays as it is. `list()` also serves retention,
 * integrity checks and the destination browser, where the tree is a flat directory of backup
 * files - none of this applies there, and a symbolic link has no meaning in that context.
 *
 * Uses `readdir` without `recursive`, one directory at a time, for two reasons that both
 * matter here. Node's recursive walk cannot be interrupted and reports nothing until it has
 * read everything, so a large source looked frozen and ignored a cancel. And it silently
 * refuses to descend into a symlinked directory, which is correct behaviour hidden behind a
 * flag - done explicitly, the link gets recorded on the way past instead of vanishing.
 */
async function walkLocalTree(
    basePath: string,
    startDir: string,
    options?: ListTreeOptions
): Promise<ListTreeResult> {
    const files: FileInfo[] = [];
    const pruned: PrunedDirectory[] = [];
    let directoriesRead = 0;

    const walk = async (relDir: string): Promise<void> => {
        options?.signal?.throwIfAborted();

        const currentDir = relDir ? path.join(startDir, relDir) : startDir;
        let entries;
        try {
            entries = await fs.readdir(currentDir, { withFileTypes: true });
        } catch (error) {
            // A directory that cannot be read at all is the walk's own root failing, or one
            // subtree the user has no access to. The root has to propagate so the caller can
            // report an unusable source; a subtree is skipped, matching every other adapter's
            // walker.
            if (relDir === "") throw error;
            return;
        }

        directoriesRead++;
        options?.onProgress?.({
            files: files.length,
            directories: directoriesRead,
            prunedDirectories: pruned.length,
            currentPath: relDir,
        });

        const subdirectories: string[] = [];
        for (const entry of entries) {
            const childRel = relDir ? `${relDir}/${entry.name}` : entry.name;
            const fullPath = path.join(currentDir, entry.name);

            // Checked before isDirectory(), because a Dirent for a link to a directory
            // answers isSymbolicLink() and nothing else - asking the other way round is how
            // these went missing in the first place.
            if (entry.isSymbolicLink()) {
                let target: string;
                try {
                    target = await fs.readlink(fullPath);
                } catch (error) {
                    // The link exists but its target cannot be read, which is not the same as
                    // a dangling link (readlink answers fine for those). Nothing to store, so
                    // it is reported as unsupported rather than dropped.
                    log.warn("Could not read symlink target", { path: childRel }, wrapError(error));
                    continue;
                }
                const stats = await fs.lstat(fullPath).catch(() => undefined);
                files.push({
                    name: entry.name,
                    path: path.relative(basePath, fullPath),
                    size: 0,
                    lastModified: stats?.mtime ?? new Date(0),
                    linkTarget: target,
                });
                continue;
            }

            if (entry.isDirectory()) {
                const pattern = canPruneDirectory(childRel, options?.excludePatterns);
                if (pattern) {
                    pruned.push({ path: childRel, pattern });
                    continue;
                }
                subdirectories.push(childRel);
                continue;
            }

            if (!entry.isFile()) continue;

            const stats = await fs.stat(fullPath).catch(() => undefined);
            if (!stats) continue;
            files.push({
                name: entry.name,
                path: path.relative(basePath, fullPath),
                size: stats.size,
                lastModified: stats.mtime,
            });
        }

        // Depth-first and serial. Local directory reads hit the page cache rather than a
        // network round trip, so there is nothing here for parallelism to hide.
        for (const child of subdirectories) await walk(child);
    };

    await walk("");
    return { files, pruned };
}

export const LocalFileSystemAdapter: StorageAdapter = {
    id: "local-filesystem",
    type: "storage",
    name: "Local Filesystem",
    configSchema: LocalStorageSchema,

    async upload(config: { basePath: string }, localPath: string, remotePath: string, onProgress?: (percent: number) => void, onLog?: (msg: string, level?: LogLevel, type?: LogType, details?: string) => void): Promise<boolean> {
        let destPath: string;
        try {
            destPath = resolveSafePath(config.basePath, remotePath);
        } catch (error: unknown) {
            log.error("Local upload security check failed", { basePath: config.basePath, remotePath }, wrapError(error));
            if (onLog && error instanceof Error) onLog(error.message, 'error', 'security');
            throw error; // Rethrow to fail explicitly
        }

        try {
            const destDir = path.dirname(destPath);

            await fs.mkdir(destDir, { recursive: true });

            // fs.copyFile does not support progress, so we use streams
            const fileStat = await fs.stat(localPath);
            const size = fileStat.size;
            let processed = 0;

            const sourceStream = createReadStream(localPath);
            const destStream = createWriteStream(destPath);

            if (onProgress) {
                sourceStream.on('data', (chunk) => {
                    processed += chunk.length;
                    const percent = size > 0 ? Math.round((processed / size) * 100) : 0;
                    onProgress(percent);
                });
            }

            await pipeline(sourceStream, destStream);
            return true;
        } catch (error: unknown) {
            log.error("Local upload failed", { localPath, remotePath }, wrapError(error));
            if (onLog && error instanceof Error) onLog(`Local upload failed: ${error.message}`, 'error', 'general', error.stack);
            return false;
        }
    },

    async downloadRange(
        config: { basePath: string },
        remotePath: string,
        start: number,
        end: number
    ): Promise<NodeJS.ReadableStream> {
        const sourcePath = resolveSafePath(config.basePath, remotePath);
        // An empty range is legal - a zero-length file's archive entry produces one.
        if (end < start) return Readable.from([]);
        return createReadStream(sourcePath, { start, end });
    },

    async download(
        config: { basePath: string },
        remotePath: string,
        localPath: string,
        onProgress?: (processed: number, total: number) => void,
        _onLog?: (msg: string, level?: LogLevel, type?: LogType, details?: string) => void
    ): Promise<boolean> {
        let sourcePath: string;
        try {
            sourcePath = resolveSafePath(config.basePath, remotePath);
        } catch (error) {
             log.error("Local download security check failed", { basePath: config.basePath, remotePath }, wrapError(error));
             throw error;
        }

        try {
            try {
                await fs.access(sourcePath);
            } catch {
                log.warn("File not found for download", { sourcePath });
                return false;
            }

            const localDir = path.dirname(localPath);
            await fs.mkdir(localDir, { recursive: true });

            // Use streaming copy to track progress
            const fileStat = await fs.stat(sourcePath);
            const size = fileStat.size;
            let processed = 0;

            const sourceStream = createReadStream(sourcePath);
            const destStream = createWriteStream(localPath);

            if (onProgress) {
                sourceStream.on('data', (chunk) => {
                    processed += chunk.length;
                    onProgress(processed, size);
                });
            }

            await pipeline(sourceStream, destStream);
            return true;
        } catch (error) {
            log.error("Local download failed", { remotePath, localPath }, wrapError(error));
            return false;
        }
    },

    readConcurrency: STATELESS_READ_CONCURRENCY,

    async read(config: { basePath: string }, remotePath: string): Promise<string | null> {
        try {
             const sourcePath = resolveSafePath(config.basePath, remotePath);
             try {
                 await fs.access(sourcePath);
             } catch {
                 return null;
             }
             return await fs.readFile(sourcePath, 'utf-8');
        } catch (error) {
            // Rethrow security errors
            if (error instanceof Error && error.message.includes("Access denied")) throw error;
            log.error("Local read failed", { remotePath }, wrapError(error));
            return null;
        }
    },

    async list(config: { basePath: string }, remotePath: string = ""): Promise<FileInfo[]> {
        try {
            const dirPath = resolveSafePath(config.basePath, remotePath);
            await fs.access(dirPath);

            const entries = await fs.readdir(dirPath, { withFileTypes: true, recursive: true });

            const files: FileInfo[] = [];

            for (const entry of entries) {
                if (entry.isFile()) {
                    // With recursive: true, entry.name is just the filename and parentPath is its directory.
                    const fullPath = path.join(entry.parentPath, entry.name);
                    const relativePath = path.relative(config.basePath, fullPath);
                    // Retention or an upload can remove a file between readdir and stat. It is gone,
                    // so it is left out instead of failing the whole listing.
                    const stats = await fs.stat(fullPath).catch((error: NodeJS.ErrnoException) => {
                        if (error.code === "ENOENT") return null;
                        throw error;
                    });
                    if (!stats) continue;

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
            if (error instanceof Error && error.message.includes("Access denied")) throw error;
            // A subfolder that does not exist yet is a legitimate empty-result case (no backups for this job yet).
            const nodeErr = error as NodeJS.ErrnoException;
            if (remotePath !== "" && nodeErr.code === "ENOENT") return [];
            // Any other error on a root listing or non-ENOENT failures: throw so the stats cache
            // keeps the last scanned values and sets scanError=true, preventing a false 0-byte snapshot.
            log.error("Local list failed", { remotePath }, wrapError(error));
            throw error;
        }
    },

    async listTree(config: { basePath: string }, remotePath: string = "", options?: ListTreeOptions): Promise<ListTreeResult> {
        const dirPath = resolveSafePath(config.basePath, remotePath);
        try {
            await fs.access(dirPath);
        } catch {
            // A source path that is not there yet lists as empty, same as `list()` does for a
            // missing subfolder. The runner reports the empty collection either way.
            return { files: [], pruned: [] };
        }
        return walkLocalTree(path.resolve(config.basePath), dirPath, options);
    },

    async createSymlink(config: { basePath: string }, remotePath: string, target: string): Promise<void> {
        const linkPath = resolveSafePath(config.basePath, remotePath);
        await fs.mkdir(path.dirname(linkPath), { recursive: true });
        // Replaced rather than merged. `symlink` fails on an existing path, and a restore that
        // stops at the first link the target already has is not a restore. `unlink` is used
        // deliberately instead of `rm -r`: it removes the link itself, never what it points
        // at, so re-running a restore cannot walk through an old link and delete real data.
        await fs.unlink(linkPath).catch(() => { });
        // `target` is written verbatim. Resolving it would break every relative link, which is
        // the common case - `../../archive/cert1.pem` only means anything from where it lives.
        await fs.symlink(target, linkPath);
    },

    async browseDirectories(config: { basePath: string }, subPath: string = ""): Promise<DirectoryBrowseEntry[]> {
        const dirPath = resolveSafePath(config.basePath, subPath);
        let entries;
        try {
            entries = await fs.readdir(dirPath, { withFileTypes: true });
        } catch (error) {
            const nodeErr = error as NodeJS.ErrnoException;
            if (nodeErr.code === "ENOENT") return [];
            log.error("Local browseDirectories failed", { subPath }, wrapError(error));
            throw error;
        }
        return entries
            .filter((entry) => entry.isDirectory())
            .map((entry) => ({
                name: entry.name,
                path: subPath ? `${subPath}/${entry.name}` : entry.name,
            }));
    },

    async delete(config: { basePath: string }, remotePath: string): Promise<boolean> {
        try {
            const targetPath = resolveSafePath(config.basePath, remotePath);
            try {
                await fs.access(targetPath);
            } catch {
                return true; // Already gone
            }

            await fs.unlink(targetPath);
            return true;
        } catch (error) {
             if (error instanceof Error && error.message.includes("Access denied")) throw error;
             log.error("Local delete failed", { remotePath }, wrapError(error));
             return false;
        }
    },

    async verifyChecksum(config: { basePath: string }, remotePath: string, checksums: { sha256?: string; md5?: string }): Promise<'passed' | 'failed' | 'unsupported'> {
        if (!checksums.sha256) return 'unsupported';
        try {
            const filePath = resolveSafePath(config.basePath, remotePath);
            await fs.access(filePath);
            const actual = await calculateFileChecksum(filePath);
            return actual === checksums.sha256 ? 'passed' : 'failed';
        } catch {
            return 'unsupported';
        }
    },

    async ping(config: { basePath: string }): Promise<{ success: boolean; message: string }> {
        try {
            await fs.access(config.basePath, fs.constants.R_OK | fs.constants.W_OK);
            return { success: true, message: `Access to ${config.basePath} verified` };
        } catch (error: unknown) {
            const message = error instanceof Error ? error.message : String(error);
            return { success: false, message: `Access failed: ${message}` };
        }
    },

    async test(config: { basePath: string }): Promise<{ success: boolean; message: string }> {
        const ts = new Date().toISOString().slice(0, 19).replace('T', '_').replace(/:/g, '-');
        const subdir = path.join(config.basePath, '.dbackup', 'test');
        const testFile = path.join(subdir, `connection-test-local-filesystem-${ts}`);
        let written = false;
        try {
            await fs.mkdir(subdir, { recursive: true });
            // On Windows, set the hidden attribute on .dbackup so it doesn't appear in File Explorer
            if (process.platform === 'win32') {
                await execFileAsync('attrib', ['+h', path.join(config.basePath, '.dbackup')]).catch(() => {});
            }

            // 1. Write
            await fs.writeFile(testFile, "Connection Test");
            written = true;

            // 2. Delete
            await fs.unlink(testFile);
            written = false;

            return { success: true, message: `Access to ${config.basePath} verified (Read/Write)` };
        } catch (error: unknown) {
             const message = error instanceof Error ? error.message : String(error);
             return { success: false, message: `Access failed: ${message}` };
        } finally {
            if (written) await fs.unlink(testFile).catch(() => {});
        }
    }
};
