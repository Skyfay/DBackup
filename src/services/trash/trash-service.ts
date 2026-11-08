/**
 * Recently deleted: keys, saved logins, connections, jobs and users stay here as snapshots after a
 * delete, until they are restored, deleted for good, or Clean old data removes them once their time
 * under Data retention is up. See `trash-snapshot.ts` and `trash-restore.ts`.
 */

import prisma from "@/lib/prisma";
import { getDataRetentionSetting, parseRetentionDays } from "@/lib/core/data-retention";
import { ConflictError, PermissionError, wrapError } from "@/lib/logging/errors";
import { logger } from "@/lib/logging/logger";
import { userMessage } from "@/lib/logging/user-message";
import { BULK_ROW_FAILED } from "@/lib/core/bulk";
import { accountRefusal } from "@/lib/auth/account-access";
import type { OwnerMembership } from "@/lib/auth/owner-permissions";
import { PERMISSIONS } from "@/lib/auth/permissions";
import type { PlatformReach } from "@/lib/auth/platform-group-caps";
import { runAsSystem, runAsTenant } from "@/lib/tenant/context";
import { HOME_TENANT_ID } from "@/lib/tenant/home";
import { assertMayAdd } from "@/services/tenant/tenant-allowances";
import { sharingChanged } from "@/services/tenant/shared-servers";
import { decryptConfig } from "@/lib/crypto";
import { assertMayManageHostLocal } from "@/services/adapters/adapter-create";
import { assertCommandFields } from "@/lib/adapters/config-check";
import { registerAdapters } from "@/lib/adapters";
import { validateCredentialAssignments } from "@/lib/adapters/credential-validation";
import { CONFIG_BACKUP_LOGIN_APPLY_LOCKED } from "@/lib/core/config-backup-locks";
import type { AuthContext } from "@/lib/auth/access-control";
import { savedLoginRefusal } from "@/lib/server/config-backup-target-guard";
import { assertOffSharedPlaces } from "@/services/adapters/shared-place";
import { restoreSnapshot } from "./trash-restore";
import { assertStoredLoginFields, assertStoredLoginOffHost } from "@/services/auth/credential-service";
import type { CredentialSnapshot, UserSnapshot } from "./trash-snapshot";
import { isTrashKind, type TrashKind, type TrashPart, type TrashRestoreResult, type TrashRow } from "./trash-types";

const log = logger.child({ service: "TrashService" });

const DAY_MS = 24 * 60 * 60 * 1000;

/** Who looks at Recently deleted: only what they may change shows. */
export interface TrashViewer {
    permissions: readonly string[];
    isPlatformAdmin: boolean;
}

/** Whether a viewer may restore or purge a deleted record: its permission, and a platform admin for the account of a platform admin. */
export function mayHandle(viewer: TrashViewer, entry: { permission: string; superAdminOnly: boolean }): boolean {
    if (viewer.isPlatformAdmin) return true;
    return !entry.superAdminOnly && viewer.permissions.includes(entry.permission);
}

/**
 * Whether a viewer may bring back a deleted account wherever its entry waits, for Undo: a platform
 * admin any, and one only a platform admin brings back no one else. Any other account works in the
 * tenant of its entry alone, so the viewer has to be allowed to change such an account, see
 * `accountRefusal`: whoever manages the accounts of the platform in a reach that covers that
 * tenant, or the admin of that tenant, and only while no group of its snapshot may do more than
 * they may there (`groups` and `permissionsByTenant` from `trashAccountCaps`).
 */
export function mayRestoreAccount(
    viewer: TrashViewer & { tenantId: string | null; reach?: PlatformReach; permissionsByTenant?: Readonly<Record<string, readonly string[]>> },
    entry: { permission: string; superAdminOnly: boolean; tenantId: string; groups?: readonly OwnerMembership[] }
): boolean {
    if (viewer.isPlatformAdmin) return true;
    if (entry.superAdminOnly) return false;
    const mayChange = viewer.permissions.includes(entry.permission) || viewer.permissions.includes(PERMISSIONS.PLATFORM.ACCOUNTS_WRITE);
    const actor = { isPlatformAdmin: false, tenantId: viewer.tenantId, permissions: viewer.permissions, reach: viewer.reach, permissionsByTenant: viewer.permissionsByTenant };
    return mayChange && !accountRefusal(actor, { isPlatformAdmin: false, tenantIds: [entry.tenantId], groups: entry.groups ?? [] });
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
            select: { id: true, kind: true, recordId: true, name: true, detail: true, deletedAt: true, deletedByName: true, permission: true, superAdminOnly: true, tenantId: true },
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
            tenantId: row.tenantId,
        }];
    });
}

/** Recently deleted as a part of the settings, with whether the viewer may restore and delete for good. */
export async function getTrashPart(viewer: TrashViewer & { canManage: boolean }): Promise<TrashPart> {
    return { rows: await listTrash(viewer), canManage: viewer.canManage };
}

const ENTRY_SELECT = { id: true, kind: true, recordId: true, name: true, permission: true, superAdminOnly: true, deletedById: true, deletedAt: true, tenantId: true } as const;

/** The deleted records of these ids, for the permission check of an action. */
export async function trashEntries(ids: string[]) {
    return prisma.deletedRecord.findMany({ where: { id: { in: ids } }, select: ENTRY_SELECT });
}

/**
 * The newest deleted account of each of these ids, in whichever tenant it waits, for Undo right
 * after a delete. An account waits in its own tenant or in the home tenant, never by the tenant it
 * was deleted from (see `keepInTrash`), so the tenant of the request may not hold it.
 */
export async function latestAccountEntries(recordIds: string[]) {
    const rows = await runAsSystem(() => prisma.deletedRecord.findMany({
        where: { kind: "user", recordId: { in: recordIds } },
        orderBy: { deletedAt: "desc" },
        select: ENTRY_SELECT,
    }));
    const newest = new Map<string, (typeof rows)[number]>();
    for (const row of rows) if (!newest.has(row.recordId)) newest.set(row.recordId, row);
    return [...newest.values()];
}

/**
 * The email each deleted account of these entries comes back with and the tenants it works in
 * then, for the check of a domain the provider of another tenant claims. The people of the
 * platform and an account of no tenant count as people of the home tenant, like `ownEmailRefusal`.
 */
export async function trashAccounts(ids: string[], options: { anyTenant?: boolean } = {}): Promise<{ id: string; email: string; tenantIds: string[] }[]> {
    const read = () => prisma.deletedRecord.findMany({ where: { id: { in: ids }, kind: "user" }, select: { id: true, data: true } });
    const rows = options.anyTenant ? await runAsSystem(read) : await read();
    return rows.map((row) => {
        const snapshot = JSON.parse(row.data) as UserSnapshot;
        const tenantIds = [...new Set((snapshot.memberships ?? []).map((membership) => membership.tenantId))];
        if (snapshot.record.platformGroupId || tenantIds.length === 0) tenantIds.push(HOME_TENANT_ID);
        return { id: row.id, email: snapshot.record.email, tenantIds };
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
 * The deleted record of an id. With `anyTenantAccounts` an account is also found in another tenant
 * than the one of the request, for an Undo whose caller checked the entry `latestAccountEntries` read.
 */
async function findEntry(id: string, anyTenantAccounts: boolean) {
    const entry = await prisma.deletedRecord.findUnique({ where: { id } });
    if (entry || !anyTenantAccounts) return entry;
    const account = await runAsSystem(() => prisma.deletedRecord.findUnique({ where: { id } }));
    return account?.kind === "user" ? account : null;
}

/** What the check of a restored connection reads of its snapshot. */
interface DeletedConnection {
    type: string;
    storageRole?: string | null;
    adapterId: string;
    config: string;
    primaryCredentialId?: string | null;
    sshCredentialId?: string | null;
}

/** Who restores, for the guards that ask whether a platform admin with a session acts. */
export type TrashCaller = Pick<AuthContext, "isPlatformAdmin" | "authMethod">;

/** A caller with no right of a platform admin, for a restore that names nobody. */
const NO_PLATFORM_ADMIN: TrashCaller = { isPlatformAdmin: false, authMethod: "session" };

/** The id of a saved login that still exists, null for none or one deleted since the snapshot. */
async function presentLogin(id: string | null | undefined): Promise<string | null> {
    if (!id) return null;
    return (await prisma.credentialProfile.findUnique({ where: { id }, select: { id: true } })) ? id : null;
}

/**
 * The checks of a save that a connection meets again when it comes back from Recently deleted,
 * since a restore stores it like a save: its saved logins fit its type, a saved login of the
 * destination of the configuration backup signs in on it through a platform admin alone, and a
 * storage connection keeps out of the folder of a destination the tenant shares with customers. A
 * login deleted since the snapshot counts as none, the restore drops it with a note.
 *
 * @throws ValidationError for a login of the wrong type or a place a shared destination holds.
 * @throws PermissionError for a login of the configuration backup without a platform admin.
 */
async function assertConnectionSaveChecks(record: DeletedConnection, config: Record<string, unknown>, caller: TrashCaller): Promise<void> {
    const primaryCredentialId = await presentLogin(record.primaryCredentialId);
    const sshCredentialId = await presentLogin(record.sshCredentialId);
    if (await savedLoginRefusal(caller, primaryCredentialId, sshCredentialId)) {
        throw new PermissionError("platform admin", { message: CONFIG_BACKUP_LOGIN_APPLY_LOCKED });
    }
    registerAdapters();
    await validateCredentialAssignments(record.adapterId, primaryCredentialId, sshCredentialId);
    if (record.type === "storage") await assertOffSharedPlaces(record.adapterId, config, { primaryCredentialId, sshCredentialId });
}

/** The config of a deleted connection in plain text, empty when it cannot be read. */
function storedConfig(config: string): Record<string, unknown> {
    try {
        return decryptConfig(JSON.parse(config)) as Record<string, unknown>;
    } catch {
        return {};
    }
}

/**
 * Restores deleted records under their own ids, each in a transaction of its own. A name someone took
 * meanwhile comes back as a conflict, and `newName` restores a single record under another one.
 */
export async function restoreFromTrash(ids: string[], options: { newName?: string; anyTenantAccounts?: boolean; caller?: TrashCaller } = {}): Promise<TrashRestoreResult> {
    const result: TrashRestoreResult = { restored: [], conflicts: [], failed: [] };
    const newName = ids.length === 1 ? options.newName?.trim() || undefined : undefined;

    for (const id of ids) {
        const entry = await findEntry(id, options.anyTenantAccounts ?? false);
        if (!entry || !isTrashKind(entry.kind)) {
            result.failed.push({ id, name: entry?.name ?? id, error: "It is gone from Recently deleted." });
            continue;
        }
        const kind = entry.kind;
        const restore = () => prisma.$transaction(async (tx) => {
            const done = await restoreSnapshot(tx, kind, JSON.parse(entry.data), newName);
            await tx.deletedRecord.delete({ where: { id } });
            return done;
        });
        try {
            // A connection that comes back is one more of its kind, which the platform may not let
            // the tenant add itself. Asked before the transaction, which holds the one connection to SQLite.
            if (kind === "connection") {
                const { record } = JSON.parse(entry.data) as { record: DeletedConnection };
                const config = storedConfig(record.config);
                await assertMayAdd(record.type, record.storageRole);
                // One that reaches the server DBackup runs on comes back through a platform admin alone.
                await assertMayManageHostLocal(record.adapterId, config, record, true);
                // Nor with a port, a host or a user that could not reach a command line, which an
                // earlier version may have stored, see `config-check.ts`.
                assertCommandFields(config);
                // Nor past the checks of its logins and its place a save asks.
                await assertConnectionSaveChecks(record, config, options.caller ?? NO_PLATFORM_ADMIN);
            }
            // A saved login with the SSH agent of the server comes back through a platform admin alone,
            // like when it is created, since every connection that used it logs in with it again.
            if (kind === "credential") {
                const { record } = JSON.parse(entry.data) as CredentialSnapshot;
                await assertStoredLoginOffHost(record.type, record.data);
                // Nor with a password or a username a save refuses today, which an earlier version may have stored.
                await assertStoredLoginFields(record.id, record.type, record.data);
            }
            // An account belongs to no tenant, so its Undo also works in All tenants and in another
            // tenant, which changes no tenant. Its entry lives in the tenant that keeps it.
            const restored = kind === "user" ? await runAsTenant(entry.tenantId, restore) : await restore();
            result.restored.push({ id, recordId: entry.recordId, kind, name: restored.name, notes: restored.notes });
        } catch (error: unknown) {
            if (error instanceof ConflictError) {
                result.conflicts.push({ id, kind, name: entry.name, message: error.message });
            } else {
                // A sentence written for the user passes, the words of the database stay in the log.
                result.failed.push({ id, name: entry.name, error: userMessage(error, BULK_ROW_FAILED, log, "Restoring a deleted record failed", { id, kind }) });
            }
        }
    }

    // A restored connection of a shared server brings its assignments and rules back, which the
    // cached rows of its customers count.
    if (result.restored.some((entry) => entry.kind === "connection")) sharingChanged();
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
