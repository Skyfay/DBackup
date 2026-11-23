import type { DatabaseInfo } from "@/lib/core/interfaces";
import type { DatabaseRun, ExplorerDbJob, LastBackup } from "./database-explorer-types";

/**
 * The rules of the Database Explorer as plain functions: which job backs up which database, and
 * what a run holds. Kept free of Prisma so they can be tested on their own.
 */

/** A database as the list cache keeps it. */
export interface ListedDatabase {
    name: string;
    sizeInBytes?: number;
    tableCount?: number;
}

/** Keeps the name, the size and the table count of what a server listed, and drops anything unnamed. */
export function cleanListedDatabases(databases: DatabaseInfo[]): ListedDatabase[] {
    return databases
        .filter((database) => typeof database?.name === "string" && database.name.length > 0)
        .map((database) => ({
            name: database.name,
            ...(typeof database.sizeInBytes === "number" && Number.isFinite(database.sizeInBytes) ? { sizeInBytes: database.sizeInBytes } : {}),
            ...(typeof database.tableCount === "number" && Number.isFinite(database.tableCount) ? { tableCount: database.tableCount } : {}),
        }));
}

/** The list a cache row holds, an empty list for one that cannot be read. */
export function parseListedDatabases(json: string | null | undefined): ListedDatabase[] {
    if (!json) return [];
    try {
        const parsed: unknown = JSON.parse(json);
        return Array.isArray(parsed) ? cleanListedDatabases(parsed as DatabaseInfo[]) : [];
    } catch {
        return [];
    }
}

/** A database as `serverId/name`, unique across every server. */
export const databaseKey = (serverId: string, name: string) => `${serverId}/${name}`;

/**
 * Servers DBackup backs up as a whole, so the Database Explorer shows them as one entry. Their
 * numbered databases always exist, most of them empty, and a job cannot pick among them.
 */
const INSTANCE_ADAPTERS = ["redis", "valkey"];

export const isInstance = (adapterId: string) => INSTANCE_ADAPTERS.includes(adapterId);

/** The databases a job picked, or null for a job that backs up every database of its server. */
export function parseJobDatabases(raw: string | null | undefined): string[] | null {
    if (!raw) return null;
    try {
        const parsed: unknown = JSON.parse(raw);
        if (!Array.isArray(parsed)) return null;
        const names = parsed.filter((entry): entry is string => typeof entry === "string" && entry.length > 0);
        return names.length > 0 ? names : null;
    } catch {
        return null;
    }
}

/** Whether a job backs up a database of its server. */
export function jobHolds(job: Pick<ExplorerDbJob, "serverId" | "databases">, serverId: string, name: string): boolean {
    return job.serverId === serverId && (job.databases === null || job.databases.includes(name));
}

/** Groups a list by a key, keeping the order of the list in each group. */
export function groupBy<T>(list: readonly T[], keyOf: (entry: T) => string): Map<string, T[]> {
    const groups = new Map<string, T[]>();
    for (const entry of list) {
        const key = keyOf(entry);
        const group = groups.get(key);
        if (group) group.push(entry);
        else groups.set(key, [entry]);
    }
    return groups;
}

/**
 * The enabled jobs that back up each database, keyed by `databaseKey`, in the order of the jobs.
 * The jobs are looked up by their server, since a check of every job for every database took
 * seconds at thousands of each.
 */
export function coverageOf(databases: { serverId: string; name: string }[], jobs: ExplorerDbJob[]): Map<string, string[]> {
    const byServer = groupBy(jobs.filter((job) => job.enabled), (job) => job.serverId);
    return new Map(databases.map((database) => [
        databaseKey(database.serverId, database.name),
        (byServer.get(database.serverId) ?? []).filter((job) => jobHolds(job, database.serverId, database.name)).map((job) => job.id),
    ]));
}

function parseObject(raw: string | null | undefined): Record<string, unknown> | null {
    if (!raw) return null;
    try {
        const parsed: unknown = JSON.parse(raw);
        return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : null;
    } catch {
        return null;
    }
}

const stringList = (value: unknown): string[] | null =>
    Array.isArray(value) && value.every((entry) => typeof entry === "string") ? (value as string[]) : null;

/**
 * The databases a run backed up, read from its metadata. Runs write `names`, older runs kept them
 * under `databases` or `multiDb`. Null when the run recorded none, like one that failed early.
 */
export function namesOfRun(metadata: string | null | undefined): string[] | null {
    const meta = parseObject(metadata);
    if (!meta) return null;
    const databases = meta.databases as { names?: unknown } | undefined;
    const multiDb = meta.multiDb as { databases?: unknown } | undefined;
    return stringList(meta.names) ?? stringList(databases?.names) ?? stringList(meta.databases) ?? stringList(multiDb?.databases);
}

/**
 * Where a run uploaded its backup and whether each upload worked. An air-gapped destination the run
 * left out is no upload that failed, and the backup is not there, so it is not listed.
 */
export function destinationsOfRun(metadata: string | null | undefined): DatabaseRun["destinations"] {
    const meta = parseObject(metadata);
    const list = Array.isArray(meta?.destinations) ? (meta.destinations as unknown[]) : [];
    return list.flatMap((entry) => {
        if (!entry || typeof entry !== "object") return [];
        const destination = entry as { name?: unknown; adapterId?: unknown; status?: unknown; airGapped?: unknown };
        if (typeof destination.name !== "string" || destination.airGapped === true) return [];
        return [{ name: destination.name, adapterId: typeof destination.adapterId === "string" ? destination.adapterId : "", ok: destination.status === "success" }];
    });
}

/** The newest kept run of any of these jobs, for an instance, which every run of its jobs backs up whole. */
export function lastBackupOfJobs(runs: KeptRun[], jobIds: string[]): LastBackup | null {
    const run = runs.find((entry) => jobIds.includes(entry.jobId));
    return run ? { at: run.startedAt, jobId: run.jobId, executionId: run.id, size: run.size, status: run.status } : null;
}

export interface KeptRun {
    id: string;
    jobId: string;
    status: "Success" | "Partial";
    startedAt: string;
    size: number | null;
    names: string[] | null;
}

/**
 * The newest kept run of every database. The runs come newest first. A run without names counts for
 * every database its job holds, since it was written before runs recorded them.
 */
export function lastBackupsOf(runs: KeptRun[], jobs: ExplorerDbJob[], databases: { serverId: string; name: string }[]): Map<string, LastBackup> {
    const jobsById = new Map(jobs.map((job) => [job.id, job]));
    // The databases by server, so a run without names looks only at those of its server.
    const byServer = groupBy(databases, (database) => database.serverId);
    const byKey = new Map<string, LastBackup>();
    for (const run of runs) {
        const job = jobsById.get(run.jobId);
        if (!job) continue;
        const names = run.names ?? (byServer.get(job.serverId) ?? []).filter((database) => jobHolds(job, database.serverId, database.name)).map((database) => database.name);
        for (const name of names) {
            const key = databaseKey(job.serverId, name);
            if (byKey.has(key)) continue;
            byKey.set(key, { at: run.startedAt, jobId: run.jobId, executionId: run.id, size: run.size, status: run.status });
        }
    }
    return byKey;
}

/**
 * The jobs whose older kept runs may still hold the last backup of a database, once only the newest
 * kept run of each job was read: those whose newest run left out a database of their server that
 * has no last backup yet, or an older one than that run. Usually none, since a run backs up every
 * database its job holds, so the older runs are read only for the few jobs that need them.
 */
export function jobsToReadFurther(newest: KeptRun[], jobs: ExplorerDbJob[], databases: { serverId: string; name: string }[], found: Map<string, LastBackup>): string[] {
    const jobsById = new Map(jobs.map((job) => [job.id, job]));
    const byServer = groupBy(databases, (database) => database.serverId);
    const further: string[] = [];
    for (const run of newest) {
        const job = jobsById.get(run.jobId);
        if (!job) continue;
        const at = Date.parse(run.startedAt);
        const leftOut = (byServer.get(job.serverId) ?? []).some((database) => {
            const backedUp = run.names ? run.names.includes(database.name) : jobHolds(job, database.serverId, database.name);
            if (backedUp) return false;
            const last = found.get(databaseKey(database.serverId, database.name));
            return !last || Date.parse(last.at) < at;
        });
        if (leftOut) further.push(job.id);
    }
    return further;
}

/** The version the hourly check read last, from the metadata of a connection. */
export function versionOf(metadata: string | null): string | null {
    if (!metadata) return null;
    try {
        const parsed = JSON.parse(metadata) as { engineVersion?: unknown };
        return typeof parsed.engineVersion === "string" && parsed.engineVersion.trim() ? parsed.engineVersion.trim() : null;
    } catch {
        return null;
    }
}
