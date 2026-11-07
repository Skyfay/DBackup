import prisma from "@/lib/prisma";
import { GROUP_BEYOND_ACCOUNT_REFUSAL, heldGroupBeyond } from "@/lib/auth/account-access";
import type { OwnerMembership } from "@/lib/auth/owner-permissions";
import { runAsSystem, runAsTenant } from "@/lib/tenant/context";
import { HOME_TENANT_ID } from "@/lib/tenant/home";
import { userService } from "@/services/user/user-service";
import type { UserSnapshot } from "./trash-snapshot";
import type { TrashRestoreResult } from "./trash-types";

/**
 * The groups a deleted account comes back with cap who brings it back or deletes it for good, like
 * they cap who changes or deletes the live account (`heldGroupBeyond`). Whoever restores an account
 * may give it a new email and then sign in as it, so an account whose group may do more than the
 * caller may stays for someone who may do all of it.
 */

/** Who brings back or deletes a deleted account. */
export interface AccountGroupCaller {
    id: string;
    isPlatformAdmin: boolean;
    /** The tenant they work in now, none in All tenants. */
    tenantId: string | null;
    /** What they may do there. */
    permissions: readonly string[];
}

/**
 * The group a deleted account held in each of its tenants, from its snapshot, each looked up in the
 * tenant of its membership like the restore does. A snapshot of an earlier version knows one group
 * of the home tenant. A group deleted since comes back with nobody and is left out.
 */
export async function snapshotGroups(snapshot: UserSnapshot): Promise<OwnerMembership[]> {
    const legacyGroupId = snapshot.record.groupId;
    const memberships = snapshot.memberships ?? (legacyGroupId ? [{ tenantId: HOME_TENANT_ID, groupId: legacyGroupId }] : []);
    const groups = await Promise.all(memberships.map(async ({ tenantId, groupId }) => {
        const group = await runAsTenant(tenantId, () => prisma.group.findUnique({ where: { id: groupId }, select: { permissions: true, fullAccess: true } }));
        return group ? [{ tenantId, group }] : [];
    }));
    return groups.flat();
}

/**
 * The groups of the deleted accounts among these entries, by the id of the entry. With `anyTenant`
 * an entry is read in whichever tenant it waits, for Undo.
 */
export async function trashAccountGroups(ids: readonly string[], options: { anyTenant?: boolean } = {}): Promise<Map<string, OwnerMembership[]>> {
    if (ids.length === 0) return new Map();
    const read = () => prisma.deletedRecord.findMany({ where: { id: { in: [...ids] }, kind: "user" }, select: { id: true, data: true } });
    const rows = options.anyTenant ? await runAsSystem(read) : await read();
    const groups = new Map<string, OwnerMembership[]>();
    for (const row of rows) groups.set(row.id, await snapshotGroups(JSON.parse(row.data) as UserSnapshot));
    return groups;
}

/**
 * The groups of the deleted accounts of these entries, by the id of the entry, with what the caller
 * may do in their tenants other than the one they work in now (`AccountActor.permissionsByTenant`),
 * for `heldGroupBeyond` and `accountRefusal`.
 */
export async function trashAccountCaps(
    caller: AccountGroupCaller,
    ids: readonly string[],
    options: { anyTenant?: boolean } = {}
): Promise<{ groups: Map<string, OwnerMembership[]>; permissionsByTenant: Record<string, readonly string[]> }> {
    const groups = await trashAccountGroups(ids, options);
    const permissionsByTenant = await userService.permissionsByTenantFor(caller, [...groups.values()].flat());
    return { groups, permissionsByTenant };
}

/**
 * The deleted accounts among these entries the caller may not bring back or delete for good, since
 * a group of theirs may do more than the caller may, each refused with the sentence a change of the
 * live account hears. Every other entry passes, so a batch refuses only the rows it has to.
 */
export async function groupBeyondRefusals(
    caller: AccountGroupCaller,
    entries: readonly { id: string; kind: string; name: string }[],
    options: { anyTenant?: boolean } = {}
): Promise<TrashRestoreResult["failed"]> {
    const accounts = entries.filter((entry) => entry.kind === "user");
    if (caller.isPlatformAdmin || accounts.length === 0) return [];
    const { groups, permissionsByTenant } = await trashAccountCaps(caller, accounts.map((entry) => entry.id), options);
    const actor = { ...caller, permissionsByTenant };
    return accounts
        .filter((entry) => heldGroupBeyond(actor, groups.get(entry.id) ?? []))
        .map((entry) => ({ id: entry.id, name: entry.name, error: GROUP_BEYOND_ACCOUNT_REFUSAL }));
}
