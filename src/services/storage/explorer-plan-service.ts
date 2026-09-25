import prisma from "@/lib/prisma";
import type { RetentionConfiguration } from "@/lib/core/retention";
import { logger } from "@/lib/logging/logger";
import { wrapError } from "@/lib/logging/errors";
import { storageExplorerService } from "./explorer-service";
import { MISSED_DAYS, PLAN_DAYS, markFulls, missedDays, readPolicy, runsBetween, simulateRetention, toFileInfo } from "./explorer-plan";
import type { AgedOut, BackupRun, ExplorerPlan, JobPlan } from "./explorer-types";

const log = logger.child({ service: "StorageExplorerPlanService" });

const DAY_MS = 86_400_000;
const NONE: RetentionConfiguration = { mode: "NONE" };

interface PlanDestination {
    configId: string;
    retention: string;
    retentionPolicyId: string | null;
    retentionPolicy: { config: string } | null;
}

/**
 * What the schedules of the jobs plan for the next days and what they missed, for the timeline of
 * the Backups tab. The runs come from each schedule the way the scheduler reads it, whether one
 * starts a new chain from the rule of the chain planner, and what the retention removes after it
 * from the retention of the runner, applied to the backups the destinations hold now.
 */
export class StorageExplorerPlanService {
    async getPlan(now = new Date()): Promise<ExplorerPlan> {
        const [timezone, jobs, fallback, backups] = await Promise.all([
            this.timezone(),
            prisma.job.findMany({
                select: {
                    id: true,
                    enabled: true,
                    schedule: true,
                    createdAt: true,
                    updatedAt: true,
                    backupMode: true,
                    fullEveryDays: true,
                    schedulePreset: { select: { schedule: true } },
                    sources: { select: { id: true } },
                    destinations: {
                        select: { configId: true, retention: true, retentionPolicyId: true, retentionPolicy: { select: { config: true } } },
                        orderBy: { priority: "asc" },
                    },
                },
            }),
            prisma.retentionPolicy.findFirst({ where: { isDefault: true }, select: { config: true } }),
            storageExplorerService.getBackups(),
        ]);

        const nowMs = now.getTime();
        const scheduled = jobs.filter((job) => job.enabled && scheduleOf(job));
        const chained = scheduled.filter((job) => job.backupMode === "INCREMENTAL" && job.sources.length > 0);
        const [started, chainStarts] = await Promise.all([
            this.startedSince(scheduled.map((job) => job.id), nowMs - MISSED_DAYS * DAY_MS),
            this.chainStarts(chained.map((job) => job.id)),
        ]);
        const runsByJob = new Map<string, BackupRun[]>();
        for (const run of backups.runs) {
            const list = runsByJob.get(run.jobKey);
            if (list) list.push(run);
            else runsByJob.set(run.jobKey, [run]);
        }

        const plans: JobPlan[] = jobs.map((job) => {
            const schedule = scheduleOf(job);
            const first = job.destinations[0];
            const base: JobPlan = {
                jobKey: job.id,
                schedule,
                enabled: job.enabled,
                createdAt: job.createdAt.toISOString(),
                retention: first ? configOf(first, fallback?.config ?? null) : null,
                planned: [],
                missed: [],
                truncated: false,
            };
            if (!job.enabled || !schedule) return base;

            const { times, truncated } = runsBetween(schedule, timezone, nowMs, nowMs + (PLAN_DAYS + 1) * DAY_MS);
            const chains = chained.includes(job);
            const fulls = chains ? markFulls(times, chainStarts.get(job.id) ?? null, job.fullEveryDays) : [];
            const runs = times.map((at, index) => ({ at, full: chains ? fulls[index] : undefined }));
            const aged = job.destinations.map((destination) => {
                const files = (runsByJob.get(job.id) ?? []).flatMap((run) => run.copies
                    .filter((copy) => copy.destinationId === destination.configId && copy.state === "stored" && copy.file)
                    .map((copy) => toFileInfo(copy.file!)));
                return simulateRetention(files, runs, policyOf(destination, fallback?.config ?? null), timezone, chains);
            });

            const since = Math.max(job.createdAt.getTime(), job.updatedAt.getTime(), nowMs - MISSED_DAYS * DAY_MS);
            return {
                ...base,
                truncated,
                planned: runs.map((run, index) => {
                    const agesOut: AgedOut[] = job.destinations.flatMap((destination, at) => {
                        const removed = aged[at][index];
                        return removed ? [{ destinationId: destination.configId, count: removed.count, oldest: new Date(removed.oldest).toISOString() }] : [];
                    });
                    return {
                        at: new Date(run.at).toISOString(),
                        ...(chains ? { full: run.full } : {}),
                        ...(agesOut.length > 0 ? { agesOut } : {}),
                    };
                }),
                missed: missedDays(schedule, timezone, since, nowMs, started.get(job.id) ?? []),
            };
        });

        return { timezone, days: PLAN_DAYS, jobs: plans };
    }

    /** The time zone the scheduler reads the schedules in, UTC unless the settings name another. */
    private async timezone(): Promise<string> {
        const setting = await prisma.systemSetting.findUnique({ where: { key: "system.timezone" } });
        return setting?.value || "UTC";
    }

    /** When the runs of these jobs started since then, by the schedule or by hand, per job. */
    private async startedSince(jobIds: string[], since: number): Promise<Map<string, number[]>> {
        const byJob = new Map<string, number[]>();
        if (jobIds.length === 0) return byJob;
        const rows = await prisma.execution.findMany({
            where: { jobId: { in: jobIds }, type: "Backup", startedAt: { gte: new Date(since) } },
            select: { jobId: true, startedAt: true },
        });
        for (const row of rows) {
            if (!row.jobId) continue;
            const list = byJob.get(row.jobId);
            if (list) list.push(row.startedAt.getTime());
            else byJob.set(row.jobId, [row.startedAt.getTime()]);
        }
        return byJob;
    }

    /** When the chain each of these jobs builds on now began: the start of its newest full backup that made it. */
    private async chainStarts(jobIds: string[]): Promise<Map<string, number>> {
        const starts = new Map<string, number>();
        await Promise.all(jobIds.map(async (jobId) => {
            try {
                const full = await prisma.execution.findFirst({
                    where: { jobId, backupType: "Full", status: { in: ["Success", "Partial"] } },
                    orderBy: { startedAt: "desc" },
                    select: { startedAt: true },
                });
                if (full) starts.set(jobId, full.startedAt.getTime());
            } catch (error: unknown) {
                log.warn("Could not read the chain of a job", { jobId }, wrapError(error));
            }
        }));
        return starts;
    }
}

/** The schedule the scheduler runs, a preset's when the job follows one. */
function scheduleOf(job: { schedule: string; schedulePreset: { schedule: string } | null }): string | null {
    return (job.schedulePreset?.schedule ?? job.schedule ?? "").trim() || null;
}

/**
 * The policy of a destination as the runner resolves it: its template, else the inline setting a
 * job saved before templates existed, else the default template. A template that is gone keeps all.
 */
function configOf(destination: PlanDestination, fallback: string | null): string | null {
    if (destination.retentionPolicyId) return destination.retentionPolicy?.config ?? null;
    if (readPolicy(destination.retention)) return destination.retention;
    return fallback;
}

function policyOf(destination: PlanDestination, fallback: string | null): RetentionConfiguration {
    return readPolicy(configOf(destination, fallback)) ?? NONE;
}

export const storageExplorerPlanService = new StorageExplorerPlanService();
