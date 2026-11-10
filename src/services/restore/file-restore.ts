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
import { restoreDestination, safeRemoteJoin } from "@/lib/archive/remote-paths";
import prisma from "@/lib/prisma";
import { STORAGE_ROLES } from "@/lib/core/storage-roles";
import { pipeline } from "stream/promises";
import { createGzip } from "zlib";
import { pack } from "tar-stream";
import crypto from "crypto";
import { BackupMetadata, StorageAdapter, AdapterConfig } from "@/lib/core/interfaces";
import { openStorageArchiveSource, resolveStorageAdapter, ManagedArchiveSource } from "@/lib/archive/storage-source";
import { parseArchiveIndex, readArchiveManifest, readEmbeddedIndexBytes } from "@/lib/archive/reader";
import { createDestinationSessions } from "./destination-sessions";
import { findRestoreTarget } from "./restore-target";
import { openRow } from "@/services/sharing/destination-access";
import { forEachSnapshotFile, ChainReaderOptions } from "@/lib/archive/chain-source";
import { hashingStream } from "@/lib/archive/hashing";
import { checkChainCompleteness } from "@/lib/archive/chain";
import { totalSize } from "@/lib/archive/browse";
import { resolveContents, downloadShape, type FileRestoreSelection } from "./archive-selection";
import { databaseDumpFileName, safeNameSegment } from "@/lib/archive/dump-names";
import { DATABASE_MEMBER_PREFIX } from "@/lib/archive/format";
import { entryKey } from "@/lib/archive/types";
import { openArchiveEntry } from "@/lib/archive/reader";
import { archiveIndexVerifier, KeyOverride, resolveBackupKey } from "@/services/backup/key-resolution";
import { resolveTransferConcurrency } from "@/lib/adapters/transfer-concurrency";
import { archiveIndexService } from "@/services/backup/archive-index-service";
import { giveRecordedMode, privateTempPath } from "@/lib/private-temp-dir";
import { readSidecarText } from "@/lib/adapters/storage/common/read-sidecar";
import { ArchiveIndex, ArchiveManifest, metadataFromIndex, partitionSymlinks } from "@/lib/archive/types";
import { logger } from "@/lib/logging/logger";
import { wrapError, NotFoundError, ValidationError } from "@/lib/logging/errors";
import fs from "fs/promises";
import { createWriteStream } from "fs";
import { ENTRY_THROUGH_LINK, LINK_LEAVES_TARGET, linkLeavesTarget, throughLinkOf } from "@/lib/archive/link-target";
import { assertRestoreFolder } from "@/lib/archive/remote-paths";
import { assertWriteTargets, isOrigin, restoredFileRefusal, type RestoreCaller } from "./restore-targets";
import { reserveTempSpace, type TempSpaceReservation } from "./temp-space";
import { parseWithinBudget } from "@/services/backup/index-parse-budget";
import { assertEncryptionKept } from "./recorded-encryption";

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
    /**
     * Writing to storage only: refuses the connections the files would be written to by throwing,
     * called with their ids once they are known and before anything is written. A restore to the
     * origin learns them from the archive, so the caller cannot check them up front.
     */
    checkTargets?: (connectionIds: string[]) => Promise<void>;
    /**
     * Who restores, for the targets and files only some may write, see `assertWriteTargets` and
     * `restoredFileRefusal`. Without one the restore writes as someone with no rights beyond it.
     */
    caller?: RestoreCaller;
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
export async function readBackupMetadata(
    adapter: StorageAdapter,
    config: AdapterConfig,
    file: string
): Promise<BackupMetadata> {
    // Bounded, see `readSidecarText`: a `.meta.json` past the limit fails the read.
    const content = await readSidecarText(adapter, config, `${file}.meta.json`);
    if (!content) throw new NotFoundError("Backup metadata", `${file}.meta.json`);
    return JSON.parse(content) as BackupMetadata;
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
    override?: KeyOverride,
    /** The tenant whose view of the destination the path is in, the tenant of the code that runs when left out. */
    viewerTenantId?: string | null
): Promise<OpenedArchive> {
    const { adapter, config } = await resolveStorageAdapter(storageConfigId, viewerTenantId);
    const meta = await readBackupMetadata(adapter, config, file);

    if (meta.archive?.formatVersion !== 2) {
        throw new ValidationError(
            "This backup predates the seekable archive format, so single files or databases cannot be read out of it. Restore or download it as a whole instead.",
            { field: "file" }
        );
    }

    // The index sidecar is the primary path: it is small, and reading it means the archive
    // itself is only ever touched for the entries actually being restored.
    // Read in the same view as the archive, which for a shared restore is not the tenant of the request.
    const sidecarBytes = await archiveIndexService.fetchSidecar(storageConfigId, file, meta.archive.indexFile, viewerTenantId);

    let managed = await openStorageArchiveSource(adapter, config, file, undefined);
    try {
        const manifest = await readArchiveManifest(managed.source);
        // The manifest of the archive itself says whether it is encrypted, the run that wrote it
        // whether it has to be, see `recorded-encryption.ts`.
        await assertEncryptionKept(storageConfigId, file, { encrypted: !!manifest.encryption, jobId: meta.jobId }, viewerTenantId);

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

        // Within the bound on the parses of the process, see `index-parse-budget.ts`.
        const index = await parseWithinBudget(indexBytes.length, () => parseArchiveIndex(indexBytes, manifest, masterKey));
        await assertChainComplete(adapter, config, file, index);

        const chain: ChainReaderOptions = {
            adapter,
            config,
            snapshotPath: file,
            // A chain is written by one job, so a plain archive in the chain of an encrypted one was laid there.
            requireEncryption: !!manifest.encryption,
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

/**
 * The name of a file in a download: the id of its source as one plain folder, then its path, which
 * may not climb out of it. Both come from the index, and `tar -xf` on the machine of the user
 * writes wherever a name says, so `..` or an absolute path would land outside the folder it
 * extracts into. `safeRemoteJoin` refuses those, which fails the download rather than the user.
 */
function downloadMemberName(src: string, filePath: string): string {
    return `${safeNameSegment(src)}/${safeRemoteJoin("", filePath)}`;
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
                    await openArchiveEntry(archive.source, archive.manifest, entry, archive.masterKey, database.s),
                    hashingStream((d) => { digest = d; }),
                    member
                );
                if (database.h && digest !== database.h) {
                    throw new Error(`Database dump '${database.name}' does not match its recorded checksum - the archive is corrupt`);
                }
            }

            await forEachSnapshotFile(archive, payloads, async (file, content) => {
                const entry = tarPack.entry({ name: downloadMemberName(bySrc.get(file) ?? file.src, file.p), size: file.s });
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
                        { name: downloadMemberName(src, file.p), type: "symlink", linkname: file.lnk, size: 0 },
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

/** Where the files of one directory source are written: the connection, its adapter and config, and the folder. */
interface RestoreTarget {
    adapter: StorageAdapter;
    config: AdapterConfig;
    /** The saved connection the files go to. */
    connectionId: string;
    /** The adapter and tenant of that connection, for who may write into it. */
    adapterId: string;
    tenantId: string;
    basePath: string;
    label: string;
    /** Whether the files go back where the directory source read them. */
    origin: boolean;
    /** Whether the connection holds backups, where a file named like one may not be restored, see `restoredFileRefusal`. */
    destination: boolean;
}

/**
 * Resolves where each directory source's files should be written back to.
 *
 * Driven by the source ids actually resolved from the index rather than by the request's
 * selection, so restoring a whole snapshot (which carries no selection) works too.
 *
 * Only a source the request names in its selection counts as the origin of its files. The ids of
 * the index come from the destination, so a backup could name the source of another job, whose
 * folder the restore would then write as its origin, without the right to change that connection,
 * see `writeTargetRefusal`. A whole snapshot restored without a selection writes as anywhere else.
 */
async function resolveTargets(
    input: FileRestoreInput,
    sourceIds: string[]
): Promise<Map<string, RestoreTarget>> {
    const targets = new Map<string, RestoreTarget>();
    const named = new Set((input.selections ?? []).map((selection) => selection.src));

    if (input.target.kind === "storage") {
        // A folder that leaves the connection is refused before the connection is opened.
        assertRestoreFolder(input.target.basePath);
        // Never a destination shared with the tenant that takes only encrypted backups, see `findRestoreTarget`.
        const found = await findRestoreTarget(input.target.configId);
        const { adapter, config } = await openRow(found.row, found.mode);
        for (const src of sourceIds) {
            // The folder a source read, the volume of Docker Volumes, goes back without more rights, see `writeTargetRefusal`.
            const source = await prisma.jobSource.findUnique({ where: { id: src }, select: { configId: true, path: true } });
            targets.set(src, {
                adapter, config,
                connectionId: input.target.configId,
                adapterId: found.row.adapterId,
                tenantId: found.row.tenantId,
                basePath: input.target.basePath,
                label: `${found.row.name}:${input.target.basePath}`,
                origin: named.has(src) && isOrigin(source, input.target.configId, input.target.basePath, found.row.adapterId),
                destination: found.row.storageRole === STORAGE_ROLES.DESTINATION,
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
        assertRestoreFolder(jobSource.path);
        const origin = await findRestoreTarget(jobSource.configId);
        const { adapter, config } = await openRow(origin.row, origin.mode);
        targets.set(src, {
            adapter, config,
            connectionId: jobSource.configId,
            adapterId: origin.row.adapterId,
            tenantId: origin.row.tenantId,
            basePath: jobSource.path,
            label: `${jobSource.config.name}:${jobSource.path}`,
            origin: named.has(src),
            destination: origin.row.storageRole === STORAGE_ROLES.DESTINATION,
        });
    }

    return targets;
}

/** The caller of a restore that names none: no platform admin, no permission, no tenant. */
const NO_CALLER: RestoreCaller = { isPlatformAdmin: false, authMethod: "session" };

/** The path a file is written to, null when it leaves its folder, which the write then reports. */
function remotePathOrNull(basePath: string, relativePath: string): string | null {
    try {
        return safeRemoteJoin(basePath, relativePath);
    } catch {
        return null;
    }
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
    let files: ReturnType<typeof resolveContents>["files"];
    let targets: Map<string, RestoreTarget>;
    try {
        files = resolveContents(archive.index, input).files;
        targets = await resolveTargets(input, [...new Set(files.map((f) => f.src))]);
        // Before anything is written, with the connections of an origin known only now.
        await input.checkTargets?.([...new Set([...targets.values()].map((t) => t.connectionId))]);
        await assertWriteTargets([...targets.values()].map((t) => ({ ...t, config: t.config as Record<string, unknown> })), input.caller ?? NO_CALLER);
    } catch (e) {
        await archive.dispose();
        throw e;
    }

    if (files.length === 0) {
        await archive.dispose();
        throw new ValidationError("No files matched the selection", { field: "selections" });
    }

    const failed: FileRestoreResult["failed"] = [];
    let restored = 0;
    let restoredBytes = 0;

    // An entry below a link of the same backup is never written, see `throughLinkOf`.
    const throughLink = throughLinkOf(archive.index.files);
    // A file only a platform admin restores is named as failed and never read, see `restoredFileRefusal`.
    const writable = files.filter((file) => {
        if (throughLink(file.src, file.file.p)) {
            failed.push({ path: file.file.p, error: `'${file.file.p}' was not restored: ${ENTRY_THROUGH_LINK}.` });
            return false;
        }
        const target = targets.get(file.src);
        const refusal = target ? restoredFileRefusal(remotePathOrNull(target.basePath, file.file.p) ?? file.file.p, input.caller, target.destination, target.adapterId) : null;
        if (refusal) failed.push({ path: file.file.p, error: refusal });
        return !refusal;
    });

    // Split before anything runs. Links have no entry to fetch, and they are created after
    // every file for the same reason extractArchiveFrom() does it that way.
    const { payloads, symlinks } = partitionSymlinks(writable);

    // Write-back stages each file independently, so several run at once - the round-trip
    // win when restoring to a network destination. Each target states how many it can take;
    // the files of every target share one pipeline, so the smallest wins. Anything else
    // would push a rate-limited destination past what it said it could handle in order to
    // keep a faster one busy.
    const concurrency = Math.min(
        ...[...targets.values()].map((t) => resolveTransferConcurrency(t.adapter.id, t.config)),
    );

    // Each file is staged whole before its upload and removed after it, `concurrency` at once. The
    // space stays promised to this restore until it ends, see `reserveTempSpace`.
    let space: TempSpaceReservation | undefined;
    let sessions: ReturnType<typeof createDestinationSessions>;
    try {
        space = await reserveTempSpace(payloads.map(({ file }) => file.s ?? 0), concurrency);
        sessions = createDestinationSessions(concurrency);
    } catch (error) {
        space?.release();
        await archive.dispose();
        throw error;
    }

    try {
        await forEachSnapshotFile(archive, payloads, async (file, content) => {
            const target = targets.get(file.src);
            if (!target) {
                failed.push({ path: file.p, error: "No restore target resolved for this directory source" });
                return;
            }

            // In the private folder, since the file is restored data, decrypted.
            const stagePath = await privateTempPath(`restore-${process.pid}-${crypto.randomUUID()}`);
            const metadata = metadataFromIndex(file, target.origin);
            let digest: string | undefined;
            try {
                await pipeline(content, hashingStream((d) => { digest = d; }), createWriteStream(stagePath, { flags: "wx" }));
                // The mode the archive recorded, see `giveRecordedMode`, which an upload like rsync -a keeps.
                await giveRecordedMode(stagePath, metadata?.mode);

                if (file.h && digest && digest !== file.h) {
                    throw new Error(`Checksum mismatch: expected ${file.h}, got ${digest}`);
                }

                const { remotePath, restoreRelativePath } = restoreDestination(target.basePath, file.p);
                if (!(await sessions.upload(target, stagePath, remotePath, undefined, { ...metadata, restoreRelativePath }))) {
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

            // A link that leads out of the folder of the restore is never laid, see `link-target.ts`.
            if (linkLeavesTarget(file.p, file.lnk, (resolved) => throughLink(src, resolved))) {
                failed.push({ path: file.p, error: `The symbolic link '${file.p}' -> '${file.lnk}' was not restored: ${LINK_LEAVES_TARGET}.` });
                continue;
            }

            const { remotePath, restoreRelativePath } = restoreDestination(target.basePath, file.p);
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
                await target.adapter.createSymlink(target.config, remotePath, file.lnk, { restoreRelativePath });
                restored++;
                onProgress?.(restored, files.length, file.p);
            } catch (e: unknown) {
                const message = e instanceof Error ? e.message : String(e);
                failed.push({ path: file.p, error: message });
                log.warn("Failed to restore symlink", { file: file.p, target: target.label }, wrapError(e));
            }
        }
    } finally {
        space?.release();
        await sessions.close();
        await archive.dispose();
    }

    return { restored, failed, totalBytes: restoredBytes };
}
