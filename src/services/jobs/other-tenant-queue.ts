import prisma from "@/lib/prisma";
import { explicitScope, runAsSystem } from "@/lib/tenant/context";
import { requestScope } from "@/lib/tenant/current";
import { getRecentRunsByJob } from "@/services/dashboard/aggregates";
import type { RunSummary } from "@/services/dashboard/types";
import { OTHER_TENANT_JOB } from "./job-timeline-types";

/**
 * The queue is one for every tenant (`processQueue`), so the runs of one tenant wait for the runs of
 * the others. A plan of the queue that a tenant reads is played through with the runs of every
 * tenant, read here across tenants on purpose, and names those of the others only as
 * `OTHER_TENANT_JOB`, never by their name or id.
 */

/**
 * The tenant that reads a plan of the queue now. Null where the plan holds the jobs of every tenant
 * already, like All tenants and the system scope, and for code of no tenant, whose reads fail anyway.
 */
export async function queueViewer(): Promise<string | null> {
    const scope = explicitScope() ?? (await requestScope());
    return scope?.kind === "tenant" ? scope.tenantId : null;
}

/** A job of another tenant with a schedule. Its id stays on the server. */
export interface OtherTenantJob {
    id: string;
    /** The effective expression, the preset's when the job follows one. */
    schedule: string;
    /** Its last runs, which tell how long a run takes. */
    runs: RunSummary[];
}

/** A run of another tenant that runs or waits now. */
export interface OtherTenantRun {
    id: string;
    jobId: string;
    status: string;
    startedAt: Date;
}

export interface OtherTenantQueue {
    jobs: OtherTenantJob[];
    live: OtherTenantRun[];
}

export const NO_OTHER_TENANTS: OtherTenantQueue = { jobs: [], live: [] };

/** The enabled jobs with a schedule and the runs that run or wait now of every tenant but this one. */
export function otherTenantQueue(tenantId: string): Promise<OtherTenantQueue> {
    return runAsSystem(async () => {
        const [jobs, live, history] = await Promise.all([
            prisma.job.findMany({
                where: { tenantId: { not: tenantId }, enabled: true },
                select: { id: true, schedule: true, schedulePreset: { select: { schedule: true } } },
            }),
            prisma.execution.findMany({
                where: { tenantId: { not: tenantId }, type: "Backup", jobId: { not: null }, status: { in: ["Running", "Pending"] } },
                orderBy: { startedAt: "asc" },
                select: { id: true, jobId: true, status: true, startedAt: true },
            }),
            // The runs of every tenant, cached once for the system scope and All tenants alike.
            getRecentRunsByJob(),
        ]);
        return {
            jobs: jobs.flatMap((job) => {
                const schedule = (job.schedulePreset?.schedule ?? job.schedule ?? "").trim();
                return schedule ? [{ id: job.id, schedule, runs: history[job.id] ?? [] }] : [];
            }),
            live: live.flatMap((run) => (run.jobId ? [{ id: run.id, jobId: run.jobId, status: run.status, startedAt: run.startedAt }] : [])),
        };
    });
}

/** The ids of the jobs of other tenants in a plan, the ones `anonymousWaits` hides. */
export function otherJobIds(queue: OtherTenantQueue): Set<string> {
    return new Set([...queue.jobs.map((job) => job.id), ...queue.live.map((run) => run.jobId)]);
}

/** The jobs a run waits for, with every job of another tenant as one `OTHER_TENANT_JOB` at the end. */
export function anonymousWaits(waitsFor: string[], others: Set<string>): string[] {
    const own = waitsFor.filter((jobId) => !others.has(jobId));
    return own.length === waitsFor.length ? waitsFor : [...own, OTHER_TENANT_JOB];
}

export interface Span {
    from: number;
    to: number;
}

export interface Stretch extends Span {
    count: number;
}

/**
 * How many of `others` run or wait at each moment one of `own` does, as stretches of one count.
 * Moments without a run of `own` are left out, so a tenant learns how full the queue is only where
 * its own runs share it.
 */
export function demandBeside(others: Span[], own: Span[]): Stretch[] {
    const events: [time: number, other: number, mine: number][] = [];
    for (const span of others) if (span.to > span.from) events.push([span.from, 1, 0], [span.to, -1, 0]);
    for (const span of own) if (span.to > span.from) events.push([span.from, 0, 1], [span.to, 0, -1]);
    events.sort((a, b) => a[0] - b[0]);

    const stretches: Stretch[] = [];
    let other = 0;
    let mine = 0;
    let since = Number.NEGATIVE_INFINITY;
    for (let index = 0; index < events.length;) {
        const time = events[index][0];
        if (other > 0 && mine > 0 && time > since) {
            const last = stretches[stretches.length - 1];
            if (last && last.count === other && last.to === since) last.to = time;
            else stretches.push({ from: since, to: time, count: other });
        }
        for (; index < events.length && events[index][0] === time; index++) {
            other += events[index][1];
            mine += events[index][2];
        }
        since = time;
    }
    return stretches;
}
