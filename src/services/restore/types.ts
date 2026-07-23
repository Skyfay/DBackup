import type { TriggerInfo } from "@/lib/runner";

/** Selects a directory entry (from a seekable v2 archive) to restore, and where to. */
export interface DirectoryRestoreMapping {
    /** Matches the directory source's jobSourceId in the archive's index. */
    entryId: string;
    /** A StorageAdapter config to restore into - most commonly "Local Filesystem". */
    targetConfigId: string;
    targetPath: string;
    selected: boolean;
    /**
     * Paths to restore, relative to the source root. A directory path selects everything
     * beneath it. Absent means the whole source - the common case, and what every request
     * written before partial selection existed sends.
     */
    paths?: string[];
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
