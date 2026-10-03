"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { checkPermission, getCurrentUserWithGroup, getUserPermissions } from "@/lib/auth/access-control";
import { TRASH_ADMIN_PERMISSION } from "@/lib/auth/permissions";
import { AUDIT_ACTIONS, AUDIT_RESOURCES, type AuditResource } from "@/lib/core/audit-types";
import { BulkIdsSchema } from "@/lib/core/bulk-schema";
import { AuthenticationError, getErrorMessage, wrapError } from "@/lib/logging/errors";
import { logger } from "@/lib/logging/logger";
import { auditService } from "@/services/audit-service";
import { latestTrashIds, mayHandle, purgeFromTrash, restoreFromTrash, trashEntries, type TrashViewer } from "@/services/trash/trash-service";
import { TRASH_KINDS, isTrashKind, type TrashKind, type TrashRestoreResult } from "@/services/trash/trash-types";

const log = logger.child({ action: "trash" });

/** The audit resource of each kind of deleted record. */
const RESOURCES: Record<TrashKind, AuditResource> = {
    encryptionKey: AUDIT_RESOURCES.VAULT,
    credential: AUDIT_RESOURCES.CREDENTIAL,
    connection: AUDIT_RESOURCES.ADAPTER,
    job: AUDIT_RESOURCES.JOB,
    user: AUDIT_RESOURCES.USER,
};

/**
 * How long Undo works after a delete. The toast shows for seconds, this leaves room for a slow
 * answer, and anything older is restored under Settings by someone who may change the settings.
 */
const UNDO_WINDOW_MS = 5 * 60 * 1000;

const GONE = "It is not in Recently deleted any more.";

export type TrashActionResult<T> = { success: true; data: T } | { success: false; error: string };

type Entry = Omit<Awaited<ReturnType<typeof trashEntries>>[number], "kind"> & { kind: TrashKind };

type Viewer = { id: string; group: { name: string } | null };

/** The viewer with the permissions each entry is checked against, the one it was deleted with. */
function trashViewer(user: Viewer, permissions: string[]): TrashViewer {
    return { permissions, isSuperAdmin: user.group?.name === "SuperAdmin" };
}

/**
 * The entries of these ids the viewer may restore or delete. Reading them has to come before the
 * check, since the check depends on them, and one the viewer may not handle counts as gone, so the
 * answer tells nothing about it.
 */
async function allowed(viewer: TrashViewer, ids: string[]): Promise<Entry[]> {
    return (await trashEntries(ids)).flatMap((entry) => (isTrashKind(entry.kind) && mayHandle(viewer, entry) ? [{ ...entry, kind: entry.kind }] : []));
}

/** Writes an entry for every record that came back, and refreshes the pages that list them. */
async function recordRestored(userId: string, entries: Entry[], result: TrashRestoreResult) {
    const before = new Map(entries.map((entry) => [entry.id, entry.name]));
    for (const restored of result.restored) {
        const originalName = before.get(restored.id);
        await auditService.log(
            userId,
            AUDIT_ACTIONS.RESTORE,
            RESOURCES[restored.kind],
            { name: restored.name, action: "trash_restore", ...(originalName && originalName !== restored.name ? { originalName } : {}) },
            restored.recordId
        );
    }
    // A record comes back on its page, wherever it was listed.
    if (result.restored.length > 0) revalidatePath("/dashboard", "layout");
}

/** Reports the ids that were asked for and are not among the entries the viewer may handle. */
function missing(ids: string[], entries: Entry[]): TrashRestoreResult["failed"] {
    const found = new Set(entries.map((entry) => entry.id));
    return ids.filter((id) => !found.has(id)).map((id) => ({ id, name: id, error: GONE }));
}

const RestoreSchema = z.object({
    ids: BulkIdsSchema,
    /** Another name for a single record whose name was taken, or another email for a user. */
    newName: z.string().trim().min(1).max(100).optional(),
});

/**
 * Brings deleted records back under their own ids. A name taken meanwhile comes back as a conflict.
 * Needs the right to change the settings, and for each record the right to change its kind.
 */
export async function restoreDeletedAction(ids: string[], newName?: string): Promise<TrashActionResult<TrashRestoreResult>> {
    const user = await checkPermission(TRASH_ADMIN_PERMISSION);
    const viewer = trashViewer(user, await getUserPermissions());
    const parsed = RestoreSchema.safeParse({ ids, newName });
    if (!parsed.success) return { success: false, error: "Invalid request" };

    try {
        const entries = await allowed(viewer, parsed.data.ids);
        if (parsed.data.newName && entries.length === 1 && entries[0].kind === "user" && !z.string().email().safeParse(parsed.data.newName).success) {
            return { success: false, error: "An account needs a valid email." };
        }
        const result = entries.length > 0
            ? await restoreFromTrash(entries.map((entry) => entry.id), { newName: parsed.data.newName })
            : { restored: [], conflicts: [], failed: [] };
        result.failed.push(...missing(parsed.data.ids, entries));
        await recordRestored(user.id, entries, result);
        return { success: true, data: result };
    } catch (error: unknown) {
        log.error("Restoring deleted records failed", {}, wrapError(error));
        return { success: false, error: getErrorMessage(error) || "Nothing could be restored." };
    }
}

const UndoSchema = z.object({
    kind: z.enum(TRASH_KINDS),
    recordIds: BulkIdsSchema,
});

/**
 * Undo right after a delete: brings back what the viewer just deleted, the newest deleted record of
 * each id. Only their own delete of the last minutes, with the right to change the kind, so it
 * needs no right to change the settings and is no way around it.
 */
export async function undoDeleteAction(kind: TrashKind, recordIds: string[]): Promise<TrashActionResult<TrashRestoreResult>> {
    const permissions = await getUserPermissions();
    const user = await getCurrentUserWithGroup();
    if (!user) throw new AuthenticationError();
    const parsed = UndoSchema.safeParse({ kind, recordIds });
    if (!parsed.success) return { success: false, error: "Invalid request" };

    try {
        const since = Date.now() - UNDO_WINDOW_MS;
        const entries = (await allowed(trashViewer(user, permissions), await latestTrashIds(parsed.data.kind, parsed.data.recordIds)))
            .filter((entry) => entry.deletedById === user.id && entry.deletedAt.getTime() >= since);
        if (entries.length === 0) return { success: false, error: "It can no longer be undone. Someone who may change the settings restores it under Settings, Recently deleted." };
        const result = await restoreFromTrash(entries.map((entry) => entry.id));
        await recordRestored(user.id, entries, result);
        return { success: true, data: result };
    } catch (error: unknown) {
        log.error("Undoing a delete failed", { kind: parsed.data.kind }, wrapError(error));
        return { success: false, error: getErrorMessage(error) || "The delete could not be undone." };
    }
}

/**
 * Deletes records from Recently deleted for good, before their time is up, and answers with the ids
 * that went. Needs the right to change the settings, and for each record the right to change its kind.
 */
export async function purgeDeletedAction(ids: string[]): Promise<TrashActionResult<{ purged: string[] }>> {
    const user = await checkPermission(TRASH_ADMIN_PERMISSION);
    const viewer = trashViewer(user, await getUserPermissions());
    const parsed = BulkIdsSchema.safeParse(ids);
    if (!parsed.success) return { success: false, error: "Invalid request" };

    try {
        const entries = await allowed(viewer, parsed.data);
        if (entries.length === 0) return { success: false, error: GONE };
        await purgeFromTrash(entries.map((entry) => entry.id));
        for (const entry of entries) {
            await auditService.log(user.id, AUDIT_ACTIONS.DELETE, RESOURCES[entry.kind], { name: entry.name, action: "trash_purge", permanently: true }, entry.recordId);
        }
        revalidatePath("/dashboard/settings");
        return { success: true, data: { purged: entries.map((entry) => entry.id) } };
    } catch (error: unknown) {
        log.error("Deleting records from Recently deleted failed", {}, wrapError(error));
        return { success: false, error: getErrorMessage(error) || "Nothing could be deleted." };
    }
}
