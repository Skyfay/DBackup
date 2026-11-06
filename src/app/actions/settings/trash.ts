"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { checkPermission, getViewer, getUserPermissions, tenantRefusal } from "@/lib/auth/access-control";
import { emailClaimScope } from "@/lib/auth/account-access";
import { TRASH_ADMIN_PERMISSION } from "@/lib/auth/permissions";
import type { PlatformReach } from "@/lib/auth/platform-group-caps";
import { AUDIT_ACTIONS, AUDIT_RESOURCES, type AuditResource } from "@/lib/core/audit-types";
import { BulkIdsSchema } from "@/lib/core/bulk-schema";
import { AuthenticationError } from "@/lib/logging/errors";
import { userMessage } from "@/lib/logging/user-message";
import { logger } from "@/lib/logging/logger";
import { auditService, type AuditOrigin } from "@/services/audit-service";
import { claimedEmailRefusal } from "@/services/sso/email-domain-claims";
import { PLATFORM_LOG } from "@/services/system/settings-save";
import { groupBeyondRefusals, trashAccountCaps, type AccountGroupCaller } from "@/services/trash/account-groups";
import { latestAccountEntries, latestTrashIds, mayHandle, mayRestoreAccount, purgeFromTrash, restoreFromTrash, trashAccounts, trashEntries, type TrashViewer } from "@/services/trash/trash-service";
import { TRASH_KINDS, isTrashKind, type TrashKind, type TrashRestoreResult } from "@/services/trash/trash-types";
import { userService } from "@/services/user/user-service";
import { CHANGED_EMAIL_ANSWERS, takenEmailRefusal } from "@/services/user/new-account-email";
import type { AccountViewer } from "@/services/user/account-visibility";

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

/** The viewer as the guards of a restored connection ask for it, an action always has a session. */
const sessionCaller = (user: { isPlatformAdmin: boolean }) => ({ isPlatformAdmin: user.isPlatformAdmin, authMethod: "session" as const });

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

/**
 * The log of a record that came back. An account waits in its own tenant or in the home tenant,
 * whichever tenant deleted it, so like the delete its entry stays in the tenant the viewer works in
 * only while the account waited there, and goes into the log of the platform otherwise.
 */
function restoredLog(viewerTenantId: string | null, entry: Entry | undefined): AuditOrigin | undefined {
    if (entry?.kind !== "user") return undefined;
    return viewerTenantId && entry.tenantId === viewerTenantId ? { tenantId: viewerTenantId } : PLATFORM_LOG;
}

/** Writes an entry for every record that came back, and refreshes the pages that list them. */
async function recordRestored(viewer: { id: string; tenantId: string | null }, entries: Entry[], result: TrashRestoreResult) {
    const before = new Map(entries.map((entry) => [entry.id, entry]));
    for (const restored of result.restored) {
        const entry = before.get(restored.id);
        const originalName = entry?.name;
        await auditService.log(
            viewer.id,
            AUDIT_ACTIONS.RESTORE,
            RESOURCES[restored.kind],
            { name: restored.name, action: "trash_restore", ...(originalName && originalName !== restored.name ? { originalName } : {}) },
            restored.recordId,
            restoredLog(viewer.tenantId, entry)
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
 * The accounts among these whose own email has an account by now, as conflicts the person resolves
 * with another email. They hear what a new email hears (`takenEmailRefusal`): the account is named
 * only to whoever may see it, and anyone else's refusal counts as a try.
 */
async function takenOwnEmails(entries: Entry[], viewer: AccountViewer, options: { anyTenant?: boolean } = {}): Promise<TrashRestoreResult["conflicts"]> {
    const users = entries.filter((entry) => entry.kind === "user");
    if (users.length === 0) return [];
    const names = new Map(users.map((entry) => [entry.id, entry.name]));
    const conflicts: TrashRestoreResult["conflicts"] = [];
    for (const account of await trashAccounts(users.map((entry) => entry.id), { anyTenant: options.anyTenant })) {
        const taken = await takenEmailRefusal(account.email, viewer, viewer.tenantId, CHANGED_EMAIL_ANSWERS);
        if (taken) conflicts.push({ id: account.id, kind: "user", name: names.get(account.id) ?? account.email, message: taken });
    }
    return conflicts;
}

/**
 * What the viewer manages of the accounts of the platform: the tenants their right reaches, and
 * with it the emails they may give, see `emailClaimScope`.
 */
async function accountsScopeOf(user: Viewer, permissions: string[]): Promise<{ reach: PlatformReach; claims: EmailClaimScope }> {
    const reach = await userService.accountsReachOf({ id: user.id, isPlatformAdmin: user.isPlatformAdmin, permissions });
    return { reach, claims: emailClaimScope({ isPlatformAdmin: user.isPlatformAdmin, permissions, reach }) };
}

/** The viewer as the cap of the groups of a deleted account reads them, see `account-groups.ts`. */
function groupCaller(user: Viewer & { tenantId: string | null }, permissions: readonly string[]): AccountGroupCaller {
    return { id: user.id, isPlatformAdmin: user.isPlatformAdmin, tenantId: user.tenantId, permissions };
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
        // An account whose group may do more than the viewer may comes back only through someone who
        // may do all of it, under its own email or a new one, like a change of the live account.
        const beyond = await groupBeyondRefusals(groupCaller(user, viewer.permissions), found);
        if (newEmail && beyond.length > 0) return { success: false, error: beyond[0].error };
        // Whoever does not see the account that holds the new email never learns that it exists, see `takenEmailRefusal`.
        const newTaken = newEmail ? await takenEmailRefusal(newEmail, { ...user, userId: user.id }, user.tenantId, CHANGED_EMAIL_ANSWERS) : null;
        if (newTaken) return { success: false, error: newTaken };
        // An account comes back with an email, its own or a new one, whose domain the provider of
        // another tenant may claim by now.
        const { claims } = await accountsScopeOf(user, [...viewer.permissions]);
        const beyondIds = new Set(beyond.map((entry) => entry.id));
        const claimed = await claimedAccounts(found.filter((entry) => !beyondIds.has(entry.id)), claims, { newName: newEmail });
        if (newEmail && claimed.length > 0) return { success: false, error: claimed[0].error };
        const refused = new Set([...beyondIds, ...claimed.map((entry) => entry.id)]);
        // An account that comes back under its own email meets the same check as under a new one.
        const taken = newEmail ? [] : await takenOwnEmails(found.filter((entry) => !refused.has(entry.id)), { ...user, userId: user.id });
        for (const conflict of taken) refused.add(conflict.id);
        const entries = found.filter((entry) => !refused.has(entry.id));
        const result = entries.length > 0
            // A new name only ever belongs to the one record picked, which went through the checks
            // above, never to one left over after others were refused.
            ? await restoreFromTrash(entries.map((entry) => entry.id), { newName: found.length === 1 ? parsed.data.newName : undefined, caller: sessionCaller(user) })
            : { restored: [], conflicts: [], failed: [] };
        result.conflicts.push(...taken);
        result.failed.push(...beyond, ...claimed, ...missing(parsed.data.ids, found));
        await recordRestored(user, entries, result);
        return { success: true, data: result };
    } catch (error: unknown) {
        return { success: false, error: userMessage(error, "Nothing could be restored. The server log has the details.", log, "Restoring deleted records failed") };
    }
}

/**
 * The viewer's own deletes of accounts they may bring back with Undo, see `mayRestoreAccount`, which
 * also weighs the groups of each snapshot against what the viewer may in their tenants. The entries
 * wait in any tenant.
 */
async function ownAccountsToUndo(user: Viewer & { tenantId: string | null }, permissions: string[], reach: PlatformReach, entries: Entry[]): Promise<Entry[]> {
    if (entries.length === 0) return [];
    const { groups, permissionsByTenant } = await trashAccountCaps(groupCaller(user, permissions), entries.map((entry) => entry.id), { anyTenant: true });
    const viewer = { ...trashViewer(user, permissions), tenantId: user.tenantId, reach, permissionsByTenant };
    return entries.filter((entry) => mayRestoreAccount(viewer, { ...entry, groups: groups.get(entry.id) ?? [] }));
}

const UndoSchema = z.object({
    kind: z.enum(TRASH_KINDS),
    recordIds: BulkIdsSchema,
});

/**
 * Undo right after a delete: brings back what the viewer just deleted, the newest deleted record of
 * each id. Only their own delete of the last minutes, with the right to change the kind, so it
 * needs no right to change the settings and is no way around it. A record of a tenant comes back in
 * that tenant, so All tenants, which only reads, is refused, while an account, which belongs to no
 * tenant, comes back there too.
 * @no-permission-required - no right of its own: each entry is checked against the right to change
 * its kind (`mayHandle`, `mayRestoreAccount`), and only the viewer's own delete of the last minutes counts
 */
export async function undoDeleteAction(kind: TrashKind, recordIds: string[]): Promise<TrashActionResult<TrashRestoreResult>> {
    const permissions = await getUserPermissions();
    const user = await getViewer();
    if (!user) throw new AuthenticationError();
    const parsed = UndoSchema.safeParse({ kind, recordIds });
    if (!parsed.success) return { success: false, error: "Invalid request" };
    if (parsed.data.kind !== "user") {
        const refused = tenantRefusal(user);
        if (refused) return { success: false, error: user.allTenants ? IN_ITS_TENANT : refused };
    }

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
            ? await ownAccountsToUndo(user, permissions, reach, (await latestAccountEntries(parsed.data.recordIds)).map((entry) => ({ ...entry, kind: "user" as const })).filter(own))
            : (await allowed(viewer, await latestTrashIds(parsed.data.kind, parsed.data.recordIds))).filter(own);
        if (found.length === 0) return { success: false, error: "It can no longer be undone. Someone who may change the tenant settings restores it under Settings › Recently deleted." };
        const claimed = await claimedAccounts(found, claims, { anyTenant: true });
        const refused = new Set(claimed.map((entry) => entry.id));
        const taken = accounts ? await takenOwnEmails(found.filter((entry) => !refused.has(entry.id)), { ...user, userId: user.id }, { anyTenant: true }) : [];
        for (const conflict of taken) refused.add(conflict.id);
        const entries = found.filter((entry) => !refused.has(entry.id));
        const ids = entries.map((entry) => entry.id);
        const result: TrashRestoreResult = ids.length === 0
            ? { restored: [], conflicts: [], failed: [] }
            : accounts ? await restoreFromTrash(ids, { anyTenantAccounts: true, caller: sessionCaller(user) }) : await restoreFromTrash(ids, { caller: sessionCaller(user) });
        result.conflicts.push(...taken);
        result.failed.push(...claimed);
        await recordRestored(user, entries, result);
        return { success: true, data: result };
    } catch (error: unknown) {
        return { success: false, error: userMessage(error, "The delete could not be undone. The server log has the details.", log, "Undoing a delete failed", { kind: parsed.data.kind }) };
    }
}

/**
 * Deletes records from Recently deleted for good, before their time is up, and answers with the ids
 * that went. Needs the right to change the settings, and for each record the right to change its kind.
 */
export async function purgeDeletedAction(ids: string[]): Promise<TrashActionResult<{ purged: string[]; failed: TrashRestoreResult["failed"] }>> {
    const user = await checkPermission(TRASH_ADMIN_PERMISSION);
    const viewer = trashViewer(user, await getUserPermissions());
    const parsed = BulkIdsSchema.safeParse(ids);
    if (!parsed.success) return { success: false, error: "Invalid request" };
    if (user.allTenants) return { success: false, error: IN_ITS_TENANT };

    try {
        const found = await allowed(viewer, parsed.data);
        if (found.length === 0) return { success: false, error: GONE };
        // An account whose group may do more than the viewer may goes for good only through someone
        // who may do all of it, like the delete of the live account.
        const failed = await groupBeyondRefusals(groupCaller(user, viewer.permissions), found);
        const refused = new Set(failed.map((entry) => entry.id));
        const entries = found.filter((entry) => !refused.has(entry.id));
        if (entries.length === 0) return { success: false, error: failed[0].error };
        await purgeFromTrash(entries.map((entry) => entry.id));
        for (const entry of entries) {
            await auditService.log(user.id, AUDIT_ACTIONS.DELETE, RESOURCES[entry.kind], { name: entry.name, action: "trash_purge", permanently: true }, entry.recordId);
        }
        revalidatePath("/dashboard/settings");
        return { success: true, data: { purged: entries.map((entry) => entry.id), failed } };
    } catch (error: unknown) {
        return { success: false, error: userMessage(error, "Nothing could be deleted. The server log has the details.", log, "Deleting records from Recently deleted failed") };
    }
}
