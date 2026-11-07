import type { JobListItem } from "./job-list-service";

/**
 * What the paged list of the Jobs page gets from the server. Types only, so the browser can import
 * them.
 */

/** The quick filters of the Jobs page. */
export type JobFilter = "all" | "attention" | "running" | "paused";

export const JOB_FILTER_VALUES = ["all", "attention", "running", "paused"] as const satisfies readonly JobFilter[];

/** The orders the jobs are read in, the newest first unless asked. */
export const JOB_SORTS = ["createdAt", "name"] as const;
export type JobSort = (typeof JOB_SORTS)[number];

/** How many of something there are, with the names of the first few. */
export interface NamedCount {
    count: number;
    names: string[];
}

/** The numbers above the list, over every job whatever the search and the filters. */
export interface JobStats {
    total: number;
    paused: number;
    /** How the latest runs of every job ended, the last 12 of each. */
    runs: { succeeded: number; partial: number; failed: number };
    /** The jobs whose last finished run failed. */
    failed: NamedCount;
    /** The jobs whose last finished run missed a copy. */
    partial: NamedCount;
    /** The job that runs next on its schedule. */
    next: { at: string; name: string } | null;
    /** The jobs that run now, the first few with how far they got. */
    running: { count: number; jobs: { name: string; progress: number | null }[] };
    /** The jobs whose run waits for a slot of the queue. */
    waiting: number;
}

/** One page of the jobs, with what the quick filters, the Tenant filter and the numbers above the list need. */
export interface JobPage {
    rows: JobListItem[];
    /** The jobs the search and the filters leave. */
    total: number;
    /** How many jobs each quick filter holds, of every job. */
    counts: Record<JobFilter, number>;
    /** How many jobs of each tenant the search and the quick filter leave, only in All tenants. */
    tenants?: Record<string, number>;
    stats: JobStats;
    /** Whether a run of any job runs or waits now, which the page follows closely. */
    live: boolean;
}
