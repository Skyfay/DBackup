import type { RestoreMode } from "@/components/dashboard/storage/restore-scope";

// Re-exported so the explorer's call sites keep importing their types from one place.
export type { RestoreMode };

/** A backup file as the Storage Explorer and the restore page handle it, one row of a destination's listing. */
export type FileInfo = {
    name: string;
    path: string;
    size: number;
    lastModified: string;
    jobId?: string;
    jobName?: string;
    /** When the backup was made, from its sidecar. */
    createdAt?: string;
    /** The databases the backup holds, when its sidecar names them. */
    databases?: string[];
    sourceName?: string;
    sourceType?: string;
    engineVersion?: string;
    engineEdition?: string;
    dbInfo?: { count: string | number; label: string };
    isEncrypted?: boolean;
    encryptionProfileId?: string;
    compression?: string;
    locked?: boolean;
    trigger?: { type: string; actor?: string };
    storageClass?: string;
    checksum?: string;
    checksumMd5?: string;
    /** True for backups that carry a file index, so individual files can be browsed and restored. */
    hasFileIndex?: boolean;
    /** Whether the backup stores everything or only what changed. */
    backupType?: 'full' | 'incremental';
    /** What the backup contains - drives which restore modes are offered. */
    combined?: { databases: number; directorySources: number };
    /** Incremental chain membership. Absent on standalone full backups. */
    chain?: { id: string; type: 'full' | 'incremental'; index: number };
    /** Complete snapshot size, which for an incremental exceeds the archive's own size. */
    logicalSize?: number;
    verification?: {
        verifiedAt: string;
        passed: boolean;
        trigger: 'manual' | 'post-upload' | 'scheduled';
    };
};
