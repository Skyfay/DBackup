import prisma from "@/lib/prisma";
import type { ScheduleLoad, ScheduledJobLoad } from "@/lib/core/schedule-conflicts";
import { getMaxConcurrentJobs, getRecentRunsByJob, getSchedulerTimezone } from "@/services/dashboard/aggregates";
import { estimateDuration } from "@/services/dashboard/schedule";
import { OTHER_TENANT_JOB, OTHER_TENANT_JOB_NAME } from "./job-timeline-types";
import { NO_OTHER_TENANTS, otherTenantQueue, queueViewer } from "./other-tenant-queue";

/**
 * What the scheduler already runs: every enabled job with its effective schedule and how long a
 * run of it takes, the slots of the queue and the scheduler's time zone. The schedule picker
 * checks a new time against it the way the Overview marks overlapping runs.
 *
 * The queue is one for every tenant, so in a tenant the jobs of the other tenants count too. They
 * come without their id, name or preset, each named `OTHER_TENANT_JOB_NAME`, which the clash note
 * shows once however many of them are ahead.
 */
export async function getScheduleLoad(): Promise<ScheduleLoad> {
    const viewer = await queueViewer();
    const [jobs, runsByJob, timezone, slots, others] = await Promise.all([
        prisma.job.findMany({
            where: { enabled: true },
            select: { id: true, name: true, schedule: true, schedulePresetId: true, schedulePreset: { select: { schedule: true } } },
            orderBy: { name: "asc" },
        }),
        getRecentRunsByJob(),
        getSchedulerTimezone(),
        getMaxConcurrentJobs(),
        viewer ? otherTenantQueue(viewer) : NO_OTHER_TENANTS,
    ]);

    const own: ScheduledJobLoad[] = jobs.flatMap((job) => {
        const schedule = (job.schedulePreset?.schedule ?? job.schedule ?? "").trim();
        if (!schedule) return [];
        return [{ id: job.id, name: job.name, schedule, presetId: job.schedulePresetId, estimatedMs: estimateDuration(runsByJob[job.id] ?? []) }];
    });
    const otherTenants: ScheduledJobLoad[] = others.jobs.map((job, index) => ({
        id: `${OTHER_TENANT_JOB}:${index + 1}`,
        name: OTHER_TENANT_JOB_NAME,
        schedule: job.schedule,
        presetId: null,
        estimatedMs: job.estimatedMs,
    }));

    return { timezone, slots, jobs: [...own, ...otherTenants] };
}
