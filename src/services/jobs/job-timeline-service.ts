import { getTimezoneOffset } from "date-fns-tz";
import prisma from "@/lib/prisma";
import { readCronAtOffset } from "@/lib/core/cron";
import { planQueue, type QueueItem } from "@/lib/core/queue-plan";
import { getMaxConcurrentJobs, getRecentRunsByJob, getSchedulerTimezone } from "@/services/dashboard/aggregates";
import { latestOutcome } from "@/services/dashboard/health";
import { estimateDuration } from "@/services/dashboard/schedule";
import { liveProgress } from "./job-overview";
import type { JobTimeline, TimelinePlannedRun, TimelineRun } from "./job-timeline-types";

const DAY_MS = 24 * 60 * 60 * 1000;
/** How far the timeline reaches back and ahead. */
export const TIMELINE_REACH_MS = 7 * DAY_MS;
/** Every five minutes for a week. A job that runs more often is cut short and named. */
const MAX_PLANNED_PER_JOB = 7 * 24 * 12;

const plannedKey = (jobId: string, due: number) => `${jobId}@${due}`;

/**
 * The runs of every job a week back and a week ahead: what ran with its outcome, what runs and
 * waits now, and what the schedules plan with their usual length. The queue is played through so
 * each planned run knows when it is expected to start and which jobs it waits for.
 *
 * The schedules are read at the offset the scheduler's time zone has now, which is far faster than
 * the zone itself, so runs after a change to summer time show an hour off until then.
 */
export async function getJobTimeline(now = new Date()): Promise<JobTimeline> {
    const from = new Date(now.getTime() - TIMELINE_REACH_MS);
    const to = new Date(now.getTime() + TIMELINE_REACH_MS);
    const [jobs, executions, history, timezone, slots] = await Promise.all([
        prisma.job.findMany({ select: { id: true, enabled: true, schedule: true, schedulePreset: { select: { schedule: true } } } }),
        prisma.execution.findMany({
            where: { type: "Backup", jobId: { not: null }, OR: [{ startedAt: { gte: from } }, { status: { in: ["Running", "Pending"] } }] },
            orderBy: { startedAt: "asc" },
            select: { id: true, jobId: true, status: true, startedAt: true, endedAt: true, metadata: true },
        }),
        getRecentRunsByJob(),
        getSchedulerTimezone(),
        getMaxConcurrentJobs(),
    ]);

    const estimates: Record<string, number> = {};
    const failing: string[] = [];
    for (const job of jobs) {
        const runs = history[job.id] ?? [];
        estimates[job.id] = estimateDuration(runs);
        if (latestOutcome(runs)?.status === "Failed") failing.push(job.id);
    }

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

    const offset = Math.round(getTimezoneOffset(timezone, now) / 60_000);
    const due: { jobId: string; at: number }[] = [];
    const truncated: string[] = [];
    for (const job of jobs) {
        const cron = job.enabled ? readCronAtOffset(job.schedulePreset?.schedule ?? job.schedule ?? "", Number.isFinite(offset) ? offset : 0) : null;
        if (!cron) continue;
        let cursor = now;
        for (let count = 0; ; count++) {
            const next = cron.nextRun(cursor);
            if (!next || next.getTime() > to.getTime()) break;
            if (count === MAX_PLANNED_PER_JOB) {
                truncated.push(job.id);
                break;
            }
            due.push({ jobId: job.id, at: next.getTime() });
            items.push({ key: plannedKey(job.id, next.getTime()), jobId: job.id, due: next.getTime(), durationMs: estimates[job.id] ?? 0 });
            cursor = next;
        }
    }

    const plan = planQueue(items, slots, now.getTime());
    const iso = (time: number | undefined) => (time === undefined ? null : new Date(time).toISOString());

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
            waitsFor: queued?.waitsFor ?? [],
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
                waitsFor: queued?.waitsFor ?? [],
            };
        });

    return { now: now.toISOString(), from: from.toISOString(), to: to.toISOString(), slots, estimates, failing, runs, planned, truncated };
}
