/**
 * Types for the seekable archive format (manifest version 2).
 *
 * Two structures matter and they are deliberately separate:
 *
 * - The **manifest** is cleartext, always. It therefore must never contain user data - no
 *   file paths, no database names, no checksums of plaintext. It holds only what a reader
 *   needs before it can decrypt anything: format version, crypto parameters, and counts.
 * - The **index** holds everything else and is sealed whenever the archive is encrypted.
 *   Putting paths or plaintext checksums in the manifest instead would publish the table
 *   of contents next to the encrypted data, which is exactly what this split prevents.
 *   A SHA-256 over plaintext is a confirmation oracle against known files, so it belongs
 *   in the sealed index too.
 */

export type CompressionKind = "GZIP" | "BROTLI";

export type DumpFormat = "sql" | "custom" | "archive" | "bak" | "fbk";

// ── Manifest (cleartext, no user data) ────────────────────────────────────

export interface ArchiveEncryptionInfo {
    algorithm: "aes-256-gcm";
    /** Hex-encoded 32-byte per-archive HKDF salt. Cleartext by design - it is not a secret. */
    kdfSalt: string;
    /** Hex-encoded 4-byte nonce prefix. Nonces are `prefix ‖ uint64BE(ordinal)`. */
    noncePrefix: string;
    /** EncryptionProfile id, so a restore knows which master key to ask for. */
    profileId: string;
}

export interface ArchiveManifest {
    version: 2;
    createdAt: string;
    /** Database adapterId, or DIRECTORY_ONLY_SOURCE_TYPE. Structural, not user data. */
    sourceType: string;
    engineVersion?: string;
    /** Compression applied to entries. Per-entry `comp` in the index stays authoritative. */
    compression: "NONE" | CompressionKind;
    /** Absent on unencrypted archives. */
    encryption?: ArchiveEncryptionInfo;
    /**
     * True when small files were packed into shared bundles. Only ever set on encrypted
     * archives: bundling would otherwise break the promise that an unencrypted archive can
     * be unpacked with plain `tar -xf`, since a bundle has no single real path.
     */
    bundled?: boolean;
    counts: {
        databases: number;
        directorySources: number;
        /** Logical file count across all directory sources. */
        files: number;
        /** Physical entry count, lower than `files` when bundling is active. */
        entries: number;
    };
    /** Logical uncompressed total across databases and directory files. */
    totalSize: number;
    /** Member name of the sealed index. Always INDEX_MEMBER. */
    indexMember: string;
}

// ── Index (NDJSON, gzipped, sealed when the archive is encrypted) ──────────

/** First line. Ties the index to the archive it describes. */
export interface IndexHeaderLine {
    k: "h";
    v: 2;
    createdAt: string;
    /** Basename of the archive this index belongs to. */
    archive: string;
}

/**
 * A physical entry: one tar member holding payload bytes.
 *
 * Separating physical entries from logical files is what makes bundling possible - many
 * `f` lines can point at one `e` line via `n`.
 */
export interface IndexEntryLine {
    k: "e";
    /** Entry ordinal, also the nonce counter. Unique within the archive, starts at 1. */
    n: number;
    /** Tar member name. */
    member: string;
    /** Byte offset of the member's payload within the archive. */
    off: number;
    /** Bytes stored in the tar, i.e. after compression and sealing. */
    size: number;
    /** Payload size after unsealing but before decompression. Absent when unencrypted. */
    sealed?: true;
    /** Compression applied to the payload. Absent means stored as-is. */
    comp?: CompressionKind;
    /** Set when this entry is a bundle holding several small files. */
    bundle?: true;
}

/** A database dump. Maps 1:1 onto a physical entry. */
export interface IndexDatabaseLine {
    k: "db";
    name: string;
    format: DumpFormat;
    /** Ordinal of the physical entry holding this dump. */
    n: number;
    /** Uncompressed dump size. */
    s: number;
}

/** A directory source. Describes the grouping, not the files themselves. */
export interface IndexDirectoryLine {
    k: "d";
    /** JobSource.id - stable identity across runs. */
    src: string;
    label: string;
    fileCount: number;
    totalSize: number;
    excludePatterns: string[];
}

/** A logical file inside a directory source. */
export interface IndexFileLine {
    k: "f";
    /** JobSource.id this file belongs to. */
    src: string;
    /** Path relative to the directory source root, POSIX separators. */
    p: string;
    /** Uncompressed size. */
    s: number;
    /** ISO 8601 mtime. */
    m: string;
    /** SHA-256 of the plaintext content. Safe to store here because the index is sealed. */
    h?: string;
    /** Ordinal of the physical entry holding this file's bytes. */
    n: number;
    /** Byte offset within the decompressed entry. Only set for bundled entries. */
    o?: number;
    /** Byte length within the decompressed entry. Only set for bundled entries. */
    l?: number;
}

export type IndexLine =
    | IndexHeaderLine
    | IndexEntryLine
    | IndexDatabaseLine
    | IndexDirectoryLine
    | IndexFileLine;

/** Parsed index, grouped for lookup. */
export interface ArchiveIndex {
    header: IndexHeaderLine;
    /** Keyed by ordinal. */
    entries: Map<number, IndexEntryLine>;
    databases: IndexDatabaseLine[];
    directories: IndexDirectoryLine[];
    files: IndexFileLine[];
}

// ── Writer input ──────────────────────────────────────────────────────────

/** One file to include from a directory source, already downloaded to local disk. */
export interface SourceFileEntry {
    /** Path relative to the directory source root, POSIX separators. */
    path: string;
    size: number;
    /** ISO 8601 */
    mtime: string;
    /** SHA-256 of the plaintext content. */
    checksum?: string;
}

export type ArchiveSourceEntry =
    | {
        kind: "database";
        dbName: string;
        /** Local path to the already-produced dump file. */
        path: string;
        format: DumpFormat;
        /**
         * True when the adapter already compressed the dump itself (e.g. pg_dump -Z).
         * Compression is skipped for it, since recompressing compressed bytes costs CPU
         * for nothing.
         */
        nativeCompression?: boolean;
    }
    | {
        kind: "directory";
        jobSourceId: string;
        label: string;
        /** Local directory the files were downloaded into. */
        localPath: string;
        excludePatterns: string[];
        files: SourceFileEntry[];
    };

export interface CreateArchiveOptions {
    sourceType: string;
    engineVersion?: string;
    compression?: "NONE" | CompressionKind;
    /** Omit for an unencrypted archive. */
    encryption?: {
        masterKey: Buffer;
        profileId: string;
    };
}

export interface CreateArchiveResult {
    manifest: ArchiveManifest;
    index: ArchiveIndex;
    /**
     * Serialized index, byte-identical to the archive's index member. Callers write this
     * next to the archive as the sidecar.
     */
    indexBytes: Buffer;
}

// ── Reader ────────────────────────────────────────────────────────────────

/**
 * Random-access byte source over an archive.
 *
 * Abstracted so the reader never knows whether it is talking to a local temp file or to a
 * storage adapter serving HTTP range requests, and so adapters without range support can
 * fall back to a sequential scan without the reader caring.
 */
export interface ArchiveByteSource {
    /**
     * Reads [start, end] inclusive. An empty range (end < start) is legal and yields no
     * bytes, which is what a zero-length file's entry looks like.
     */
    read(start: number, end: number): Promise<NodeJS.ReadableStream>;
    /** Total archive size, when known. */
    size?: number;
}

/** Selects what to pull out of an archive. */
export interface ArchiveSelection {
    databaseNames?: string[];
    directoryJobSourceIds?: string[];
    /** Exact file paths, keyed by JobSource id. Used by file-level restore. */
    files?: { src: string; paths: string[] }[];
}
