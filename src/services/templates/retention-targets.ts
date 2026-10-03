import prisma from "@/lib/prisma";
import { readCron } from "@/lib/core/cron";
import { readPolicy } from "@/services/storage/explorer-plan";
import { storageExplorerService } from "@/services/storage/explorer-service";
import { schedulerTimezone } from "./templates-model";
import type { RetentionTarget, RetentionTargets, TemplateHow } from "./templates-types";

/** The destinations of a policy, or the ones that follow whatever policy is the default. */
export type RetentionScope = { policyId: string } | { followers: true };

interface DestinationRecord {
    retention: string;
    retentionPolicyId: string | null;
}

/** A destination with neither a policy nor a setting of its own, which the default decides. */
function followsDefault(destination: DestinationRecord): boolean {
    return !destination.retentionPolicyId && !readPolicy(destination.retention);
}

/** How a destination comes to the policy the scope names, or null when it does not. */
export function howReached(destination: DestinationRecord, scope: RetentionScope, defaultPolicyId: string | null): TemplateHow | null {
    if ("followers" in scope) return followsDefault(destination) ? "default" : null;
    if (destination.retentionPolicyId === scope.policyId) return "picked";
    return scope.policyId === defaultPolicyId && followsDefault(destination) ? "default" : null;
}

const key = (jobId: string, destinationId: string) => `${jobId}\u0000${destinationId}`;

/**
 * The destinations a change of a retention policy reaches, each with the backups it holds now and
 * when its job runs next, so the dialog can work out what that run removes while the policy is
 * edited. Read from the cached listings, so it never waits for a storage.
 */
export async function getRetentionTargets(scope: RetentionScope, now = new Date()): Promise<RetentionTargets> {
    const [timezone, jobs, defaultPolicy] = await Promise.all([
        schedulerTimezone(),
        prisma.job.findMany({
            orderBy: { name: "asc" },
            select: {
                id: true,
                name: true,
                enabled: true,
                schedule: true,
                backupMode: true,
                schedulePreset: { select: { schedule: true } },
                _count: { select: { sources: true } },
                destinations: {
                    orderBy: { priority: "asc" },
                    select: { configId: true, retention: true, retentionPolicyId: true, config: { select: { name: true, adapterId: true } } },
                },
            },
        }),
        prisma.retentionPolicy.findFirst({ where: { isDefault: true }, select: { id: true } }),
    ]);

    const reached = jobs.flatMap((job) => job.destinations.flatMap((destination) => {
        const how = howReached(destination, scope, defaultPolicy?.id ?? null);
        return how ? [{ job, destination, how }] : [];
    }));
    if (reached.length === 0) return { timezone, targets: [], unlisted: [] };

    const { runs, destinations } = await storageExplorerService.getBackupsWithDestinations();
    const held = new Map<string, RetentionTarget["backups"]>();
    for (const run of runs) {
        for (const copy of run.copies) {
            if (copy.state !== "stored" || !copy.file) continue;
            const backups = held.get(key(run.jobKey, copy.destinationId)) ?? [];
            backups.push({ at: copy.file.createdAt ?? copy.file.lastModified, locked: copy.file.locked === true, chainId: copy.file.chain?.id ?? null });
            held.set(key(run.jobKey, copy.destinationId), backups);
        }
    }

    const listed = new Set(destinations.filter((destination) => destination.listedAt !== null).map((destination) => destination.id));
    const targets: RetentionTarget[] = reached.map(({ job, destination, how }) => {
        const next = job.enabled ? readCron(job.schedulePreset?.schedule ?? job.schedule, timezone)?.nextRun(now) : null;
        return {
            jobId: job.id,
            jobName: job.name,
            destinationId: destination.configId,
            destinationName: destination.config.name,
            adapterId: destination.config.adapterId,
            how,
            nextRun: next ? next.toISOString() : null,
            chains: job.backupMode === "INCREMENTAL" && job._count.sources > 0,
            backups: held.get(key(job.id, destination.configId)) ?? [],
        };
    });
    const unlisted = [...new Set(targets.map((target) => target.destinationId))].filter((id) => !listed.has(id));

    return { timezone, targets, unlisted };
}
