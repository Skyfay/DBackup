/**
 * Types for Multi-DB TAR Archive Format
 *
 * Multi-database backups are stored as TAR archives containing:
 * - manifest.json: Metadata about the archive and contained databases
 * - Individual dump files per database (format depends on adapter)
 */

/**
 * Database entry in a TAR manifest
 */
export interface DatabaseEntry {
    /** Original database name */
    name: string;
    /** Filename in the archive (e.g., "mydb.sql", "mydb.dump") */
    filename: string;
    /** Size in bytes (uncompressed) */
    size: number;
    /** Dump format: sql (MySQL), custom (PostgreSQL -Fc), archive (MongoDB), bak (MSSQL), fbk (Firebird gbak) */
    format: "sql" | "custom" | "archive" | "bak" | "fbk";
}

/**
 * Manifest stored as manifest.json in the TAR archive
 */
export interface TarManifest {
    /** Format version */
    version: 1;
    /** ISO 8601 timestamp when the archive was created */
    createdAt: string;
    /** Database type: mysql, mariadb, postgresql, mongodb, mssql */
    sourceType: string;
    /** Database engine version (e.g., "8.0.32", "15.2") */
    engineVersion?: string;
    /** List of databases in the archive */
    databases: DatabaseEntry[];
    /** Total size of all dumps in bytes (uncompressed) */
    totalSize: number;
}

/**
 * Result of extracting a TAR archive
 */
export interface ExtractResult {
    /** Parsed manifest from the archive */
    manifest: TarManifest;
    /** Absolute paths to extracted files */
    files: string[];
}

/**
 * Options for creating a TAR archive
 */
export interface CreateTarOptions {
    /** Database type (mysql, postgresql, etc.) */
    sourceType: string;
    /** Database engine version */
    engineVersion?: string;
    /**
     * External compression to apply per-entry (only consumed by createCombinedTar(), ignored by
     * createMultiDbTar() which is never touched by this option) - "NONE" or omitted disables it.
     * Database entries flagged with `nativeCompression` are skipped regardless of this setting.
     */
    compression?: "NONE" | "GZIP" | "BROTLI";
}

/**
 * File entry for creating a TAR archive
 */
export interface TarFileEntry {
    /** Filename to use in the archive */
    name: string;
    /** Local path to the file */
    path: string;
    /** Database name this file represents */
    dbName: string;
    /** Format of the dump file */
    format: DatabaseEntry["format"];
}

/**
 * Manifest v2 - combined DB + directory-source archives (JobSource feature).
 *
 * Additive to the v1 types above - createMultiDbTar/readTarManifest/extractSelectedDatabases
 * are untouched and remain the correct tools for pure-database archives. A v2 manifest is only
 * ever produced by createCombinedTar(), which is only invoked for jobs that actually have
 * directory sources - every DB-only job keeps producing v1 archives forever.
 */

/** Per-file index entry for a directory entry's searchable file list (Tier-A file browsing). */
export interface DirectoryFileIndexEntry {
    /** Path relative to the directory source root, POSIX separators */
    path: string;
    size: number;
    /** ISO 8601 */
    mtime: string;
    /** SHA-256 of the file's content, computed once after download. Optional/absent on archives written before this field existed. Groundwork for future incremental-backup change detection (more reliable than mtime/size alone) - not yet consumed by anything. */
    checksum?: string;
}

export interface DbEntryV2 {
    kind: "database";
    /** Original database name */
    name: string;
    /** Tar member name, always "databases/<name>.<ext>" - unaffected by `compressed`, the member's bytes are simply gzip/brotli-compressed in place when set. */
    filename: string;
    /** Size actually stored in the tar (i.e. the compressed size when `compressed` is set) */
    size: number;
    format: "sql" | "custom" | "archive" | "fbk";
    /** Set when this entry's bytes were compressed before being added to the tar (skipped for adapters with their own native dump compression, e.g. Postgres). Absent on archives written before per-entry compression support. */
    compressed?: "GZIP" | "BROTLI";
}

export interface DirectoryEntryV2 {
    kind: "directory";
    /** JobSource.id - stable identity across runs */
    jobSourceId: string;
    /** Display label, e.g. "SFTP Server 1: /var/www/uploads" */
    label: string;
    /** Tar member name prefix (no trailing slash) - always "sources/<jobSourceId>" */
    pathPrefix: string;
    fileCount: number;
    totalSize: number;
    excludePatterns: string[];
    /** Set when every file under this directory entry was compressed before being added to the tar (uniform per source, matching the job's compression setting). Absent on archives written before per-entry compression support. */
    compressed?: "GZIP" | "BROTLI";
}

export type ManifestEntryV2 = DbEntryV2 | DirectoryEntryV2;

export interface TarManifestV2 {
    version: 2;
    createdAt: string;
    /** DB adapterId when a DB source is present; "directory-only" sentinel otherwise */
    sourceType: string;
    engineVersion?: string;
    entries: ManifestEntryV2[];
    totalSize: number;
    /**
     * True for every archive written by the per-entry-compression-aware createCombinedTar().
     * Absent (undefined) on archives written before this feature existed - those were always
     * compressed as a whole by the upload step instead, and their entries are never individually
     * compressed, so `compressed` on any entry must be ignored for them. This flag is the sole
     * backward-compat switch: extraction only looks at entries' `compressed` fields when this is
     * true, and 03-upload.ts only skips its own whole-file compression pass for archives produced
     * after this flag started being set.
     */
    perEntryCompression?: boolean;
}

/** Input entry for createCombinedTar() - either a single already-produced DB dump file, or a directory root already downloaded to local disk. */
export type CombinedTarFileEntry =
    | {
        kind: "database";
        /** Original database name */
        dbName: string;
        /** Local path to the already-produced dump file */
        path: string;
        format: DbEntryV2["format"];
        /** True when the adapter already applied its own native compression to this dump (e.g. Postgres pg_dump -Z) - createCombinedTar() skips per-entry external compression for it to avoid double-compressing already-compressed bytes. */
        nativeCompression?: boolean;
    }
    | {
        kind: "directory";
        jobSourceId: string;
        label: string;
        /** Local directory root the files were downloaded into */
        localPath: string;
        excludePatterns: string[];
        /** Per-file index (e.g. from DirectoryDownloadResult.entries) - avoids re-walking the filesystem */
        files: DirectoryFileIndexEntry[];
    };

/**
 * Selects which entries extractCombinedArchive() should write to disk.
 *
 * Omitting the whole `selection` argument means "extract everything" (both kinds). Once a
 * selection object is provided, each field is exhaustive/explicit on its own: a field left
 * undefined means "none of this kind" (not "all") - an empty array means the same thing. This
 * avoids the ambiguity of a two-dimensional selection where "I only care about databases"
 * could otherwise be misread as "...and give me every directory too."
 */
export interface CombinedExtractSelection {
    databaseNames?: string[];
    directoryJobSourceIds?: string[];
}

export interface CombinedExtractResult {
    manifest: TarManifestV2;
    /** Extracted database dump files, one per extracted DB entry */
    databaseFiles: { entry: DbEntryV2; path: string }[];
    /** Extracted directory roots, one per extracted directory entry - files land under <root>/<relativePath> */
    directoryRoots: { entry: DirectoryEntryV2; path: string }[];
}
