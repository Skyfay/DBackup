import { z } from "zod";
import { LogLevel, LogType } from "./logs";

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
    /** SHA-256 checksum of the final backup file (after compression/encryption) */
    checksum?: string;
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
}

export interface BaseAdapter {
    id: string; // Unique identifier (e.g., 'mysql', 's3')
    name: string; // Display name
    configSchema: z.ZodObject<z.ZodRawShape>; // Schema for configuration
    /**
     * Optional method to test the connection configuration
     */
    test?: (config: AdapterConfig) => Promise<{ success: boolean; message: string; version?: string }>;

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
    restore(config: AdapterConfig, sourcePath: string, onLog?: (msg: string, level?: LogLevel, type?: LogType, details?: string) => void, onProgress?: (percentage: number) => void): Promise<BackupResult>;

    /**
     * Optional method to analyze a dump file and return contained databases
     */
    analyzeDump?: (sourcePath: string) => Promise<string[]>;
}

export type FileInfo = {
    name: string;
    path: string;
    size: number;
    lastModified: Date;
    locked?: boolean;
};

export interface StorageAdapter extends BaseAdapter {
    type: 'storage';
    /**
     * Uploads a local file to the storage destination
     */
    upload(config: AdapterConfig, localPath: string, remotePath: string, onProgress?: (percent: number) => void, onLog?: (msg: string, level?: LogLevel, type?: LogType, details?: string) => void): Promise<boolean>;

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
     * Lists files in a directory
     */
    list(config: AdapterConfig, remotePath: string): Promise<FileInfo[]>;

    /**
     * Deletes a file
     */
    delete(config: AdapterConfig, remotePath: string): Promise<boolean>;
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
    success: boolean;
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
