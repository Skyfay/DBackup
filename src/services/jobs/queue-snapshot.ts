import prisma from "@/lib/prisma";
import { DEFAULT_RUN_MS } from "@/lib/core/schedule-conflicts";
import { runAsSystem } from "@/lib/tenant/context";
import { RUNS_PER_JOB, toRunSummary } from "@/services/dashboard/aggregates";
import { estimateDuration } from "@/services/dashboard/schedule";
import type { RunSummary } from "@/services/dashboard/types";
import { newestBackupIds, newestDurations, readInChunks } from "@/services/history/newest-runs";

/**
 * The queue of every tenant at a glance: each enabled job with a schedule, its tenant and how long a
 * run of it usually takes. The queue is one for every tenant, so the Overview, the Timeline and the
 * schedule picker of each tenant count the jobs of all the others. They read this snapshot instead
 * of reading every job and its last runs of every tenant on every request, which took a minute from
 * a few thousand jobs. When the schedules start runs is planned once in `queue-schedules.ts`.
 *
 * Kept in memory for the whole process and read in the system scope, across tenants on purpose. Its
 * jobs reach a tenant only through `otherTenantQueue`, which names none of them. A saved job or
 * setting refreshes the scheduler, which drops the jobs (`queueJobsChanged`), and a finished run
 * marks its job, whose usual length is read again on the next read (`queueRunEnded`).
 * Everything is read again at the latest every ten minutes, for whatever changed it otherwise.
 */

/** An enabled job with a schedule, of any tenant. */
export interface QueueJob {
    id: string;
    tenantId: string;
    /** The effective expression, the preset's when the job follows one. */
    schedule: string;
    /** How long a run takes, from its last runs, like `estimateDuration`. */
    estimatedMs: number;
}

/** The jobs are read again at the latest after this, for whatever changed them without a refresh. */
const JOBS_TTL_MS = 10 * 60 * 1000;

interface QueueState {
    jobs: Map<string, QueueJob> | null;
    loadedAt: number;
    loading: Promise<Map<string, QueueJob>> | null;
    /** Bumped when the jobs change, so a load that started before keeps out. */
    version: number;
    /** The usual length of a run of each job, kept when the jobs are read again after a save. */
    estimates: Map<string, number>;
    /** When the usual length of every job was read last. */
    estimatedAt: number;
    /** The jobs whose usual length a run that ended since may have changed. */
    ended: Set<string>;
}

// On globalThis, so the runner, the scheduler and the pages of every module graph share one.
const globalForQueue = globalThis as unknown as { __dbackupQueueSnapshot?: QueueState };
const state: QueueState = (globalForQueue.__dbackupQueueSnapshot ??= {
    jobs: null,
    loadedAt: 0,
    loading: null,
    version: 0,
    estimates: new Map(),
    estimatedAt: 0,
    ended: new Set(),
});

/**
 * Drops the jobs, for a saved job, preset or setting. Called by every refresh of the scheduler. The
 * usual lengths stay, a saved job runs as long as before.
 */
export function queueJobsChanged(): void {
    state.version++;
    state.jobs = null;
    state.loading = null;
}

/** Marks a job whose run ended, so its usual length is read again. */
export function queueRunEnded(jobId: string | null | undefined): void {
    if (jobId) state.ended.add(jobId);
}

/**
 * How long a run of each job takes, from its last runs as a whole, like `estimateDuration`: summed
 * by SQLite in one query, and read run by run only for a job whose times it does not hold as
 * Prisma writes them.
 */
async function estimatesOf(jobIds: readonly string[]): Promise<Map<string, number>> {
    const durations = await newestDurations(jobIds, RUNS_PER_JOB);
    const estimates = new Map<string, number>();
    const odd: string[] = [];
    for (const id of jobIds) {
        const summed = durations.get(id);
        if (!summed) odd.push(id);
        else estimates.set(id, summed.counted > 0 ? Math.round(summed.total / summed.counted) : DEFAULT_RUN_MS);
    }
    if (odd.length === 0) return estimates;

    const ids = await newestBackupIds(odd, { take: RUNS_PER_JOB, wholeJob: true });
    const runs = await readInChunks(ids, (chunk) => prisma.execution.findMany({
        where: { id: { in: chunk } },
        select: { id: true, jobId: true, status: true, startedAt: true, endedAt: true },
    }));
    const byJob = new Map<string, RunSummary[]>(odd.map((id) => [id, []]));
    for (const run of runs) if (run.jobId) byJob.get(run.jobId)?.push(toRunSummary(run));
    for (const [id, list] of byJob) estimates.set(id, estimateDuration(list));
    return estimates;
}

function loadJobs(): Promise<Map<string, QueueJob>> {
    // The runs that ended until now are read with the jobs, those that end meanwhile on the next read.
    const ended = new Set(state.ended);
    state.ended.clear();
    const load = runAsSystem(async () => {
        const jobs = await prisma.job.findMany({
            where: { enabled: true },
            select: { id: true, tenantId: true, schedule: true, schedulePreset: { select: { schedule: true } } },
        });
        const scheduled = jobs.flatMap((job) => {
            const schedule = (job.schedulePreset?.schedule ?? job.schedule ?? "").trim();
            return schedule ? [{ id: job.id, tenantId: job.tenantId, schedule }] : [];
        });
        // After a save only the new jobs and those whose runs ended, every job once in a while.
        const everyJob = Date.now() - state.estimatedAt >= JOBS_TTL_MS;
        const wanted = scheduled.filter((job) => everyJob || ended.has(job.id) || !state.estimates.has(job.id));
        const read = await estimatesOf(wanted.map((job) => job.id));
        if (everyJob) {
            state.estimates = read;
            state.estimatedAt = Date.now();
        } else {
            for (const [id, estimatedMs] of read) state.estimates.set(id, estimatedMs);
        }
        return new Map(scheduled.map((job) => [job.id, { ...job, estimatedMs: state.estimates.get(job.id) ?? DEFAULT_RUN_MS }]));
    });
    // A load that failed leaves the ended runs for the next one.
    load.catch(() => {
        for (const id of ended) state.ended.add(id);
    });
    return load;
}

/** Reads again how long a run takes of the jobs whose runs ended since the last read. */
async function refreshEnded(jobs: Map<string, QueueJob>): Promise<void> {
    const ended = [...state.ended].filter((id) => jobs.has(id));
    state.ended.clear();
    if (ended.length === 0) return;
    const estimates = await runAsSystem(() => estimatesOf(ended));
    for (const [id, estimatedMs] of estimates) {
        state.estimates.set(id, estimatedMs);
        const job = jobs.get(id);
        if (job) jobs.set(id, { ...job, estimatedMs });
    }
}

/** Every enabled job with a schedule of every tenant, read once and kept until the jobs change. */
export async function queueJobs(): Promise<QueueJob[]> {
    if (state.jobs && Date.now() - state.loadedAt < JOBS_TTL_MS) {
        await refreshEnded(state.jobs);
        return [...state.jobs.values()];
    }
    let loading = state.loading;
    if (!loading) {
        const version = state.version;
        const started = loadJobs();
        loading = started;
        state.loading = started;
        started
            .then((jobs) => {
                if (state.version !== version || state.loading !== started) return;
                state.jobs = jobs;
                state.loadedAt = Date.now();
            })
            .catch(() => undefined)
            .finally(() => {
                if (state.loading === started) state.loading = null;
            });
    }
    return [...(await loading).values()];
}
