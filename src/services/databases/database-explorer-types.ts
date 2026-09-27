/**
 * What the Database Explorer shows, as the API hands it to the page. Plain data without Prisma, so
 * the client can import it.
 */

/** A database connection of DBackup, the server its databases live on. */
export interface ExplorerServer {
    id: string;
    name: string;
    adapterId: string;
    /** The version the hourly check read last. */
    version: string | null;
    /** When the version last changed, null while it never did since the connection was added. */
    versionSince: string | null;
    /** The version before that change. */
    previousVersion: string | null;
    /** How it answered the latest health check. */
    status: "ONLINE" | "DEGRADED" | "OFFLINE";
    /** When its databases were last read in full, null before the first read. */
    readAt: string | null;
    /** Why the latest read failed, null after a good one. */
    readError: string | null;
}

/** When a database last went into a backup that was kept. */
export interface LastBackup {
    at: string;
    jobId: string;
    executionId: string;
    /** The size of the whole backup, which may hold more databases than this one. */
    size: number | null;
    status: "Success" | "Partial";
}

/** A numbered database of a Redis or Valkey server and its keys. */
export interface LogicalDatabase {
    name: string;
    keys: number;
}

export interface ExplorerDatabase {
    /** `serverId/name` for a database, the server id for an instance, unique across every server. */
    key: string;
    serverId: string;
    /**
     * A database of a server, or an instance: a Redis or Valkey server, which DBackup backs up as
     * a whole, so its numbered databases are one entry.
     */
    kind: "database" | "instance";
    /** The name of the database, or of the server for an instance. */
    name: string;
    sizeInBytes: number | null;
    /** Tables of a database, null for an instance and when the server does not tell. */
    tableCount: number | null;
    /** Keys of an instance over all its numbered databases, null for a database. */
    keyCount: number | null;
    /** The numbered databases of an instance that hold keys, empty for a database. */
    logical: LogicalDatabase[];
    /** The numbered databases of an instance without a key. */
    emptyLogical: number;
    /** The enabled jobs that back it up. */
    jobIds: string[];
    lastBackup: LastBackup | null;
}

/** A job that backs up databases, as the explorer needs it. */
export interface ExplorerDbJob {
    id: string;
    name: string;
    serverId: string;
    enabled: boolean;
    /** Null when the job backs up every database of its server, also the ones added later. */
    databases: string[] | null;
    /** The schedule the scheduler reads, a preset's when the job follows one. */
    schedule: string | null;
}

export interface DatabaseOverview {
    servers: ExplorerServer[];
    databases: ExplorerDatabase[];
    jobs: ExplorerDbJob[];
    /** Whether the viewer may see the jobs, which the coverage and the timeline need. */
    coverage: boolean;
}

export type RunStatus = "Success" | "Partial" | "Failed" | "Running" | "Pending" | "Cancelled";

/** A run of a job that backs up databases. */
export interface DatabaseRun {
    id: string;
    jobId: string;
    serverId: string;
    status: RunStatus;
    startedAt: string;
    size: number | null;
    /** The databases the run backed up, or the ones its job holds for a run that failed before it knew. */
    databases: string[];
    /** Where the backup went and how each upload ended. */
    destinations: { name: string; adapterId: string; ok: boolean }[];
}

/** A version of a server that the hourly check read for the first time. */
export interface VersionChange {
    serverId: string;
    previousVersion: string;
    newVersion: string;
    detectedAt: string;
    /** The new version is older than the one before. */
    downgrade: boolean;
}

/** A run the schedule of a job plans. */
export interface PlannedRun {
    jobId: string;
    at: string;
}

export interface DatabaseRuns {
    runs: DatabaseRun[];
    versionChanges: VersionChange[];
    planned: PlannedRun[];
}
