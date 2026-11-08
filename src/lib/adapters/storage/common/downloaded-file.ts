import fs from "fs/promises";
import type { Stats } from "fs";
import type { StorageAdapter, StorageSession } from "@/lib/core/interfaces";
import { logger } from "@/lib/logging/logger";

const log = logger.child({ module: "DownloadedFile" });

/**
 * What a download of a storage leaves on the disk of DBackup.
 *
 * A destination or a source may belong to a customer, who decides what lies there. A transfer that
 * recreates what the server holds, like rsync with `-a`, would recreate a symbolic link to
 * `/etc/shadow` as a link, and every reader of the temporary file afterwards, the download of a
 * backup to the browser included, would read the file of the server it points at. A download
 * therefore counts only once a regular file lies at its local path. Anything else, a link, a
 * folder, a device or a named pipe, or nothing at all, is removed and the download fails.
 */

/** What a path is, for the message, when it is no regular file. */
function kindOf(stats: Stats): string {
    if (stats.isSymbolicLink()) return "a symbolic link";
    if (stats.isDirectory()) return "a folder";
    if (stats.isBlockDevice() || stats.isCharacterDevice()) return "a device";
    if (stats.isFIFO()) return "a named pipe";
    if (stats.isSocket()) return "a socket";
    return "no regular file";
}

/**
 * A download that left no regular file at its local path, with the reason for the run log. A plain
 * error rather than an `AdapterError`, so the collection that imports it loads where a test
 * replaces the error classes.
 */
export class DownloadedFileError extends Error {
    constructor(readonly adapterId: string, readonly reason: string) {
        super(`[${adapterId}] download: ${reason}`);
        this.name = "DownloadedFileError";
    }
}

/**
 * Refuses what a download left at `localPath` unless it is a regular file, looked at without
 * following a link. What it refuses is removed, a link as the link and never its target.
 *
 * @throws DownloadedFileError naming what lay there
 */
export async function assertDownloadedFile(adapterId: string, remotePath: string, localPath: string): Promise<void> {
    let stats: Stats;
    try {
        stats = await fs.lstat(localPath);
    } catch (error) {
        if ((error as NodeJS.ErrnoException)?.code === "ENOENT") {
            throw new DownloadedFileError(adapterId, `the storage sent no file for ${remotePath}`);
        }
        throw error;
    }
    if (stats.isFile()) return;

    const kind = kindOf(stats);
    // `rm` removes a link itself, never what it points at, and a folder with what is in it.
    await fs.rm(localPath, { recursive: true, force: true }).catch(() => { });
    log.warn("Refused a download that left no regular file", { adapterId, remotePath, kind });
    throw new DownloadedFileError(adapterId, `${remotePath} arrived as ${kind}, not as a regular file, so it was not read`);
}

/** The session with its downloads checked like those of the adapter. */
function guardedSession(adapterId: string, session: StorageSession): StorageSession {
    if (!session.download) return session;
    const download = session.download.bind(session);
    return {
        ...session,
        upload: session.upload.bind(session),
        close: session.close.bind(session),
        download: async (remotePath, localPath, onProgress) => {
            const ok = await download(remotePath, localPath, onProgress);
            if (ok) await assertDownloadedFile(adapterId, remotePath, localPath);
            return ok;
        },
    };
}

/**
 * The adapter with every download into a local path checked by `assertDownloadedFile`, the one of
 * the adapter and the one of its sessions. `registerAdapters()` registers every storage adapter
 * through it, so no reader of a downloaded file meets a link, whichever adapter wrote it and
 * whichever path, a destination view or the plain adapter, called it.
 */
export function withCheckedDownloads(adapter: StorageAdapter): StorageAdapter {
    const download = adapter.download;
    const openSession = adapter.openSession;
    return {
        ...adapter,
        download: async (config, remotePath, localPath, onProgress, onLog) => {
            const ok = await download.call(adapter, config, remotePath, localPath, onProgress, onLog);
            if (ok) await assertDownloadedFile(adapter.id, remotePath, localPath);
            return ok;
        },
        ...(openSession
            ? {
                openSession: async (config, onLog, options) =>
                    guardedSession(adapter.id, await openSession.call(adapter, config, onLog, options)),
            }
            : {}),
    };
}
