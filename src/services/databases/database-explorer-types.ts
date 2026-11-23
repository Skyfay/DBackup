/**
 * What the Database Explorer shows, as the API hands it to the page. Plain data without Prisma, so
 * the client can import it.
 */

/** A database connection of DBackup, the server its databases live on. */
export interface ExplorerServer {
    id: string;
    name: string;
    adapterId: string;
    /** The tenant the connection belongs to, which the lists show and open it in while they hold every tenant. */
    tenantId?: string;
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
    /** The tenant of its server, which the list shows and opens it in while it holds every tenant. */
    tenantId?: string;
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
    endedAt: string | null;
    size: number | null;
    /** The path of its backup at every destination, null while it runs and for a run that failed. */
    path: string | null;
    /** The databases the run backed up, or the ones its job holds for a run that failed before it knew. */
    databases: string[];
    /** Where the backup went and how each upload ended. */
    destinations: { name: string; adapterId: string; ok: boolean }[];
    /** The last error a failed run logged, only when asked for. */
    error: string | null;
}

/** A run as the API sends it. Its databases point into the name lists, which the runs of one job share. */
export interface DatabaseRunRecord extends Omit<DatabaseRun, "databases"> {
    databases: number;
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

/**
 * The runs as the API sends them. An hourly job over hundreds of databases would repeat the same
 * names in every run, so each list of names is sent once.
 */
export interface DatabaseRunsData extends Omit<DatabaseRuns, "runs"> {
    runs: DatabaseRunRecord[];
    names: string[][];
}

// ------------------------------------------------------------------ the Servers tab

/** A database server as the Servers tab lists it, beside what the overview holds of it. */
export interface ServerSummary {
    id: string;
    /** Where it runs, host and port or a path, null when the connection has nothing to show. */
    address: string | null;
    /** How long its latest health check took, null before the first. */
    latencyMs: number | null;
    /** Kept backups of its jobs at any destination, null for a viewer who may not see backups. */
    keptBackups: number | null;
    /** When the newest of them was made. */
    lastBackupAt: string | null;
    /**
     * The newest kept backup of its engine it is too old to take, like one of 16.4 while it runs
     * 16.2, with the server that made it. Null when it takes every one, or backups are hidden.
     */
    behind: { version: string; serverName: string } | null;
}

export interface ServersOverview {
    servers: ServerSummary[];
    /** Version changes of any server in the last 30 days. */
    newVersions: number;
    /** Whether the viewer may see backups, which the kept counts and Behind need. */
    backups: boolean;
}

/** One server for its page, with how often it answered. */
export interface ServerDetails extends ServerSummary {
    /** Share of the health checks of the last 30 days that passed in percent, null without any. */
    uptime: number | null;
}

/** A version a server ran, from when the hourly check first read it until the next one came. */
export interface VersionPeriod {
    version: string;
    /** Null for a version read before DBackup kept a history. */
    since: string | null;
    /** Null for the version running now. */
    until: string | null;
    /** How it came, an upgrade or an older version than before. Null when the server was added with it. */
    change: { kind: "up" | "down"; from: string } | null;
    /** Backups made while it ran that are still kept, null for a viewer who may not see backups. */
    kept: number | null;
    /** Backups its jobs made while it ran, null for a viewer who may not see jobs. */
    made: number | null;
}

/** One page of the versions of a server, newest first. */
export interface VersionPage {
    versions: VersionPeriod[];
    total: number;
    page: number;
    size: number;
}

// ------------------------------------------------------------------ the paged list of the Databases tab

/** Where a database stands, one or more at once, for the State filter. */
export type DatabaseState = "backed-up" | "no-job" | "never" | "unread";

/** The orders the list of databases is read in, the biggest first unless asked. */
export const DATABASE_SORTS = ["size", "database", "server", "tables", "last"] as const;
export type DatabaseSort = (typeof DATABASE_SORTS)[number];

/** A server as the filters, the freshness of the lists and the dots of the tabs need it, for every server. */
export type ServerBrief = Omit<ExplorerServer, "version" | "versionSince" | "previousVersion">;

/** The numbers above the list, over every database whatever the filters. */
export interface DatabaseSummary {
    databases: number;
    servers: number;
    /** The bytes of every database whose size is known. */
    size: number;
    /** Databases whose server does not tell their size. */
    unsized: number;
    tables: number;
    backedUp: number;
    noJob: number;
    noJobSize: number;
    biggest: ExplorerDatabase | null;
}

/** How many databases each value of a filter leaves under the other filters, a database once for each of its jobs and states. */
export interface DatabaseFacets {
    server: Record<string, number>;
    engine: Record<string, number>;
    /** By job id, `none` for the databases in no job. */
    job: Record<string, number>;
    state: Record<string, number>;
    /** By tenant id, only in All tenants. */
    tenant?: Record<string, number>;
}

/** One page of the Databases tab, with what the filters, the numbers and the tabs need of every database. */
export interface DatabasePage {
    rows: ExplorerDatabase[];
    /** The databases the search and the filters leave. */
    total: number;
    /** The servers of the rows, with their versions. */
    servers: ExplorerServer[];
    /** The jobs of the servers of the rows. */
    jobs: ExplorerDbJob[];
    /** Whether the viewer may see the jobs, which the coverage and the timeline need. */
    coverage: boolean;
    /** Every server, for the filters, how old the lists are and the dots of the tabs. */
    serverList: ServerBrief[];
    /** The enabled jobs that back up databases, by name, for the Job filter. */
    jobOptions: { id: string; name: string }[];
    facets: DatabaseFacets;
    summary: DatabaseSummary;
    /** How many enabled jobs back up databases. */
    enabledJobs: number;
    /** The engines of the Redis and Valkey servers, whose keys are no tables. */
    keyStores: string[];
}
