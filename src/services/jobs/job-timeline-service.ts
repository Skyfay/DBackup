import { getTimezoneOffset } from "date-fns-tz";
import prisma from "@/lib/prisma";
import { offsetReader } from "@/lib/core/cron-window";
import { planQueue, type QueueItem } from "@/lib/core/queue-plan";
import { getMaxConcurrentJobs, getRecentRunsByJob, getSchedulerTimezone } from "@/services/dashboard/aggregates";
import { latestOutcome } from "@/services/dashboard/health";
import { estimateDuration } from "@/services/dashboard/schedule";
import { liveProgress } from "./job-overview";
import type { JobTimeline, TimelinePlannedRun, TimelineRun } from "./job-timeline-types";
import { anonymousWaits, demandBeside, NO_OTHER_TENANTS, otherJobIds, otherTenantQueue, queueViewer, type Span } from "./other-tenant-queue";
import { queuePlan, type DueTimes } from "./queue-schedules";

const DAY_MS = 24 * 60 * 60 * 1000;
/** How far the timeline reaches back and ahead. */
export const TIMELINE_REACH_MS = 7 * DAY_MS;
/** Every five minutes for a week. A job that runs more often is cut short and named. */
const MAX_PLANNED_PER_JOB = 7 * 24 * 12;

const plannedKey = (jobId: string, due: number) => `${jobId}@${due}`;

const NOT_PLANNED: DueTimes = { times: [], truncated: false };

/**
 * The runs of every job a week back and a week ahead: what ran with its outcome, what runs and
 * waits now, and what the schedules plan with their usual length. The queue is played through so
 * each planned run knows when it is expected to start and which jobs it waits for.
 *
 * The queue is one for every tenant, so in a tenant the runs of the other tenants take their slots
 * too. They are planned alongside and never listed, a run that waits for one names
 * `OTHER_TENANT_JOB`, and `otherTenants` counts them where a run of the tenant shares the queue.
 *
 * The schedules are read at the offset the scheduler's time zone has now, which is far faster than
 * the zone itself, so runs after a change to summer time show an hour off until then.
 */
export async function getJobTimeline(now = new Date()): Promise<JobTimeline> {
    const from = new Date(now.getTime() - TIMELINE_REACH_MS);
    const to = new Date(now.getTime() + TIMELINE_REACH_MS);
    const viewer = await queueViewer();
    const [jobs, executions, history, timezone, slots, others] = await Promise.all([
        prisma.job.findMany({ select: { id: true, name: true, enabled: true, schedule: true, schedulePreset: { select: { schedule: true } } } }),
        prisma.execution.findMany({
            where: { type: "Backup", jobId: { not: null }, OR: [{ startedAt: { gte: from } }, { status: { in: ["Running", "Pending"] } }] },
            orderBy: { startedAt: "asc" },
            select: { id: true, jobId: true, status: true, startedAt: true, endedAt: true, metadata: true },
        }),
        getRecentRunsByJob(),
        getSchedulerTimezone(),
        getMaxConcurrentJobs(),
        viewer ? otherTenantQueue(viewer) : NO_OTHER_TENANTS,
    ]);

    const estimates: Record<string, number> = {};
    const failing: string[] = [];
    for (const job of jobs) {
        const runs = history[job.id] ?? [];
        estimates[job.id] = estimateDuration(runs);
        if (latestOutcome(runs)?.status === "Failed") failing.push(job.id);
    }
    const otherEstimates = new Map(others.jobs.map((job) => [job.id, job.estimatedMs]));

    const items: QueueItem[] = [];
    for (const execution of executions) {
        if (!execution.jobId || (execution.status !== "Running" && execution.status !== "Pending")) continue;
        const time = execution.startedAt.getTime();
        items.push({
            key: execution.id,
            jobId: execution.jobId,
            due: time,
            durationMs: estimates[execution.jobId] ?? 0,
            startedAt: execution.status === "Running" ? time : undefined,
        });
    }
    const otherItems: QueueItem[] = others.live.map((run) => {
        const time = run.startedAt.getTime();
        return { key: run.id, jobId: run.jobId, due: time, durationMs: otherEstimates.get(run.jobId) ?? 0, startedAt: run.status === "Running" ? time : undefined };
    });

    const measured = Math.round(getTimezoneOffset(timezone, now) / 60_000);
    const offset = Number.isFinite(measured) ? measured : 0;
    // When the schedules start a run from now until `to`, and whether one runs too often to list
    // them all, from the plan of the queue every tenant shares.
    const schedules = await queuePlan({ offset }, now.getTime(), to.getTime());
    const read = offsetReader(offset, now.getTime(), to.getTime());
    const plannedOf = (schedule: string | null) => (schedule ? schedules.due({ schedule }, MAX_PLANNED_PER_JOB, read) ?? NOT_PLANNED : NOT_PLANNED);

    const due: { jobId: string; at: number }[] = [];
    const truncated: string[] = [];
    for (const job of jobs) {
        const times = plannedOf(job.enabled ? job.schedulePreset?.schedule ?? job.schedule ?? "" : null);
        if (times.truncated) truncated.push(job.id);
        for (const at of times.times) {
            due.push({ jobId: job.id, at });
            items.push({ key: plannedKey(job.id, at), jobId: job.id, due: at, durationMs: estimates[job.id] ?? 0 });
        }
    }
    for (const job of others.jobs) {
        for (const at of plannedOf(job.schedule).times) {
            otherItems.push({ key: plannedKey(job.id, at), jobId: job.id, due: at, durationMs: otherEstimates.get(job.id) ?? 0 });
        }
    }

    const plan = planQueue([...items, ...otherItems], slots, now.getTime());
    const iso = (time: number | undefined) => (time === undefined ? null : new Date(time).toISOString());
    const otherJobs = otherJobIds(others);

    const runs: TimelineRun[] = executions.flatMap((execution) => {
        if (!execution.jobId) return [];
        const queued = plan.get(execution.id);
        return [{
            id: execution.id,
            jobId: execution.jobId,
            status: execution.status,
            startedAt: execution.startedAt.toISOString(),
            endedAt: execution.endedAt?.toISOString() ?? null,
            ...(execution.status === "Running" ? liveProgress(execution.metadata) : { stage: null, progress: null }),
            expectedStart: iso(queued?.start),
            expectedEnd: iso(queued?.end),
            waitsFor: anonymousWaits(queued?.waitsFor ?? [], otherJobs),
        }];
    });

    const planned: TimelinePlannedRun[] = due
        .sort((a, b) => a.at - b.at || a.jobId.localeCompare(b.jobId))
        .map(({ jobId, at }) => {
            const queued = plan.get(plannedKey(jobId, at));
            return {
                jobId,
                due: new Date(at).toISOString(),
                start: new Date(queued?.start ?? at).toISOString(),
                end: new Date(queued?.end ?? at + (estimates[jobId] ?? 0)).toISOString(),
                waitsFor: anonymousWaits(queued?.waitsFor ?? [], otherJobs),
            };
        });

    const jobNames = new Map(jobs.map((job) => [job.id, job.name]));
    const names: Record<string, string> = {};
    for (const entry of [...runs, ...planned]) {
        for (const jobId of entry.waitsFor) {
            const name = jobNames.get(jobId);
            if (name) names[jobId] = name;
        }
    }
    const timeline: JobTimeline = { now: now.toISOString(), from: from.toISOString(), to: to.toISOString(), slots, estimates, failing, runs, planned, truncated, names };
    if (!viewer) return timeline;
    // A run that waits counts from when it was due, like the Every job row counts the bars.
    const spanOf = (item: QueueItem): Span => ({ from: item.due, to: plan.get(item.key)?.end ?? item.due });
    const otherTenants = demandBeside(otherItems.map(spanOf), items.map(spanOf))
        .map((stretch) => ({ from: new Date(stretch.from).toISOString(), to: new Date(stretch.to).toISOString(), count: stretch.count }));
    return { ...timeline, otherTenants };
}
