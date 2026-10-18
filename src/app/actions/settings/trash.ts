"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { checkPermission, getViewer, getUserPermissions } from "@/lib/auth/access-control";
import { emailClaimScope } from "@/lib/auth/account-access";
import { TRASH_ADMIN_PERMISSION } from "@/lib/auth/permissions";
import type { PlatformReach } from "@/lib/auth/platform-group-caps";
import { AUDIT_ACTIONS, AUDIT_RESOURCES, type AuditResource } from "@/lib/core/audit-types";
import { BulkIdsSchema } from "@/lib/core/bulk-schema";
import { AuthenticationError, getErrorMessage, wrapError } from "@/lib/logging/errors";
import { logger } from "@/lib/logging/logger";
import { auditService } from "@/services/audit-service";
import { claimedEmailRefusal } from "@/services/sso/email-domain-claims";
import { latestAccountEntries, latestTrashIds, mayHandle, mayRestoreAccount, purgeFromTrash, restoreFromTrash, trashAccounts, trashEntries, type TrashViewer } from "@/services/trash/trash-service";
import { TRASH_KINDS, isTrashKind, type TrashKind, type TrashRestoreResult } from "@/services/trash/trash-types";
import { userService } from "@/services/user/user-service";

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
 * answer, and anything older is restored under Settings › Recently deleted by someone who may
 * change the tenant settings.
 */
const UNDO_WINDOW_MS = 5 * 60 * 1000;

const GONE = "It is not in Recently deleted any more.";

/** All tenants only reads, a deleted record comes back or goes for good in its own tenant. */
const IN_ITS_TENANT = "Open the tenant of the entry to restore it or delete it for good.";

export type TrashActionResult<T> = { success: true; data: T } | { success: false; error: string };

type Entry = Omit<Awaited<ReturnType<typeof trashEntries>>[number], "kind"> & { kind: TrashKind };

type Viewer = { id: string; isPlatformAdmin: boolean };

/** The viewer with the permissions each entry is checked against, the one it was deleted with. */
function trashViewer(user: Viewer, permissions: string[]): TrashViewer {
    return { permissions, isPlatformAdmin: user.isPlatformAdmin };
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

/**
 * The accounts among the entries that may not come back with their email, under their own or under
 * `newName`, since the provider of another tenant claims its domain. Only someone who manages the
 * accounts of the platform gives such an email, someone of a platform group of some tenants one
 * their tenants claim, see `emailClaimScope`.
 */
async function claimedAccounts(entries: Entry[], scope: EmailClaimScope, options: { newName?: string; anyTenant?: boolean } = {}): Promise<TrashRestoreResult["failed"]> {
    if (scope.platformLevel || !entries.some((entry) => entry.kind === "user")) return [];
    const names = new Map(entries.map((entry) => [entry.id, entry.name]));
    const accounts = await trashAccounts(entries.filter((entry) => entry.kind === "user").map((entry) => entry.id), { anyTenant: options.anyTenant });
    const failed: TrashRestoreResult["failed"] = [];
    for (const account of accounts) {
        const refused = await claimedEmailRefusal(options.newName ?? account.email, [...account.tenantIds, ...scope.tenantIds], false);
        if (refused) failed.push({ id: account.id, name: names.get(account.id) ?? account.email, error: refused });
    }
    return failed;
}

type EmailClaimScope = ReturnType<typeof emailClaimScope>;

/**
 * What the viewer manages of the accounts of the platform: the tenants their right reaches, and
 * with it the emails they may give, see `emailClaimScope`.
 */
async function accountsScopeOf(user: Viewer, permissions: string[]): Promise<{ reach: PlatformReach; claims: EmailClaimScope }> {
    const reach = await userService.accountsReachOf({ id: user.id, isPlatformAdmin: user.isPlatformAdmin, permissions });
    return { reach, claims: emailClaimScope({ isPlatformAdmin: user.isPlatformAdmin, permissions, reach }) };
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
    if (user.allTenants) return { success: false, error: IN_ITS_TENANT };

    try {
        const found = await allowed(viewer, parsed.data.ids);
        const newEmail = parsed.data.newName && found.length === 1 && found[0].kind === "user" ? parsed.data.newName : undefined;
        if (newEmail && !z.string().email().safeParse(newEmail).success) return { success: false, error: "An account needs a valid email." };
        // An account comes back with an email, its own or a new one, whose domain the provider of
        // another tenant may claim by now.
        const { claims } = await accountsScopeOf(user, [...viewer.permissions]);
        const claimed = await claimedAccounts(found, claims, { newName: newEmail });
        if (newEmail && claimed.length > 0) return { success: false, error: claimed[0].error };
        const refused = new Set(claimed.map((entry) => entry.id));
        const entries = found.filter((entry) => !refused.has(entry.id));
        const result = entries.length > 0
            ? await restoreFromTrash(entries.map((entry) => entry.id), { newName: parsed.data.newName })
            : { restored: [], conflicts: [], failed: [] };
        result.failed.push(...claimed, ...missing(parsed.data.ids, found));
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
    const user = await getViewer();
    if (!user) throw new AuthenticationError();
    const parsed = UndoSchema.safeParse({ kind, recordIds });
    if (!parsed.success) return { success: false, error: "Invalid request" };

    try {
        const since = Date.now() - UNDO_WINDOW_MS;
        const own = (entry: Entry) => entry.deletedById === user.id && entry.deletedAt.getTime() >= since;
        const viewer = trashViewer(user, permissions);
        // An account waits in its own tenant or in the home tenant, whichever tenant deleted it, so
        // it is read in every tenant, limited to the viewer's own delete and to an account they may
        // bring back there.
        const accounts = parsed.data.kind === "user";
        const { reach, claims } = await accountsScopeOf(user, permissions);
        const found = accounts
            ? (await latestAccountEntries(parsed.data.recordIds)).map((entry) => ({ ...entry, kind: "user" as const })).filter((entry) => own(entry) && mayRestoreAccount({ ...viewer, tenantId: user.tenantId, reach }, entry))
            : (await allowed(viewer, await latestTrashIds(parsed.data.kind, parsed.data.recordIds))).filter(own);
        if (found.length === 0) return { success: false, error: "It can no longer be undone. Someone who may change the tenant settings restores it under Settings › Recently deleted." };
        const claimed = await claimedAccounts(found, claims, { anyTenant: true });
        const refused = new Set(claimed.map((entry) => entry.id));
        const entries = found.filter((entry) => !refused.has(entry.id));
        const ids = entries.map((entry) => entry.id);
        const result: TrashRestoreResult = ids.length === 0
            ? { restored: [], conflicts: [], failed: [] }
            : accounts ? await restoreFromTrash(ids, { anyTenantAccounts: true }) : await restoreFromTrash(ids);
        result.failed.push(...claimed);
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
    if (user.allTenants) return { success: false, error: IN_ITS_TENANT };

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
