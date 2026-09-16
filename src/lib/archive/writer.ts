/**
 * Writer for the seekable archive format (manifest version 2).
 *
 * Layout produced:
 *
 *     manifest.json     cleartext, first, carries no user data
 *     <data members>    [compress] -> [seal] per entry, individually addressable
 *     index             sealed NDJSON, last, records every entry's byte offset
 *
 * The archive itself is never compressed or encrypted as a whole. That is the property
 * that makes file-level restore possible: a single entry can be fetched by byte range and
 * opened on its own. Compressing or sealing the outer stream would force a full download
 * and a full decrypt just to read one file.
 *
 * Written in three passes. The index has to come last because it records offsets that only
 * exist once the data members have been written, and those offsets are discovered by a
 * header walk rather than by counting emitted bytes - see tar-blocks.ts for why counting
 * is not correct.
 */

import path from "path";
import crypto from "crypto";
import fs from "fs/promises";
import { createReadStream, createWriteStream } from "fs";
import { PassThrough, Readable, pipeline as pipelineCb } from "stream";
import { pipeline } from "stream/promises";
import { pack, Pack } from "tar-stream";
import { compressBufferSync, getCompressionStream, getCompressionExtension } from "@/lib/crypto/compression";
import { deriveArchiveKeys, generateKdfSalt } from "@/lib/crypto/kdf";
import { generateNoncePrefix, sealEntry, sealedSize } from "@/lib/crypto/entry-cipher";
import { getTempDir } from "@/lib/temp-dir";
import { isIncompressible } from "@/lib/incompressible-formats";
import {
    BUNDLE_FILE_MAX_SIZE,
    BUNDLE_TARGET_SIZE,
    DATABASE_MEMBER_PREFIX,
    FIRST_DATA_ORDINAL,
    INDEX_MEMBER,
    MANIFEST_MEMBER,
    SOURCE_MEMBER_PREFIX,
    opaqueMemberName,
} from "./format";
import { buildUstarHeader, tarPadding, walkTarHeaders, TAR_TRAILER } from "./tar-blocks";
import { serializeIndex } from "./index-file";
import { hashingStream } from "./hashing";
import { databaseDumpFileName } from "./dump-names";
import {
    ArchiveIndex,
    ArchiveManifest,
    ChainInfo,
    entryKey,
    ArchiveSourceEntry,
    CompressionKind,
    CreateArchiveOptions,
    CreateArchiveResult,
    DumpFormat,
    IndexDatabaseLine,
    IndexDirectoryLine,
    IndexEntryLine,
    IndexFileLine,
    IndexLine,
    metadataToIndex,
    SourceFileEntry,
} from "./types";

/** A single small file packed into a shared bundle. */
interface BundlePart {
    localPath: string;
    file: SourceFileEntry;
    src: string;
}

/**
 * One physical tar member. `origin` carries what the index needs to describe this member's
 * logical content, so index lines can be produced in a single pass afterwards.
 */
interface PlannedEntry {
    ordinal: number;
    member: string;
    comp?: CompressionKind;
    origin:
    | { kind: "database"; dbName: string; format: DumpFormat; localPath: string }
    | { kind: "file"; src: string; file: SourceFileEntry; localPath: string }
    | { kind: "bundle"; parts: BundlePart[] };
}

/** A materialized entry, ready to be streamed into the tar. */
interface MaterializedEntry {
    /** Bytes to store in the tar, i.e. after compression and sealing. */
    storedSize: number;
    /** Streams the exact bytes to store. */
    open: () => NodeJS.ReadableStream;
    /** Temp file to remove once written, if one was needed. */
    tempFile?: string;
    /** Byte ranges within the decompressed payload, in bundle-part order. */
    parts?: { offset: number; length: number }[];
    /**
     * SHA-256 of the plaintext, for database dumps. Only known once the bytes have been read,
     * which for an uncompressed dump is not until the member has been written.
     */
    plainDigest?: () => string | undefined;
}

/**
 * Groups source entries into physical tar members.
 *
 * Small files are packed into shared bundles, but only when the archive is encrypted.
 * An unencrypted archive must stay unpackable with plain `tar -xf`, and a bundle has no
 * single real path, so the efficiency win is traded away to keep that promise intact.
 */
function planEntries(entries: ArchiveSourceEntry[], encrypted: boolean, compression?: CompressionKind): PlannedEntry[] {
    const planned: PlannedEntry[] = [];
    let ordinal = FIRST_DATA_ORDINAL;

    const memberName = (realPath: string, comp?: CompressionKind): string =>
        encrypted ? opaqueMemberName(ordinal) : `${realPath}${comp ? getCompressionExtension(comp) : ""}`;

    for (const entry of entries) {
        if (entry.kind === "database") {
            // Recompressing a natively compressed dump (pg_dump -Z) burns CPU for nothing.
            const comp = entry.nativeCompression ? undefined : compression;
            planned.push({
                ordinal,
                // The name is sanitized because an unencrypted archive publishes it as a real
                // path, and `tar -xf` would follow a database called `../../x` out of the folder.
                member: memberName(`${DATABASE_MEMBER_PREFIX}${databaseDumpFileName(entry.dbName, entry.format)}`, comp),
                comp,
                origin: { kind: "database", dbName: entry.dbName, format: entry.format, localPath: entry.path },
            });
            ordinal++;
            continue;
        }

        let bundle: BundlePart[] = [];
        let bundleSize = 0;

        const flushBundle = () => {
            if (bundle.length === 0) return;
            planned.push({
                ordinal,
                member: opaqueMemberName(ordinal),
                comp: compression,
                origin: { kind: "bundle", parts: bundle },
            });
            ordinal++;
            bundle = [];
            bundleSize = 0;
        };

        for (const file of entry.files) {
            // A symbolic link has no bytes and therefore no physical member: its whole content
            // is the target string, which goes straight into the index. Skipping it here is
            // what keeps it out of the bundler and away from any attempt to read a local file
            // that was never collected.
            if (file.linkTarget !== undefined) continue;

            const localPath = path.join(entry.localPath, file.path);

            if (encrypted && file.size <= BUNDLE_FILE_MAX_SIZE) {
                bundle.push({ localPath, file, src: entry.jobSourceId });
                bundleSize += file.size;
                if (bundleSize >= BUNDLE_TARGET_SIZE) flushBundle();
                continue;
            }

            // Recompressing an already-compressed format costs a full temp-file round trip
            // and the CPU to go with it, for a fraction of a percent - the same reasoning
            // that skips a natively compressed dump above. Bundles are deliberately left
            // out: they hold whatever small files happen to be adjacent, and lifting an
            // image out of one would cost it its own tar header and auth tag, which is more
            // than the compression ever saved on a file that size.
            const comp = isIncompressible(file.path) ? undefined : compression;

            planned.push({
                ordinal,
                member: memberName(`${SOURCE_MEMBER_PREFIX}${entry.jobSourceId}/${file.path}`, comp),
                comp,
                origin: { kind: "file", src: entry.jobSourceId, file, localPath },
            });
            ordinal++;
        }

        flushBundle();
    }

    return planned;
}

/** A symbolic link from a directory source. Carries a target instead of bytes. */
interface PlannedSymlink {
    src: string;
    /** Path relative to the directory source root, POSIX separators. */
    path: string;
    /** ISO 8601 mtime of the link itself. */
    mtime: string;
    /** Raw, unresolved target. */
    target: string;
}

/** Collects every symbolic link across the directory sources, in source order. */
function planSymlinks(entries: ArchiveSourceEntry[]): PlannedSymlink[] {
    const links: PlannedSymlink[] = [];
    for (const entry of entries) {
        if (entry.kind !== "directory") continue;
        for (const file of entry.files) {
            if (file.linkTarget === undefined) continue;
            links.push({ src: entry.jobSourceId, path: file.path, mtime: file.mtime, target: file.linkTarget });
        }
    }
    return links;
}

/**
 * Produces the exact bytes for one entry.
 *
 * Compressed payloads go through a temp file because tar needs the member size before the
 * payload, and compressed size is only known after compressing. Uncompressed payloads skip
 * that: sealing adds exactly TAG_LENGTH bytes with no padding, so the stored size is known
 * up front and the source file streams straight through.
 */
async function materialize(entry: PlannedEntry, sealKey: Buffer | null, noncePrefix: Buffer | null): Promise<MaterializedEntry> {
    // Built with pipeline, not stream.pipe(): a read error on the underlying source (a
    // collected file deleted before it is archived) must reach the returned stream instead
    // of firing as an unhandled 'error' on the source and taking the backup process down.
    const seal = (stream: NodeJS.ReadableStream): NodeJS.ReadableStream => {
        if (!sealKey || !noncePrefix) return stream;
        const out = new PassThrough();
        pipelineCb(stream, sealEntry(sealKey, noncePrefix, entry.ordinal), out, () => { /* surfaced on out */ });
        return out;
    };
    const withTag = (size: number): number => (sealKey ? sealedSize(size) : size);

    if (entry.origin.kind === "bundle") {
        // Bundles are capped at BUNDLE_TARGET_SIZE, so assembling one in memory is bounded
        // and yields exact part offsets without a second pass over the files.
        const parts: NonNullable<MaterializedEntry["parts"]> = [];
        const buffers: Buffer[] = [];
        let offset = 0;

        for (const part of entry.origin.parts) {
            const content = await fs.readFile(part.localPath);
            buffers.push(content);
            parts.push({ offset, length: content.length });
            offset += content.length;
        }

        const plain = Buffer.concat(buffers);
        const payload = entry.comp ? compressBufferSync(plain, entry.comp) : plain;

        return { storedSize: withTag(payload.length), open: () => seal(Readable.from([payload])), parts };
    }

    const localPath = entry.origin.localPath;

    // A dump gets the same plaintext checksum a file gets from its collector. Hashed on the
    // way through rather than in a separate read, because a dump can be tens of gigabytes.
    // Files are not hashed here: their checksum was already taken when they were collected.
    let digest: string | undefined;
    const isDatabase = entry.origin.kind === "database";
    const read = (): NodeJS.ReadableStream => {
        const raw = createReadStream(localPath);
        if (!isDatabase) return raw;
        const out = new PassThrough();
        pipelineCb(raw, hashingStream((d) => { digest = d; }), out, () => { /* surfaced on out */ });
        return out;
    };
    const plainDigest = isDatabase ? () => digest : undefined;

    if (!entry.comp) {
        const stats = await fs.stat(localPath);
        return { storedSize: withTag(stats.size), open: () => seal(read()), plainDigest };
    }

    // Ordinals restart at 1 for every archive, so pid + ordinal is not unique: two jobs
    // running concurrently in the same process (maxConcurrentJobs > 1) would compress
    // different entries into the same file and each would end up with the other's bytes.
    const tempFile = path.join(
        getTempDir(),
        `archive-entry-${process.pid}-${crypto.randomUUID()}${getCompressionExtension(entry.comp)}`
    );
    const compressStream = getCompressionStream(entry.comp);
    if (!compressStream) throw new Error(`Unsupported compression type: ${entry.comp}`);
    await pipeline(read(), compressStream, createWriteStream(tempFile));

    const stats = await fs.stat(tempFile);
    return { storedSize: withTag(stats.size), open: () => seal(createReadStream(tempFile)), tempFile, plainDigest };
}

/**
 * What to call an entry in the live progress display.
 *
 * Deliberately derived from the origin rather than from the tar member name: in an encrypted
 * archive the member name is opaque by design, so it would show the user nothing.
 */
function entryLabel(entry: PlannedEntry): string {
    if (entry.origin.kind === "database") return entry.origin.dbName;
    if (entry.origin.kind === "file") return entry.origin.file.path;
    return `${entry.origin.parts.length} small file${entry.origin.parts.length === 1 ? "" : "s"}`;
}

/** Streams one already-materialized entry into the tar. */
async function writeMember(tarPack: Pack, name: string, size: number, open: () => NodeJS.ReadableStream): Promise<void> {
    const entry = tarPack.entry({ name, size });
    // pipeline wires error handling across both ends and resolves when the tar entry
    // finishes, so a source read failure rejects here rather than crashing the process.
    await pipeline(open(), entry as NodeJS.WritableStream);
}

/**
 * Writes a real TAR symlink member: typeflag 2, a linkname, and no payload.
 *
 * Only ever called for unencrypted archives, and that restriction is the point. It is what
 * keeps the promise that such an archive extracts correctly with plain `tar -xf` and no
 * DBackup anywhere. An encrypted archive must not carry one: a link target is a path, and a
 * tar header is cleartext, so writing it there would publish user data right next to the
 * sealed entries that exist to hide exactly that. Encrypted archives keep their targets in
 * the sealed index alone.
 */
function writeSymlinkMember(tarPack: Pack, name: string, target: string): Promise<void> {
    return new Promise((resolve, reject) => {
        tarPack.entry({ name, type: "symlink", linkname: target, size: 0 }, (err) => (err ? reject(err) : resolve()));
    });
}

/**
 * Creates a seekable archive containing database dumps and/or directory source trees.
 *
 * @param entries - Database dumps and directory roots, already on local disk
 * @param destinationPath - Where the archive is written
 * @param options - Source metadata, compression, and encryption when enabled
 * @returns The manifest, the parsed index, and the index bytes to store as a sidecar
 */
export async function createArchive(
    entries: ArchiveSourceEntry[],
    destinationPath: string,
    options: CreateArchiveOptions
): Promise<CreateArchiveResult> {
    const compression = options.compression && options.compression !== "NONE" ? options.compression : undefined;
    const encrypted = !!options.encryption;

    const kdfSalt = encrypted ? generateKdfSalt() : null;
    const noncePrefix = encrypted ? generateNoncePrefix() : null;
    const keys = options.encryption && kdfSalt ? deriveArchiveKeys(options.encryption.masterKey, kdfSalt) : null;

    const planned = planEntries(entries, encrypted, compression);
    const symlinks = planSymlinks(entries);

    // Files the format rule stored as-is. Counted so a run can report it: a job configured
    // for compression that produces an archive the size of its input otherwise looks like a
    // setting that silently did not apply.
    const skippedCompression = planned.reduce(
        (acc, entry) =>
            compression && entry.origin.kind === "file" && !entry.comp
                ? { files: acc.files + 1, bytes: acc.bytes + entry.origin.file.size }
                : acc,
        { files: 0, bytes: 0 }
    );

    const directoryLines: IndexDirectoryLine[] = entries
        .filter((e): e is Extract<ArchiveSourceEntry, { kind: "directory" }> => e.kind === "directory")
        .map((e) => ({
            k: "d",
            src: e.jobSourceId,
            label: e.label,
            fileCount: e.files.length,
            totalSize: e.files.reduce((sum, f) => sum + f.size, 0),
            excludePatterns: e.excludePatterns,
        }));

    const databaseLines: IndexDatabaseLine[] = [];
    for (const entry of planned) {
        if (entry.origin.kind !== "database") continue;
        const stats = await fs.stat(entry.origin.localPath);
        databaseLines.push({ k: "db", name: entry.origin.dbName, format: entry.origin.format, n: entry.ordinal, s: stats.size });
    }

    const totalSize =
        databaseLines.reduce((sum, d) => sum + d.s, 0) + directoryLines.reduce((sum, d) => sum + d.totalSize, 0);

    const manifest: ArchiveManifest = {
        version: 2,
        createdAt: new Date().toISOString(),
        ...(options.chain
            ? {
                chain: {
                    id: options.chain.id,
                    type: options.chain.type,
                    ...(options.chain.base ? { base: options.chain.base } : {}),
                    index: options.chain.index,
                } satisfies ChainInfo,
            }
            : {}),
        sourceType: options.sourceType,
        engineVersion: options.engineVersion,
        compression: compression ?? "NONE",
        ...(options.encryption && kdfSalt && noncePrefix
            ? {
                encryption: {
                    algorithm: "aes-256-gcm" as const,
                    kdfSalt: kdfSalt.toString("hex"),
                    noncePrefix: noncePrefix.toString("hex"),
                    profileId: options.encryption.profileId,
                },
            }
            : {}),
        ...(planned.some((p) => p.origin.kind === "bundle") ? { bundled: true } : {}),
        counts: {
            databases: databaseLines.length,
            directorySources: directoryLines.length,
            files: directoryLines.reduce((sum, d) => sum + d.fileCount, 0),
            entries: planned.length,
            ...(symlinks.length > 0 ? { symlinks: symlinks.length } : {}),
        },
        totalSize,
        indexMember: INDEX_MEMBER,
    };

    // ── Pass 1: manifest and data members ─────────────────────────────────
    // finalize() is deliberately not called - the index member is appended in pass 3,
    // once the header walk has produced exact offsets for everything written here.
    const tarPack = pack();
    const writePromise = pipeline(tarPack, createWriteStream(destinationPath));
    const materializedByOrdinal = new Map<number, { storedSize: number; parts?: MaterializedEntry["parts"]; digest?: string }>();

    // Compressing an entry is independent work, so it runs ahead of the writer; appending to
    // the tar stays strictly in order, because the byte offsets that make the archive
    // seekable come from that order. `pending[i]` holds the in-flight materialization of
    // planned[i], and at most `lookahead` of them exist at once - which also bounds how many
    // compressed temp files sit on disk.
    const lookahead = Math.max(1, Math.min(Math.floor(options.concurrency ?? 1) || 1, planned.length));
    const pending: (Promise<MaterializedEntry> | undefined)[] = new Array(planned.length);
    const startMaterialize = (index: number) => {
        if (index >= planned.length) return;
        const started = materialize(planned[index], keys?.dataKey ?? null, noncePrefix);
        // A look-ahead failure must not surface as an unhandled rejection while the writer is
        // still busy with an earlier entry. Attaching a handler marks it handled; awaiting it
        // below still rejects with the original error.
        started.catch(() => { });
        pending[index] = started;
    };

    try {
        const manifestBuffer = Buffer.from(JSON.stringify(manifest, null, 2), "utf-8");
        await writeMember(tarPack, MANIFEST_MEMBER, manifestBuffer.length, () => Readable.from([manifestBuffer]));

        for (let i = 0; i < lookahead; i++) startMaterialize(i);

        for (let i = 0; i < planned.length; i++) {
            // Packing a large source is minutes of work after collection has finished, so a
            // cancel arriving here has to be honoured rather than waited out. The finally
            // block below cleans up whatever was compressed ahead.
            options.signal?.throwIfAborted();
            const entry = planned[i];
            const materialized = await pending[i]!;
            pending[i] = undefined;
            startMaterialize(i + lookahead);

            try {
                await writeMember(tarPack, entry.member, materialized.storedSize, materialized.open);
                materializedByOrdinal.set(entry.ordinal, {
                    storedSize: materialized.storedSize,
                    parts: materialized.parts,
                    digest: materialized.plainDigest?.(),
                });
            } finally {
                if (materialized.tempFile) await fs.unlink(materialized.tempFile).catch(() => { });
            }

            // Nothing reads a dump again once its member is written: its size was taken before
            // the manifest and the header walk below only reads the archive.
            if (entry.origin.kind === "database") {
                await options.onDatabaseDumpWritten?.(entry.origin.localPath);
            }

            options.onProgress?.(i + 1, planned.length, entryLabel(entry));
        }

        // Written after the data members and before the index, so the offsets recorded by the
        // header walk are untouched by them - a symlink member carries no payload, and nothing
        // ever looks its offset up.
        if (!encrypted) {
            for (const link of symlinks) {
                options.signal?.throwIfAborted();
                await writeSymlinkMember(tarPack, `${SOURCE_MEMBER_PREFIX}${link.src}/${link.path}`, link.target);
            }
        }
    } finally {
        // Entries compressed ahead but never written - an error cut the loop short - still
        // have a temp file on disk.
        for (const inFlight of pending) {
            if (!inFlight) continue;
            const leftover = await inFlight.catch(() => undefined);
            if (leftover?.tempFile) await fs.unlink(leftover.tempFile).catch(() => { });
        }
        tarPack.push(null);
        await writePromise;
    }

    // ── Pass 2: exact offsets, then the logical index ─────────────────────
    // Header-only walk, seeking over payloads. Cost scales with member count, not size.
    const offsetByMember = new Map((await walkTarHeaders(destinationPath)).map((m) => [m.name, m.offset]));

    const entryLines: IndexEntryLine[] = [];
    const fileLines: IndexFileLine[] = [];
    const databaseLineByOrdinal = new Map(databaseLines.map((line) => [line.n, line]));

    for (const entry of planned) {
        const materialized = materializedByOrdinal.get(entry.ordinal)!;
        const offset = offsetByMember.get(entry.member);
        if (offset === undefined) {
            throw new Error(`Archive is inconsistent: member '${entry.member}' is missing after writing`);
        }

        entryLines.push({
            k: "e",
            n: entry.ordinal,
            member: entry.member,
            off: offset,
            size: materialized.storedSize,
            ...(encrypted ? { sealed: true as const } : {}),
            ...(entry.comp ? { comp: entry.comp } : {}),
            ...(entry.origin.kind === "bundle" ? { bundle: true as const } : {}),
        });

        if (entry.origin.kind === "database") {
            const line = databaseLineByOrdinal.get(entry.ordinal);
            if (line && materialized.digest) line.h = materialized.digest;
        } else if (entry.origin.kind === "file") {
            const { file, src } = entry.origin;
            fileLines.push({
                k: "f", src, p: file.path, s: file.size, m: file.mtime,
                ...(file.checksum ? { h: file.checksum } : {}),
                ...metadataToIndex(file),
                n: entry.ordinal,
            });
        } else if (entry.origin.kind === "bundle") {
            entry.origin.parts.forEach((part, i) => {
                const slice = materialized.parts![i];
                fileLines.push({
                    k: "f", src: part.src, p: part.file.path, s: part.file.size, m: part.file.mtime,
                    ...(part.file.checksum ? { h: part.file.checksum } : {}),
                    ...metadataToIndex(part.file),
                    n: entry.ordinal, o: slice.offset, l: slice.length,
                });
            });
        }
    }

    // Symbolic links, which have no entry to resolve offsets against. Emitted here so they sit
    // in the index alongside real files and every reader that lists a source sees them without
    // knowing anything special - only the paths that fetch bytes have to branch, and they do
    // that on the absence of `n`.
    for (const link of symlinks) {
        fileLines.push({ k: "f", src: link.src, p: link.path, s: 0, m: link.mtime, lnk: link.target });
    }

    // ── Carried-over content from earlier archives in the chain ───────────
    // An incremental only stores what changed, but its index still describes the whole
    // tree. Unchanged files keep pointing at whichever archive already holds them, which
    // is what lets a restore resolve a snapshot in one lookup instead of replaying the
    // chain. The foreign entry lines are carried too, so a single index is self-sufficient
    // and no predecessor's index has to be opened.
    const carried = options.chain?.carried;
    const allFileLines = [...fileLines, ...(carried?.files ?? [])];
    const allEntryLines = [...entryLines, ...(carried?.entries ?? [])];

    const deps = [...new Set(allFileLines.map((f) => f.a).filter((a): a is string => !!a))].sort();

    // Directory lines describe the whole snapshot, so carried files count towards their
    // file count and size too. Without this an incremental would report only what it
    // physically stores, and the browse UI would show a directory as nearly empty.
    for (const line of directoryLines) {
        const carriedHere = (carried?.files ?? []).filter((f) => f.src === line.src);
        line.fileCount += carriedHere.length;
        line.totalSize += carriedHere.reduce((sum, f) => sum + f.s, 0);
    }

    const index: ArchiveIndex = {
        header: { k: "h", v: 2, createdAt: manifest.createdAt, archive: path.basename(destinationPath) },
        entries: new Map(allEntryLines.map((line) => [entryKey(line.a, line.n), line])),
        databases: databaseLines,
        directories: directoryLines,
        files: allFileLines,
        deps,
    };

    const lines: IndexLine[] = [
        index.header,
        ...(deps.length > 0 ? [{ k: "deps" as const, archives: deps }] : []),
        ...allEntryLines,
        ...databaseLines,
        ...directoryLines,
        ...allFileLines,
    ];
    const indexBytes = await serializeIndex(
        lines,
        keys && noncePrefix ? { indexKey: keys.indexKey, noncePrefix } : undefined
    );

    // ── Pass 3: append the index member and close the archive ─────────────
    await fs.appendFile(
        destinationPath,
        Buffer.concat([
            buildUstarHeader(INDEX_MEMBER, indexBytes.length),
            indexBytes,
            tarPadding(indexBytes.length),
            TAR_TRAILER,
        ])
    );

    return { manifest, index, indexBytes, skippedCompression };
}
