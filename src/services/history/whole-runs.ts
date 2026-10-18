import type { Prisma } from "@prisma/client";

/**
 * A run of a job for some of its databases alone, like a backup a customer started of a database
 * a shared server gives it, or a run of single databases from the page of a server. It backs up a
 * part of the job, so how long it took and how it ended say nothing about the job as a whole: the
 * usual length of a run, the estimates of the schedules, the last run and the health of a job leave
 * it out. History lists it like every run. Its metadata names the databases, see `onlyDatabasesOf`
 * in `src/lib/runner.ts`.
 */

/** What the metadata of such a run holds, for raw SQL that leaves it out, see `newest-runs.ts`. */
export const SINGLE_DATABASES_MARK = '"onlyDatabases"';

/** The runs that back up a job as a whole, for a query of the executions. */
export const WHOLE_JOB_RUNS: Prisma.ExecutionWhereInput = {
    OR: [{ metadata: null }, { NOT: { metadata: { contains: SINGLE_DATABASES_MARK } } }],
};

/** Whether a run backed up some databases of its job alone, by its stored metadata. */
export function isSingleDatabaseRun(metadata: string | null | undefined): boolean {
    return Boolean(metadata?.includes(SINGLE_DATABASES_MARK));
}
