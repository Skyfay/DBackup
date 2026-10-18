import { Prisma } from "@prisma/client";
import prisma from "@/lib/prisma";
import { SINGLE_DATABASES_MARK } from "./whole-runs";

/**
 * The newest backups of each job, found in one query however many jobs there are: one lookup per
 * job on the index of job and start, newest first. A condition with one branch per job, a
 * `(jobId, startedAt)` pair from a `groupBy`, cost about a second from 5,000 jobs and failed past
 * 10,000 with "Expression tree is too large", and a query per job paid the round trip through
 * Prisma for each of them, scanning the backups of every job newest first when no tenant narrowed
 * it, since SQLite picked the index of type and start.
 *
 * Raw SQL for that measured reason. It skips the tenant filter, so it only finds the ids of runs of
 * the jobs the caller read through the client, and numbers, and the caller reads the rows through
 * the client again.
 */

export interface NewestBackups {
    /** How many of each job, newest first. One by default. */
    take?: number;
    /** Only runs that ended with one of these. Any status when left out. */
    statuses?: readonly string[];
    /** Only the runs that back up the job as a whole, like `WHOLE_JOB_RUNS`. */
    wholeJob?: boolean;
    /**
     * Of the newest runs, only those with one of these statuses, like the newest finished backup
     * of each job where it failed. Rows a caller would read only to drop most of them.
     */
    keepOnly?: readonly string[];
}

/** The lookup of the newest backups of one job of `json_each`, by the index of job and start. */
function newestOf(options: NewestBackups, take: number): Prisma.Sql {
    // The unary plus keeps SQLite on the index of job and start: without statistics it would take
    // the index of type, or of status, and walk the backups of every job until it met this one.
    const statuses = options.statuses && options.statuses.length > 0
        ? Prisma.sql`AND +x.status IN (${Prisma.join([...options.statuses])})`
        : Prisma.empty;
    // The LIKE of Prisma's `contains`, which `WHOLE_JOB_RUNS` uses.
    const whole = options.wholeJob
        ? Prisma.sql`AND (x.metadata IS NULL OR NOT x.metadata LIKE ${`%${SINGLE_DATABASES_MARK}%`})`
        : Prisma.empty;
    return Prisma.sql`
        SELECT x.id FROM Execution x
        WHERE x.jobId = j.value AND +x.type = 'Backup' ${statuses} ${whole}
        ORDER BY x.startedAt DESC
        LIMIT ${take}`;
}

/** The ids of the newest backups of each of the jobs, in no order. */
export async function newestBackupIds(jobIds: readonly string[], options: NewestBackups = {}): Promise<string[]> {
    if (jobIds.length === 0) return [];
    const take = Math.max(1, Math.floor(options.take ?? 1));
    const keep = options.keepOnly && options.keepOnly.length > 0
        ? Prisma.sql`AND +e.status IN (${Prisma.join([...options.keepOnly])})`
        : Prisma.empty;
    const rows = await prisma.$queryRaw<{ id: string }[]>`
        SELECT e.id AS id
        FROM json_each(${JSON.stringify(jobIds)}) j, Execution e
        WHERE e.id IN (${newestOf(options, take)}) ${keep}`;
    return rows.map((row) => row.id);
}

/** How long the newest runs of a job took, as `estimateDuration` counts them. */
export interface NewestDurations {
    /** The sum of the lengths of the runs that ended, were not cancelled and took any time. */
    total: number;
    /** How many runs those are. */
    counted: number;
}

const count = (value: number | bigint | null) => Number(value ?? 0);

/**
 * How long the newest `take` runs of each job as a whole took, summed by SQLite instead of reading
 * every run of every job: a queue of 25,000 jobs read 300,000 rows through Prisma in two seconds. A
 * job with a time SQLite does not hold in milliseconds, which Prisma always writes, is left out,
 * for the caller to read its runs itself.
 */
export async function newestDurations(jobIds: readonly string[], take: number): Promise<Map<string, NewestDurations>> {
    if (jobIds.length === 0) return new Map();
    const rows = await prisma.$queryRaw<{ jobId: string; odd: number | bigint | null; total: number | bigint | null; counted: number | bigint | null }[]>`
        SELECT j.value AS jobId,
               SUM(typeof(e.startedAt) <> 'integer' OR (e.endedAt IS NOT NULL AND typeof(e.endedAt) <> 'integer')) AS odd,
               SUM(CASE WHEN e.endedAt IS NOT NULL AND e.status <> 'Cancelled' AND e.endedAt > e.startedAt THEN e.endedAt - e.startedAt END) AS total,
               COUNT(CASE WHEN e.endedAt IS NOT NULL AND e.status <> 'Cancelled' AND e.endedAt > e.startedAt THEN 1 END) AS counted
        FROM json_each(${JSON.stringify(jobIds)}) j, Execution e
        WHERE e.id IN (${newestOf({ wholeJob: true }, Math.max(1, Math.floor(take)))})
        GROUP BY j.value`;
    const durations = new Map<string, NewestDurations>();
    // A job without runs has none to sum.
    for (const id of jobIds) durations.set(id, { total: 0, counted: 0 });
    for (const row of rows) {
        if (count(row.odd) > 0) durations.delete(row.jobId);
        else durations.set(row.jobId, { total: count(row.total), counted: count(row.counted) });
    }
    return durations;
}

/** How many ids one read of rows names, well below the limit of SQLite on bound values. */
const CHUNK = 5_000;

/**
 * Reads rows by their ids a chunk at a time, through the client and its tenant filter. Ask for the
 * ids alone: another condition beside them, like a status, can make SQLite walk that index instead.
 */
export async function readInChunks<T>(ids: readonly string[], read: (chunk: string[]) => Promise<T[]>): Promise<T[]> {
    const rows: T[] = [];
    for (let start = 0; start < ids.length; start += CHUNK) {
        rows.push(...(await read(ids.slice(start, start + CHUNK))));
    }
    return rows;
}
