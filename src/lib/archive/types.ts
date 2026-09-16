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

/**
 * On-disk format of a database dump entry. Part of the format contract: a value written here
 * is read back by every DBackup version and by the Recovery Kit, so values are only ever added.
 */
export type DumpFormat = "sql" | "custom" | "archive" | "bak" | "fbk" | "bacpac" | "rdb" | "sqlite";

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

/**
 * Position of this archive within an incremental chain.
 *
 * Absent on a standalone full backup, which is what a FULL-mode job always produces.
 */
export interface ChainInfo {
    /** Shared by the full and every incremental built on it. */
    id: string;
    type: "full" | "incremental";
    /**
     * Filename of the predecessor archive, absent on the full.
     *
     * Deliberately a filename and not an Execution id: an id means nothing outside
     * DBackup's database, which would make the chain unresolvable without DBackup and
     * break the whole recoverability promise.
     */
    base?: string;
    /** Position in the chain. The full is 0. */
    index: number;
}

export interface ArchiveManifest {
    version: 2;
    createdAt: string;
    /** Absent on standalone full backups. */
    chain?: ChainInfo;
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
        /** Logical file count across all directory sources. Includes symbolic links. */
        files: number;
        /** Physical entry count, lower than `files` when bundling is active. */
        entries: number;
        /**
         * Symbolic links among `files`. Absent on archives written before links were stored.
         *
         * A count, not a listing - the manifest is cleartext, so it may carry the shape of the
         * archive but never its contents. It exists so a reader that cannot restore links can
         * still say how many it is dropping instead of silently omitting them.
         */
        symlinks?: number;
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
    /**
     * Entry ordinal, also the nonce counter. Unique **within its own archive**, starts at 1.
     *
     * Not unique across a chain's index, because a carried-over entry keeps the ordinal it
     * had in its own archive - it has to, since that ordinal is what derives its nonce.
     * Use entryKey() to address entries.
     */
    n: number;
    /**
     * Archive holding this entry. Absent means the archive this index belongs to.
     *
     * Set on entries carried forward from an earlier archive in the same chain, so a
     * single index fully describes a snapshot without opening the predecessors' indexes.
     */
    a?: string;
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
    /**
     * SHA-256 of the dump as the adapter produced it. Absent on archives written before dumps
     * carried one. Safe here for the same reason a file checksum is: the index is sealed.
     */
    h?: string;
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
    /** Uncompressed size. Always 0 for a symbolic link. */
    s: number;
    /** ISO 8601 mtime. */
    m: string;
    /** SHA-256 of the plaintext content. Safe to store here because the index is sealed. */
    h?: string;
    /**
     * Symbolic link target, raw and unresolved. Its presence is what marks this line as a
     * link rather than a file, and a link has no bytes - so `s` is 0 and `n` is absent.
     *
     * A target is a path and therefore user data, which is why it lives here in the sealed
     * index rather than in a tar header. Unencrypted archives additionally carry a real tar
     * symlink member, where publishing the target costs nothing that the member names have
     * not already given away.
     */
    lnk?: string;
    /**
     * Ordinal of the physical entry holding this file's bytes, within archive `a`.
     *
     * Absent exactly when `lnk` is set. Every reader has to handle that: resolving an entry
     * for a line that has none is what would turn a symlink into a crash mid-restore.
     */
    n?: number;
    /**
     * Archive holding this file's bytes. Absent means the archive this index belongs to.
     *
     * This is what makes a snapshot's index a complete picture: an unchanged file simply
     * keeps pointing at whichever earlier archive already holds it, so a restore never
     * has to replay the chain.
     */
    a?: string;
    /** Byte offset within the decompressed entry. Only set for bundled entries. */
    o?: number;
    /** Byte length within the decompressed entry. Only set for bundled entries. */
    l?: number;
    /**
     * POSIX permission bits, owner and group, when the source could report them.
     *
     * Absent for every archive written before these existed and for every source whose
     * protocol has no notion of them, which is most of them - S3 and Dropbox have no owner
     * to record. A restore that finds them missing writes the file the way it always did.
     *
     * They live in the sealed index rather than in a tar header for the same reason a
     * symlink target does: an unencrypted archive publishes its tar headers, and a uid map
     * describes the machine a backup came from.
     */
    mo?: number;
    u?: number;
    g?: number;
}

/**
 * Archives this snapshot needs besides its own.
 *
 * Lets a reader check chain completeness up front and name the missing archive, instead
 * of failing partway through a restore.
 */
export interface IndexDepsLine {
    k: "deps";
    archives: string[];
}

export type IndexLine =
    | IndexHeaderLine
    | IndexDepsLine
    | IndexEntryLine
    | IndexDatabaseLine
    | IndexDirectoryLine
    | IndexFileLine;

/**
 * Addresses an entry across a chain.
 *
 * Ordinals are only unique within one archive, so the archive name has to be part of the
 * key. An absent archive means "this index's own archive".
 */
export function entryKey(archive: string | undefined, ordinal: number): string {
    return `${archive ?? ""}#${ordinal}`;
}

/**
 * Whether an index line describes a symbolic link rather than a file with bytes.
 *
 * The single place that decides what "is a symlink" means, so the rule cannot drift between
 * the writer, the readers and the restore paths. Every caller that is about to resolve a
 * physical entry has to ask this first - a link has none.
 */
export function isSymlinkLine(file: IndexFileLine): file is IndexFileLine & { lnk: string } {
    return file.lnk !== undefined;
}

/** POSIX metadata of a source or index entry, in the shape both sides of the chain use. */
export interface FileMetadata {
    mode?: number;
    uid?: number;
    gid?: number;
}

/**
 * The three metadata fields as index keys, omitting whichever the source did not report.
 *
 * Written this way rather than as three assignments so an unset field stays absent from the
 * JSON instead of appearing as `null`. The index is one line per file in an archive that can
 * hold a million of them, and `"mo":null` on every line is pure weight.
 */
export function metadataToIndex(meta: FileMetadata): Pick<IndexFileLine, "mo" | "u" | "g"> {
    return {
        ...(meta.mode !== undefined ? { mo: meta.mode } : {}),
        ...(meta.uid !== undefined ? { u: meta.uid } : {}),
        ...(meta.gid !== undefined ? { g: meta.gid } : {}),
    };
}

/**
 * The same three fields read back off an index line, for handing to an upload.
 *
 * Undefined rather than an empty object when the line carries none, so a restore from an
 * archive without metadata - which is every archive written so far - calls `upload()` with
 * exactly the arguments it always did.
 */
export function metadataFromIndex(file: IndexFileLine): FileMetadata | undefined {
    if (file.mo === undefined && file.u === undefined && file.g === undefined) return undefined;
    return {
        ...(file.mo !== undefined ? { mode: file.mo } : {}),
        ...(file.u !== undefined ? { uid: file.u } : {}),
        ...(file.g !== undefined ? { gid: file.g } : {}),
    };
}

/**
 * Splits index lines into the ones carrying bytes and the symbolic links among them.
 *
 * The returned links have `lnk` narrowed to a string, so a caller cannot forget that a link
 * always has a target and end up writing `undefined` into a restored tree.
 */
export function partitionSymlinks<T extends { file: IndexFileLine }>(
    items: readonly T[]
): { payloads: T[]; symlinks: (Omit<T, "file"> & { file: IndexFileLine & { lnk: string } })[] } {
    const payloads: T[] = [];
    const symlinks: (Omit<T, "file"> & { file: IndexFileLine & { lnk: string } })[] = [];
    for (const item of items) {
        if (isSymlinkLine(item.file)) symlinks.push({ ...item, file: item.file });
        else payloads.push(item);
    }
    return { payloads, symlinks };
}

/** Parsed index, grouped for lookup. */
export interface ArchiveIndex {
    header: IndexHeaderLine;
    /** Keyed by entryKey(entry.a, entry.n). */
    entries: Map<string, IndexEntryLine>;
    databases: IndexDatabaseLine[];
    directories: IndexDirectoryLine[];
    files: IndexFileLine[];
    /** Other archives this snapshot references. Empty for a standalone full. */
    deps: string[];
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
    /**
     * Raw symbolic link target. Set means nothing was collected to disk under `path`, so the
     * writer stores the target instead of reading bytes that are not there.
     */
    linkTarget?: string;
    /** POSIX metadata at the source, when the adapter could see it. See IndexFileLine. */
    mode?: number;
    uid?: number;
    gid?: number;
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

/** Index content carried forward from earlier archives in the same chain. */
export interface CarriedIndexContent {
    /** File lines whose bytes live in an earlier archive. Every line has `a` set. */
    files: IndexFileLine[];
    /** The entry lines those files point at. Every line has `a` set. */
    entries: IndexEntryLine[];
}

export interface CreateArchiveOptions {
    sourceType: string;
    engineVersion?: string;
    compression?: "NONE" | CompressionKind;
    /** Omit for an unencrypted archive. */
    encryption?: {
        masterKey: Buffer;
        profileId: string;
    };
    /** Omit for a standalone full backup. */
    chain?: ChainInfo & { carried?: CarriedIndexContent };
    /**
     * How many entries may be compressed ahead of the writer.
     *
     * The tar itself is always written one entry after another - the byte offsets that make
     * the archive seekable come from that order - but compressing an entry is independent
     * work, so it can run ahead. Defaults to 1, which is the original strictly serial
     * behaviour. At N, up to N compressed temp files exist at once.
     */
    concurrency?: number;
    /** Reports entries written so far, for the runner's live progress display. */
    onProgress?: (done: number, total: number, label: string) => void;
    /**
     * Aborts packing between entries.
     *
     * Packing runs after everything has been collected and can take minutes on a large
     * source, so it is the last place a cancelled run would otherwise sit and wait.
     */
    signal?: AbortSignal;
    /**
     * Called once a database dump has been written into the archive and its local file is no
     * longer read. Lets the caller delete each dump as it goes, so a multi-database job does
     * not hold every raw dump and the finished archive on disk at the same time.
     */
    onDatabaseDumpWritten?: (localPath: string) => Promise<void>;
}

export interface CreateArchiveResult {
    manifest: ArchiveManifest;
    index: ArchiveIndex;
    /**
     * Serialized index, byte-identical to the archive's index member. Callers write this
     * next to the archive as the sidecar.
     */
    indexBytes: Buffer;
    /**
     * Directory files stored as-is because their format is already compressed. Reporting
     * only - nothing in the archive depends on it, and it stays at zero when the job has no
     * compression configured, since then nothing was skipped.
     */
    skippedCompression: { files: number; bytes: number };
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
