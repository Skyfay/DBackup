/**
 * Extraction of whole entries from a seekable archive to local disk.
 *
 * This is the bulk path used by a full restore. File-level restore uses the reader's
 * per-file helpers directly instead, because it does not want anything on disk.
 *
 * Entries are fetched once each and files are grouped onto them, so a bundle holding a
 * hundred small files costs one range read rather than a hundred.
 */

import fs from "fs/promises";
import path from "path";
import { createWriteStream } from "fs";
import { pipeline } from "stream/promises";
import { DATABASE_MEMBER_PREFIX, EXTENSION_BY_FORMAT, SOURCE_MEMBER_PREFIX } from "./format";
import { groupFilesByEntry, openArchiveEntry, openArchiveFile, readArchiveIndex, readArchiveManifest } from "./reader";
import { groupFilesByArchive, OpenedChainArchive } from "./chain-source";
import { localFileSource, readAll } from "./sources";
import {
    ArchiveByteSource,
    ArchiveIndex,
    ArchiveManifest,
    ArchiveSelection,
    entryKey,
    IndexDatabaseLine,
    IndexDirectoryLine,
    IndexFileLine,
} from "./types";

export interface ExtractOptions {
    selection?: ArchiveSelection;
    masterKey?: Buffer;
    sidecarBytes?: Buffer;
    /**
     * Opens a sibling archive of the same incremental chain.
     *
     * Required only when the snapshot carries files forward from earlier archives.
     * Omitting it on a standalone full backup is correct and costs nothing.
     */
    openChainArchive?: (archiveName: string) => Promise<OpenedChainArchive>;
}

export interface ExtractResult {
    manifest: ArchiveManifest;
    index: ArchiveIndex;
    /** Extracted database dumps, one per selected database entry. */
    databaseFiles: { entry: IndexDatabaseLine; path: string }[];
    /** Extracted directory roots. Files land under <root>/<relativePath>. */
    directoryRoots: { entry: IndexDirectoryLine; path: string }[];
}

/**
 * Resolves an output path and refuses anything escaping the extraction root.
 *
 * Archive contents are attacker-controlled in the threat model that matters here: a
 * tampered index could name `../../etc/cron.d/x` and turn a restore into remote code
 * execution on the DBackup host.
 */
function safeJoin(root: string, relative: string): string {
    const resolved = path.resolve(root, relative);
    const rootWithSep = root.endsWith(path.sep) ? root : root + path.sep;
    if (resolved !== root && !resolved.startsWith(rootWithSep)) {
        throw new Error(`Refusing to extract outside the target directory: ${relative}`);
    }
    return resolved;
}

async function writeStreamTo(stream: NodeJS.ReadableStream, target: string): Promise<void> {
    await fs.mkdir(path.dirname(target), { recursive: true });
    await pipeline(stream, createWriteStream(target));
}

/**
 * Extracts selected databases and directory sources from an archive to a local directory.
 *
 * @param source - Byte source over the archive
 * @param extractDir - Directory to write into
 * @param options - Selection (omit to extract everything) and the master key when encrypted
 */
export async function extractArchiveFrom(
    source: ArchiveByteSource,
    extractDir: string,
    options?: ExtractOptions
): Promise<ExtractResult> {
    await fs.mkdir(extractDir, { recursive: true });

    const manifest = await readArchiveManifest(source);
    const index = await readArchiveIndex(source, manifest, {
        masterKey: options?.masterKey,
        sidecarBytes: options?.sidecarBytes,
    });

    const selection = options?.selection;
    // A selection object is exhaustive per kind: an omitted field means "none of this
    // kind", never "all of it". Omitting the whole object means "everything".
    const wantedDatabases = !selection
        ? index.databases
        : index.databases.filter((d) => selection.databaseNames?.includes(d.name));
    const wantedDirectories = !selection
        ? index.directories
        : index.directories.filter((d) => selection.directoryJobSourceIds?.includes(d.src));

    const databaseFiles: ExtractResult["databaseFiles"] = [];
    for (const database of wantedDatabases) {
        // Database dumps are always stored in full in the archive that references them -
        // an incremental never carries one forward - so the entry is always local.
        const entry = index.entries.get(entryKey(undefined, database.n));
        if (!entry) throw new Error(`Archive index is inconsistent: database '${database.name}' references missing entry ${database.n}`);

        const target = safeJoin(
            extractDir,
            `${DATABASE_MEMBER_PREFIX}${database.name}.${EXTENSION_BY_FORMAT[database.format]}`
        );
        await writeStreamTo(await openArchiveEntry(source, manifest, entry, options?.masterKey), target);
        databaseFiles.push({ entry: database, path: target });
    }

    const wantedSourceIds = new Set(wantedDirectories.map((d) => d.src));
    const directoryRoots: ExtractResult["directoryRoots"] = wantedDirectories.map((entry) => ({
        entry,
        path: path.join(extractDir, SOURCE_MEMBER_PREFIX, entry.src),
    }));
    for (const root of directoryRoots) {
        await fs.mkdir(root.path, { recursive: true });
    }

    const rootBySourceId = new Map(directoryRoots.map((r) => [r.entry.src, r.path]));
    const wantedFiles = index.files.filter((f) => wantedSourceIds.has(f.src));

    // Grouped by archive first: files carried over from earlier archives of an incremental
    // chain live elsewhere, and opening one sibling at a time bounds peak disk usage on
    // adapters that cannot serve byte ranges.
    for (const [archiveName, group] of groupFilesByArchive(wantedFiles.map((file) => ({ file })))) {
        if (archiveName !== undefined && !options?.openChainArchive) {
            throw new Error(
                `This snapshot needs '${archiveName}' from its backup chain, but no chain reader was provided`
            );
        }

        const opened = archiveName === undefined
            ? { source, manifest, masterKey: options?.masterKey, dispose: undefined as (() => Promise<void>) | undefined }
            : await options!.openChainArchive!(archiveName);

        try {
            for (const [key, files] of groupFilesByEntry(group.map((g) => g.file))) {
                const entry = index.entries.get(key);
                if (!entry) throw new Error(`Archive index is inconsistent: missing entry ${key}`);

                if (!entry.bundle) {
                    // Exactly one file per non-bundled entry, so stream it straight to disk.
                    const file = files[0];
                    await writeStreamTo(
                        await openArchiveEntry(opened.source, opened.manifest, entry, opened.masterKey),
                        safeJoin(rootBySourceId.get(file.src)!, file.p)
                    );
                    continue;
                }

                // Bundles are capped at a few MB, so one buffered read serves every file in them.
                const payload = await readAll(
                    await openArchiveEntry(opened.source, opened.manifest, entry, opened.masterKey)
                );
                for (const file of files) {
                    const slice = payload.subarray(file.o ?? 0, (file.o ?? 0) + (file.l ?? payload.length));
                    const target = safeJoin(rootBySourceId.get(file.src)!, file.p);
                    await fs.mkdir(path.dirname(target), { recursive: true });
                    await fs.writeFile(target, slice);
                }
            }
        } finally {
            if (opened.dispose) await opened.dispose();
        }
    }

    return { manifest, index, databaseFiles, directoryRoots };
}

/** Convenience wrapper for extracting an archive that is already on local disk. */
export async function extractArchive(
    archivePath: string,
    extractDir: string,
    options?: ExtractOptions
): Promise<ExtractResult> {
    return extractArchiveFrom(await localFileSource(archivePath), extractDir, options);
}

/** Reads a single file out of an archive without touching disk. */
export async function readSingleFile(
    source: ArchiveByteSource,
    manifest: ArchiveManifest,
    index: ArchiveIndex,
    file: IndexFileLine,
    masterKey?: Buffer
): Promise<NodeJS.ReadableStream> {
    return openArchiveFile(source, manifest, index, file, masterKey);
}
