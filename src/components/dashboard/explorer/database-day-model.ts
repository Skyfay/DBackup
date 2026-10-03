import type { DayKey } from "@/components/dashboard/storage/explorer/timeline-model";
import type { DatabaseOverview, DatabaseRun, PlannedRun } from "@/services/databases/database-explorer-types";

/**
 * The rules of the panel of a day as plain functions: what was picked, which of the runs belong
 * to it, the runs of the day for the dropdown and the backups before and after one of them.
 */

/** What a day was picked for: a database, an instance, or a folded server with `server:` and its id. */
export interface DayTarget {
    name: string;
    adapterId: string;
    serverId: string;
    /** The database whose runs count, null for an instance or a server, where every run counts. */
    database: string | null;
    /** The enabled jobs whose plans count. */
    jobIds: string[];
}

export function dayTarget(key: string, overview: DatabaseOverview): DayTarget | null {
    if (key.startsWith("server:")) {
        const server = overview.servers.find((entry) => entry.id === key.slice("server:".length));
        if (!server) return null;
        const jobIds = overview.jobs.filter((job) => job.enabled && job.serverId === server.id).map((job) => job.id);
        return { name: server.name, adapterId: server.adapterId, serverId: server.id, database: null, jobIds };
    }
    const database = overview.databases.find((entry) => entry.key === key);
    const server = database ? overview.servers.find((entry) => entry.id === database.serverId) : undefined;
    if (!database || !server) return null;
    return {
        name: database.name,
        adapterId: server.adapterId,
        serverId: server.id,
        database: database.kind === "database" ? database.name : null,
        jobIds: database.jobIds,
    };
}

const DAY_MS = 86_400_000;

/** The runs the panel asks for: a month on each side of the day, for the backups before and after it. */
export function panelSpan(day: DayKey): { from: string; until: string } {
    const start = Date.parse(`${day}T00:00:00Z`);
    return { from: new Date(start - 31 * DAY_MS).toISOString(), until: new Date(start + 32 * DAY_MS).toISOString() };
}

/** The runs that backed up what was picked, newest first. */
export function runsOf(target: DayTarget, runs: DatabaseRun[]): DatabaseRun[] {
    return runs
        .filter((run) => run.serverId === target.serverId && (target.database === null || run.databases.includes(target.database)))
        .sort((a, b) => Date.parse(b.startedAt) - Date.parse(a.startedAt));
}

/** A run of the day, or one its schedules still plan. */
export interface DayEntry {
    id: string;
    at: string;
    jobId: string;
    run: DatabaseRun | null;
    planned: PlannedRun | null;
}

/** The runs of a day and the ones still planned that day, by time, the way the dropdown lists them. */
export function dayEntries(target: DayTarget, runs: DatabaseRun[], planned: PlannedRun[], day: DayKey, dayOf: (iso: string) => DayKey, now: number): DayEntry[] {
    const done = runs.filter((run) => run.status !== "Cancelled" && dayOf(run.startedAt) === day)
        .map((run) => ({ id: run.id, at: run.startedAt, jobId: run.jobId, run, planned: null }));
    const ahead = planned.filter((entry) => target.jobIds.includes(entry.jobId) && Date.parse(entry.at) > now && dayOf(entry.at) === day)
        .map((entry) => ({ id: `planned:${entry.jobId}:${entry.at}`, at: entry.at, jobId: entry.jobId, run: null, planned: entry }));
    return [...done, ...ahead].sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
}

/** The entry the panel opens with: the one in the address, else the newest run, else the first plan. */
export function pickEntry(entries: DayEntry[], id: string | null): DayEntry | null {
    return entries.find((entry) => entry.id === id) ?? [...entries].reverse().find((entry) => entry.run !== null) ?? entries[0] ?? null;
}

const kept = (run: DatabaseRun) => run.status === "Success" || run.status === "Partial";

/** The kept backups right before and after a time, which a day without its own backup points to. */
export function nearbyBackups(mine: DatabaseRun[], at: string): { before: DatabaseRun | null; after: DatabaseRun | null } {
    const time = Date.parse(at);
    const before = mine.find((run) => kept(run) && Date.parse(run.startedAt) < time) ?? null;
    const after = [...mine].reverse().find((run) => kept(run) && Date.parse(run.startedAt) > time) ?? null;
    return { before, after };
}
