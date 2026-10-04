import prisma from "@/lib/prisma";
import type { ScheduleLoad } from "@/lib/core/schedule-conflicts";
import { getMaxConcurrentJobs, getRecentRunsByJob, getSchedulerTimezone } from "@/services/dashboard/aggregates";
import { estimateDuration } from "@/services/dashboard/schedule";

/**
 * What the scheduler already runs: every enabled job with its effective schedule and how long a
 * run of it takes, the slots of the queue and the scheduler's time zone. The schedule picker
 * checks a new time against it the way the Overview marks overlapping runs.
 */
export async function getScheduleLoad(): Promise<ScheduleLoad> {
    const [jobs, runsByJob, timezone, slots] = await Promise.all([
        prisma.job.findMany({
            where: { enabled: true },
            select: { id: true, name: true, schedule: true, schedulePresetId: true, schedulePreset: { select: { schedule: true } } },
            orderBy: { name: "asc" },
        }),
        getRecentRunsByJob(),
        getSchedulerTimezone(),
        getMaxConcurrentJobs(),
    ]);

    return {
        timezone,
        slots,
        jobs: jobs.flatMap((job) => {
            const schedule = (job.schedulePreset?.schedule ?? job.schedule ?? "").trim();
            if (!schedule) return [];
            return [{ id: job.id, name: job.name, schedule, presetId: job.schedulePresetId, estimatedMs: estimateDuration(runsByJob[job.id] ?? []) }];
        }),
    };
}
