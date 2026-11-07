/**
 * Byte sources backed by a storage adapter.
 *
 * Adapters that implement `downloadRange` serve each archive entry with a single ranged
 * request, so restoring one file out of a multi-gigabyte backup transfers only that file.
 *
 * Adapters that don't fall back to downloading the archive once into a temp file and
 * ranging over that. That costs the full transfer, but only once per restore rather than
 * once per file, and it keeps file-level restore working everywhere instead of only on the
 * adapters that happen to support ranges. Callers must always `dispose()` so the temp file
 * is removed.
 */

import fs from "fs/promises";
import crypto from "crypto";
import path from "path";
import { AdapterConfig as AdapterConfigType, StorageAdapter } from "@/lib/core/interfaces";
import { openDestination } from "@/services/sharing/destination-access";
import { getTempDir } from "@/lib/temp-dir";
import { wrapError } from "@/lib/logging/errors";
import { logger } from "@/lib/logging/logger";
import { localFileSource } from "./sources";
import { byteLimit, DamagedBackupError } from "./limits";
import { PassThrough, pipeline } from "stream";
import { ArchiveByteSource } from "./types";
import { reserveTempSpace } from "@/services/restore/temp-space";

const log = logger.child({ module: "archive/storage-source" });

export interface ManagedArchiveSource {
    source: ArchiveByteSource;
    /** True when the adapter served ranges natively, false when the archive was downloaded. */
    ranged: boolean;
    dispose: () => Promise<void>;
}

/**
 * Resolves a storage connection into its implementation and decrypted config, as the tenant that
 * runs now sees it, see `src/services/sharing/destination-access.ts`.
 */
export async function resolveStorageAdapter(
    configId: string,
    /** The tenant whose view of the destination to open, the tenant of the code that runs when left out. */
    tenantId?: string | null
): Promise<{ adapter: StorageAdapter; config: AdapterConfigType }> {
    const { adapter, config } = await openDestination(configId, tenantId);
    return { adapter, config };
}

/**
 * Refuses a byte range that is none: a bound that is no whole number of at least 0, like NaN from
 * an index field that held a string, or an end before the start by more than the one byte of an
 * empty range. NaN compares false with every number, so such a range would cap nothing.
 */
export function assertRange(start: number, end: number): void {
    const whole = (value: number) => typeof value === "number" && Number.isSafeInteger(value);
    if (!whole(start) || !whole(end) || start < 0 || end < start - 1) {
        throw new DamagedBackupError("a read asked for a byte range that is none");
    }
}

/**
 * A ranged stream of the destination that fails with a `DamagedBackupError` at the first byte past
 * the range it asked for. A server that ignores `Range` sends the whole file from its start, so
 * without this a reader would take the wrong bytes, and as many as the server sends.
 *
 * @throws DamagedBackupError for a range that is none, see `assertRange`. The stream is left to
 *   the caller, who destroys it.
 */
export function cappedRange(stream: NodeJS.ReadableStream, start: number, end: number): NodeJS.ReadableStream {
    assertRange(start, end);
    const out = new PassThrough();
    pipeline(stream, byteLimit(Math.max(0, end - start + 1), "a range the destination sent"), out, () => { /* handled by the caller via `out` */ });
    return out;
}

/**
 * Opens a byte source over a remote archive.
 *
 * @param adapter - Storage adapter holding the archive
 * @param config - Resolved adapter config
 * @param remotePath - Remote path of the archive
 * @param size - Archive size in bytes, needed to locate the index when no sidecar exists
 */
export async function openStorageArchiveSource(
    adapter: StorageAdapter,
    config: AdapterConfigType,
    remotePath: string,
    size?: number
): Promise<ManagedArchiveSource> {
    /**
     * Downloads the archive into the temporary folder. Where its size is known, the copy is
     * promised its space first like a staged entry of a restore (`reserveTempSpace`), so a restore
     * that falls back to it is refused rather than filling the folder every tenant shares. The
     * promise is given back once the copy is removed.
     */
    const fetchWhole = async (): Promise<WholeCopy> => {
        const space = size !== undefined ? await reserveTempSpace([size], 1) : undefined;
        const tempFile = path.join(getTempDir(), `archive-fetch-${process.pid}-${crypto.randomUUID()}-${path.basename(remotePath)}`);
        const remove = async () => {
            await fs.unlink(tempFile).catch(() => { });
            space?.release();
        };
        try {
            const downloaded = await adapter.download(config, remotePath, tempFile);
            if (!downloaded) throw new Error(`Failed to download archive '${remotePath}' from ${adapter.id}`);
            return { source: await localFileSource(tempFile), remove };
        } catch (error: unknown) {
            await remove();
            throw error;
        }
    };

    if (adapter.downloadRange) {
        // Declaring the capability is not the same as having it at this moment: an SSH
        // server may have no SFTP subsystem, a token may have expired, a proxy in front of
        // an HTTP destination may refuse Range requests. Rather than failing the restore,
        // the first ranged read that errors falls back to fetching the archive once - the
        // behaviour of an adapter without ranges at all.
        //
        // One promise for every read. Reads run side by side, and each that fails would
        // otherwise start a download of its own before the first one finished, each a whole
        // copy of the archive in the temporary folder, of which dispose removed only the last.
        let fallback: Promise<WholeCopy> | undefined;

        return {
            ranged: true,
            source: {
                size,
                read: async (start, end) => {
                    // Before the destination is asked and outside the fallback below, so a range
                    // that is none fails the read instead of fetching the whole archive.
                    assertRange(start, end);
                    if (fallback) return (await fallback).source.read(start, end);
                    try {
                        return cappedRange(await adapter.downloadRange!(config, remotePath, start, end), start, end);
                    } catch (error: unknown) {
                        if (!fallback) {
                            log.warn(
                                "Ranged read failed, falling back to fetching the whole archive",
                                { adapter: adapter.id, remotePath },
                                wrapError(error)
                            );
                        }
                        fallback ??= fetchWhole();
                        return (await fallback).source.read(start, end);
                    }
                },
            },
            dispose: async () => {
                if (!fallback) return;
                // A download that failed removed its copy itself.
                const copy = await fallback.catch(() => undefined);
                await copy?.remove();
            },
        };
    }

    const whole = await fetchWhole();
    return {
        ranged: false,
        source: whole.source,
        dispose: whole.remove,
    };
}

/** A whole copy of the archive in the temporary folder, and how to remove it. */
interface WholeCopy {
    source: ArchiveByteSource;
    /** Removes the copy and gives back the space promised to it. Harmless twice. */
    remove: () => Promise<void>;
}
