import type { TriggerInfo } from "@/lib/runner";
import type { KeyOverride } from "@/services/backup/key-resolution";
import type { DatabaseMappingEntry } from "./database-mapping";

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

/**
 * Which half of a combined (v2) archive a restore should touch.
 *
 * Needed because an omitted `databaseMapping`/`directoryMapping` means "restore all of
 * them" - a convention every v1 caller relies on - so absence cannot also express "leave
 * this half alone". Without an explicit scope, restoring only the files out of a
 * database + directory backup would try to restore its databases too.
 */
export type RestoreScope = 'all' | 'databases' | 'files';

/** A customer's restore of a database of a shared server, see `RestoreInput.shared`. */
export interface SharedRestore {
    databaseName: string;
    /**
     * The tenant of the server, which gets a run of the same restore in its own History with the
     * whole log, and the names of both tenants. Left out, only the customer's run is written.
     */
    provider?: { tenantId: string; name: string; customer: string };
    /**
     * The tenant whose view of the destination the path of the copy is in, the tenant of the server.
     * A copy on a destination another tenant provides to it lies in that tenant's folder there.
     */
    copyTenantId?: string;
}

export interface RestoreInput {
    storageConfigId: string;
    file: string;
    /**
     * A restore a customer started of a database of a shared server. Its run lands in the
     * customer's History, so it names that database alone: never the archive, its path, the
     * destination or the other databases of the server. Only an archive with an index is read.
     */
    shared?: SharedRestore;
    /** Defaults to 'all', which is what every request written before scopes existed means. */
    scope?: RestoreScope;
    /** Optional - a directory-only archive has no database target. Required whenever the
     * archive (or the caller's selection) includes at least one database entry. */
    targetSourceId?: string;
    targetDatabaseName?: string;
    /**
     * Which databases to restore and under which names. Callers may send an object of renames,
     * RestoreService turns it into a list of entries before anything reads it.
     */
    databaseMapping?: Record<string, string> | DatabaseMappingEntry[];
    /** Directory entries to restore from a combined (v2) archive - see DirectoryRestoreMapping. */
    directoryMapping?: DirectoryRestoreMapping[];
    /**
     * Glob patterns whose matching files are skipped, applied to every directory source.
     *
     * Same syntax as a backup's exclude patterns, so a preset can be reused on both sides.
     * Useful for leaving behind clutter a destination will not take anyway - Dropbox refuses
     * `.DS_Store` outright - without having to untick files one by one in the tree.
     */
    excludePatterns?: string[];
    privilegedAuth?: {
        user?: string;
        password?: string;
    };
    /**
     * Vault profile to open the backup with, when the one its metadata names does not fit
     * and the user picked another. Absent for the ordinary case. A restore of a shared
     * database hands over the key it found among the keys of the server's tenant, so the
     * restore searches no other tenant's.
     */
    keyOverride?: KeyOverride;
    triggerInfo?: TriggerInfo;
    /**
     * The tenant of a shared server confirmed that the restore overwrites databases its customers
     * hold now. Without it such a restore is refused, see `customer-databases.ts`.
     */
    overwriteCustomerDatabases?: boolean;
}
