import fs from "fs/promises";
import path from "path";
import { StorageAdapter, AdapterConfig, DirectoryDownloadOptions, DirectoryDownloadResult, DirectoryFileEntry } from "@/lib/core/interfaces";
import { LogLevel, LogType } from "@/lib/core/logs";
import { mapWithConcurrency, untilAborted } from "@/lib/concurrency";
import { matchesAnyExcludePattern } from "@/lib/exclude-patterns";
import { summariseExcluded, formatExcludeSummary } from "@/lib/exclude-summary";
import { listTreeForCollection } from "./list-tree";
import { DownloadedFileError } from "./downloaded-file";
import { stripSlashes } from "@/lib/paths";
import { CollectedPathError, collectedPathProblem, resolveCollectedPath, shownCollectedPath } from "@/lib/archive/collected-paths";

/** Strips a queried remotePath prefix from a FileInfo.path (which list() returns relative to the adapter root). */
export function toRelativePath(filePath: string, remotePath: string): string {
    const normalizedFile = filePath.replace(/\\/g, "/").replace(/^\/+/, "");
    const normalizedRoot = stripSlashes(remotePath.replace(/\\/g, "/"));
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
 * How often a transfer still in flight may report.
 *
 * The reports end up rebuilding a progress string and touching the execution row, and SFTP
 * delivers a step callback per 32 KB chunk across several parallel files. A quarter of a
 * second is well under what reads as live and well over what costs anything.
 */
const PARTIAL_PROGRESS_INTERVAL_MS = 250;

/**
 * Generic fallback for StorageAdapter.downloadDirectory: lists the remote directory tree
 * (adapters already implement recursive list()) and downloads each file individually via
 * the adapter's existing download(). Used by every storage adapter that doesn't implement
 * downloadDirectory natively (all except Rsync, which has its own optimized implementation
 * to preserve its delta-transfer advantage).
 */

/**
 * The names of a listing that cannot be a file of the collection folder, see `collected-paths.ts`,
 * as failures of the run, and one warning naming them. Shared with the native collections, so a
 * name is refused by the same rule whichever adapter listed it.
 */
export function refuseListedNames<T extends { relativePath: string }>(
    listed: T[],
    onLog?: OnLog
): { kept: T[]; refused: { path: string; error: string }[] } {
    const kept: T[] = [];
    const refused: { path: string; error: string }[] = [];
    for (const entry of listed) {
        const problem = collectedPathProblem(entry.relativePath);
        if (problem) refused.push({ path: shownCollectedPath(entry.relativePath), error: `refused, ${problem}` });
        else kept.push(entry);
    }
    if (refused.length > 0 && onLog) {
        const shown = refused.slice(0, 50);
        onLog(
            `${refused.length} name(s) of the listing cannot be a file of this folder and are NOT in this backup`,
            "warning", "security",
            shown.map((r) => `${r.path} (${r.error})`).join("\n")
            + (refused.length > shown.length ? `\n... and ${refused.length - shown.length} more` : "")
        );
    }
    return { kept, refused };
}

export async function downloadDirectoryGeneric(
    adapter: StorageAdapter,
    config: AdapterConfig,
    remotePath: string,
    localPath: string,
    excludePatterns?: string[],
    onProgress?: OnProgress,
    onLog?: OnLog,
    options?: DirectoryDownloadOptions
): Promise<DirectoryDownloadResult> {
    const { files: allFiles, pruned, unsupportedSymlinks } = await listTreeForCollection(adapter, config, remotePath, {
        excludePatterns,
        signal: options?.signal,
        onProgress: options?.onListProgress,
        concurrency: options?.concurrency,
    });

    // Links the adapter saw but could not describe. Named rather than counted, because "18
    // links were skipped" tells nobody which certificate is going to be missing. Capped so a
    // pathological tree cannot write thousands of lines into the execution record.
    if (unsupportedSymlinks && unsupportedSymlinks.length > 0) {
        const shown = unsupportedSymlinks.slice(0, 50);
        onLog?.(
            `${unsupportedSymlinks.length} symbolic link(s) could not be collected from this source and are NOT in this backup`,
            "warning", "storage",
            shown.join("\n") + (unsupportedSymlinks.length > shown.length ? `\n... and ${unsupportedSymlinks.length - shown.length} more` : "")
        );
    }

    // A name the server listed that cannot be a file of the collection folder, like `../x` or an
    // absolute path, is refused before anything is fetched, linked or carried under it.
    const { kept: named, refused } = refuseListedNames(
        allFiles.map((file) => ({ file, relativePath: toRelativePath(file.path, remotePath) })),
        onLog
    );

    const entries: { relativePath: string; sourcePath: string; size: number; lastModified: Date; linkTarget?: string }[] = [];
    const excluded: { path: string; size: number }[] = [];
    for (const { file, relativePath } of named) {
        if (matchesAnyExcludePattern(relativePath, excludePatterns)) {
            excluded.push({ path: relativePath, size: file.size });
            continue;
        }
        entries.push({
            relativePath,
            sourcePath: file.path,
            size: file.size,
            lastModified: file.lastModified,
            ...(file.linkTarget !== undefined ? { linkTarget: file.linkTarget } : {}),
        });
    }

    // Excluding files silently is the one thing a backup must not do: what is missing from a
    // backup is exactly what nobody notices until they need it. Reported per pattern rather
    // than per file - a source with a node_modules in it would otherwise write tens of
    // thousands of paths into the execution log, on every run.
    if ((excluded.length > 0 || pruned.length > 0) && onLog) {
        const { message, details } = formatExcludeSummary(summariseExcluded(excluded, excludePatterns ?? [], pruned));
        onLog(message, "info", "storage", details);
    }

    const totalBytes = entries.reduce((sum, e) => sum + e.size, 0);
    const totalFiles = entries.length;
    let processedBytes = 0;
    let processedFiles = 0;
    let skippedFiles = 0;
    // Bytes of transfers still running. Counted apart from `processedBytes` so a file can
    // report while it is arriving without being counted twice when it lands.
    let liveBytes = 0;
    let lastPartialReport = 0;

    // Each file yields exactly one outcome; mapWithConcurrency keeps them in input order, so
    // the resulting entries/failures lists have the same layout the old serial loop produced,
    // independent of which download finished first.
    type Outcome =
        | { kind: "entry"; entry: DirectoryFileEntry }
        | { kind: "failure"; failure: { path: string; error: string } };

    const bump = (bytes: number) => {
        // Runs synchronously between awaits, so the shared counters stay consistent under
        // parallelism - Node never interleaves these statements.
        processedBytes += bytes;
        processedFiles++;
        onProgress?.(processedBytes + liveBytes, totalBytes, processedFiles, totalFiles);
    };

    /** How much of each in-flight file has arrived, so its share can be removed when it lands. */
    const partialByIndex = new Map<number, number>();

    /**
     * Reports a transfer that is still running.
     *
     * Without this a source is only heard from when a file completes, so one large file is
     * indistinguishable from a stalled run for as long as it takes to arrive - which over a
     * network source is exactly when someone is watching. Throttled because the callback ends
     * up rebuilding a progress string, and a 32 KB chunk size means thousands of calls a
     * second otherwise.
     */
    const partial = (index: number, transferred: number) => {
        if (!onProgress) return;
        liveBytes += transferred - (partialByIndex.get(index) ?? 0);
        partialByIndex.set(index, transferred);

        const now = Date.now();
        if (now - lastPartialReport < PARTIAL_PROGRESS_INTERVAL_MS) return;
        lastPartialReport = now;
        onProgress(processedBytes + liveBytes, totalBytes, processedFiles, totalFiles);
    };

    const settle = (index: number) => {
        liveBytes -= partialByIndex.get(index) ?? 0;
        partialByIndex.delete(index);
    };

    // Per-file "started/finished" chatter from an adapter would put one or two lines in the
    // execution history for every file collected - hundreds of lines for a real source, which
    // is why S3 and local stay silent here. Progress is already reported per file via
    // onProgress and summarised at the end, so only warnings and errors are worth a history
    // line; those still come through.
    const fileOnLog: OnLog | undefined = onLog
        ? (msg, level, type, details) => { if (level && level !== "info") onLog(msg, level, type, details); }
        : undefined;

    // Adapters that authenticate per connection (SFTP, FTP) charge a full handshake before the
    // first byte moves. A session pools exactly as many connections as we run transfers, turning
    // one handshake per file into one per worker - and keeping the socket count at what the
    // server was told to expect rather than at however many files a source happens to hold.
    const concurrency = options?.concurrency ?? 1;
    const session = adapter.openSession
        ? await adapter.openSession(config, onLog, { concurrency }).catch(() => undefined)
        : undefined;
    const fetchFile = session?.download
        ? (sourcePath: string, target: string, onBytes: (transferred: number) => void) =>
            session.download!(sourcePath, target, onBytes)
        : (sourcePath: string, target: string, onBytes: (transferred: number) => void) =>
            adapter.download(config, sourcePath, target, onBytes, fileOnLog);

    // A transfer already running cannot be interrupted from the outside - neither ssh2's
    // fastGet nor most SDK downloads take a signal - so the connections underneath are dropped
    // instead, which fails the reads immediately.
    //
    // Without this, cancelling only ever took effect between two files. That is instant on a
    // source of many small files and never on a source of a few large ones: with two files and
    // two workers there is no next iteration to check at, so a cancel waited out the whole
    // transfer. Same reason a single large file ignored it.
    const abortTransfers = () => { void session?.close().catch(() => { }); };
    if (session) options?.signal?.addEventListener("abort", abortTransfers, { once: true });

    try {
        const outcomes = await mapWithConcurrency(entries, concurrency, async (entry, index): Promise<Outcome> => {
            // Throwing unwinds this worker, and every sibling throws on its next turn.
            options?.signal?.throwIfAborted();

            // A symbolic link has no bytes to fetch: its content is the target string, which
            // the listing already produced. Downloading it would read whatever it points at
            // and store those bytes under the link's own path - a different tree than the one
            // being backed up, and one that duplicates data the source deliberately shares.
            //
            // Checked before `shouldDownload`, and that order is load-bearing. There is no
            // transfer to skip here, so the predicate has nothing to decide - and answering
            // "unchanged" would mark the link for carry-forward, which links deliberately do
            // not take part in. It would drop out of the snapshot entirely.
            if (entry.linkTarget !== undefined) {
                bump(0);
                return {
                    kind: "entry",
                    entry: {
                        relativePath: entry.relativePath,
                        size: 0,
                        lastModified: entry.lastModified,
                        linkTarget: entry.linkTarget,
                    },
                };
            }

            // Incremental backups skip files the chain already holds. They still belong to the
            // snapshot, so they are reported as unchanged rather than dropped - the archive
            // writer carries them forward by reference.
            if (options?.shouldDownload && !options.shouldDownload(entry)) {
                skippedFiles++;
                bump(0);
                return { kind: "entry", entry: { relativePath: entry.relativePath, size: entry.size, lastModified: entry.lastModified, unchanged: true } };
            }

            // The relative path comes from the remote server's listing, so it is not trusted:
            // an S3 key is stored verbatim and a WebDAV href is whatever the server sends. A
            // ".." segment would otherwise write outside the work directory during collection.
            // The names were checked above already, the join is checked again right where it is used.
            let localFilePath: string;
            try {
                localFilePath = resolveCollectedPath(localPath, entry.relativePath);
            } catch (error: unknown) {
                if (!(error instanceof CollectedPathError)) throw error;
                const shown = shownCollectedPath(entry.relativePath);
                onLog?.(`Refused to collect '${shown}': ${error.reason}`, "error", "security");
                return { kind: "failure", failure: { path: shown, error: error.reason } };
            }
            await fs.mkdir(path.dirname(localFilePath), { recursive: true });

            let success: boolean;
            try {
                success = await untilAborted(
                    fetchFile(entry.sourcePath, localFilePath, (transferred) => partial(index, transferred)),
                    options?.signal
                );
            } catch (error) {
                // A transfer torn down by the cancellation above is a cancelled run, not a
                // file the source refused to hand over.
                options?.signal?.throwIfAborted();
                // A file that arrived as a link or anything else than a regular file is left out
                // and named, like a file the source did not return, see `downloaded-file.ts`.
                if (error instanceof DownloadedFileError) {
                    onLog?.(`Refused to collect '${shownCollectedPath(entry.relativePath)}': ${error.reason}`, "error", "security");
                    return { kind: "failure", failure: { path: shownCollectedPath(entry.relativePath), error: error.reason } };
                }
                throw error;
            } finally {
                // Whether it arrived or not, this file is no longer in flight - its partial
                // count has to go, or every failure would inflate the total from then on.
                settle(index);
            }

            if (!success) {
                // Same distinction: a download that returned false because its connection was
                // dropped on cancel must not be reported as a file missing from the backup.
                options?.signal?.throwIfAborted();

                // Recorded, not swallowed: the file is absent from the archive, and a backup
                // that hides that is worse than one that admits it.
                onLog?.(`Failed to download ${entry.sourcePath}`, "error", "storage");
                return { kind: "failure", failure: { path: entry.relativePath, error: "the source did not return the file" } };
            }

            bump(entry.size);
            return { kind: "entry", entry: { relativePath: entry.relativePath, size: entry.size, lastModified: entry.lastModified } };
        });

        const resultEntries: DirectoryFileEntry[] = [];
        const failures: { path: string; error: string }[] = [...refused];
        for (const outcome of outcomes) {
            if (outcome.kind === "entry") resultEntries.push(outcome.entry);
            else failures.push(outcome.failure);
        }

        if (skippedFiles > 0) {
            onLog?.(`${skippedFiles} of ${totalFiles} file(s) unchanged, not transferred`, "info", "storage");
        }

        return { files: resultEntries.length, bytes: processedBytes, entries: resultEntries, failures };
    } finally {
        // Removed explicitly: one signal outlives every source of the job, so a listener left
        // behind would accumulate one per source and close a session that has moved on.
        options?.signal?.removeEventListener("abort", abortTransfers);
        await session?.close().catch(() => { });
    }
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
    onLog?: OnLog,
    options?: DirectoryDownloadOptions
): Promise<DirectoryDownloadResult> {
    if (adapter.downloadDirectory) {
        return adapter.downloadDirectory(config, remotePath, localPath, excludePatterns, onProgress, onLog, options);
    }
    return downloadDirectoryGeneric(adapter, config, remotePath, localPath, excludePatterns, onProgress, onLog, options);
}
