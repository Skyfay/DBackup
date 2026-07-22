/**
 * On-disk constants for the seekable archive format (manifest version 2).
 *
 * Everything in this file is part of the format contract that
 * docs/developer-guide/reference/archive-format.md describes and that the Recovery Kit
 * reimplements. Changing a value here changes what existing archives mean, so treat it as
 * a breaking format change rather than a tunable.
 */

import { DumpFormat } from "./types";

/** Manifest member, always the first entry and always cleartext. Carries no user data. */
export const MANIFEST_MEMBER = "manifest.json";

/**
 * Sealed NDJSON index, always the last entry.
 *
 * It has to come last because it records the byte offset of every other entry, and those
 * are only known once they have been written. The index sidecar uploaded next to the
 * archive is a byte-identical copy, which is what lets browsing and file-level restore
 * skip the archive entirely - the embedded member is the disaster fallback for when the
 * sidecar is gone, and costs one sequential scan.
 */
export const INDEX_MEMBER = "index";

/** Member name prefix for opaque entries in encrypted archives. */
export const OPAQUE_MEMBER_PREFIX = "d/";

/** Member name prefix for database dumps in unencrypted archives. */
export const DATABASE_MEMBER_PREFIX = "databases/";

/** Member name prefix for directory-source files in unencrypted archives. */
export const SOURCE_MEMBER_PREFIX = "sources/";

/** Sentinel used as `sourceType` when a job has directory sources but no database source. */
export const DIRECTORY_ONLY_SOURCE_TYPE = "directory-only";

/** Filename suffix of the index sidecar uploaded alongside the archive. */
export const INDEX_SIDECAR_SUFFIX = ".index";

/**
 * Files at or below this size are packed into shared bundles instead of getting their own
 * entry. Without bundling every small file costs a 512-byte tar header, a compression
 * header that gains nothing because the dictionary restarts, and a 16-byte auth tag - on a
 * million 2 KB files that is hundreds of MB of pure overhead plus a ruined compression
 * ratio.
 */
export const BUNDLE_FILE_MAX_SIZE = 64 * 1024;

/**
 * Target payload size of one bundle. Random access survives bundling because restoring a
 * single small file only means fetching this much instead of a few KB, which is irrelevant
 * next to the round trip itself.
 */
export const BUNDLE_TARGET_SIZE = 4 * 1024 * 1024;

/**
 * Ordinal of the first data entry. Ordinal 0 is reserved for the index (see INDEX_ORDINAL
 * in crypto/entry-cipher.ts), so a data payload can never share a nonce with it.
 */
export const FIRST_DATA_ORDINAL = 1;

/** Tar block size. Payload offsets are always a multiple of this. */
export const TAR_BLOCK_SIZE = 512;

/** Tar member filename extension per dump format. */
export const EXTENSION_BY_FORMAT: Record<DumpFormat, string> = {
    sql: "sql",
    custom: "dump",
    archive: "archive",
    bak: "bak",
    fbk: "fbk",
};

/** Zero-padded opaque member name for an entry ordinal, e.g. 1 -> "d/000001". */
export function opaqueMemberName(ordinal: number): string {
    return `${OPAQUE_MEMBER_PREFIX}${String(ordinal).padStart(6, "0")}`;
}

/**
 * Byte offset of a tar member's payload, given the total bytes written once the member
 * (including its trailing padding) is complete.
 *
 * Deriving the offset by subtracting the padded payload length is deliberate: computing it
 * forwards from a header would require knowing the header size, which is not constant -
 * tar-stream emits an extra PAX header for names that do not fit the ustar layout. Working
 * backwards from the end is correct for plain, ustar-prefixed and PAX-prefixed members
 * alike, which the unit tests assert directly.
 */
export function payloadOffsetFromEnd(bytesWrittenAfterMember: number, storedSize: number): number {
    return bytesWrittenAfterMember - paddedSize(storedSize);
}

/** Payload size rounded up to the next tar block boundary. */
export function paddedSize(size: number): number {
    return Math.ceil(size / TAR_BLOCK_SIZE) * TAR_BLOCK_SIZE;
}
