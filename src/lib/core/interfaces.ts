import { z } from "zod";
import { LogLevel, LogType } from "./logs";
import type { AdapterCredentialRequirements } from "./credentials";

/**
 * Base configuration type for adapters.
 * Individual adapters use more specific types from @/lib/adapters/definitions.
 * The interfaces use 'any' for compatibility with TypeScript's contravariant
 * function parameters, but implementations use their specific config types.
 */
export type AdapterConfig = any;

export interface AdapterConfigSchema {
    name: string;
    label: string;
    description?: string;
    input: z.ZodObject<z.ZodRawShape>;
}

export interface BackupMetadata {
    version: 1;
    jobId: string;
    jobName: string;
    sourceName: string;
    sourceType: string;
    engineVersion?: string;
    engineEdition?: string; // e.g., "Express", "Standard", "Enterprise", "Azure SQL Edge"
    databases: string[] | { count: number; names?: string[] };
    timestamp: string;
    originalFileName: string;
    sourceId: string;
    locked?: boolean;
    compression?: 'GZIP' | 'BROTLI';
    encryption?: {
        enabled: boolean;
        profileId: string;
        algorithm: 'aes-256-gcm';
        iv: string;
        authTag: string;
    };
    /** Multi-DB TAR archive metadata */
    multiDb?: {
        format: 'tar';
        /** Database names contained in the archive */
        databases: string[];
    };
    /** Present only for combined (manifest v2) archives - job had directory sources in addition to (or instead of) a database source. */
    combined?: {
        databases: number;
        directorySources: number;
    };
    /**
     * Present only for seekable (manifest v2) archives. Lets the browse and file-level
     * restore paths find and open the index sidecar without touching the archive itself,
     * which is the whole point of the sidecar - a directory listing must not cost a
     * multi-gigabyte download.
     *
     * Note that a v2 archive is never compressed or encrypted as a whole, so the top-level
     * `compression` and `encryption` fields above stay unset for it even when the job has
     * both enabled. Both are applied per entry inside the archive instead.
     */
    archive?: {
        formatVersion: 2;
        /** Filename suffix of the index sidecar, appended to the backup file's remote path. */
        indexFile: string;
        encrypted: boolean;
        /** EncryptionProfile id, when encrypted. */
        profileId?: string;
        /**
         * Hex-encoded KDF salt and nonce prefix, copied from the archive's own manifest.
         * Neither is a secret - they exist so the index sidecar can be opened without
         * reading the archive at all, which is what keeps a directory listing cheap.
         */
        kdfSalt?: string;
        noncePrefix?: string;
        compression?: 'GZIP' | 'BROTLI';
        /** Whether small files were packed into shared bundles. */
        bundled?: boolean;
        files?: number;
    };
    /**
     * Whether this backup stores everything or only what changed.
     *
     * Written for **every** backup, including database-only ones that have no notion of
     * chains yet, so the Storage Explorer can label them uniformly and a future
     * incremental database mode does not need a second signal.
     */
    backupType?: 'full' | 'incremental';
    /**
     * Incremental chain membership. Absent on a standalone full backup.
     *
     * Duplicated from the archive's own manifest so retention can group backups into
     * chains without opening any archive, and so it still works for archives whose
     * Execution row has been cleaned up.
     */
    chain?: {
        id: string;
        type: 'full' | 'incremental';
        /** Filename of the predecessor archive. Absent on the full. */
        base?: string;
        index: number;
    };
    /** SHA-256 checksum of the final backup file (after compression/encryption) */
    checksum?: string;
    /** MD5 checksum of the final backup file - enables native verification for Google Drive and OneDrive */
    checksumMd5?: string;
    /** Result of the most recent integrity verification */
    verification?: {
        verifiedAt: string;
        passed: boolean;
        trigger: 'manual' | 'post-upload' | 'scheduled';
        actualChecksum?: string;
    };
    /** Trigger information - what initiated the backup */
    trigger?: {
        type: "Manual" | "Scheduler" | "Api";
        /** Username or API key name. Only present if privacy.includeActorInMetadata is enabled. */
        actor?: string;
    };
    /** Allow additional adapter-specific properties */
    [key: string]: unknown;
}

/**
 * Extended database information with optional size and table count.
 * Returned by getDatabasesWithStats() for displaying DB details in the UI.
 */
export interface DatabaseInfo {
    name: string;
    /** Total size in bytes (data + index). Undefined if not available. */
    sizeInBytes?: number;
    /** Number of tables/collections in the database. Undefined if not available. */
    tableCount?: number;
    /** Firebird only: filesystem path for this alias, used to prefill the restore target field. */
    path?: string;
}

/**
 * Information about a single table, view, or collection inside a database.
 * Returned by getTables().
 */
export interface TableInfo {
    name: string;
    /** Approximate row or document count. Undefined if not available. */
    rowCount?: number;
    /** Size in bytes. Undefined if not available. */
    sizeInBytes?: number;
    /** Object type. Defaults to "table" if not provided. */
    type?: "table" | "view" | "collection" | "materialized_view";
}

/**
 * Metadata for a single column (or document field) in a table/collection.
 * Returned as part of TableDataResult.
 */
export interface ColumnInfo {
    name: string;
    dataType: string;
    nullable?: boolean;
    primaryKey?: boolean;
    defaultValue?: string;
}

/**
 * Input options for getTableData().
 */
export interface TableDataOptions {
    database: string;
    table: string;
    /** 1-based page number. */
    page: number;
    pageSize: number;
    /** Optional text search term applied server-side. */
    search?: string;
    /** Column name to restrict the search to. When set, search only applies to this column. */
    searchColumn?: string;
    /** How to match the search term against the column value. Defaults to "contains". */
    matchMode?: "contains" | "equals" | "starts" | "ends";
    /** Column name to sort by. */
    sortBy?: string;
    /** Sort direction. Defaults to ascending. */
    sortDir?: "asc" | "desc";
}

/**
 * Result returned by getTableData().
 */
export interface TableDataResult {
    rows: Record<string, unknown>[];
    /** Total row/document count for the table (used for pagination). */
    totalCount: number;
    /** Column definitions. For schemaless adapters (MongoDB, Redis) derived dynamically. */
    columns: ColumnInfo[];
}

export interface BaseAdapter {
    id: string; // Unique identifier (e.g., 'mysql', 's3')
    name: string; // Display name
    configSchema: z.ZodObject<z.ZodRawShape>; // Schema for configuration
    /**
     * Declares which credential profile types this adapter consumes.
     * Adapters without this field do not require a credential profile (e.g.
     * local-filesystem, OAuth-based storage, webhook notifications).
     * Read by the credential picker (UI) and the config resolver (runtime).
     */
    credentials?: AdapterCredentialRequirements;
    /**
     * Optional method to test the connection configuration (full write/delete verification).
     */
    test?: (config: AdapterConfig) => Promise<{ success: boolean; message: string; version?: string }>;

    /**
     * Optional lightweight connectivity check that verifies reachability without writing any files.
     * Used by the periodic health check (every minute) to avoid creating test files that accumulate
     * under S3 governance/retention policies. Falls back to test() when not implemented.
     */
    ping?: (config: AdapterConfig) => Promise<{ success: boolean; message: string }>;

    /**
     * Optional method to list available databases (for Source adapters)
     */
    getDatabases?: (config: AdapterConfig) => Promise<string[]>;

    /**
     * Optional method to list databases with size and table count information.
     * Falls back to getDatabases() if not implemented.
     */
    getDatabasesWithStats?: (config: AdapterConfig) => Promise<DatabaseInfo[]>;
}

export type BackupResult = {
    success: boolean;
    path?: string;
    size?: number;
    error?: string;
    logs: string[];
    /** Partial metadata from adapter - will be merged with full metadata in runner */
    metadata?: Partial<BackupMetadata>;
    startedAt: Date;
    completedAt: Date;
};

export interface DatabaseAdapter extends BaseAdapter {
    type: 'database';
    /**
     * Optional method to prepare/validate restore before starting.
     * Useful for permission checks (e.g. Can I create the database?).
     * If this fails, the promise should reject (or return error status).
     */
    prepareRestore?(config: AdapterConfig, databases: string[]): Promise<void>;

    /**
     * Dumps the database to a local file path
     * @param config The user configuration for this adapter
     * @param destinationPath The path where the dump should be saved locally
     * @param onLog Optional callback for live logs
     * @param onProgress Optional callback for progress (0-100)
     */
    dump(config: AdapterConfig, destinationPath: string, onLog?: (msg: string, level?: LogLevel, type?: LogType, details?: string) => void, onProgress?: (percentage: number) => void): Promise<BackupResult>;

    /**
     * Restores the database from a local file path
     * @param config The user configuration for this adapter
     * @param sourcePath The path to the dump file
     * @param onLog Optional callback for live logs
     * @param onProgress Optional callback for progress (0-100)
     */
    restore(config: AdapterConfig, sourcePath: string, onLog?: (msg: string, level?: LogLevel, type?: LogType, details?: string) => void, onProgress?: (percentage: number, detail?: string) => void): Promise<BackupResult>;

    /**
     * Optional method to analyze a dump file and return contained databases
     */
    analyzeDump?: (sourcePath: string) => Promise<string[]>;

    /**
     * Optional method to list tables, views, or collections inside a database.
     * Returns TableInfo[] with optional row count and size.
     */
    getTables?: (config: AdapterConfig, database: string) => Promise<TableInfo[]>;

    /**
     * Optional method to fetch paginated row data from a table or collection.
     * Returns rows, total count, and column definitions.
     */
    getTableData?: (config: AdapterConfig, options: TableDataOptions) => Promise<TableDataResult>;

    /**
     * Optional: dumps a single named database to a plain local file, without any
     * TAR/manifest wrapping. Adapters that implement this expose the same per-database
     * logic `dump()` already uses internally for its own multi-DB case - it is a capability
     * export, not new dump logic. Presence of this method is what makes a database source
     * combinable with directory sources (JobSource) in one backup job.
     */
    dumpOne?(
        config: AdapterConfig,
        dbName: string,
        destinationPath: string,
        onLog?: (msg: string, level?: LogLevel, type?: LogType, details?: string) => void
    ): Promise<{ size: number }>;

    /**
     * Optional: restores a single plain dump file (as produced by dumpOne) into a single
     * target database. Counterpart to dumpOne - required for the same combined-backup
     * capability during restore.
     * @param originalDbName The database's original name at backup time (needed by adapters
     * that must rewrite embedded USE/CREATE DATABASE statements when restoring to a renamed target).
     */
    restoreOne?(
        config: AdapterConfig,
        filePath: string,
        targetDbName: string,
        onLog?: (msg: string, level?: LogLevel, type?: LogType, details?: string) => void,
        onProgress?: (percentage: number, detail?: string) => void,
        originalDbName?: string
    ): Promise<void>;
}

export type FileInfo = {
    name: string;
    path: string;
    size: number;
    lastModified: Date;
    locked?: boolean;
    storageClass?: string;
    /**
     * Incremental chain this backup belongs to, read from its `.meta.json`.
     *
     * Retention needs it because a chain can only be deleted as a whole - later snapshots
     * reference bytes in earlier archives, so removing one member would silently gut the
     * others.
     */
    chainId?: string;
};

/** Optional options passed to upload() for adapters that support native checksum storage. */
export interface UploadOptions {
    checksumSha256?: string;
    checksumMd5?: string;
}

/**
 * A persistent upload session that reuses a single connection for multiple uploads.
 * Returned by `StorageAdapter.openSession()` when an adapter supports connection reuse.
 *
 * The session must be closed by calling `close()` after use, typically in a `finally` block.
 * Progress and log callbacks are passed per upload call and behave identically to the
 * stateless `StorageAdapter.upload()` method.
 */
export interface StorageSession {
    upload(
        localPath: string,
        remotePath: string,
        onProgress?: (percent: number) => void,
        onLog?: (msg: string, level?: LogLevel, type?: LogType, details?: string) => void,
        options?: UploadOptions
    ): Promise<boolean>;
    close(): Promise<void>;
}

/** A single file discovered while downloading a directory tree. */
export interface DirectoryFileEntry {
    /** Path relative to the directory source root, POSIX separators. */
    relativePath: string;
    size: number;
    lastModified: Date;
    /**
     * Set when an incremental backup decided the file is unchanged and skipped the
     * transfer. The file still belongs to the snapshot - its bytes just already exist in
     * an earlier archive of the chain - so it is reported here rather than omitted.
     */
    unchanged?: boolean;
}

/** Options for a directory download, used by incremental backups to skip unchanged files. */
export interface DirectoryDownloadOptions {
    /**
     * Decides whether a file has to be transferred.
     *
     * Adapters that ignore this stay correct: everything is downloaded, and the archive
     * writer still avoids re-storing unchanged content by comparing checksums. Honouring
     * it is what turns that storage saving into a bandwidth saving as well.
     */
    shouldDownload?: (entry: { relativePath: string; size: number; lastModified: Date }) => boolean;
    /**
     * How many files to transfer at once. Over a network destination the per-file round trip,
     * not the bandwidth, is the limit, so downloading several in parallel is much faster.
     * Defaults to serial (1) when unset - the generic loop's historical behaviour. Adapters
     * with their own downloadDirectory (Rsync) ignore it.
     */
    concurrency?: number;
}

/** Result of downloading an entire remote directory tree to a local directory. */
export interface DirectoryDownloadResult {
    files: number;
    bytes: number;
    /** Per-file index - becomes the manifest's searchable file list (path/size/mtime). */
    entries: DirectoryFileEntry[];
    /**
     * Files the source listed but would not hand over - unreadable, locked, vanished
     * mid-run, or rejected by the remote.
     *
     * Reported rather than skipped in silence: such a file is missing from the archive and
     * from its index, so a backup that ignored this would look complete and not be. The
     * runner names them and downgrades the execution instead of reporting Success.
     */
    failures: { path: string; error: string }[];
}

/** A single child directory returned by browseDirectories(), one tree level at a time. */
export interface DirectoryBrowseEntry {
    name: string;
    /** Path relative to the adapter's configured root, POSIX separators, no leading slash.
     *  For ID-based adapters (Google Drive) this is the folder ID, not a path string. */
    path: string;
}

/**
 * A point-in-time copy of a source tree, so a backup reads a stable snapshot instead of a
 * tree that keeps changing underneath it.
 *
 * Held by the runner for the duration of the collection and released in `stepCleanup`,
 * which runs in the runner's `finally` - so a snapshot outlives neither a failure nor a
 * cancellation.
 */
export interface SnapshotHandle {
    /** Opaque id the adapter needs to release this snapshot again. */
    id: string;
    /**
     * Config fields to overlay while reading. A snapshot is usually exposed somewhere else
     * entirely - FSRVP hands out a separate UNC path - so collection reads the same
     * relative paths against an overlaid config rather than a rewritten remote path.
     */
    configOverride: Record<string, unknown>;
    /** Human-readable location, for the execution log. */
    label: string;
}

export interface StorageAdapter extends BaseAdapter {
    type: 'storage';
    /**
     * Uploads a local file to the storage destination.
     * Pass `options.checksumSha256` / `options.checksumMd5` so adapters that support
     * native checksum storage (S3, etc.) can attach the hash during the upload request.
     */
    upload(config: AdapterConfig, localPath: string, remotePath: string, onProgress?: (percent: number) => void, onLog?: (msg: string, level?: LogLevel, type?: LogType, details?: string) => void, options?: UploadOptions): Promise<boolean>;

    /**
     * Optional: Verifies the integrity of a remote file without downloading it.
     * Adapters implement this when the storage API provides native checksum access
     * (S3 custom metadata, Google Drive md5Checksum, OneDrive file.hashes.sha256Hash).
     * Returns 'unsupported' when the adapter cannot verify natively (e.g. SFTP, FTP).
     * The VerificationService calls this first and falls back to download+hash if unsupported.
     */
    verifyChecksum?(
        config: AdapterConfig,
        remotePath: string,
        checksums: { sha256?: string; md5?: string }
    ): Promise<'passed' | 'failed' | 'unsupported'>;

    /**
     * Optional: Opens a persistent session for multiple uploads on a single connection.
     * Adapters that do not implement this fall back to per-call `upload()` (stateless).
     * Implementations should hold the underlying connection until `close()` is invoked.
     */
    openSession?(
        config: AdapterConfig,
        onLog?: (msg: string, level?: LogLevel, type?: LogType, details?: string) => void
    ): Promise<StorageSession>;

    /**
     * Downloads a file from storage to local path
     */
    download(
        config: AdapterConfig,
        remotePath: string,
        localPath: string,
        onProgress?: (processed: number, total: number) => void,
        onLog?: (msg: string, level?: LogLevel, type?: LogType, details?: string) => void
    ): Promise<boolean>;

    /**
     * Reads the content of a file as a string
     */
    read?(config: AdapterConfig, remotePath: string): Promise<string | null>;

    /**
     * Optional: streams a byte range [start, end] (both inclusive) of a remote file.
     *
     * This is what makes file-level restore cheap: a seekable (manifest v2) archive records
     * the exact byte offset of every entry, so one file can be pulled out of a
     * multi-gigabyte backup by fetching just its range. Implemented by adapters whose
     * protocol supports it natively - HTTP Range for S3/WebDAV/Drive/OneDrive/Dropbox, seek
     * for SFTP and the local filesystem.
     *
     * Adapters that don't implement this still work: the caller falls back to downloading
     * the archive once to a temp file and ranging over that. See
     * src/lib/archive/storage-source.ts.
     */
    downloadRange?(
        config: AdapterConfig,
        remotePath: string,
        start: number,
        end: number
    ): Promise<NodeJS.ReadableStream>;

    /**
     * Lists files in a directory
     */
    list(config: AdapterConfig, remotePath: string): Promise<FileInfo[]>;

    /**
     * Deletes a file
     */
    delete(config: AdapterConfig, remotePath: string): Promise<boolean>;

    /**
     * Optional: downloads an entire remote directory tree to a local directory, used by
     * directory-source (JobSource) backups. Adapters that don't implement this are handled
     * via a generic fallback (list() + per-file download()) - see
     * src/lib/adapters/storage/common/download-directory.ts. Rsync implements this natively
     * to preserve its delta-transfer advantage.
     */
    downloadDirectory?(
        config: AdapterConfig,
        remotePath: string,
        localPath: string,
        excludePatterns?: string[],
        onProgress?: (processedBytes: number, totalBytes: number, processedFiles: number, totalFiles: number) => void,
        onLog?: (msg: string, level?: LogLevel, type?: LogType, details?: string) => void,
        options?: DirectoryDownloadOptions
    ): Promise<DirectoryDownloadResult>;

    /**
     * Optional: lists the immediate child directories of subPath (non-recursive), scoped to this
     * adapter's configured root. Used for lazy expansion in the directory-source folder tree picker
     * (job form). Adapters that don't implement this are treated as "browse unsupported" by the
     * picker, which falls back to plain manual path entry.
     */
    browseDirectories?(config: AdapterConfig, subPath: string): Promise<DirectoryBrowseEntry[]>;

    /**
     * Reports whether this server can produce a point-in-time snapshot of the given path.
     *
     * Checked before the option can be enabled at all, and again before every backup that
     * relies on it - a service can be stopped or a permission revoked after the fact.
     */
    supportsSnapshot?(config: AdapterConfig, remotePath: string): Promise<{ supported: boolean; message: string }>;

    /** Creates and exposes a snapshot. The caller must release it, whatever else happens. */
    createSnapshot?(config: AdapterConfig, remotePath: string): Promise<SnapshotHandle>;

    /** Releases a snapshot. Must tolerate one that is already gone. */
    releaseSnapshot?(config: AdapterConfig, handle: SnapshotHandle): Promise<void>;

    /**
     * Finds snapshots this adapter left behind on the server, so a run killed before it
     * could clean up does not block the next one. Returns handles ready for release.
     */
    findOrphanedSnapshots?(config: AdapterConfig, remotePath: string): Promise<SnapshotHandle[]>;
}

/**
 * Context passed to notification adapters with backup/restore result details.
 *
 * When `eventType` is set the notification originates from the system
 * notification framework (e.g. user login, config backup) and should be
 * rendered using the generic `title / message / fields` properties instead
 * of the backup-specific ones.
 */
export interface NotificationContext {
    success?: boolean;
    adapterName?: string;
    duration?: number;
    size?: number;
    error?: string;
    jobName?: string;
    executionId?: string;
    status?: string;
    logs?: Array<{
        timestamp: string;
        level: string;
        type: string;
        message: string;
        stage?: string;
        details?: string;
    }>;

    // ── System notification fields ─────────────────────────────
    /** Identifies this as a system notification (set by SystemNotificationService) */
    eventType?: string;
    /** Short title used as email subject / embed title */
    title?: string;
    /** Structured key-value fields for rich rendering */
    fields?: Array<{ name: string; value: string; inline?: boolean }>;
    /** Hex colour for embeds / status indicators */
    color?: string;
    /** Optional badge label override (e.g. "Alert") */
    badge?: string;
}

export interface NotificationAdapter extends BaseAdapter {
    type: 'notification';
    send(config: AdapterConfig, message: string, context?: NotificationContext): Promise<boolean>;
}
