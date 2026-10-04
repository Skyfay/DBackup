/**
 * Recently deleted: keys, saved logins, connections, jobs and users stay here as snapshots after a
 * delete, until they are restored, deleted for good, or Clean old data removes them once their time
 * under Data retention is up. See `trash-snapshot.ts` and `trash-restore.ts`.
 */

import prisma from "@/lib/prisma";
import { getDataRetentionSetting, parseRetentionDays } from "@/lib/core/data-retention";
import { ConflictError, getErrorMessage, wrapError } from "@/lib/logging/errors";
import { logger } from "@/lib/logging/logger";
import { restoreSnapshot } from "./trash-restore";
import { isTrashKind, type TrashKind, type TrashRestoreResult, type TrashRow } from "./trash-types";

const log = logger.child({ service: "TrashService" });

const DAY_MS = 24 * 60 * 60 * 1000;

/** Who looks at Recently deleted: only what they may change shows. */
export interface TrashViewer {
    permissions: readonly string[];
    isSuperAdmin: boolean;
}

/** Whether a viewer may restore or purge a deleted record: its permission, and SuperAdmin for a SuperAdmin's account. */
export function mayHandle(viewer: TrashViewer, entry: { permission: string; superAdminOnly: boolean }): boolean {
    if (viewer.isSuperAdmin) return true;
    return !entry.superAdminOnly && viewer.permissions.includes(entry.permission);
}

/** How long a deleted record stays, from Data retention. */
export async function getTrashDays(): Promise<number> {
    const setting = getDataRetentionSetting("deletedItems");
    if (!setting) return 30;
    const row = await prisma.systemSetting.findUnique({ where: { key: setting.key }, select: { value: true } });
    return parseRetentionDays(row?.value, setting);
}

/** Everything in Recently deleted the viewer may change, newest first. */
export async function listTrash(viewer: TrashViewer): Promise<TrashRow[]> {
    const [rows, days] = await Promise.all([
        prisma.deletedRecord.findMany({
            orderBy: { deletedAt: "desc" },
            select: { id: true, kind: true, recordId: true, name: true, detail: true, deletedAt: true, deletedByName: true, permission: true, superAdminOnly: true },
        }),
        getTrashDays(),
    ]);
    return rows.flatMap((row) => {
        if (!isTrashKind(row.kind) || !mayHandle(viewer, row)) return [];
        return [{
            id: row.id,
            kind: row.kind,
            recordId: row.recordId,
            name: row.name,
            detail: row.detail,
            deletedAt: row.deletedAt.toISOString(),
            deletedByName: row.deletedByName,
            expiresAt: new Date(row.deletedAt.getTime() + days * DAY_MS).toISOString(),
        }];
    });
}

/** The deleted records of these ids, for the permission check of an action. */
export async function trashEntries(ids: string[]) {
    return prisma.deletedRecord.findMany({
        where: { id: { in: ids } },
        select: { id: true, kind: true, recordId: true, name: true, permission: true, superAdminOnly: true, deletedById: true, deletedAt: true },
    });
}

/** The newest deleted record of each of these records, for Undo right after a delete. */
export async function latestTrashIds(kind: TrashKind, recordIds: string[]): Promise<string[]> {
    const rows = await prisma.deletedRecord.findMany({
        where: { kind, recordId: { in: recordIds } },
        orderBy: { deletedAt: "desc" },
        select: { id: true, recordId: true },
    });
    const newest = new Map<string, string>();
    for (const row of rows) if (!newest.has(row.recordId)) newest.set(row.recordId, row.id);
    return [...newest.values()];
}

/**
 * Restores deleted records under their own ids, each in a transaction of its own. A name someone took
 * meanwhile comes back as a conflict, and `newName` restores a single record under another one.
 */
export async function restoreFromTrash(ids: string[], options: { newName?: string } = {}): Promise<TrashRestoreResult> {
    const result: TrashRestoreResult = { restored: [], conflicts: [], failed: [] };
    const newName = ids.length === 1 ? options.newName?.trim() || undefined : undefined;

    for (const id of ids) {
        const entry = await prisma.deletedRecord.findUnique({ where: { id } });
        if (!entry || !isTrashKind(entry.kind)) {
            result.failed.push({ id, name: entry?.name ?? id, error: "It is gone from Recently deleted." });
            continue;
        }
        const kind = entry.kind;
        try {
            const restored = await prisma.$transaction(async (tx) => {
                const done = await restoreSnapshot(tx, kind, JSON.parse(entry.data), newName);
                await tx.deletedRecord.delete({ where: { id } });
                return done;
            });
            result.restored.push({ id, recordId: entry.recordId, kind, name: restored.name, notes: restored.notes });
        } catch (error: unknown) {
            if (error instanceof ConflictError) {
                result.conflicts.push({ id, kind, name: entry.name, message: error.message });
            } else {
                log.error("Restoring a deleted record failed", { id, kind }, wrapError(error));
                result.failed.push({ id, name: entry.name, error: getErrorMessage(error) || "It could not be restored." });
            }
        }
    }

    // A restored job runs on its schedule again.
    if (result.restored.some((entry) => entry.kind === "job")) {
        import("@/lib/server/scheduler")
            .then(({ scheduler }) => scheduler.refresh())
            .catch((error: unknown) => log.error("Scheduler refresh failed after a job was restored", {}, wrapError(error)));
    }
    return result;
}

/** Deletes records from Recently deleted for good, and answers with how many went. */
export async function purgeFromTrash(ids: string[]): Promise<number> {
    const { count } = await prisma.deletedRecord.deleteMany({ where: { id: { in: ids } } });
    return count;
}

/** Removes what stayed longer than its time, for Clean old data. */
export async function cleanTrash(days: number): Promise<number> {
    const { count } = await prisma.deletedRecord.deleteMany({ where: { deletedAt: { lt: new Date(Date.now() - days * DAY_MS) } } });
    return count;
}
