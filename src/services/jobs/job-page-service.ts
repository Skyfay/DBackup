import prisma from "@/lib/prisma";
import { RUNS_PER_JOB, getSchedulerTimezone } from "@/services/dashboard/aggregates";
import { cached } from "@/services/dashboard/cache";
import { UPCOMING_WINDOW_MS, upcomingReader } from "@/services/dashboard/schedule";
import { newestBackupIds, newestStatusCounts, readInChunks } from "@/services/history/newest-runs";
import { getJobItems } from "./job-list-service";
import { liveProgress, nextRunOf } from "./job-overview";
import type { JobFilter, JobPage, JobSort, JobStats, NamedCount } from "./job-page-types";
import { queuePlan } from "./queue-schedules";

/**
 * One page of the Jobs page. The search, the quick filters with their counts, the order and the
 * numbers above the list need every job, but only its name, tenant, state and schedule, and of its
 * runs only what the database counts: the outcome of its last run, the ones that run now and how
 * its latest runs ended. Everything else a row shows, its connections, its latest runs and its next
 * run, is read for the jobs of the page alone.
 */

export interface JobQuery {
    /** From 1. */
    page?: number;
    pageSize?: number;
    filter?: JobFilter;
    /** Part of the name of the job, in any case. */
    search?: string;
    /** The tenants of the Tenant filter of All tenants. */
    tenantIds?: string[];
    sort?: JobSort;
    /** The newest or the last name first. The newest first by default. */
    desc?: boolean;
    /** These jobs whatever the search and the filters, like the one a link opens. */
    ids?: string[];
}

export const JOB_MAX_PAGE_SIZE = 500;

const FINISHED = ["Success", "Failed", "Partial", "Cancelled"];
/** How many names a count of jobs carries, the numbers above the list name the first. */
const NAMES = 3;
/** The jobs that run now named with how far they got. */
const RUNNING_NAMES = 10;
/** What the runs tell is read again after this, or once a run of the tenant ended. */
const RUN_FACTS_TTL_MS = 15_000;
/** Up to this many jobs on a schedule the next run is read from each cron, beyond from the plan of the queue every request shares. */
const OWN_CRONS = 200;

interface IndexedJob {
    id: string;
    name: string;
    tenantId: string;
    enabled: boolean;
    createdAt: Date;
    /** The effective expression, the preset's when the job follows one. */
    schedule: string;
}

interface LiveRun {
    jobId: string;
    status: string;
    metadata: string | null;
}

interface RunFacts {
    /** The jobs whose last finished run as a whole failed or missed a copy. */
    outcomes: Map<string, string>;
    /** How the latest runs of every job ended, by status. */
    statuses: Record<string, number>;
}

/** The outcome of the last run of every job and how their latest runs ended, counted by SQLite. */
function runFacts(ids: string[]): Promise<RunFacts> {
    return cached("job-page-runs", RUN_FACTS_TTL_MS, async () => {
        const [troubled, statuses] = await Promise.all([
            newestBackupIds(ids, { take: 1, statuses: FINISHED, wholeJob: true, keepOnly: ["Failed", "Partial"] }),
            newestStatusCounts(ids, RUNS_PER_JOB),
        ]);
        const rows = await readInChunks(troubled, (chunk) => prisma.execution.findMany({ where: { id: { in: chunk } }, select: { jobId: true, status: true } }));
        return { outcomes: new Map(rows.flatMap((row) => (row.jobId ? [[row.jobId, row.status] as const] : []))), statuses };
    });
}

/** The runs that run or wait now, newest first. */
async function liveRuns(): Promise<LiveRun[]> {
    // By the status alone, which the index of status and start finds among the few that run or wait.
    // Asked for the type too, SQLite walked every backup ever by the index of type.
    const rows = await prisma.execution.findMany({
        where: { status: { in: ["Running", "Pending"] } },
        select: { jobId: true, status: true, type: true, startedAt: true, metadata: true },
    });
    return rows
        .filter((row) => row.type === "Backup" && row.jobId)
        .sort((a, b) => b.startedAt.getTime() - a.startedAt.getTime())
        .map((row) => ({ jobId: row.jobId as string, status: row.status, metadata: row.metadata }));
}

/**
 * The job that runs next on its schedule. A few jobs read their crons, many read the plan of the
 * queue the Overview reads too, and their crons only when none of them runs in its window.
 */
async function nextRun(jobs: IndexedJob[], now: Date): Promise<JobStats["next"]> {
    const scheduled = jobs.filter((job) => job.enabled && job.schedule);
    if (scheduled.length === 0) return null;
    const timezone = await getSchedulerTimezone();
    let best: { at: number; job: IndexedJob } | null = null;
    const consider = (job: IndexedJob, at: number | null) => {
        if (at !== null && (!best || at < best.at)) best = { at, job };
    };
    const byCron = (list: IndexedJob[]) => {
        for (const job of list) {
            const next = nextRunOf({ id: job.id, enabled: true, schedule: job.schedule }, timezone, now);
            consider(job, next ? Date.parse(next) : null);
        }
    };
    if (scheduled.length <= OWN_CRONS) {
        byCron(scheduled);
    } else {
        const plan = await queuePlan({ timezone }, now.getTime(), now.getTime() + UPCOMING_WINDOW_MS);
        const read = upcomingReader(timezone, now);
        const later: IndexedJob[] = [];
        for (const job of scheduled) {
            const due = plan.due(job, 1, read);
            if (due && due.times.length > 0) consider(job, due.times[0]);
            else later.push(job);
        }
        if (!best) byCron(later);
    }
    const found = best as { at: number; job: IndexedJob } | null;
    return found ? { at: new Date(found.at).toISOString(), name: found.job.name } : null;
}

function named(jobs: IndexedJob[]): NamedCount {
    return { count: jobs.length, names: jobs.slice(0, NAMES).map((job) => job.name) };
}

const clean = (values: string[] | undefined) => (values ?? []).map((value) => value.trim()).filter(Boolean);

const byName = new Intl.Collator("en", { numeric: true, sensitivity: "base" });

/**
 * One page of the jobs with the search, a quick filter and the Tenant filter, the newest first.
 * `byTenant` counts the tenants too, for the Tenant filter of All tenants.
 */
export async function listJobPage(query: JobQuery = {}, { byTenant = false }: { byTenant?: boolean } = {}): Promise<JobPage> {
    const now = new Date();
    const [rows, allLive] = await Promise.all([
        prisma.job.findMany({
            select: { id: true, name: true, tenantId: true, enabled: true, createdAt: true, schedule: true, schedulePreset: { select: { schedule: true } } },
            orderBy: { createdAt: "desc" },
        }),
        liveRuns(),
    ]);
    const jobs: IndexedJob[] = rows.map((row) => ({
        id: row.id,
        name: row.name,
        tenantId: row.tenantId,
        enabled: row.enabled,
        createdAt: row.createdAt,
        schedule: (row.schedulePreset?.schedule ?? row.schedule ?? "").trim(),
    }));
    const known = new Set(jobs.map((job) => job.id));
    const live = allLive.filter((run) => known.has(run.jobId));
    const facts = await runFacts(jobs.map((job) => job.id));

    // The run a job shows as live: one that runs, else the newest that waits.
    const current = new Map<string, LiveRun>();
    for (const run of live) {
        const held = current.get(run.jobId);
        if (!held || (held.status !== "Running" && run.status === "Running")) current.set(run.jobId, run);
    }
    const matches = (job: IndexedJob, filter: JobFilter) => {
        switch (filter) {
            case "all":
                return true;
            case "attention":
                return facts.outcomes.has(job.id);
            case "running":
                return current.has(job.id);
            case "paused":
                return !job.enabled;
        }
    };

    const filter = query.filter ?? "all";
    const search = query.search?.trim().toLowerCase() ?? "";
    const tenants = new Set(byTenant ? clean(query.tenantIds) : []);
    const searched = search ? jobs.filter((job) => job.name.toLowerCase().includes(search)) : jobs;
    const quick = searched.filter((job) => matches(job, filter));
    const shown = tenants.size > 0 ? quick.filter((job) => tenants.has(job.tenantId)) : quick;
    if (query.sort === "name") {
        const order = new Map(shown.map((job, index) => [job.id, index]));
        const desc = query.desc ?? false;
        shown.sort((a, b) => (desc ? byName.compare(b.name, a.name) : byName.compare(a.name, b.name)) || (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0));
    } else if (query.desc === false) {
        shown.reverse();
    }

    const pageSize = Math.min(Math.max(1, Math.floor(query.pageSize ?? 25)), JOB_MAX_PAGE_SIZE);
    const page = query.page && query.page > 0 ? Math.floor(query.page) : 1;
    const wanted = query.ids && query.ids.length > 0
        ? query.ids.filter((id) => known.has(id)).slice(0, JOB_MAX_PAGE_SIZE)
        : shown.slice((page - 1) * pageSize, page * pageSize).map((job) => job.id);
    const [items, next] = await Promise.all([getJobItems(wanted, now), nextRun(jobs, now)]);

    const running = jobs.filter((job) => current.get(job.id)?.status === "Running");
    const stats: JobStats = {
        total: jobs.length,
        paused: jobs.filter((job) => !job.enabled).length,
        runs: { succeeded: facts.statuses.Success ?? 0, partial: facts.statuses.Partial ?? 0, failed: facts.statuses.Failed ?? 0 },
        failed: named(jobs.filter((job) => facts.outcomes.get(job.id) === "Failed")),
        partial: named(jobs.filter((job) => facts.outcomes.get(job.id) === "Partial")),
        next,
        running: {
            count: running.length,
            jobs: running.slice(0, RUNNING_NAMES).map((job) => ({ name: job.name, progress: liveProgress(current.get(job.id)?.metadata ?? null).progress })),
        },
        waiting: jobs.filter((job) => current.get(job.id)?.status === "Pending").length,
    };
    const counts = Object.fromEntries((["all", "attention", "running", "paused"] as const).map((value) => [value, jobs.filter((job) => matches(job, value)).length])) as Record<JobFilter, number>;
    const tenantCounts: Record<string, number> = {};
    if (byTenant) for (const job of quick) tenantCounts[job.tenantId] = (tenantCounts[job.tenantId] ?? 0) + 1;

    return {
        rows: items,
        total: shown.length,
        counts,
        ...(byTenant ? { tenants: tenantCounts } : {}),
        stats,
        live: live.length > 0,
    };
}
