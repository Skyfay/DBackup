import type { TriggerInfo } from "@/lib/runner";

/** Selects a single directory entry (from a combined v2 archive) to restore, and where to. */
export interface DirectoryRestoreMapping {
    /** Matches DirectoryEntryV2.jobSourceId in the archive's manifest. */
    entryId: string;
    /** A StorageAdapter config to restore into - most commonly "Local Filesystem". */
    targetConfigId: string;
    targetPath: string;
    selected: boolean;
}

export interface RestoreInput {
    storageConfigId: string;
    file: string;
    /** Optional - a directory-only archive has no database target. Required whenever the
     * archive (or the caller's selection) includes at least one database entry. */
    targetSourceId?: string;
    targetDatabaseName?: string;
    databaseMapping?: Record<string, string> | any[];
    /** Directory entries to restore from a combined (v2) archive - see DirectoryRestoreMapping. */
    directoryMapping?: DirectoryRestoreMapping[];
    privilegedAuth?: {
        user?: string;
        password?: string;
    };
    triggerInfo?: TriggerInfo;
}
