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
import { readArchiveManifest, readArchiveIndex } from "@/lib/archive/reader";
import { forEachSnapshotFile, hashingStream, ChainReaderOptions } from "@/lib/archive/chain-source";
import { checkChainCompleteness } from "@/lib/archive/chain";
import { resolveSelection, totalSize } from "@/lib/archive/browse";
import { getProfileMasterKey } from "@/services/backup/encryption-service";
import { archiveIndexService } from "@/services/backup/archive-index-service";
import { getTempDir } from "@/lib/temp-dir";
import { ArchiveIndex, ArchiveManifest, IndexFileLine } from "@/lib/archive/types";
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

export interface FileRestoreSelection {
    /** JobSource id of the directory source. */
    src: string;
    /**
     * Selected paths relative to that source's root. A directory selects everything below
     * it. Absent means the whole source.
     */
    paths?: string[];
}

export interface FileRestoreInput {
    /** Storage adapter holding the backup. */
    storageConfigId: string;
    /** Remote path of the backup archive. */
    file: string;
    /**
     * Files to restore. Omit to restore the complete snapshot, which for an incremental
     * means every file it describes, wherever in the chain the bytes live.
     */
    selections?: FileRestoreSelection[];
    target: FileRestoreTarget;
}

/** Everything needed to read files out of a snapshot, plus how to release it. */
interface OpenedArchive extends ManagedArchiveSource {
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
export async function openArchiveForRestore(storageConfigId: string, file: string): Promise<OpenedArchive> {
    const { adapter, config } = await resolveStorageAdapter(storageConfigId);
    const meta = await readBackupMetadata(adapter, config, file);

    if (meta.archive?.formatVersion !== 2) {
        throw new ValidationError(
            "This backup does not support file-level restore. Only backups with directory sources created by a recent version can be browsed and restored file by file.",
            { field: "file" }
        );
    }

    const chain: ChainReaderOptions = {
        adapter,
        config,
        snapshotPath: file,
        resolveMasterKey: getProfileMasterKey,
    };

    // The index sidecar is the primary path: it is small, and reading it means the archive
    // itself is only ever touched for the entries actually being restored.
    const sidecarBytes = await archiveIndexService.fetchSidecar(storageConfigId, file, meta.archive.indexFile);

    let managed = await openStorageArchiveSource(adapter, config, file, undefined);
    try {
        const manifest = await readArchiveManifest(managed.source);
        const masterKey = manifest.encryption
            ? await getProfileMasterKey(manifest.encryption.profileId)
            : undefined;

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

        const index = await readArchiveIndex(managed.source, manifest, {
            ...(sidecarBytes ? { sidecarBytes } : {}),
            masterKey,
        });
        await assertChainComplete(adapter, config, file, index);

        return { ...managed, manifest, index, masterKey, chain };
    } catch (e: unknown) {
        await managed.dispose();
        throw e;
    }
}

/** Expands the caller's selection into concrete index lines, keyed by directory source. */
function resolveFiles(index: ArchiveIndex, selections?: FileRestoreSelection[]): { src: string; file: IndexFileLine }[] {
    // No selection means the whole snapshot. This is what the Storage Explorer's download
    // uses, so a user gets the complete contents rather than an incremental's delta.
    if (!selections || selections.length === 0) {
        return index.files.map((file) => ({ src: file.src, file }));
    }

    const resolved: { src: string; file: IndexFileLine }[] = [];
    const seen = new Set<string>();

    for (const selection of selections) {
        const files = selection.paths && selection.paths.length > 0
            ? resolveSelection(index, selection.src, selection.paths)
            : index.files.filter((f) => f.src === selection.src);
        for (const file of files) {
            const key = `${file.src}::${file.p}`;
            if (seen.has(key)) continue;
            seen.add(key);
            resolved.push({ src: selection.src, file });
        }
    }

    return resolved;
}

export interface FileRestorePlan {
    fileCount: number;
    totalBytes: number;
    /** True when the archive was fetched whole because the adapter cannot serve ranges. */
    fullDownload: boolean;
}

/** Resolves a selection without restoring anything, for confirmation dialogs. */
export async function planFileRestore(input: FileRestoreInput): Promise<FileRestorePlan> {
    const archive = await openArchiveForRestore(input.storageConfigId, input.file);
    try {
        const files = resolveFiles(archive.index, input.selections);
        return {
            fileCount: files.length,
            totalBytes: totalSize(files.map((f) => f.file)),
            fullDownload: !archive.ranged,
        };
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
    const archive = await openArchiveForRestore(input.storageConfigId, input.file);
    const files = resolveFiles(archive.index, input.selections);

    if (files.length === 0) {
        await archive.dispose();
        throw new ValidationError("No files matched the selection", { field: "selections" });
    }

    const bySrc = new Map(files.map((f) => [f.file, f.src]));
    const tarPack = pack();
    const gzip = createGzip();
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
            await forEachSnapshotFile(archive, files, async (file, content) => {
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

    const archive = await openArchiveForRestore(input.storageConfigId, input.file);
    const files = resolveFiles(archive.index, input.selections);
    const targets = await resolveTargets(input, [...new Set(files.map((f) => f.src))]);

    if (files.length === 0) {
        await archive.dispose();
        throw new ValidationError("No files matched the selection", { field: "selections" });
    }

    const failed: FileRestoreResult["failed"] = [];
    let restored = 0;
    let restoredBytes = 0;

    try {
        await forEachSnapshotFile(archive, files, async (file, content) => {
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
                if (!(await target.adapter.upload(target.config, stagePath, remotePath))) {
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
        });
    } finally {
        await archive.dispose();
    }

    return { restored, failed, totalBytes: restoredBytes };
}
