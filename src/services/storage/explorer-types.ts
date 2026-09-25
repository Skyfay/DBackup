import type { RichFileInfo } from "./storage-service";

/**
 * What the Storage Explorer loads, shared by its service, its API routes and the page.
 *
 * The explorer lists every backup as a run with a copy at every destination of its job, which the
 * page filters by job and by destination, and the files of one destination. Both come from the same
 * cached listings of the destinations, see `explorer-model.ts`.
 */

/** A backup file as the explorer sends it: the cached row, with its date the way JSON carries it. */
export type ExplorerFile = Omit<RichFileInfo, "lastModified"> & { lastModified: string };

export type HealthStatus = "ONLINE" | "DEGRADED" | "OFFLINE";

export interface ExplorerDestination {
    id: string;
    name: string;
    adapterId: string;
    /** When the listing was last compared with the storage. Null while it could not be listed at all. */
    listedAt: string | null;
    /** Why the last listing failed, while that is recent. The cached list, if any, is still shown. */
    listError: string | null;
    /** A listing runs in the background right now. The page asks again until it is done. */
    listing: boolean;
    /** The connection check that runs every minute, which tells whether the storage answers now. */
    health: { status: HealthStatus; checkedAt: string | null; error: string | null };
    /** Backups in the listing. */
    count: number;
    /** Bytes of those backups. */
    size: number;
}

/**
 * - `job` a job that exists
 * - `deleted` a job that is gone while its backups are still there
 * - `none` files without anything that names their job
 * - `system` the config backups of DBackup itself
 */
export type ExplorerJobKind = "job" | "deleted" | "none" | "system";

export interface ExplorerJob {
    /** The id of an existing job, or a key for the other kinds, see `explorer-model.ts`. */
    key: string;
    kind: ExplorerJobKind;
    name: string;
    /** The id of the job, also for a deleted one when its backups carry it. */
    jobId: string | null;
    /** Adapter id of the database source, for its logo. Null for a job with folders only. */
    sourceType: string | null;
    sourceName: string | null;
    /** Whether the job backs up folders, which is what can make it incremental. */
    hasFolders: boolean;
    incremental: boolean;
    /** Where the job writes now, in its upload order. Empty for everything but an existing job. */
    configuredDestinationIds: string[];
    /** Every destination that holds a backup of it or should, configured ones first. */
    destinationIds: string[];
    /** Distinct backups, a run with copies at two destinations counting once. */
    runs: number;
    /** Bytes of every copy at every destination. */
    size: number;
    newest: string | null;
    oldest: string | null;
    failedChecks: number;
    missingCopies: number;
    locked: number;
}

export type CopyState = "stored" | "missing";

export interface BackupCopy {
    destinationId: string;
    /**
     * `missing` when the destination should hold the backup and does not: it belongs to the job and
     * holds an older backup of it, so it was already there when the run made this one.
     */
    state: CopyState;
    /** The file at that destination, absent for a missing copy. */
    file?: ExplorerFile;
}

export interface RunExecution {
    id: string;
    status: string;
    startedAt: string;
    endedAt: string | null;
}

export interface BackupRun {
    /** The path of the backup, the same at every destination. */
    path: string;
    jobKey: string;
    /** The file of the first stored copy, which the list shows. */
    file: ExplorerFile;
    /** When the backup was made. */
    createdAt: string;
    copies: BackupCopy[];
}

export interface ExplorerIndex {
    destinations: ExplorerDestination[];
    jobs: ExplorerJob[];
}

export interface ExplorerBackups {
    /** Every backup of every job, newest first. */
    runs: BackupRun[];
}

export interface DestinationBackup {
    file: ExplorerFile;
    jobKey: string;
    /** The same backup at the other destinations of its job, without their files. */
    elsewhere: { destinationId: string; state: CopyState }[];
}

export interface ExplorerDestinationView {
    destination: ExplorerDestination;
    /** Newest first. */
    backups: DestinationBackup[];
}
