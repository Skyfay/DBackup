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
import { DATABASE_MEMBER_PREFIX, SOURCE_MEMBER_PREFIX } from "./format";
import { databaseDumpFileName } from "./dump-names";
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
    isSymlinkLine,
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
    /**
     * Symbolic links that could not be created.
     *
     * Reported rather than thrown, so one bad link does not cost the caller everything else
     * that was restored - and reported rather than dropped, because a link missing from a
     * restored tree is exactly the silence this format change exists to end.
     */
    skippedSymlinks: { path: string; reason: string }[];
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

        const target = safeJoin(extractDir, `${DATABASE_MEMBER_PREFIX}${databaseDumpFileName(database.name, database.format)}`);
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
    const selectedFiles = index.files.filter((f) => wantedSourceIds.has(f.src));

    // Links are held back here and created at the very end, once every regular file has
    // landed. See createSymlinks() for why that order is a security property.
    const symlinks = selectedFiles.filter(isSymlinkLine);
    const wantedFiles = selectedFiles.filter((f) => !isSymlinkLine(f));

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

    const skippedSymlinks = await createSymlinks(symlinks, rootBySourceId);

    return { manifest, index, databaseFiles, directoryRoots, skippedSymlinks };
}

/**
 * Recreates symbolic links, and does it last on purpose.
 *
 * A link in an archive is a write primitive aimed at any path on the host. `safeJoin` cannot
 * stop that on its own: `path.resolve` works on strings and never asks the filesystem, so an
 * archive holding `foo -> /etc/cron.d` followed by a file `foo/x` passes every containment
 * check and still writes outside the target. That is the classic tar symlink traversal, and
 * it is a remote code execution on the DBackup host, not a tidiness problem.
 *
 * Creating every link only after the last regular file has been written closes it completely,
 * whatever the targets say: at the moment a file is written, no link from this archive exists
 * for its path to travel through. That is the whole defence, so this call must stay after the
 * file loop - moving it, or interleaving it for tidier code, silently reopens the hole.
 *
 * Targets themselves are stored verbatim, including absolute ones. A link's target is content,
 * not a path this code is about to follow, and a restore to the original location is exactly
 * where an absolute target is correct.
 */
async function createSymlinks(
    symlinks: readonly (IndexFileLine & { lnk: string })[],
    rootBySourceId: ReadonlyMap<string, string>
): Promise<{ path: string; reason: string }[]> {
    const skipped: { path: string; reason: string }[] = [];

    for (const link of symlinks) {
        const root = rootBySourceId.get(link.src);
        if (!root) continue;
        const target = safeJoin(root, link.p);
        await fs.mkdir(path.dirname(target), { recursive: true });

        // Anything already at this path was written by the file loop above, which means the
        // index claims one path is both a link and a real file or directory. No source can be
        // both, so the index is inconsistent or was tampered with - and the resolution is to
        // keep the data. Deleting a directory of just-restored files to make room for a link
        // would destroy the restore, and would hand the traversal back its second step.
        const existing = await fs.lstat(target).catch(() => undefined);
        if (existing && !existing.isSymbolicLink()) {
            skipped.push({ path: link.p, reason: "a file or directory was restored to that path" });
            continue;
        }

        try {
            // An earlier link at the same path is replaced. `unlink` takes the link itself,
            // never what it points at, so re-running a restore cannot delete real data.
            if (existing) await fs.unlink(target);
            await fs.symlink(link.lnk, target);
        } catch (error: unknown) {
            // One link that cannot be created must not cost the caller everything else that
            // was restored successfully. It is reported instead, and the caller decides.
            skipped.push({ path: link.p, reason: error instanceof Error ? error.message : String(error) });
        }
    }

    return skipped;
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
