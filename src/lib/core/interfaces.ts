import { z } from "zod";
import { LogLevel, LogType } from "./logs";
import type { AdapterCredentialRequirements } from "./credentials";
import type { ExecutionHost, TransportResolver } from "@/lib/transport/types";

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
    // LEGACY-FORMAT(shared): Whole-file compression and encryption. Older database backups carry these,
    // and so do config backups, which still use that format. Keep them for the config backups.
    compression?: 'GZIP' | 'BROTLI';
    encryption?: {
        enabled: boolean;
        profileId: string;
        algorithm: 'aes-256-gcm';
        iv: string;
        authTag: string;
    };
    /** Multi-DB TAR archive metadata */
    // LEGACY-FORMAT(read): Only set on older multi-database TAR backups.
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
     *
     * `host` is the transport the config asked for (direct or SSH). It is optional
     * here because test() is the one method both storage and database adapters
     * implement, and storage adapters manage their own connections. Database
     * adapters must reject a missing host rather than guess a transport: silently
     * defaulting to direct would check a different machine than the one configured
     * and report it healthy. Always obtain one through `runConnectivityCheck()`.
     */
    test?: (config: AdapterConfig, host?: ExecutionHost) => Promise<{ success: boolean; message: string; version?: string }>;

    /**
     * Optional lightweight connectivity check that verifies reachability without writing any files.
     * Used by the periodic health check (every minute) to avoid creating test files that accumulate
     * under S3 governance/retention policies. Falls back to test() when not implemented.
     */
    ping?: (config: AdapterConfig, host?: ExecutionHost) => Promise<{ success: boolean; message: string }>;
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
     * Optional: builds the TransportSpec from this adapter's config.
     * Omit it to use the standard `connectionMode` plus `ssh*` field convention.
     * SQLite and MSSQL declare their own because their stored configs predate it.
     */
    transport?: TransportResolver;

    /**
     * Every method below takes `host` as a REQUIRED parameter, unlike test() and
     * ping() on BaseAdapter. `AdapterConfig` is `any`, so argument count is the
     * only thing the compiler can still check, and an arity error is one of the
     * few things `any` cannot swallow. Forgetting the host is therefore a build
     * failure rather than a run that quietly talks to the wrong machine.
     *
     * getDatabases and getDatabasesWithStats live here rather than on BaseAdapter
     * because no storage or notification adapter implements them.
     */

    /**
     * Optional method to list available databases (for Source adapters)
     */
    getDatabases?: (config: AdapterConfig, host: ExecutionHost) => Promise<string[]>;

    /**
     * Optional method to list databases with size and table count information.
     * Falls back to getDatabases() if not implemented.
     */
    getDatabasesWithStats?: (config: AdapterConfig, host: ExecutionHost) => Promise<DatabaseInfo[]>;

    /**
     * Optional method to prepare/validate restore before starting.
     * Useful for permission checks (e.g. Can I create the database?).
     * If this fails, the promise should reject (or return error status).
     */
    prepareRestore?(config: AdapterConfig, databases: string[], host: ExecutionHost): Promise<void>;

    /**
     * Dumps the database to a local file path
     * @param config The user configuration for this adapter
     * @param destinationPath The path where the dump should be saved locally
     * @param host The execution transport resolved from the config
     * @param onLog Optional callback for live logs
     * @param onProgress Optional callback for progress (0-100)
     */
    // LEGACY-FORMAT(write): No job calls dump() anymore, every backup is produced by dumpOne().
    // Remove it from the interface and from every adapter.
    dump(config: AdapterConfig, destinationPath: string, host: ExecutionHost, onLog?: (msg: string, level?: LogLevel, type?: LogType, details?: string) => void, onProgress?: (percentage: number) => void): Promise<BackupResult>;

    /**
     * Restores the database from a local file path
     * @param config The user configuration for this adapter
     * @param sourcePath The path to the dump file
     * @param host The execution transport resolved from the config
     * @param onLog Optional callback for live logs
     * @param onProgress Optional callback for progress (0-100)
     */
    // LEGACY-FORMAT(read): Only backups written before the seekable archive reach restore(). New
    // backups are restored through restoreOne(). Remove it once those backups no longer need restoring.
    restore(config: AdapterConfig, sourcePath: string, host: ExecutionHost, onLog?: (msg: string, level?: LogLevel, type?: LogType, details?: string) => void, onProgress?: (percentage: number, detail?: string) => void): Promise<BackupResult>;

    /**
     * Optional method to analyze a dump file and return contained databases
     */
    // LEGACY-FORMAT(read): Lists the databases of a backup file written before the seekable
    // archive. A seekable archive is listed from its index instead.
    analyzeDump?: (sourcePath: string) => Promise<string[]>;

    /**
     * Optional method to list tables, views, or collections inside a database.
     * Returns TableInfo[] with optional row count and size.
     */
    getTables?: (config: AdapterConfig, database: string, host: ExecutionHost) => Promise<TableInfo[]>;

    /**
     * Optional method to fetch paginated row data from a table or collection.
     * Returns rows, total count, and column definitions.
     */
    getTableData?: (config: AdapterConfig, options: TableDataOptions, host: ExecutionHost) => Promise<TableDataResult>;

    /**
     * Dumps a single named database to a plain local file, without any TAR/manifest
     * wrapping. Every backup is a seekable archive holding one entry per database, and this
     * is how each entry is produced. Throws on failure.
     */
    dumpOne?(
        config: AdapterConfig,
        dbName: string,
        destinationPath: string,
        host: ExecutionHost,
        onLog?: (msg: string, level?: LogLevel, type?: LogType, details?: string) => void
    ): Promise<{ size: number }>;

    /**
     * Restores a single plain dump file (as produced by dumpOne) into a single target
     * database. Counterpart to dumpOne, used for every seekable archive. Throws on failure.
     * @param originalDbName The database's original name at backup time (needed by adapters
     * that must rewrite embedded USE/CREATE DATABASE statements when restoring to a renamed target).
     */
    restoreOne?(
        config: AdapterConfig,
        filePath: string,
        targetDbName: string,
        host: ExecutionHost,
        onLog?: (msg: string, level?: LogLevel, type?: LogType, details?: string) => void,
        onProgress?: (percentage: number, detail?: string) => void,
        originalDbName?: string
    ): Promise<void>;

    /**
     * Optional: the entries a backup of this source consists of, for sources whose snapshot
     * cannot be split per database. Redis writes one RDB holding every logical database, and
     * a SQLite source is a single file. Without it, the job's selection is used, or
     * getDatabases() when nothing is selected.
     */
    listDumpEntries?(config: AdapterConfig, selected: string[], host: ExecutionHost): Promise<string[]>;
}

export type FileInfo = {
    name: string;
    path: string;
    size: number;
    lastModified: Date;
    /**
     * Creation time DBackup itself recorded in the backup's `.meta.json`, when one was
     * readable.
     *
     * This is what retention buckets by, because it survives the things that reset a
     * filesystem mtime: a copy without -p, a migration between servers, a restored backup
     * directory. `lastModified` keeps meaning what it says, the mtime the destination
     * reports, so the two can be compared when they disagree.
     */
    backupTimestamp?: Date;
    /**
     * Set when this entry is a symbolic link, holding its raw target exactly as stored on the
     * source - relative stays relative, and nothing is resolved.
     *
     * Resolving here would be wrong twice over: a relative target only means something from
     * the link's own directory, and following it would pull in bytes from outside the source
     * the user asked to back up. The link is the content, not what it happens to point at.
     *
     * Only ever set by the collection walkers (`listTree`). `list()` keeps describing plain
     * files, because it also serves retention, integrity checks and the destination browser,
     * where a link has no meaning.
     */
    linkTarget?: string;
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
    /**
     * The job that made this backup, read from its `.meta.json`.
     *
     * Retention leaves a backup of another job alone. A job named like a deleted one writes
     * into the same folder, and the backups the deleted job left there are not its to delete.
     */
    jobId?: string;
};

/** Optional options passed to upload() for adapters that support native checksum storage. */
export interface UploadOptions {
    checksumSha256?: string;
    checksumMd5?: string;
    /**
     * POSIX metadata to apply to the written file, when the backup recorded it and the
     * adapter can set it.
     *
     * Adapters that cannot are not expected to try: a file uploaded to S3 or Dropbox has no
     * owner to restore. The adapters that do care are the ones writing somewhere a program
     * will read the result back - a container volume above all, where a data directory with
     * the wrong owner or a mode looser than 0700 stops Postgres, MySQL and Redis from
     * starting at all.
     */
    mode?: number;
    uid?: number;
    gid?: number;
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
    /**
     * Optional: downloads over the session's connections too. Present on adapters where opening
     * a connection is expensive enough that a directory collection should not pay for one per
     * file. Callers must fall back to `StorageAdapter.download()` when it is absent.
     */
    download?(
        remotePath: string,
        localPath: string,
        onProgress?: (processed: number, total: number) => void
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
    /**
     * Raw target when this entry is a symbolic link. Nothing was transferred and no local
     * file exists, so `size` is 0 and callers must not try to read it off disk.
     */
    linkTarget?: string;
    /**
     * POSIX metadata as it exists at the source, for adapters whose protocol carries it.
     *
     * Optional throughout: an adapter that cannot see permissions leaves these unset and
     * the backup behaves exactly as it did before they existed. Setting them is what lets a
     * restore put the file back the way a program expects to find it.
     */
    mode?: number;
    uid?: number;
    gid?: number;
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
    /**
     * Aborts the collection.
     *
     * Checked before the listing, by the walk itself where the adapter supports it, and
     * before each file transfer starts. Transfers already in flight run to completion, so
     * cancellation is bounded by one file rather than by the rest of the source.
     */
    signal?: AbortSignal;
    /**
     * Live counts while the source is being listed, before a single byte has moved.
     *
     * A large tree spends minutes here. Without this the phase reports nothing at all for
     * that whole time, which is indistinguishable from a run that has stopped.
     */
    onListProgress?: (progress: ListTreeProgress) => void;
}

/** A directory a walk refused to descend into, and the pattern that made it pointless. */
export interface PrunedDirectory {
    /** Path relative to the queried directory, POSIX separators, no leading slash. */
    path: string;
    /** The exclude pattern proving everything below it is excluded. */
    pattern: string;
}

/** Live counts while a tree is being walked. */
export interface ListTreeProgress {
    files: number;
    directories: number;
    prunedDirectories: number;
    /** Directory currently being read, relative to the queried directory. Empty for the root. */
    currentPath: string;
}

/**
 * Constraints and observers for a collection walk.
 *
 * Every field is advisory. An adapter honouring none of them is still correct: exclusions are
 * applied again by the caller, progress is optional, and the caller checks the signal either
 * side of the call. Honouring them is what turns correct into fast and interruptible.
 */
export interface ListTreeOptions {
    /**
     * Glob patterns, matched against the path relative to the queried directory - the same
     * relative path the caller derives, so walk and filter agree on what a path means.
     *
     * Used only to skip descending into directories that cannot contain a wanted file, never
     * to filter individual files. Deciding what ends up in the backup stays with the caller.
     */
    excludePatterns?: string[];
    /** Aborts the walk. Implementations check between directory reads and throw. */
    signal?: AbortSignal;
    onProgress?: (progress: ListTreeProgress) => void;
    /** How many directory reads may be in flight. Defaults to 1, which is a serial walk. */
    concurrency?: number;
}

export interface ListTreeResult {
    /** Identical in shape and path convention to what `list()` returns. */
    files: FileInfo[];
    /**
     * Directories skipped whole.
     *
     * Reported rather than dropped: the exclude summary counts files, and a pruned tree
     * contributes none, so without this a `node_modules/**` would turn "48,000 files skipped"
     * into silence. A backup may not quietly leave things out.
     */
    pruned: PrunedDirectory[];
    /**
     * Symbolic links the walker saw but could not describe, because the protocol does not
     * hand out a target it could store.
     *
     * Reported for the same reason `pruned` is: they are missing from the backup, and a
     * missing thing nobody was told about is the failure mode that only surfaces during a
     * restore. An adapter that can read targets puts them in `files` with `linkTarget` set
     * and leaves this empty.
     */
    unsupportedSymlinks?: string[];
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
/** Per-group choices the job carries into a snapshot. */
export interface SnapshotOptions {
    /**
     * Whether the adapter may stop whatever is holding the sources open, for the duration.
     *
     * Set per job source. Uniform within a group by construction: a source that says no is
     * always planned into a group of its own, so an adapter never has to reconcile a group
     * where half the sources allow it and half do not.
     */
    stopContainers?: boolean;
    /**
     * Writes into the run's execution log.
     *
     * Preparing a source can be the most consequential thing a backup does - stopping a
     * database, emptying nothing but touching everything, discovering that an earlier run
     * left services down. Without this the adapter could only talk to the server console,
     * so none of it reached the history someone actually reads. Same shape as the callback
     * `downloadDirectory`, `upload` and `openSession` already take.
     */
    onLog?: (msg: string, level?: LogLevel, type?: LogType, details?: string) => void;
}

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
    /**
     * What this kind of snapshot is called, for the runner's own log lines. Defaults to
     * "snapshot".
     *
     * A shadow copy and a helper container are not the same thing, and a log that calls one
     * by the other's name is worse than a vague one. SMB says "shadow copy" and reads
     * exactly as it always has; a container runtime says "helper container".
     */
    noun?: string;
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
     * Optional: Opens a persistent session for multiple transfers over pooled connections.
     * Adapters that do not implement this fall back to per-call `upload()`/`download()` (stateless).
     * Implementations should hold the underlying connections until `close()` is invoked.
     *
     * `options.concurrency` is how many transfers the caller intends to run at once, and so how
     * many connections the session may open. Sessions must never open more than that: on SFTP
     * and FTP the connection count is what servers rate-limit, not the byte count.
     */
    openSession?(
        config: AdapterConfig,
        onLog?: (msg: string, level?: LogLevel, type?: LogType, details?: string) => void,
        options?: { concurrency?: number }
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
     * How many `read()` calls a caller may run against this destination at once.
     *
     * Defaults to serial (1) when unset, which is what every adapter did before this
     * existed. Only declare more where `read()` opens no protocol state per call, so an
     * HTTP request or a local file access. An adapter that dials a connection or spawns a
     * process per read stays serial: there the server's connection limit is what breaks,
     * not the bandwidth.
     */
    readConcurrency?: number;

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
     * Optional: the same recursive listing `list()` produces, but built with the caller's
     * constraints in hand - so an excluded directory is never read, progress arrives while
     * the walk runs, and a cancelled run stops within one round trip.
     *
     * Exists for directory sources, where the tree is deep and mostly unwanted, and where
     * `list()`'s "walk everything, filter afterwards" costs the whole tree before the first
     * byte moves. Adapters that do not implement it keep working unchanged:
     * `listTreeForCollection()` falls back to `list()`.
     */
    listTree?(
        config: AdapterConfig,
        remotePath: string,
        options?: ListTreeOptions
    ): Promise<ListTreeResult>;

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
     * Optional: recreates a symbolic link at `remotePath` pointing at `target`.
     *
     * Present only on adapters whose protocol has symbolic links at all, which is what makes
     * the method itself the capability check - no separate flag to keep in sync. A restore
     * calls it where it exists, and names every link it had to skip where it does not, rather
     * than reporting a complete restore that quietly is not one.
     *
     * `target` is stored verbatim, exactly as it was collected. Resolving it would turn a
     * relative link into one that is wrong from any other directory.
     */
    createSymlink?(config: AdapterConfig, remotePath: string, target: string): Promise<void>;

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

    /**
     * Groups this adapter's sources within one run, so preparation they share happens once
     * and is undone as soon as the last of them is collected.
     *
     * Without it every source is its own group and the run behaves exactly as it always
     * did. It exists for sources whose preparation reaches beyond the source itself: backing
     * up a container volume means stopping the containers holding it, two volumes of the
     * same container have to stop it once rather than twice, and a container whose volumes
     * are done should start again without waiting for the rest of the job.
     *
     * Returns the given paths partitioned into groups, in the order they should be
     * collected. Every input path must appear exactly once - the caller checks, because a
     * dropped path is a file missing from a backup that still reports success.
     */
    planSourceGroups?(config: AdapterConfig, remotePaths: string[]): Promise<string[][]>;

    /**
     * Prepare unconditionally, rather than only when the source config asks for a snapshot.
     *
     * `useVss` makes shadow copies an option a user turns on for a share that supports them.
     * An adapter that cannot be read at all without preparing first - a volume needs a
     * container to expose it - sets this instead, and its `stopContainers`-style choices
     * become options on createSnapshot rather than a reason to skip it.
     */
    alwaysSnapshot?: true;

    /**
     * Creates and exposes a snapshot. The caller must release it, whatever else happens.
     *
     * Takes the whole group's paths: an adapter that implements `planSourceGroups` gets one
     * preparation covering all of them. Adapters that do not are called with exactly one.
     */
    createSnapshot?(
        config: AdapterConfig,
        remotePaths: string[],
        options?: SnapshotOptions
    ): Promise<SnapshotHandle>;

    /**
     * Releases a snapshot. Must tolerate one that is already gone.
     *
     * `onLog` is separate from the create side's because a release happens twice: once when
     * the group is done, and once more from cleanup if that failed. Both want to say what
     * they undid, and the second one no longer has the options object.
     */
    releaseSnapshot?(
        config: AdapterConfig,
        handle: SnapshotHandle,
        onLog?: (msg: string, level?: LogLevel, type?: LogType, details?: string) => void
    ): Promise<void>;

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
