/**
 * Bounds on what a reader inflates out of an archive.
 *
 * Everything in a backup comes from whoever writes the destination, the index with its flags and
 * sizes included, and every tenant restores in the one process they share. A few hundred bytes of
 * Brotli inflate to gigabytes, so a reader that trusted an entry to be as small as its flags say
 * could be made to fill the memory or the disk of the server with a tiny crafted archive. Each
 * limit below is derived from what the writer produces, with room to spare, so no backup DBackup
 * wrote ever meets one.
 */

import { Transform, TransformCallback } from "stream";
import { BUNDLE_FILE_MAX_SIZE, BUNDLE_TARGET_SIZE } from "./format";

/** An archive whose content contradicts itself or goes past what any writer produces. */
export class DamagedBackupError extends Error {
    constructor(detail: string) {
        super(`The backup is damaged: ${detail}`);
        this.name = "DamagedBackupError";
    }
}

/**
 * The most a bundle inflates to. The writer closes a bundle once it reaches the target size, so
 * the last small file it took can carry it past the target by at most one such file. The margin
 * of a whole megabyte covers that many times over.
 */
export const BUNDLE_READ_LIMIT = BUNDLE_TARGET_SIZE + BUNDLE_FILE_MAX_SIZE + 1024 * 1024;

/**
 * The most index bytes a reader takes as stored, gzipped and sealed. The same as the widest
 * window the reader scans for an embedded index. Half a million files make about 80 MB of NDJSON,
 * which gzips to a fraction of that.
 */
export const INDEX_MAX_STORED_BYTES = 256 * 1024 * 1024;

/** The most NDJSON an index inflates to, ten million files of about 200 bytes each. */
export const INDEX_MAX_INFLATED_BYTES = 2 * 1024 * 1024 * 1024;

/**
 * How many times its stored size the NDJSON of an index may inflate to, beside the cap above, so a
 * stored index of a few MB never inflates to gigabytes. Measured on indexes `createArchive` wrote,
 * gzip reaches 8 for distinct small files with checksums, 21 for 100,000 empty files sharing one
 * checksum, 35 for 200,000 links to one target, 54 for those links under a shared folder of 350
 * characters, 84 under one of 1,000 and 127 under one of 3,400, close to the longest path Linux
 * allows. The ratio grows with the part of a line the lines before it repeat, so 256 is twice what
 * the longest paths a source lists reach.
 */
export const INDEX_INFLATE_RATIO = 256;

/** What an index may always inflate to, however small it is stored. Small indexes compress worst. */
export const INDEX_INFLATE_FLOOR = 16 * 1024 * 1024;

/**
 * The most bytes of NDJSON an index of `storedBytes` inflates to: `INDEX_INFLATE_RATIO` times its
 * stored size, at least `INDEX_INFLATE_FLOOR` and never past `INDEX_MAX_INFLATED_BYTES`.
 */
export function indexInflateLimit(storedBytes: number): number {
    return Math.min(INDEX_MAX_INFLATED_BYTES, Math.max(INDEX_INFLATE_FLOOR, storedBytes * INDEX_INFLATE_RATIO));
}

/** The most lines an index holds, one per file, entry, database and source. */
export const INDEX_MAX_LINES = 10_000_000;

/**
 * The longest line of an index. A file line holds two paths at most, its own and the target of a
 * link, each far below this even with every character escaped. The longest lines are a `deps` line
 * of a long chain and a source with many exclude patterns.
 */
export const INDEX_MAX_LINE_BYTES = 1024 * 1024;

/**
 * The most items a list field of an index line holds, the exclude patterns of a source and the
 * archives of a `deps` line. Each item is a string of at least two quotes and a comma, so a line of
 * `INDEX_MAX_LINE_BYTES` already bounds a list to about 350,000 of them. Real patterns and archive
 * names are tens of characters long, which keeps a list that fits into one line far below this.
 */
export const INDEX_MAX_LIST_ITEMS = 100_000;

/**
 * How many times its compressed size a backup of the older whole-file format may inflate to. Gzip
 * cannot pass about 1032 to 1 by its format, so this bounds Brotli, which can reach millions.
 */
export const LEGACY_INFLATE_RATIO = 1100;

/** What a whole-file backup may always inflate to, however small it is compressed. */
export const LEGACY_INFLATE_FLOOR = 1024 * 1024 * 1024;

/**
 * The most bytes a backup of the older whole-file format inflates to. Its `.meta.json` records no
 * size, so the bound follows the compressed size: `LEGACY_INFLATE_RATIO` times it, at least
 * `LEGACY_INFLATE_FLOOR`. A dump of a real database stays far below either.
 */
export function legacyInflateLimit(compressedBytes: number): number {
    return Math.max(LEGACY_INFLATE_FLOOR, compressedBytes * LEGACY_INFLATE_RATIO);
}

/**
 * Passes at most `limit` bytes and fails the stream with a `DamagedBackupError` on the first byte
 * past it, so an entry that lies about its size stops inflating there instead of at its end.
 *
 * @param limit - The most bytes the stream may carry, a finite number of at least 0
 * @param what - Names the stream in the error, never a path of the backup a customer did not see
 * @throws DamagedBackupError for a limit that is none, like NaN or a negative, which no byte
 *   count would ever pass and so would bound nothing
 */
export function byteLimit(limit: number, what: string): Transform {
    if (typeof limit !== "number" || !Number.isFinite(limit) || limit < 0) {
        throw new DamagedBackupError(`${what} has no valid size to read it by`);
    }
    let seen = 0;
    return new Transform({
        transform(chunk: Buffer, _encoding, callback: TransformCallback) {
            seen += chunk.length;
            if (seen > limit) {
                callback(new DamagedBackupError(`${what} holds more than the ${limit} bytes it may`));
                return;
            }
            callback(null, chunk);
        },
    });
}

/**
 * Checks the NDJSON of an index on its way to the line reader: its whole size against
 * `indexInflateLimit` of the stored size, its line count and the length of each line. The line
 * reader keeps a line in memory until its end, so a single line of gigabytes would fill the memory
 * before any parse could refuse it.
 *
 * @param storedBytes - The size of the index as stored, gzipped and sealed
 */
export function indexTextLimit(storedBytes: number): Transform {
    const limit = indexInflateLimit(storedBytes);
    let total = 0;
    let lines = 0;
    let lineLength = 0;
    return new Transform({
        transform(chunk: Buffer, _encoding, callback: TransformCallback) {
            total += chunk.length;
            if (total > limit) {
                callback(new DamagedBackupError(`its index inflates past ${limit} bytes`));
                return;
            }
            let from = 0;
            for (let at = chunk.indexOf(0x0a); at !== -1; at = chunk.indexOf(0x0a, from)) {
                if (lineLength + (at - from) > INDEX_MAX_LINE_BYTES) break;
                lines++;
                lineLength = 0;
                from = at + 1;
            }
            lineLength += chunk.length - from;
            if (lineLength > INDEX_MAX_LINE_BYTES) {
                callback(new DamagedBackupError(`its index holds a line longer than ${INDEX_MAX_LINE_BYTES} bytes`));
                return;
            }
            if (lines > INDEX_MAX_LINES) {
                callback(new DamagedBackupError(`its index holds more than ${INDEX_MAX_LINES} lines`));
                return;
            }
            callback(null, chunk);
        },
    });
}

/** Refuses index bytes past what any writer stores, before anything inflates them. */
export function assertIndexStoredSize(bytes: number): void {
    if (bytes > INDEX_MAX_STORED_BYTES) {
        throw new DamagedBackupError(`its index is ${bytes} bytes, more than the ${INDEX_MAX_STORED_BYTES} any backup stores`);
    }
}
