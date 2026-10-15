import { formatInTimeZone, fromZonedTime } from "date-fns-tz";
import prisma from "@/lib/prisma";
import { NotFoundError, ValidationError } from "@/lib/logging/errors";
import { runAsSystem, runAsTenant } from "@/lib/tenant/context";
import type { DatabasePlace } from "@/lib/tenant/database-owner";
import { backupService } from "@/services/backup/backup-service";
import { getTimezone } from "@/services/system/system-settings-service";
import { holdingNow, placeKey } from "./shared-places";

/**
 * Backups a customer starts of a database given to them, where the tenant of the server allows it
 * with a number a day. Such a backup runs the job of that tenant that backs the server up, for this
 * one database alone, and the run belongs to that tenant like every run of the job. The customer
 * follows it through `sharedBackupRun`, which tells its state and nothing else of the run.
 *
 * A day is a day in the time zone of the instance, the one its schedules run in, so the count starts
 * again at midnight there.
 */

/** What the tab Shared with you shows of backups on demand for one database. */
export interface SharedOnDemand {
    perDay: number;
    usedToday: number;
    /** A backup started today that has not ended yet. */
    active: { requestId: string; state: "queued" | "running" } | null;
}

export type SharedRunState = "queued" | "running" | "done" | "failed" | "cancelled" | "gone";

export interface SharedRunStatus {
    state: SharedRunState;
    databaseName: string;
    startedAt: string | null;
    endedAt: string | null;
}

/** The run of a backup a customer started, and what both sides write into their audit logs. */
export interface StartedSharedBackup {
    requestId: string;
    executionId: string;
    databaseName: string;
    jobId: string;
    jobName: string;
    /** The tenant of the server, whose run it is. */
    serverTenantId: string;
    customerName: string;
}

/** Midnight of the day of `now` in the time zone of the instance. */
export async function dayStart(now: Date): Promise<Date> {
    const timezone = await getTimezone().catch(() => "UTC");
    return fromZonedTime(`${formatInTimeZone(now, timezone, "yyyy-MM-dd")}T00:00:00`, timezone);
}

const RUN_STATES: Record<string, SharedRunState> = { Pending: "queued", Running: "running", Success: "done", Partial: "done", Failed: "failed", Cancelled: "cancelled" };

/** What backups on demand allow and did today, by the key of each database that allows them. Runs in the system scope. */
export async function onDemandStates(tenantId: string, places: readonly (DatabasePlace & { perDay: number })[], now: Date): Promise<Map<string, SharedOnDemand>> {
    const states = new Map<string, SharedOnDemand>();
    if (places.length === 0) return states;
    const since = await dayStart(now);
    const requests = await prisma.sharedBackupRequest.findMany({
        where: { tenantId, createdAt: { gte: since, lte: now }, sourceId: { in: [...new Set(places.map((place) => place.sourceId))] } },
        select: { id: true, sourceId: true, databaseName: true, executionId: true, createdAt: true },
        orderBy: { createdAt: "desc" },
    });
    const runs = new Map((await prisma.execution.findMany({
        where: { id: { in: requests.map((request) => request.executionId) }, status: { in: ["Pending", "Running"] } },
        select: { id: true, status: true },
    })).map((run) => [run.id, run.status]));

    for (const place of places) {
        const own = requests.filter((request) => request.sourceId === place.sourceId && request.databaseName === place.databaseName);
        // A request without its run yet is being started right now.
        const open = own.find((request) => !request.executionId || runs.has(request.executionId));
        states.set(placeKey(place), {
            perDay: place.perDay,
            usedToday: own.length,
            active: open ? { requestId: open.id, state: runs.get(open.executionId) === "Running" ? "running" : "queued" } : null,
        });
    }
    return states;
}

/** The job of the server that backs the database up: one that names it or backs up every database, an enabled one first, the oldest of them. */
async function jobFor(sourceId: string, databaseName: string) {
    const jobs = await prisma.job.findMany({ where: { sourceId }, select: { id: true, name: true, enabled: true, databases: true, tenantId: true }, orderBy: { createdAt: "asc" } });
    const covering = jobs.filter((job) => {
        try {
            const picked: unknown = JSON.parse(job.databases || "[]");
            return !Array.isArray(picked) || picked.length === 0 || picked.includes(databaseName);
        } catch {
            return true;
        }
    });
    return { any: jobs.length > 0, job: covering.find((job) => job.enabled) ?? covering[0] ?? null };
}

/**
 * Starts a backup of one database a customer holds now, if the tenant of the server allows it and
 * the day has room. Refuses with a ValidationError that says why: the database is not theirs now,
 * the server is gone, backups on demand are off, the day's backups are used up, the server has no
 * job, or that job runs right now.
 */
export async function requestSharedBackup(tenantId: string, user: { id: string; name: string }, place: DatabasePlace, now = new Date()): Promise<StartedSharedBackup> {
    const checked = await runAsSystem(async () => {
        const [customer, server] = await Promise.all([
            prisma.tenant.findUnique({ where: { id: tenantId }, select: { name: true } }),
            prisma.sharedServer.findUnique({ where: { id: place.sourceId }, select: { tenantId: true } }),
        ]);
        const holding = await holdingNow(tenantId, place, now);
        if (!server || !holding.owner) throw new ValidationError(`${place.databaseName} is no longer yours, so you cannot back it up.`);
        const provider = (await prisma.tenant.findUnique({ where: { id: server.tenantId }, select: { name: true } }))?.name ?? "The provider";
        if (!holding.live) throw new ValidationError(`The server of ${place.databaseName} was deleted, its backups can only be downloaded.`);
        if (holding.perDay === null) throw new ValidationError(`Backups on demand are off for ${place.databaseName}. ${provider} can switch them on.`);

        const { any, job } = await jobFor(place.sourceId, place.databaseName);
        if (!job) {
            throw new ValidationError(any
                ? `No job of ${provider} backs up ${place.databaseName}, so a backup cannot start. ${provider} can add it to the job.`
                : `${provider} has no job for the server of ${place.databaseName}, so a backup cannot start.`);
        }
        const running = await prisma.execution.findFirst({ where: { jobId: job.id, status: { in: ["Pending", "Running"] } }, select: { id: true } });
        if (running) throw new ValidationError(`A backup of the server of ${place.databaseName} runs right now. Try again once it is done.`);

        // Counted with its own request, so two clicks at once cannot both take the last one of the day.
        const since = await dayStart(now);
        const request = await prisma.sharedBackupRequest.create({
            data: { tenantId, sourceId: place.sourceId, databaseName: place.databaseName, executionId: "", requestedById: user.id, createdAt: now },
        });
        const used = await prisma.sharedBackupRequest.count({
            where: { tenantId, sourceId: place.sourceId, databaseName: place.databaseName, createdAt: { gte: since, lte: now }, id: { not: request.id } },
        });
        if (used >= holding.perDay) {
            await prisma.sharedBackupRequest.delete({ where: { id: request.id } });
            throw new ValidationError(`${used} ${used === 1 ? "backup" : "backups"} of ${place.databaseName} started today, the most ${provider} allows a day. The next one is possible tomorrow.`);
        }
        return { request, job, customerName: customer?.name ?? "A tenant", serverTenantId: job.tenantId };
    });

    const label = `${checked.customerName} · ${user.name}`;
    try {
        // A run of the job's own tenant, for this one database, the job itself stays as it is.
        const run = await runAsTenant(checked.serverTenantId, () =>
            backupService.executeJob(checked.job.id, { type: "Manual", label }, { databases: [place.databaseName] }));
        await runAsSystem(() => prisma.sharedBackupRequest.update({ where: { id: checked.request.id }, data: { executionId: run.executionId } }));
        return {
            requestId: checked.request.id,
            executionId: run.executionId,
            databaseName: place.databaseName,
            jobId: checked.job.id,
            jobName: checked.job.name,
            serverTenantId: checked.serverTenantId,
            customerName: checked.customerName,
        };
    } catch (error: unknown) {
        await runAsSystem(() => prisma.sharedBackupRequest.delete({ where: { id: checked.request.id } })).catch(() => undefined);
        throw error;
    }
}

/** Where a backup a customer started stands now. Only its state and times, never the run itself. */
export function sharedBackupRun(tenantId: string, requestId: string): Promise<SharedRunStatus> {
    return runAsSystem(async () => {
        const request = await prisma.sharedBackupRequest.findFirst({ where: { id: requestId, tenantId }, select: { executionId: true, databaseName: true } });
        if (!request) throw new NotFoundError("Backup", requestId);
        const run = request.executionId
            ? await prisma.execution.findUnique({ where: { id: request.executionId }, select: { status: true, startedAt: true, endedAt: true } })
            : null;
        return {
            // A request without its run yet is being started right now.
            state: !request.executionId ? "queued" : run ? RUN_STATES[run.status] ?? "running" : "gone",
            databaseName: request.databaseName,
            startedAt: run?.startedAt.toISOString() ?? null,
            endedAt: run?.endedAt?.toISOString() ?? null,
        };
    });
}
