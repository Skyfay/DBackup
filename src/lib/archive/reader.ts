/**
 * Reader for the seekable archive format (manifest version 2).
 *
 * Everything here works from byte ranges, so the same code path serves a local temp file
 * and a remote object fetched over HTTP range requests. Reading one file out of a
 * multi-gigabyte archive costs one manifest read, one index read, and one range read of
 * the entry that holds it.
 */

import { Transform, TransformCallback } from "stream";
import { getDecompressionStream } from "@/lib/crypto/compression";
import { deriveArchiveKeys } from "@/lib/crypto/kdf";
import { openEntry } from "@/lib/crypto/entry-cipher";
import { INDEX_MEMBER, MANIFEST_MEMBER, TAR_BLOCK_SIZE } from "./format";
import { parseIndex } from "./index-file";
import { readAll } from "./sources";
import { ArchiveByteSource, ArchiveIndex, ArchiveManifest, entryKey, IndexEntryLine, IndexFileLine } from "./types";

/**
 * Bytes read when looking for the manifest. A real manifest is under 2 KB; the probe is
 * deliberately small because it is paid on every remote open, and readArchiveManifest()
 * fetches the exact remainder in the (theoretical) case a manifest outgrows it.
 */
const MANIFEST_PROBE_SIZE = 16 * 1024;

/** Initial window read from the tail when locating the index without a sidecar. */
const INDEX_TAIL_PROBE_SIZE = 1024 * 1024;

/** Upper bound on the tail window, so a corrupt archive cannot make this read forever. */
const INDEX_TAIL_MAX_PROBE = 256 * 1024 * 1024;

function readOctal(block: Buffer, start: number, length: number): number {
    const raw = block.subarray(start, start + length);
    const end = raw.indexOf(0);
    const text = raw.subarray(0, end === -1 ? raw.length : end).toString("utf-8").trim();
    const value = parseInt(text, 8);
    return Number.isNaN(value) ? 0 : value;
}

function readName(block: Buffer): string {
    const raw = block.subarray(0, 100);
    const end = raw.indexOf(0);
    return raw.subarray(0, end === -1 ? raw.length : end).toString("utf-8");
}

/**
 * Reads the cleartext manifest.
 *
 * The manifest is always the first member and its name always fits the ustar layout, so
 * its payload starts at exactly one block in. No walk needed.
 */
export async function readArchiveManifest(source: ArchiveByteSource): Promise<ArchiveManifest> {
    const limit = source.size !== undefined ? Math.min(MANIFEST_PROBE_SIZE, source.size) : MANIFEST_PROBE_SIZE;
    let head = await readAll(await source.read(0, limit - 1));

    if (head.length < TAR_BLOCK_SIZE) {
        throw new Error("Not a valid archive: file is shorter than one TAR block");
    }
    if (readName(head) !== MANIFEST_MEMBER) {
        throw new Error(`Not a v2 archive: first member is '${readName(head)}', expected '${MANIFEST_MEMBER}'`);
    }

    const size = readOctal(head, 124, 12);
    if (TAR_BLOCK_SIZE + size > head.length && (source.size === undefined || TAR_BLOCK_SIZE + size <= source.size)) {
        // Manifest larger than the probe - fetch exactly the missing remainder.
        const rest = await readAll(await source.read(head.length, TAR_BLOCK_SIZE + size - 1));
        head = Buffer.concat([head, rest]);
    }

    const payload = head.subarray(TAR_BLOCK_SIZE, TAR_BLOCK_SIZE + size);
    if (payload.length < size) {
        throw new Error("Archive manifest is truncated");
    }

    const manifest = JSON.parse(payload.toString("utf-8")) as ArchiveManifest;
    if (manifest.version !== 2) {
        throw new Error(`Unsupported archive format version: ${manifest.version}`);
    }
    return manifest;
}

/** Derives this archive's subkeys, or returns null when it is unencrypted. */
export function archiveKeysFor(manifest: ArchiveManifest, masterKey?: Buffer) {
    if (!manifest.encryption) return null;
    if (!masterKey) {
        throw new Error("Archive is encrypted but no master key was provided");
    }
    const noncePrefix = Buffer.from(manifest.encryption.noncePrefix, "hex");
    const keys = deriveArchiveKeys(masterKey, Buffer.from(manifest.encryption.kdfSalt, "hex"));
    return { ...keys, noncePrefix };
}

/** Parses index bytes, unsealing them first when the archive is encrypted. */
export async function parseArchiveIndex(
    indexBytes: Buffer,
    manifest: ArchiveManifest,
    masterKey?: Buffer
): Promise<ArchiveIndex> {
    const keys = archiveKeysFor(manifest, masterKey);
    return parseIndex(indexBytes, keys ? { indexKey: keys.indexKey, noncePrefix: keys.noncePrefix } : undefined);
}

/**
 * Locates and reads the embedded index member.
 *
 * This is the fallback for when the sidecar is missing. The index is the last member
 * before the end-of-archive trailer, so it is found by scanning backwards from the tail
 * for its header block rather than walking the whole archive from the front - which for a
 * multi-terabyte archive would mean reading every header just to reach the last one.
 */
export async function readEmbeddedIndexBytes(source: ArchiveByteSource): Promise<Buffer> {
    if (source.size === undefined) {
        throw new Error("Cannot locate the embedded index without knowing the archive size");
    }

    for (let window = INDEX_TAIL_PROBE_SIZE; window <= INDEX_TAIL_MAX_PROBE; window *= 4) {
        const start = Math.max(0, source.size - window);
        // Align to a block boundary so header offsets within the window stay meaningful.
        const alignedStart = start - (start % TAR_BLOCK_SIZE);
        const tail = await readAll(await source.read(alignedStart, source.size - 1));

        for (let offset = tail.length - TAR_BLOCK_SIZE; offset >= 0; offset -= TAR_BLOCK_SIZE) {
            const block = tail.subarray(offset, offset + TAR_BLOCK_SIZE);
            if (block.subarray(257, 262).toString("utf-8") !== "ustar") continue;
            if (readName(block) !== INDEX_MEMBER) continue;

            const size = readOctal(block, 124, 12);
            const payloadStart = offset + TAR_BLOCK_SIZE;
            if (payloadStart + size > tail.length) break; // Window too small, grow it.
            return tail.subarray(payloadStart, payloadStart + size);
        }

        if (alignedStart === 0) break;
    }

    throw new Error("Archive does not contain an index member");
}

/** Reads and parses the index, preferring sidecar bytes when the caller has them. */
export async function readArchiveIndex(
    source: ArchiveByteSource,
    manifest: ArchiveManifest,
    options?: { sidecarBytes?: Buffer; masterKey?: Buffer }
): Promise<ArchiveIndex> {
    const bytes = options?.sidecarBytes ?? (await readEmbeddedIndexBytes(source));
    return parseArchiveIndex(bytes, manifest, options?.masterKey);
}

/** Emits only [offset, offset + length) of the stream flowing through it. */
function sliceStream(offset: number, length: number): Transform {
    let seen = 0;
    let emitted = 0;

    return new Transform({
        transform(chunk: Buffer, _encoding, callback: TransformCallback) {
            if (emitted >= length) {
                seen += chunk.length;
                callback();
                return;
            }

            const chunkStart = seen;
            seen += chunk.length;

            const from = Math.max(0, offset - chunkStart);
            if (from >= chunk.length) {
                callback();
                return;
            }

            const take = Math.min(chunk.length - from, length - emitted);
            emitted += take;
            callback(null, chunk.subarray(from, from + take));
        },
    });
}

/**
 * Opens one physical entry as a plaintext, decompressed stream.
 *
 * Fetches exactly the entry's byte range, so the rest of the archive is never transferred.
 */
export async function openArchiveEntry(
    source: ArchiveByteSource,
    manifest: ArchiveManifest,
    entry: IndexEntryLine,
    masterKey?: Buffer
): Promise<NodeJS.ReadableStream> {
    const keys = archiveKeysFor(manifest, masterKey);
    let stream = await source.read(entry.off, entry.off + entry.size - 1);

    if (entry.sealed) {
        if (!keys) throw new Error(`Entry ${entry.n} is sealed but the archive reports no encryption`);
        stream = stream.pipe(openEntry(keys.dataKey, keys.noncePrefix, entry.n));
    }

    if (entry.comp) {
        const decompress = getDecompressionStream(entry.comp);
        if (!decompress) throw new Error(`Unsupported compression type: ${entry.comp}`);
        stream = stream.pipe(decompress);
    }

    return stream;
}

/**
 * Opens a single logical file as a plaintext stream.
 *
 * For a bundled file this fetches the whole bundle (a few MB at most) and slices it, which
 * is why bundling does not cost random access in practice.
 */
export async function openArchiveFile(
    source: ArchiveByteSource,
    manifest: ArchiveManifest,
    index: ArchiveIndex,
    file: IndexFileLine,
    masterKey?: Buffer
): Promise<NodeJS.ReadableStream> {
    const entry = index.entries.get(entryKey(file.a, file.n));
    if (!entry) {
        throw new Error(`Archive index is inconsistent: file '${file.p}' references missing entry ${file.n}`);
    }

    const stream = await openArchiveEntry(source, manifest, entry, masterKey);
    if (file.o === undefined || file.l === undefined) return stream;
    return stream.pipe(sliceStream(file.o, file.l));
}

/** Convenience wrapper returning a file's full contents. */
export async function readArchiveFile(
    source: ArchiveByteSource,
    manifest: ArchiveManifest,
    index: ArchiveIndex,
    file: IndexFileLine,
    masterKey?: Buffer
): Promise<Buffer> {
    return readAll(await openArchiveFile(source, manifest, index, file, masterKey));
}

/**
 * Groups files by the physical entry holding them, so each entry is fetched once.
 *
 * Keyed by entryKey(), so files carried over from earlier archives in a chain group
 * against the entry in *their* archive rather than colliding with a same-ordinal entry
 * in this one.
 */
export function groupFilesByEntry(files: IndexFileLine[]): Map<string, IndexFileLine[]> {
    const grouped = new Map<string, IndexFileLine[]>();
    for (const file of files) {
        const key = entryKey(file.a, file.n);
        const existing = grouped.get(key);
        if (existing) existing.push(file);
        else grouped.set(key, [file]);
    }
    // Bundled files are emitted in offset order so one pass over the entry serves them all.
    for (const group of grouped.values()) {
        group.sort((a, b) => (a.o ?? 0) - (b.o ?? 0));
    }
    return grouped;
}

