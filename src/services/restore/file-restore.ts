/**
 * File-level restore from a seekable (manifest v2) archive.
 *
 * Restores individual files or folders without extracting the whole backup. Each selected
 * file is located through the archive index, entries are fetched by byte range where the
 * storage adapter supports it, and files sharing one entry (a bundle) are served from a
 * single fetch.
 *
 * A browser download streams straight through with nothing staged at all. Writing back to
 * a storage destination stages one file at a time, because StorageAdapter.upload() takes a
 * local path rather than a stream - peak disk usage is therefore the largest single file,
 * not the size of the restore, which can exceed the host's free space.
 */

import path from "path";
import { safeRemoteJoin } from "@/lib/archive/remote-paths";
import prisma from "@/lib/prisma";
import { pipeline } from "stream/promises";
import { createGzip } from "zlib";
import { pack } from "tar-stream";
import crypto from "crypto";
import { BackupMetadata, StorageAdapter, AdapterConfig } from "@/lib/core/interfaces";
import { openStorageArchiveSource, resolveStorageAdapter, ManagedArchiveSource } from "@/lib/archive/storage-source";
import { parseArchiveIndex, readArchiveManifest, readEmbeddedIndexBytes } from "@/lib/archive/reader";
import { createDestinationSessions } from "./destination-sessions";
import { forEachSnapshotFile, ChainReaderOptions } from "@/lib/archive/chain-source";
import { hashingStream } from "@/lib/archive/hashing";
import { checkChainCompleteness } from "@/lib/archive/chain";
import { totalSize } from "@/lib/archive/browse";
import { resolveContents, downloadShape, type FileRestoreSelection } from "./archive-selection";
import { databaseDumpFileName } from "@/lib/archive/dump-names";
import { DATABASE_MEMBER_PREFIX } from "@/lib/archive/format";
import { entryKey } from "@/lib/archive/types";
import { openArchiveEntry } from "@/lib/archive/reader";
import { archiveIndexVerifier, KeyOverride, resolveBackupKey } from "@/services/backup/key-resolution";
import { resolveTransferConcurrency } from "@/lib/adapters/transfer-concurrency";
import { archiveIndexService } from "@/services/backup/archive-index-service";
import { getTempDir } from "@/lib/temp-dir";
import { ArchiveIndex, ArchiveManifest, metadataFromIndex, partitionSymlinks } from "@/lib/archive/types";
import { logger } from "@/lib/logging/logger";
import { wrapError, NotFoundError, ValidationError } from "@/lib/logging/errors";
import fs from "fs/promises";
import { createWriteStream } from "fs";

const log = logger.child({ service: "FileRestoreService" });

/** Where restored files should land. */
export type FileRestoreTarget =
    /** Streamed to the browser as a single tar.gz. */
    | { kind: "download" }
    /** Back to the storage adapter and path the directory source was collected from. */
    | { kind: "origin" }
    /** Into any configured storage adapter, under a chosen path. */
    | { kind: "storage"; configId: string; basePath: string };

export type { FileRestoreSelection } from "./archive-selection";

export interface FileRestoreInput {
    /** Storage adapter holding the backup. */
    storageConfigId: string;
    /** Remote path of the backup archive. */
    file: string;
    /**
     * Files to restore. Omit together with `databases` to restore the complete snapshot,
     * which for an incremental means every file it describes, wherever in the chain the
     * bytes live.
     */
    selections?: FileRestoreSelection[];
    /**
     * Database dumps to include, by the name recorded in the archive. Downloads only - a
     * dump has no meaning written back into a file destination.
     */
    databases?: string[];
    /**
     * Glob patterns whose matching files are left out, same syntax as a backup's exclude
     * patterns so a preset works on both sides.
     */
    excludePatterns?: string[];
    target: FileRestoreTarget;
    /**
     * Which key to open the backup with, when the profile it names does not fit and the
     * user picked another. Absent for the ordinary case, where the metadata decides.
     */
    keyOverride?: KeyOverride;
}

/** Everything needed to read files out of a snapshot, plus how to release it. */
export interface OpenedArchive extends ManagedArchiveSource {
    manifest: ArchiveManifest;
    index: ArchiveIndex;
    masterKey?: Buffer;
    /** Lets sibling archives of the same chain be opened on demand. */
    chain: ChainReaderOptions;
}

/**
 * Reads the backup's `.meta.json`, which carries the crypto parameters needed to open the
 * index without touching the archive.
 */
async function readBackupMetadata(
    adapter: StorageAdapter,
    config: AdapterConfig,
    file: string
): Promise<BackupMetadata> {
    if (adapter.read) {
        const content = await adapter.read(config, `${file}.meta.json`);
        if (content) return JSON.parse(content) as BackupMetadata;
    }

    const tempFile = path.join(getTempDir(), `meta-${process.pid}-${crypto.randomUUID()}.json`);
    try {
        if (!(await adapter.download(config, `${file}.meta.json`, tempFile))) {
            throw new NotFoundError("Backup metadata", `${file}.meta.json`);
        }
        return JSON.parse(await fs.readFile(tempFile, "utf-8")) as BackupMetadata;
    } finally {
        await fs.unlink(tempFile).catch(() => { });
    }
}

/**
 * Verifies that every archive a snapshot depends on is actually present.
 *
 * Done up front so a broken chain is reported by name before anything is restored,
 * instead of surfacing halfway through as a confusing per-file failure.
 */
async function assertChainComplete(
    adapter: StorageAdapter,
    config: AdapterConfig,
    snapshotPath: string,
    index: ArchiveIndex
): Promise<void> {
    if (index.deps.length === 0) return;

    const dir = path.posix.dirname(snapshotPath.replace(/\\/g, "/"));
    const present = new Set((await adapter.list(config, dir === "." ? "" : dir)).map((f) => path.posix.basename(f.path)));
    const { complete, missing } = checkChainCompleteness(index, present);

    if (!complete) {
        throw new ValidationError(
            `This backup is part of an incremental chain and ${missing.length === 1 ? "one archive it needs is" : "some archives it needs are"} missing: ${missing.join(", ")}. Restore an older snapshot, or restore the missing archive(s) to this destination first.`,
            { field: "file" }
        );
    }
}

/** Opens a snapshot for reading: byte source, manifest, index, master key and chain access. */
export async function openArchiveForRestore(
    storageConfigId: string,
    file: string,
    override?: KeyOverride
): Promise<OpenedArchive> {
    const { adapter, config } = await resolveStorageAdapter(storageConfigId);
    const meta = await readBackupMetadata(adapter, config, file);

    if (meta.archive?.formatVersion !== 2) {
        throw new ValidationError(
            "This backup predates the seekable archive format, so single files or databases cannot be read out of it. Restore or download it as a whole instead.",
            { field: "file" }
        );
    }

    // The index sidecar is the primary path: it is small, and reading it means the archive
    // itself is only ever touched for the entries actually being restored.
    const sidecarBytes = await archiveIndexService.fetchSidecar(storageConfigId, file, meta.archive.indexFile);

    let managed = await openStorageArchiveSource(adapter, config, file, undefined);
    try {
        const manifest = await readArchiveManifest(managed.source);

        if (!sidecarBytes) {
            // No sidecar. Every archive carries a copy of its index as its last member, but
            // finding it means scanning backwards from the tail, which needs the archive
            // size - so this falls back to fetching the archive whole.
            log.warn("Archive index sidecar is missing, falling back to the embedded index", { file });
            await managed.dispose();
            managed = await openStorageArchiveSource(
                { ...adapter, downloadRange: undefined } as StorageAdapter, config, file
            );
        }

        // Index bytes before key: the sealed index is what proves a candidate key fits, so
        // Smart Recovery has nothing to test until they are read.
        const indexBytes = sidecarBytes ?? await readEmbeddedIndexBytes(managed.source);

        const masterKey = manifest.encryption
            ? await resolveBackupKey({
                profileId: manifest.encryption.profileId,
                override,
                verify: archiveIndexVerifier(indexBytes, manifest.encryption),
                log: (msg, level) => level === "warning" ? log.warn(msg, { file }) : log.info(msg, { file }),
            })
            : undefined;

        const index = await parseArchiveIndex(indexBytes, manifest, masterKey);
        await assertChainComplete(adapter, config, file, index);

        const chain: ChainReaderOptions = {
            adapter,
            config,
            snapshotPath: file,
            // Every archive of a chain is written by the same job, so the key that opened
            // this one opens its siblings - including when Smart Recovery had to find it
            // under a profile other than the one the archive names. Only a sibling naming a
            // different profile is resolved on its own, and it has no index in hand to test
            // a candidate against, so that case gets no Smart Recovery.
            resolveMasterKey: async (siblingProfileId: string) =>
                masterKey && siblingProfileId === manifest.encryption?.profileId
                    ? masterKey
                    : resolveBackupKey({ profileId: siblingProfileId, override }),
        };

        return { ...managed, manifest, index, masterKey, chain };
    } catch (e: unknown) {
        await managed.dispose();
        throw e;
    }
}

export interface FileRestorePlan {
    fileCount: number;
    databaseCount: number;
    /** Plaintext bytes across the selected files and dumps. */
    totalBytes: number;
    /** True when the archive was fetched whole because the adapter cannot serve ranges. */
    fullDownload: boolean;
    /** Whether a download of this selection is a single raw dump or a tar.gz. */
    output: "dump" | "tar";
}

/** What a selection covers in an archive that is already open. */
export function describeSelection(archive: Pick<OpenedArchive, "index" | "ranged">, input: FileRestoreInput): FileRestorePlan {
    const { files, databases } = resolveContents(archive.index, input);
    return {
        fileCount: files.length,
        databaseCount: databases.length,
        totalBytes: totalSize(files.map((f) => f.file)) + databases.reduce((sum, d) => sum + d.s, 0),
        fullDownload: !archive.ranged,
        output: downloadShape(input),
    };
}

/** Resolves a selection without restoring anything, for confirmation dialogs. */
export async function planFileRestore(input: FileRestoreInput): Promise<FileRestorePlan> {
    const archive = await openArchiveForRestore(input.storageConfigId, input.file, input.keyOverride);
    try {
        return describeSelection(archive, input);
    } finally {
        await archive.dispose();
    }
}

/**
 * Streams the selection to the caller as a gzipped tar.
 *
 * Deliberately streamed rather than assembled first: a selection can be far larger than
 * both RAM and free disk on the DBackup host, and the user should see bytes arriving
 * immediately rather than after a long silent staging phase.
 */
export async function streamFileRestore(input: FileRestoreInput): Promise<NodeJS.ReadableStream> {
    const archive = await openArchiveForRestore(input.storageConfigId, input.file, input.keyOverride);
    let contents: ReturnType<typeof resolveContents>;
    try {
        contents = resolveContents(archive.index, input);
    } catch (e: unknown) {
        await archive.dispose();
        throw e;
    }
    const { files, databases } = contents;

    if (files.length === 0 && databases.length === 0) {
        await archive.dispose();
        throw new ValidationError("Nothing matched the selection", { field: "selections" });
    }

    const bySrc = new Map(files.map((f) => [f.file, f.src]));
    // Links carry no bytes, so they are written straight into the tar as symlink members
    // rather than going through the entry reader. A browser download is therefore always
    // complete: `tar` recreates them on extraction with nothing else required.
    const { payloads, symlinks } = partitionSymlinks(files);
    const tarPack = pack();
    // Level 1 packs about twice as fast as the default 6 for a result roughly a tenth larger.
    // Measured on dump-like text on one core, 90 against 41 MB/s, so on a gigabit link the
    // default would cap the download instead of the network.
    const gzip = createGzip({ level: 1 });
    tarPack.pipe(gzip);
    // .pipe() does not carry an error from tarPack across to gzip, and gzip is the only
    // stream the caller holds. Forward it by hand so a mid-stream failure destroys gzip
    // instead of surfacing as an unhandled 'error' on tarPack that crashes the process.
    // The route then tears down the web response with it, which is the intended outcome.
    tarPack.on("error", (err) => { if (!gzip.destroyed) gzip.destroy(err); });

    // Produced in the background so the response can start flowing immediately. Errors are
    // pushed into the stream rather than thrown, since the caller already holds it.
    void (async () => {
        try {
            // Dumps first. They always live in the snapshot's own archive, never in a chain
            // sibling, so they need nothing from the chain reader.
            for (const database of databases) {
                const entry = archive.index.entries.get(entryKey(undefined, database.n));
                if (!entry) throw new Error(`Archive index is inconsistent: database '${database.name}' has no entry`);

                const member = tarPack.entry({
                    name: `${DATABASE_MEMBER_PREFIX}${databaseDumpFileName(database.name, database.format)}`,
                    size: database.s,
                });
                let digest: string | undefined;
                await pipeline(
                    await openArchiveEntry(archive.source, archive.manifest, entry, archive.masterKey),
                    hashingStream((d) => { digest = d; }),
                    member
                );
                if (database.h && digest !== database.h) {
                    throw new Error(`Database dump '${database.name}' does not match its recorded checksum - the archive is corrupt`);
                }
            }

            await forEachSnapshotFile(archive, payloads, async (file, content) => {
                const entry = tarPack.entry({ name: `${bySrc.get(file) ?? file.src}/${file.p}`, size: file.s });
                let digest: string | undefined;
                await pipeline(content, hashingStream((d) => { digest = d; }), entry);

                // The checksum is the last line of defence. For an encrypted archive the
                // AEAD tag already caught any corruption, but for an unencrypted one this is
                // the only check - so a mismatch aborts the download rather than handing the
                // user a broken file dressed up as a success.
                if (file.h && digest && digest !== file.h) {
                    throw new Error(
                        `Restored file '${file.p}' does not match its recorded checksum - the archive is corrupt`
                    );
                }
            });

            // After every regular file, matching how extractArchiveFrom() orders it and for
            // the same reason: `tar` follows an existing symlink when it writes a file
            // underneath one, so a link must never precede the files it could swallow.
            for (const { file, src } of symlinks) {
                await new Promise<void>((resolve, reject) => {
                    tarPack.entry(
                        { name: `${src}/${file.p}`, type: "symlink", linkname: file.lnk, size: 0 },
                        (err) => (err ? reject(err) : resolve())
                    );
                });
            }

            tarPack.finalize();
        } catch (e: unknown) {
            const wrapped = wrapError(e);
            log.error("File restore stream failed", { file: input.file }, wrapped);
            // Destroy the pack with the error; pipeline forwards it to gzip, which the caller
            // and the HTTP response are watching.
            tarPack.destroy(wrapped);
        } finally {
            await archive.dispose();
        }
    })();

    return gzip;
}

/**
 * Resolves where each directory source's files should be written back to.
 *
 * Driven by the source ids actually resolved from the index rather than by the request's
 * selection, so restoring a whole snapshot (which carries no selection) works too.
 */
async function resolveTargets(
    input: FileRestoreInput,
    sourceIds: string[]
): Promise<Map<string, { adapter: StorageAdapter; config: AdapterConfig; basePath: string; label: string }>> {
    const targets = new Map<string, { adapter: StorageAdapter; config: AdapterConfig; basePath: string; label: string }>();

    if (input.target.kind === "storage") {
        const { adapter, config } = await resolveStorageAdapter(input.target.configId);
        const row = await prisma.adapterConfig.findUnique({ where: { id: input.target.configId } });
        for (const src of sourceIds) {
            targets.set(src, {
                adapter, config,
                basePath: input.target.basePath,
                label: `${row?.name ?? input.target.configId}:${input.target.basePath}`,
            });
        }
        return targets;
    }

    // "origin" - each directory source goes back to the adapter and path it came from.
    for (const src of sourceIds) {
        const jobSource = await prisma.jobSource.findUnique({
            where: { id: src },
            include: { config: true },
        });
        if (!jobSource) {
            throw new NotFoundError(
                "Directory source",
                `${src} - it was deleted since this backup was taken, so its original location is unknown. Restore to a chosen destination instead.`
            );
        }
        const { adapter, config } = await resolveStorageAdapter(jobSource.configId);
        targets.set(src, {
            adapter, config,
            basePath: jobSource.path,
            label: `${jobSource.config.name}:${jobSource.path}`,
        });
    }

    return targets;
}

export interface FileRestoreResult {
    restored: number;
    failed: { path: string; error: string }[];
    totalBytes: number;
}

/**
 * Writes the selection to a storage destination, either its origin or a chosen one.
 *
 * Files are staged one at a time through a temp file because StorageAdapter.upload() takes
 * a local path rather than a stream. Only one file is on disk at any moment, so peak usage
 * is the largest single file rather than the whole restore.
 */
export async function restoreFilesToStorage(
    input: FileRestoreInput,
    onProgress?: (done: number, total: number, currentPath: string) => void
): Promise<FileRestoreResult> {
    if (input.target.kind === "download") {
        throw new ValidationError("Use streamFileRestore() for browser downloads", { field: "target" });
    }

    if (input.databases && input.databases.length > 0) {
        throw new ValidationError("Database dumps can only be downloaded, not written to a storage destination", { field: "databases" });
    }

    const archive = await openArchiveForRestore(input.storageConfigId, input.file, input.keyOverride);
    const { files } = resolveContents(archive.index, input);
    const targets = await resolveTargets(input, [...new Set(files.map((f) => f.src))]);

    if (files.length === 0) {
        await archive.dispose();
        throw new ValidationError("No files matched the selection", { field: "selections" });
    }

    const failed: FileRestoreResult["failed"] = [];
    let restored = 0;
    let restoredBytes = 0;

    // Split before anything runs. Links have no entry to fetch, and they are created after
    // every file for the same reason extractArchiveFrom() does it that way.
    const { payloads, symlinks } = partitionSymlinks(files);

    // Write-back stages each file independently, so several run at once - the round-trip
    // win when restoring to a network destination. Each target states how many it can take;
    // the files of every target share one pipeline, so the smallest wins. Anything else
    // would push a rate-limited destination past what it said it could handle in order to
    // keep a faster one busy.
    const concurrency = Math.min(
        ...[...targets.values()].map((t) => resolveTransferConcurrency(t.adapter.id, t.config)),
    );

    const sessions = createDestinationSessions(concurrency);

    try {
        await forEachSnapshotFile(archive, payloads, async (file, content) => {
            const target = targets.get(file.src);
            if (!target) {
                failed.push({ path: file.p, error: "No restore target resolved for this directory source" });
                return;
            }

            const stagePath = path.join(getTempDir(), `restore-${process.pid}-${crypto.randomUUID()}`);
            let digest: string | undefined;
            try {
                await pipeline(content, hashingStream((d) => { digest = d; }), createWriteStream(stagePath));

                if (file.h && digest && digest !== file.h) {
                    throw new Error(`Checksum mismatch: expected ${file.h}, got ${digest}`);
                }

                const remotePath = safeRemoteJoin(target.basePath, file.p);
                if (!(await sessions.upload(target, stagePath, remotePath, undefined, metadataFromIndex(file)))) {
                    throw new Error(`Adapter '${target.adapter.id}' rejected the upload`);
                }

                restored++;
                restoredBytes += file.s;
                onProgress?.(restored, files.length, file.p);
            } catch (e: unknown) {
                const message = e instanceof Error ? e.message : String(e);
                failed.push({ path: file.p, error: message });
                log.warn("Failed to restore file", { file: file.p, target: target.label }, wrapError(e));
            } finally {
                await fs.unlink(stagePath).catch(() => { });
            }
        }, concurrency);

        // Last, after every file has been uploaded. Not a cosmetic ordering: a destination
        // that resolves paths through its own filesystem would otherwise let a file land
        // inside a link created moments earlier, which is the tar traversal problem wearing a
        // different hat.
        for (const { file, src } of symlinks) {
            const target = targets.get(src);
            if (!target) {
                failed.push({ path: file.p, error: "No restore target resolved for this directory source" });
                continue;
            }

            const remotePath = safeRemoteJoin(target.basePath, file.p);
            if (!target.adapter.createSymlink) {
                // Named individually and counted as a failure, which downgrades the restore.
                // Object storage has no symbolic links, and reporting a complete restore that
                // is missing them is exactly the silence this whole change exists to end.
                //
                // Phrased as the capability limit it is, with the destinations that do work:
                // there is nothing here for the user to retry or fix at this one.
                failed.push({
                    path: file.p,
                    error: `${target.label} cannot store symbolic links, so '${file.p}' -> '${file.lnk}' was not restored. `
                        + `Restore to a local path, over SFTP, or as a .tar.gz download to keep symbolic links.`,
                });
                continue;
            }

            try {
                await target.adapter.createSymlink(target.config, remotePath, file.lnk);
                restored++;
                onProgress?.(restored, files.length, file.p);
            } catch (e: unknown) {
                const message = e instanceof Error ? e.message : String(e);
                failed.push({ path: file.p, error: message });
                log.warn("Failed to restore symlink", { file: file.p, target: target.label }, wrapError(e));
            }
        }
    } finally {
        await sessions.close();
        await archive.dispose();
    }

    return { restored, failed, totalBytes: restoredBytes };
}
