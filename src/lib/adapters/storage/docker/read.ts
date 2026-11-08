/**
 * Reading a volume out of its helper container.
 *
 * One tar stream per volume, streamed straight to disk. The generic collection path lists a
 * tree and then fetches each file, which for a volume would mean a round trip per file
 * through the Docker API - so this adapter implements `downloadDirectory` natively, the same
 * reason Rsync does.
 *
 * Everything the archive needs comes out of the tar headers: sizes, timestamps, symlink
 * targets, and the permissions and owners that decide whether a restored volume is one a
 * database will start on.
 */

import { createWriteStream } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import { extract, type Headers as TarHeaders } from "tar-stream";

import type {
    DirectoryDownloadOptions,
    DirectoryDownloadResult,
    DirectoryFileEntry,
} from "@/lib/core/interfaces";
import type { LogLevel, LogType } from "@/lib/core/logs";
import { matchesAnyExcludePattern } from "@/lib/exclude-patterns";
import { summariseExcluded, formatExcludeSummary } from "@/lib/exclude-summary";
import { sessionFromConfig } from "./session";
import { mountPathFor } from "./temp-container";
import { collectedPathProblem, resolveCollectedPath, shownCollectedPath } from "@/lib/archive/collected-paths";
import { createListingGuard, ListingTooLargeError } from "../common/listing-limits";
import { stripTrailingSlashes } from "@/lib/paths";

type OnProgress = (processedBytes: number, totalBytes: number, processedFiles: number, totalFiles: number) => void;
type OnLog = (msg: string, level?: LogLevel, type?: LogType, details?: string) => void;

/** How often a stream still arriving may report. Matches the generic path's interval. */
const PROGRESS_INTERVAL_MS = 250;

export async function downloadVolume(
    config: Record<string, unknown>,
    volume: string,
    localPath: string,
    excludePatterns?: string[],
    onProgress?: OnProgress,
    onLog?: OnLog,
    options?: DirectoryDownloadOptions,
): Promise<DirectoryDownloadResult> {
    const session = sessionFromConfig(config);
    await fs.mkdir(localPath, { recursive: true });

    const entries: DirectoryFileEntry[] = [];
    const failures: { path: string; error: string }[] = [];
    const excluded: { path: string; size: number }[] = [];
    let processedBytes = 0;
    let processedFiles = 0;
    let lastReport = 0;

    // Counted by the helper before the export started. Zero when it could not be run, and
    // the caller then renders a running count instead of an "x of y" it cannot honour.
    const totalFiles = session.entryCounts?.get(volume) ?? 0;

    const report = (force = false) => {
        const now = Date.now();
        if (!force && now - lastReport < PROGRESS_INTERVAL_MS) return;
        lastReport = now;
        // Total bytes stay unknown: counting files walks directory entries, adding up their
        // sizes portably would mean reading them. Progress follows the file count instead,
        // which is what the caller falls back to when no byte total is given.
        onProgress?.(processedBytes, 0, processedFiles, totalFiles);
    };

    const stream = await session.engine.exportPath(session.containerId, mountPathFor(volume));
    const tar = extract();
    // Every member passes the guard first, so a volume of any size fails the source instead of
    // filling the memory with its entries, see `listing-limits.ts`.
    const guard = createListingGuard();

    tar.on("entry", (header, source, next) => {
        void (async () => {
            try {
                await handleEntry(header, source);
            } catch (e: unknown) {
                source.resume();
                if (e instanceof ListingTooLargeError) {
                    tar.destroy(e);
                    return;
                }
                // The name as the log shows a name of a listing, see `shownCollectedPath`.
                failures.push({ path: shownCollectedPath(header.name), error: e instanceof Error ? e.message : String(e) });
            }
            next();
        })();
    });

    async function handleEntry(header: TarHeaders, source: NodeJS.ReadableStream): Promise<void> {
        options?.signal?.throwIfAborted();

        const relativePath = stripMountComponent(header.name);
        // The mount directory itself, which every export starts with and nothing needs.
        if (relativePath === "") {
            source.resume();
            return;
        }
        guard.add(relativePath, header.type === "symlink" ? header.linkname ?? "" : undefined);

        if (header.type === "directory") {
            // Directories carry no bytes, and the archive index describes files only - a
            // directory holding files is recreated from their paths on restore. An empty one
            // is not preserved, which is a limitation this adapter shares with every other
            // directory source rather than one it introduces.
            source.resume();
            return;
        }

        // A member name the volume put there, like `../x`, is refused for links and unchanged
        // files as well as for the files written below, by the rule every collection uses.
        const problem = collectedPathProblem(relativePath);
        if (problem) {
            failures.push({ path: shownCollectedPath(relativePath), error: `refused, ${problem}` });
            source.resume();
            return;
        }

        if (excludePatterns && excludePatterns.length > 0 && matchesAnyExcludePattern(relativePath, excludePatterns)) {
            excluded.push({ path: relativePath, size: header.size ?? 0 });
            source.resume();
            return;
        }

        if (header.type === "symlink") {
            // No bytes, and its target is a path rather than content - stored in the sealed
            // index rather than in a tar header, like every other source's links.
            entries.push({
                relativePath,
                size: 0,
                lastModified: header.mtime ?? new Date(0),
                linkTarget: header.linkname ?? "",
            });
            source.resume();
            return;
        }

        if (header.type !== "file") {
            // Hard links, devices, fifos and sockets. Named rather than skipped in silence:
            // what is missing from a backup is exactly what nobody notices until they need it.
            failures.push({
                path: shownCollectedPath(relativePath),
                error: `unsupported entry type '${header.type}' - only files and symbolic links are collected`,
            });
            source.resume();
            return;
        }

        const size = header.size ?? 0;
        const lastModified = header.mtime ?? new Date(0);
        const metadata = {
            ...(header.mode !== undefined ? { mode: header.mode } : {}),
            ...(header.uid !== undefined ? { uid: header.uid } : {}),
            ...(header.gid !== undefined ? { gid: header.gid } : {}),
        };

        // Incremental runs skip files the chain already holds. The bytes still travel - a tar
        // stream cannot be seeked - but they are not written, hashed or stored again.
        if (options?.shouldDownload && !options.shouldDownload({ relativePath, size, lastModified })) {
            entries.push({ relativePath, size, lastModified, unchanged: true, ...metadata });
            source.resume();
            return;
        }

        const destination = resolveCollectedPath(localPath, relativePath);
        await fs.mkdir(path.dirname(destination), { recursive: true });
        // A new file only, so a member named twice never writes through whatever lies there already.
        await pipeline(source, createWriteStream(destination, { flags: "wx" }));

        entries.push({ relativePath, size, lastModified, ...metadata });
        processedFiles++;
        processedBytes += size;
        report();
    }

    await pipeline(stream, tar);
    report(true);

    // Excluding files silently is the one thing a backup must not do. Reported per pattern
    // rather than per file, so a volume with a node_modules in it does not write tens of
    // thousands of paths into the execution log on every run.
    if (excluded.length > 0 && onLog) {
        const { message, details } = formatExcludeSummary(summariseExcluded(excluded, excludePatterns ?? [], []));
        onLog(message, "info", "storage", details);
    }

    return { files: entries.length, bytes: processedBytes, entries, failures };
}

/**
 * Drops the leading component every exported member carries.
 *
 * `getArchive` prefixes each entry with the basename of the requested path, so asking for
 * `/vol/data` yields `data/…`. Verified against a real daemon rather than assumed - it is
 * the sort of thing that costs an hour when it is wrong.
 */
function stripMountComponent(name: string): string {
    // A loop, not `/\/+$/`, which is quadratic on a long run of slashes in a member name.
    const normalized = stripTrailingSlashes(name.replace(/\\/g, "/"));
    const slash = normalized.indexOf("/");
    return slash === -1 ? "" : normalized.slice(slash + 1);
}
