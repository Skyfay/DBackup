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
import { AdapterConfig, StorageAdapter } from "@/lib/core/interfaces";
import { openStorageArchiveSource, ManagedArchiveSource } from "./storage-source";
import { readArchiveManifest } from "./reader";
import { ArchiveByteSource, ArchiveManifest, IndexFileLine } from "./types";

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
