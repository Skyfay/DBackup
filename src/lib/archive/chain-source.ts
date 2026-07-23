/**
 * Reading across the archives of an incremental chain.
 *
 * A snapshot's index describes the whole tree, but the bytes may live in several archives.
 * This resolves those archives, which sit next to the snapshot in the same directory, and
 * hands out a byte source plus the crypto parameters for each.
 *
 * The important property is **one archive open at a time**. Adapters without ranged reads
 * fall back to downloading a whole archive to a temp file, so processing work file-by-file
 * would end up holding an entire chain on disk. Grouping the work by archive instead caps
 * peak disk at the snapshot's own archive plus one other.
 */

import path from "path";
import crypto from "crypto";
import { Readable, Transform, TransformCallback } from "stream";
import { AdapterConfig, StorageAdapter } from "@/lib/core/interfaces";
import { openStorageArchiveSource, ManagedArchiveSource } from "./storage-source";
import { openArchiveEntry, groupFilesByEntry, readArchiveManifest } from "./reader";
import { readAll } from "./sources";
import { mapWithConcurrency } from "@/lib/concurrency";
import { ArchiveByteSource, ArchiveIndex, ArchiveManifest, IndexFileLine } from "./types";

export interface OpenedChainArchive {
    source: ArchiveByteSource;
    manifest: ArchiveManifest;
    masterKey?: Buffer;
    /** True when the adapter served ranges rather than downloading the archive. */
    ranged: boolean;
    dispose: () => Promise<void>;
}

export interface ChainReaderOptions {
    adapter: StorageAdapter;
    config: AdapterConfig;
    /** Remote path of the snapshot's own archive. Siblings are resolved next to it. */
    snapshotPath: string;
    /** Resolves the master key for an archive's encryption profile. */
    resolveMasterKey: (profileId: string) => Promise<Buffer>;
}

/** Remote path of a sibling archive in the same chain directory. */
export function siblingArchivePath(snapshotPath: string, archiveName: string): string {
    const dir = path.posix.dirname(snapshotPath.replace(/\\/g, "/"));
    return dir === "." ? archiveName : `${dir}/${archiveName}`;
}

/** Opens one archive of a chain, including its manifest and master key. */
export async function openChainArchive(
    options: ChainReaderOptions,
    archiveName: string | undefined
): Promise<OpenedChainArchive> {
    const remotePath = archiveName
        ? siblingArchivePath(options.snapshotPath, archiveName)
        : options.snapshotPath;

    const managed: ManagedArchiveSource = await openStorageArchiveSource(
        options.adapter,
        options.config,
        remotePath
    );

    try {
        const manifest = await readArchiveManifest(managed.source);
        const masterKey = manifest.encryption
            ? await options.resolveMasterKey(manifest.encryption.profileId)
            : undefined;
        return { source: managed.source, manifest, masterKey, ranged: managed.ranged, dispose: managed.dispose };
    } catch (e: unknown) {
        await managed.dispose();
        throw new Error(
            `Could not open '${remotePath}' from the backup chain: ${e instanceof Error ? e.message : String(e)}`
        );
    }
}

/**
 * Groups files by the archive holding their bytes.
 *
 * The snapshot's own archive (key `undefined`) is ordered first so the common case is
 * served before any sibling has to be opened.
 */
export function groupFilesByArchive<T extends { file: IndexFileLine }>(
    files: T[]
): Map<string | undefined, T[]> {
    const grouped = new Map<string | undefined, T[]>();
    for (const item of files) {
        const existing = grouped.get(item.file.a);
        if (existing) existing.push(item);
        else grouped.set(item.file.a, [item]);
    }

    if (!grouped.has(undefined)) return grouped;
    return new Map([[undefined, grouped.get(undefined)!], ...[...grouped].filter(([a]) => a !== undefined)]);
}

/** An opened snapshot with everything needed to read files across its chain. */
export interface OpenedSnapshot {
    source: ArchiveByteSource;
    manifest: ArchiveManifest;
    index: ArchiveIndex;
    masterKey?: Buffer;
    /** Lets sibling archives of the same chain be opened on demand. */
    chain: ChainReaderOptions;
}

/**
 * Iterates selected files of a snapshot, opening each archive of the chain exactly once.
 *
 * This is the single read core shared by every restore flavour - streaming download,
 * write-back to storage, and the full pipeline restore - so the guarantees below hold
 * everywhere instead of being re-implemented per caller:
 *
 * - Work is grouped by archive first and by entry second. The archive grouping is what
 *   caps peak disk usage: an adapter without ranged reads downloads a whole archive to a
 *   temp file, so visiting files in selection order would end up holding the entire chain
 *   at once. Grouped this way, at most the snapshot's own archive plus one sibling is open.
 * - Within an archive, bundled entries are read once into memory (the writer caps them at
 *   a few MB) and sliced, while standalone entries stream, so a multi-gigabyte file never
 *   has to fit in RAM.
 *
 * `concurrency` parallelises the entries **within** one archive - over a network destination
 * the per-entry round trip, not the bandwidth, is the limit, so ranged reads overlap well.
 * It never crosses the archive boundary: archives are still opened one at a time, so the
 * peak-disk guarantee holds unchanged. Callers whose output is order-dependent (the tar
 * download stream) pass 1 and get the historical strictly-serial behaviour. Note that at
 * concurrency N the per-file staging in the storage-restore callers holds up to N temp
 * files at once - bounded by the same setting.
 */
export async function forEachSnapshotFile(
    snapshot: OpenedSnapshot,
    files: readonly { file: IndexFileLine }[],
    visit: (file: IndexFileLine, content: NodeJS.ReadableStream) => Promise<void>,
    concurrency = 1
): Promise<void> {
    for (const [archiveName, group] of groupFilesByArchive(files as { file: IndexFileLine }[])) {
        // The snapshot's own archive is already open; siblings are opened and released
        // one at a time.
        const opened: Pick<OpenedChainArchive, "source" | "manifest" | "masterKey"> & { dispose?: () => Promise<void> } =
            archiveName === undefined
                ? { source: snapshot.source, manifest: snapshot.manifest, masterKey: snapshot.masterKey }
                : await openChainArchive(snapshot.chain, archiveName);

        try {
            const entryGroups = [...groupFilesByEntry(group.map((g) => g.file))];
            await mapWithConcurrency(entryGroups, concurrency, async ([key, entryFiles]) => {
                const entry = snapshot.index.entries.get(key);
                if (!entry) throw new Error(`Archive index is inconsistent: missing entry ${key}`);

                if (!entry.bundle) {
                    await visit(
                        entryFiles[0],
                        await openArchiveEntry(opened.source, opened.manifest, entry, opened.masterKey)
                    );
                    return;
                }

                const payload = await readAll(
                    await openArchiveEntry(opened.source, opened.manifest, entry, opened.masterKey)
                );
                for (const file of entryFiles) {
                    const start = file.o ?? 0;
                    await visit(file, Readable.from([payload.subarray(start, start + (file.l ?? payload.length))]));
                }
            });
        } finally {
            if (opened.dispose) await opened.dispose();
        }
    }
}

/**
 * Hashes what flows through it, so a restored file can be checked against the checksum
 * recorded in its index line. For unencrypted archives this is the only integrity check a
 * file gets - there is no AEAD tag protecting it.
 */
export function hashingStream(onDigest: (digest: string) => void): Transform {
    const hash = crypto.createHash("sha256");
    return new Transform({
        transform(chunk: Buffer, _encoding, callback: TransformCallback) {
            hash.update(chunk);
            callback(null, chunk);
        },
        flush(callback: TransformCallback) {
            onDigest(hash.digest("hex"));
            callback();
        },
    });
}
