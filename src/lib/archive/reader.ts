/**
 * Reader for the seekable archive format (manifest version 2).
 *
 * Everything here works from byte ranges, so the same code path serves a local temp file
 * and a remote object fetched over HTTP range requests. Reading one file out of a
 * multi-gigabyte archive costs one manifest read, one index read, and one range read of
 * the entry that holds it.
 */

import { PassThrough, Transform, TransformCallback, pipeline } from "stream";
import { getDecompressionStream } from "@/lib/crypto/compression";
import { deriveArchiveKeys } from "@/lib/crypto/kdf";
import { openEntry } from "@/lib/crypto/entry-cipher";
import { INDEX_MEMBER, MANIFEST_MEMBER, TAR_BLOCK_SIZE } from "./format";
import { parseIndex } from "./index-file";
import { readAll } from "./sources";
import { BUNDLE_READ_LIMIT, byteLimit, DamagedBackupError } from "./limits";
import { ArchiveByteSource, ArchiveIndex, ArchiveManifest, entryKey, IndexEntryLine, IndexFileLine, isSymlinkLine } from "./types";

/**
 * Bytes read when looking for the manifest. A real manifest is under 2 KB; the probe is
 * deliberately small because it is paid on every remote open, and readArchiveManifest()
 * fetches the exact remainder in the (theoretical) case a manifest outgrows it.
 */
const MANIFEST_PROBE_SIZE = 16 * 1024;

/**
 * The largest manifest a reader takes. The writer stores a few hundred bytes of fixed fields, so
 * a manifest past this is damaged, and its size never decides how much is fetched into memory.
 */
const MANIFEST_MAX_SIZE = 1024 * 1024;

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
    let head = await readAll(await source.read(0, limit - 1), limit);

    if (head.length < TAR_BLOCK_SIZE) {
        throw new Error("Not a valid archive: file is shorter than one TAR block");
    }
    if (readName(head) !== MANIFEST_MEMBER) {
        throw new Error(`Not a v2 archive: first member is '${readName(head)}', expected '${MANIFEST_MEMBER}'`);
    }

    const size = readOctal(head, 124, 12);
    if (size > MANIFEST_MAX_SIZE) {
        throw new DamagedBackupError(`its manifest is ${size} bytes, more than the ${MANIFEST_MAX_SIZE} any backup writes`);
    }
    if (TAR_BLOCK_SIZE + size > head.length && (source.size === undefined || TAR_BLOCK_SIZE + size <= source.size)) {
        // Manifest larger than the probe - fetch exactly the missing remainder.
        const missing = TAR_BLOCK_SIZE + size - head.length;
        const rest = await readAll(await source.read(head.length, TAR_BLOCK_SIZE + size - 1), missing);
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
        const tail = await readAll(await source.read(alignedStart, source.size - 1), source.size - alignedStart);

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
function sliceStream(offset: number, length: number, name: string): Transform {
    let seen = 0;
    let emitted = 0;

    return new Transform({
        // A slice past the end of the payload is a damaged index, never a shorter file.
        flush(callback: TransformCallback) {
            callback(emitted < length ? new DamagedBackupError(`'${name}' reaches past the end of its bundle`) : null);
        },
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
 * Runs a source through a chain of transforms and returns a single readable.
 *
 * Built with `stream.pipeline` rather than chained `.pipe()`: `.pipe()` does not forward
 * error events, so an error on an intermediate stage - an AEAD tag that fails, gunzip
 * choking on corrupt bytes - would have no listener and take the whole process down with an
 * uncaught exception. `pipeline` destroys the returned stream with that error instead, so a
 * caller's single error handler on the returned stream catches a failure from any stage,
 * and a corrupt archive fails the restore rather than the server.
 */
function chainStreams(source: NodeJS.ReadableStream, stages: NodeJS.ReadWriteStream[]): NodeJS.ReadableStream {
    if (stages.length === 0) return source;

    const out = new PassThrough();
    // pipeline destroys `out` with the error, which surfaces on the returned stream. The
    // array form is used because a spread of a typed array is not accepted by the variadic
    // overloads.
    pipeline([source, ...stages, out], () => { /* handled by the caller via `out` */ });
    return out;
}

/**
 * Opens one physical entry as a plaintext, decompressed stream.
 *
 * Fetches exactly the entry's byte range, so the rest of the archive is never transferred.
 *
 * The stream fails with a `DamagedBackupError` at the first byte past what the entry may hold: a
 * bundle `BUNDLE_READ_LIMIT`, any other entry the `declaredSize` of the one dump or file it holds,
 * the `s` of its index line. The index comes from the destination, so a few bytes flagged as
 * anything could otherwise inflate until the memory or the disk of the server is full.
 *
 * @param declaredSize - The `s` of the dump or file a standalone entry holds, ignored for a bundle.
 *   Required for any other entry, which is refused as damaged without a whole number of at least 0
 */
export async function openArchiveEntry(
    source: ArchiveByteSource,
    manifest: ArchiveManifest,
    entry: IndexEntryLine,
    masterKey?: Buffer,
    declaredSize?: number
): Promise<NodeJS.ReadableStream> {
    // A standalone entry inflates only as far as the dump or file it holds declares. Without a
    // valid declaration there is no bound, so the entry is not read at all.
    if (!entry.bundle && !(typeof declaredSize === "number" && Number.isSafeInteger(declaredSize) && declaredSize >= 0)) {
        throw new DamagedBackupError(`entry ${entry.n} has no valid declared size to read it by`);
    }
    if (![entry.off, entry.size].every((value) => typeof value === "number" && Number.isSafeInteger(value) && value >= 0)) {
        throw new DamagedBackupError(`entry ${entry.n} has no valid place in the archive`);
    }

    const keys = archiveKeysFor(manifest, masterKey);
    const raw = await source.read(entry.off, entry.off + entry.size - 1);

    const stages: NodeJS.ReadWriteStream[] = [];

    if (entry.sealed) {
        if (!keys) throw new Error(`Entry ${entry.n} is sealed but the archive reports no encryption`);
        stages.push(openEntry(keys.dataKey, keys.noncePrefix, entry.n));
    }

    if (entry.comp) {
        const decompress = getDecompressionStream(entry.comp);
        if (!decompress) throw new Error(`Unsupported compression type: ${entry.comp}`);
        stages.push(decompress);
    }

    stages.push(byteLimit(entry.bundle ? BUNDLE_READ_LIMIT : declaredSize!, `entry ${entry.n}`));

    return chainStreams(raw, stages);
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
    // A symbolic link is the one index line with nothing to open: its content is the target
    // string in the index itself. Callers branch on it before they get here, so reaching this
    // point means a caller forgot - which has to say so rather than fail later as a confusing
    // "missing entry undefined".
    if (isSymlinkLine(file)) {
        throw new Error(`'${file.p}' is a symbolic link and has no content to read - handle it via its 'lnk' target`);
    }

    const entry = file.n === undefined ? undefined : index.entries.get(entryKey(file.a, file.n));
    if (!entry) {
        throw new Error(`Archive index is inconsistent: file '${file.p}' references missing entry ${file.n}`);
    }

    // Checked before the entry is fetched, the end of the payload by the slice itself.
    const slice = entry.bundle || file.o !== undefined || file.l !== undefined ? bundleSliceOf(file) : undefined;
    const stream = await openArchiveEntry(source, manifest, entry, masterKey, file.s);
    if (!slice) return stream;
    // Same reasoning as chainStreams: a `.pipe()` here would strand an error from the
    // entry stream, so the slice is attached with pipeline instead.
    return chainStreams(stream, [sliceStream(slice.start, slice.end - slice.start, file.p)]);
}

/**
 * Where a bundled file lies in the payload of its bundle. Every bundled file has an offset and a
 * length, so a line without them, or reaching past `payloadLength` when that is known, is a damaged
 * index rather than a file to restore with the bytes of its neighbours or of the whole bundle. The
 * length may exceed the size the line names: earlier versions wrote the size from collecting the
 * file and the length from packing it, so a file that grew in between has the longer length.
 *
 * @throws DamagedBackupError for such a line
 */
export function bundleSliceOf(file: IndexFileLine, payloadLength?: number): { start: number; end: number } {
    const { o, l } = file;
    if (![o, l].every((value) => typeof value === "number" && Number.isSafeInteger(value) && value >= 0)) {
        throw new DamagedBackupError(`'${file.p}' has no valid place in its bundle`);
    }
    const end = o! + l!;
    if (end > (payloadLength ?? BUNDLE_READ_LIMIT)) {
        throw new DamagedBackupError(`'${file.p}' reaches past the end of its bundle`);
    }
    return { start: o!, end };
}

/** The bytes of a bundled file out of the payload of its bundle, see `bundleSliceOf`. */
export function bundleSlice(payload: Buffer, file: IndexFileLine): Buffer {
    const { start, end } = bundleSliceOf(file, payload.length);
    return payload.subarray(start, end);
}

/**
 * The bytes of every file of one bundle, see `bundleSlice`. Every writer lays the files of a bundle
 * one after the other, so files that share bytes are a damaged index: an index of thousands of lines
 * that all point at the whole payload would write the bundle thousands of times over.
 *
 * @throws DamagedBackupError for overlapping files, or one `bundleSliceOf` refuses
 */
export function bundleSlices(payload: Buffer, files: readonly IndexFileLine[]): Buffer[] {
    const places = files.map((file) => ({ file, ...bundleSliceOf(file, payload.length) }));
    const ordered = [...places].sort((a, b) => a.start - b.start || a.end - b.end);
    for (let i = 1; i < ordered.length; i++) {
        if (ordered[i].start < ordered[i - 1].end) {
            throw new DamagedBackupError(`'${ordered[i].file.p}' shares bytes of its bundle with '${ordered[i - 1].file.p}'`);
        }
    }
    return places.map(({ start, end }) => payload.subarray(start, end));
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
/**
 * Refuses an index where several file lines point at one entry that is no bundle. Such an entry
 * holds the bytes of one file, so every other line would restore nothing, or the bytes of another
 * file under its own name. The writer never produces it, so it is a damaged index, refused before
 * anything of the selection is read or written.
 */
export function assertSingleReferences(entries: ReadonlyMap<string, IndexEntryLine>, files: readonly IndexFileLine[]): void {
    const counts = new Map<string, number>();
    for (const file of files) {
        if (file.n === undefined) continue;
        const key = entryKey(file.a, file.n);
        counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    for (const [key, count] of counts) {
        if (count > 1 && entries.get(key)?.bundle !== true) {
            throw new DamagedBackupError(`its index points ${count} files at entry ${key}, which holds one file`);
        }
    }
}

export function groupFilesByEntry(files: IndexFileLine[]): Map<string, IndexFileLine[]> {
    const grouped = new Map<string, IndexFileLine[]>();
    for (const file of files) {
        // Symbolic links point at no entry, so they have nothing to group against. Dropped
        // here rather than trusted to every caller, since a single one that forgets would ask
        // for entry `undefined` and fail the whole restore.
        if (file.n === undefined) continue;
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

