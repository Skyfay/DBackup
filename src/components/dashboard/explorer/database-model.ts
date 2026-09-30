import type { DayKey } from "@/components/dashboard/storage/explorer/timeline-model";
import { attentionOf, combineAttention, type TabAttention } from "@/lib/core/tab-attention";
import type {
    DatabaseOverview, DatabaseRun, DatabaseRuns, DatabaseRunsData, ExplorerDatabase, ExplorerDbJob, ExplorerServer, PlannedRun, VersionChange,
} from "@/services/databases/database-explorer-types";

/**
 * The rules of the Databases tab as plain functions: the numbers of the strip, the states the
 * filters offer and the grid of the timeline. Kept free of React so they can be tested.
 */

/** Where a database stands, one or more at once, for the State filter. */
export type DatabaseState = "backed-up" | "no-job" | "never" | "unread";

export function statesOf(database: ExplorerDatabase, server: ExplorerServer | undefined, coverage: boolean): DatabaseState[] {
    const states: DatabaseState[] = [];
    if (coverage) {
        states.push(database.jobIds.length > 0 ? "backed-up" : "no-job");
        if (database.jobIds.length > 0 && !database.lastBackup) states.push("never");
    }
    if (server && (server.readError || !server.readAt)) states.push("unread");
    return states;
}

/** The page of a database or of an instance, with the table to show when given. */
export function databaseHref(database: Pick<ExplorerDatabase, "serverId" | "kind" | "name">, extra: { table?: string | null } = {}): string {
    const params = new URLSearchParams({ server: database.serverId });
    if (database.kind === "database") params.set("database", database.name);
    if (extra.table) params.set("table", extra.table);
    return `/dashboard/explorer/database?${params.toString()}`;
}

/** The runs as the API sends them, with the databases of each run looked up in the shared lists. */
export function expandRuns(data: DatabaseRunsData): DatabaseRuns {
    return {
        runs: data.runs.map((run) => ({ ...run, databases: data.names[run.databases] ?? [] })),
        versionChanges: data.versionChanges,
        planned: data.planned,
    };
}

/** A count in few characters, "184.3K". */
export function compactCount(value: number): string {
    return new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 }).format(value);
}

/** The numbered databases of an instance without a key, which the list only counts. */
export function emptyLogicalNames(database: Pick<ExplorerDatabase, "logical" | "emptyLogical">): string[] {
    const held = new Set(database.logical.map((entry) => entry.name));
    const total = database.logical.length + database.emptyLogical;
    return Array.from({ length: total }, (_, index) => String(index)).filter((name) => !held.has(name));
}

/** Numbered databases in few words, a run of three or more as its ends: "db1, db2, db4 to db15". */
export function foldedNames(names: string[]): string {
    const numbers = names.map(Number).filter(Number.isInteger).sort((a, b) => a - b);
    const runs: number[][] = [];
    for (const value of numbers) {
        const run = runs[runs.length - 1];
        if (run && value === run[run.length - 1] + 1) run.push(value);
        else runs.push([value]);
    }
    return runs
        .flatMap((run) => (run.length >= 3 ? [`db${run[0]} to db${run[run.length - 1]}`] : run.map((value) => `db${value}`)))
        .join(", ");
}

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

export function summarize(overview: DatabaseOverview): DatabaseSummary {
    const { databases } = overview;
    const noJob = databases.filter((database) => database.jobIds.length === 0);
    const sized = databases.filter((database) => database.sizeInBytes !== null);
    return {
        databases: databases.length,
        servers: overview.servers.length,
        size: sized.reduce((sum, database) => sum + (database.sizeInBytes ?? 0), 0),
        unsized: databases.length - sized.length,
        // The keys of an instance are no tables.
        tables: databases.reduce((sum, database) => sum + (database.kind === "database" ? database.tableCount ?? 0 : 0), 0),
        backedUp: databases.length - noJob.length,
        noJob: noJob.length,
        noJobSize: noJob.reduce((sum, database) => sum + (database.sizeInBytes ?? 0), 0),
        biggest: sized.reduce<ExplorerDatabase | null>((best, database) => ((database.sizeInBytes ?? 0) > (best?.sizeInBytes ?? -1) ? database : best), null),
    };
}

/** How old the lists are: the oldest read, and the servers whose latest read failed or never happened. */
export function freshnessOf(servers: ExplorerServer[]) {
    const behind = servers.filter((server) => server.readError !== null || !server.readAt);
    const times = servers.map((server) => server.readAt).filter((value): value is string => value !== null);
    const oldest = times.length === 0 ? null : times.reduce((first, time) => (Date.parse(time) < Date.parse(first) ? time : first));
    return { behind, oldest };
}

// ------------------------------------------------------------------ the timeline

export type CellKind = "none" | "ok" | "failed" | "mixed" | "running" | "planned";

export interface DatabaseCell {
    day: DayKey;
    kind: CellKind;
    runs: DatabaseRun[];
    /** Runs the schedules plan that day, after now. */
    planned: PlannedRun[];
}

export interface TimelineDatabaseRow {
    database: ExplorerDatabase;
    cells: DatabaseCell[];
}

export interface TimelineGroup {
    server: ExplorerServer;
    rows: TimelineDatabaseRow[];
    /** The version changes of the server by the day they were read. */
    marks: Map<DayKey, VersionChange[]>;
    /** Every run of the server by day, which a folded server shows in its one row. */
    cells: DatabaseCell[];
}

function kindOf(runs: DatabaseRun[], planned: PlannedRun[]): CellKind {
    const ok = runs.filter((run) => run.status === "Success" || run.status === "Partial").length;
    const failed = runs.filter((run) => run.status === "Failed").length;
    if (ok > 0 && failed > 0) return "mixed";
    if (failed > 0) return "failed";
    if (ok > 0) return "ok";
    if (runs.some((run) => run.status === "Running" || run.status === "Pending")) return "running";
    return planned.length > 0 ? "planned" : "none";
}

interface TimelineInput {
    databases: ExplorerDatabase[];
    servers: ExplorerServer[];
    jobs: ExplorerDbJob[];
    runs: DatabaseRun[];
    planned: PlannedRun[];
    versionChanges: VersionChange[];
    days: DayKey[];
    now: number;
    dayOf: (iso: string) => DayKey;
}

/**
 * The databases by server, each with a cell per day: what its runs did and what the schedules
 * plan. A run counts for every database it backed up. A planned run counts for every database its
 * job holds, the ones added later included for a job that backs up all of them.
 */
export function buildTimeline({ databases, servers, jobs, runs, planned, versionChanges, days, now, dayOf }: TimelineInput): TimelineGroup[] {
    const inView = new Set(days);
    const runsByCell = new Map<string, DatabaseRun[]>();
    const push = (key: string, run: DatabaseRun) => {
        const list = runsByCell.get(key);
        if (list) list.push(run);
        else runsByCell.set(key, [run]);
    };
    for (const run of runs) {
        if (run.status === "Cancelled") continue;
        const day = dayOf(run.startedAt);
        if (!inView.has(day)) continue;
        for (const name of run.databases) push(`${run.serverId}/${name}|${day}`, run);
        // Every run of a job on an instance backs it up whole, whatever it names.
        push(`${run.serverId}|${day}`, run);
    }

    const jobsById = new Map(jobs.map((job) => [job.id, job]));
    const plannedByCell = new Map<string, PlannedRun[]>();
    const plan = (key: string, entry: PlannedRun) => {
        const list = plannedByCell.get(key);
        if (list) list.push(entry);
        else plannedByCell.set(key, [entry]);
    };
    // The keys each job plans for, found once, since an hourly job plans many runs.
    const keysOfJob = new Map<string, string[]>();
    for (const database of databases) {
        for (const jobId of database.jobIds) {
            const list = keysOfJob.get(jobId);
            if (list) list.push(database.key);
            else keysOfJob.set(jobId, [database.key]);
        }
    }
    const keys = new Set(databases.map((database) => database.key));
    for (const entry of planned) {
        if (Date.parse(entry.at) <= now) continue;
        const job = jobsById.get(entry.jobId);
        const day = dayOf(entry.at);
        if (!job || !inView.has(day)) continue;
        // A server whose own key is a row, an instance, is planned with that row.
        if (!keys.has(job.serverId)) plan(`${job.serverId}|${day}`, entry);
        for (const key of keysOfJob.get(job.id) ?? []) plan(`${key}|${day}`, entry);
    }

    const marksByServer = new Map<string, Map<DayKey, VersionChange[]>>();
    for (const change of versionChanges) {
        const day = dayOf(change.detectedAt);
        if (!inView.has(day)) continue;
        let marks = marksByServer.get(change.serverId);
        if (!marks) {
            marks = new Map();
            marksByServer.set(change.serverId, marks);
        }
        marks.set(day, [...(marks.get(day) ?? []), change]);
    }

    const byServer = new Map<string, ExplorerDatabase[]>();
    for (const database of databases) {
        const list = byServer.get(database.serverId);
        if (list) list.push(database);
        else byServer.set(database.serverId, [database]);
    }

    const cellsOf = (key: string): DatabaseCell[] => days.map((day) => {
        const cellRuns = runsByCell.get(`${key}|${day}`) ?? [];
        const cellPlanned = plannedByCell.get(`${key}|${day}`) ?? [];
        return { day, kind: kindOf(cellRuns, cellPlanned), runs: cellRuns, planned: cellPlanned };
    });

    return servers
        .filter((server) => byServer.has(server.id))
        .map((server) => ({
            server,
            marks: marksByServer.get(server.id) ?? new Map(),
            rows: (byServer.get(server.id) ?? []).map((database) => ({ database, cells: cellsOf(database.key) })),
            cells: cellsOf(server.id),
        }));
}

/** A server with more databases than this starts folded into one row. */
export const FOLD_FROM = 10;

/** One line of the timeline: a folded server, or a database under the head of its server. */
export type TimelineUnit = { kind: "folded"; group: TimelineGroup } | { kind: "row"; group: TimelineGroup; row: TimelineDatabaseRow };

/**
 * The lines of the timeline in order, a folded server counting as one. The pages of the timeline
 * are cut from these, so a folded server with hundreds of databases takes one line of a page.
 */
export function timelineUnits(groups: TimelineGroup[], isFolded: (group: TimelineGroup) => boolean): TimelineUnit[] {
    return groups.flatMap((group): TimelineUnit[] => (isFolded(group)
        ? [{ kind: "folded", group }]
        : group.rows.map((row) => ({ kind: "row", group, row }))));
}

/** The units of one page, grouped again by server, so a server cut by a page shows its head on both. */
export function pageGroups(units: TimelineUnit[], page: number, size: number): { group: TimelineGroup; folded: boolean; rows: TimelineDatabaseRow[] }[] {
    const out: { group: TimelineGroup; folded: boolean; rows: TimelineDatabaseRow[] }[] = [];
    for (const unit of units.slice(page * size, (page + 1) * size)) {
        const last = out[out.length - 1];
        if (unit.kind === "folded") out.push({ group: unit.group, folded: true, rows: [] });
        else if (last && !last.folded && last.group === unit.group) last.rows.push(unit.row);
        else out.push({ group: unit.group, folded: false, rows: [unit.row] });
    }
    return out;
}

/** The newest change of a day, which its mark shows, and how many came before it that day. */
export function markOf(changes: VersionChange[]): { latest: VersionChange; earlier: number } {
    const sorted = [...changes].sort((a, b) => Date.parse(a.detectedAt) - Date.parse(b.detectedAt));
    return { latest: sorted[sorted.length - 1], earlier: sorted.length - 1 };
}

const DAY_MS = 86_400_000;

/**
 * The runs the timeline asks for, in blocks of four weeks, so paging a few days or a wider window
 * does not ask again. The ends reach a day further on both sides, since the days are the
 * viewer's and the server counts in UTC.
 */
export function runsSpan(first: DayKey, last: DayKey): { from: string; until: string } {
    const block = 28 * DAY_MS;
    const start = Math.floor(Date.parse(`${first}T00:00:00Z`) / block) * block - DAY_MS;
    const end = Math.ceil((Date.parse(`${last}T00:00:00Z`) + DAY_MS) / block) * block + DAY_MS;
    return { from: new Date(start).toISOString(), until: new Date(end).toISOString() };
}

/**
 * The dots of the Explorer tabs: databases no job backs up are amber, while the viewer sees the jobs,
 * and a server that does not answer is red, one that failed a check amber.
 */
export function explorerAttention(overview: DatabaseOverview, summary: DatabaseSummary, coverage: boolean): { databases?: TabAttention; servers?: TabAttention } {
    const named = (status: string) => overview.servers.filter((server) => server.status === status).map((server) => server.name);
    return {
        databases: coverage && summary.noJob > 0
            ? { tone: "warning", note: summary.noJob === 1 ? "1 database is in no job" : `${summary.noJob.toLocaleString()} databases are in no job` }
            : undefined,
        servers: combineAttention(
            attentionOf("destructive", named("OFFLINE"), "does not answer", "do not answer"),
            attentionOf("warning", named("DEGRADED"), "failed its last check", "failed their last check"),
        ),
    };
}
