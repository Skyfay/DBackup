/**
 * Execution Retention
 *
 * Two stages of cleanup for the Execution table, which otherwise grows with every run.
 *
 * - Log purge clears the `logs` column of old runs. The log is by far the largest part of a
 *   row, while everything else (status, size, timestamps, metadata, chain bookkeeping) stays
 *   available to History, the dashboard, the chain planner and the Storage Explorer.
 * - History cleanup deletes old rows entirely, but never the ones something still depends on.
 *
 * Both work in small batches. Prisma talks to SQLite over a single connection, so one huge
 * statement would hold back the log writes of every running job until it finished.
 */

import prisma from "@/lib/prisma";
import type { Prisma } from "@prisma/client";
import { subDays } from "date-fns";
import { EXECUTION_HISTORY_KEEP_LATEST, RETENTION_NEVER } from "@/lib/core/data-retention";
import { latestChainSnapshotWhere } from "@/services/backup/chain-query";

/** Runs that are still being written to. Never touched by retention. */
const ACTIVE_STATUSES = ["Pending", "Running"];

export const LOG_PURGE_BATCH_SIZE = 200;
export const HISTORY_DELETE_BATCH_SIZE = 500;

/** The value `logs` holds after a purge. Every reader already treats an empty array as "no entries". */
export const PURGED_LOGS_VALUE = "[]";

/**
 * Clears the log of every finished run that started before the retention window.
 * Returns how many runs were purged.
 */
export async function purgeExecutionLogs(retentionDays: number, now: Date = new Date()): Promise<number> {
    if (retentionDays === RETENTION_NEVER) return 0;
    const cutoff = subDays(now, retentionDays);

    let purged = 0;
    for (;;) {
        const batch = await prisma.execution.findMany({
            where: { startedAt: { lt: cutoff }, status: { notIn: ACTIVE_STATUSES }, logsPurgedAt: null },
            select: { id: true },
            take: LOG_PURGE_BATCH_SIZE,
        });
        if (batch.length === 0) break;

        const result = await prisma.execution.updateMany({
            where: { id: { in: batch.map((row) => row.id) }, status: { notIn: ACTIVE_STATUSES } },
            data: { logs: PURGED_LOGS_VALUE, logsPurgedAt: now },
        });
        purged += result.count;

        // No progress means the same rows would be selected again forever.
        if (result.count === 0 || batch.length < LOG_PURGE_BATCH_SIZE) break;
    }
    return purged;
}

/**
 * Runs that must survive history cleanup even though they are old enough to go.
 *
 * - The newest runs of every job, so the job list, the missing-backup alert and anyone looking
 *   at a rarely scheduled job still see its recent results. Runs without a job (restores,
 *   system tasks, runs of deleted jobs) are grouped by type instead.
 * - Every run of the chain each incremental job is currently extending. The chain planner reads
 *   the chain's full to work out its age, and losing it would force an unplanned full.
 *
 * Only runs older than the cutoff are collected, because newer ones are never candidates anyway.
 */
async function collectProtectedRuns(cutoff: Date): Promise<{ ids: string[]; chainIds: string[] }> {
    const groups = await prisma.execution.groupBy({
        by: ["jobId", "type"],
        where: { startedAt: { lt: cutoff } },
    });

    const ids: string[] = [];
    const chainIds = new Set<string>();

    for (const group of groups) {
        const newest = await prisma.execution.findMany({
            where: { jobId: group.jobId, type: group.type },
            orderBy: { startedAt: "desc" },
            take: EXECUTION_HISTORY_KEEP_LATEST,
            select: { id: true, startedAt: true },
        });
        for (const run of newest) {
            if (run.startedAt < cutoff) ids.push(run.id);
        }
    }

    const jobIds = new Set(groups.map((g) => g.jobId).filter((id): id is string => id !== null));
    for (const jobId of jobIds) {
        const latest = await prisma.execution.findFirst({
            where: latestChainSnapshotWhere(jobId),
            orderBy: { startedAt: "desc" },
            select: { chainId: true },
        });
        if (latest?.chainId) chainIds.add(latest.chainId);
    }

    return { ids, chainIds: [...chainIds] };
}

/**
 * Deletes finished runs that started before the retention window, except the protected ones.
 * Returns how many runs were deleted.
 */
export async function deleteOldExecutions(retentionDays: number, now: Date = new Date()): Promise<number> {
    if (retentionDays === RETENTION_NEVER) return 0;
    const cutoff = subDays(now, retentionDays);

    const { ids: protectedIds, chainIds } = await collectProtectedRuns(cutoff);

    const and: Prisma.ExecutionWhereInput[] = [
        { startedAt: { lt: cutoff } },
        { status: { notIn: ACTIVE_STATUSES } },
    ];
    if (protectedIds.length > 0) and.push({ id: { notIn: protectedIds } });
    if (chainIds.length > 0) and.push({ OR: [{ chainId: null }, { chainId: { notIn: chainIds } }] });
    const where: Prisma.ExecutionWhereInput = { AND: and };

    let deleted = 0;
    for (;;) {
        const batch = await prisma.execution.findMany({
            where,
            select: { id: true },
            take: HISTORY_DELETE_BATCH_SIZE,
        });
        if (batch.length === 0) break;

        const result = await prisma.execution.deleteMany({
            where: { id: { in: batch.map((row) => row.id) }, status: { notIn: ACTIVE_STATUSES } },
        });
        deleted += result.count;

        if (result.count === 0 || batch.length < HISTORY_DELETE_BATCH_SIZE) break;
    }
    return deleted;
}
