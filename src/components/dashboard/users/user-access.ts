import { AVAILABLE_PERMISSIONS } from "@/lib/auth/permissions";
import type { UserRow, UsersGroup } from "@/services/user/users-types";

/**
 * What the viewer may change of a user and which groups they may give, for the Users and the
 * Groups tab. It only hides and explains, the server checks every request with `accountRefusal`
 * and `roleRefusal` in `lib/auth/account-access.ts`, whose words these are.
 */

export const PLATFORM_ADMIN_ACCOUNT = "Only a platform admin can change the account of a platform admin.";
export const SHARED_ACCOUNT = "This account also works in other tenants. Only a platform admin can change it.";
export const GROUP_BEYOND_YOU = "This group may do more than you may, so you cannot give it to anyone.";
export const HELD_GROUP_BEYOND_YOU = "This user's group may do more than you may, so only someone who may do all of it changes it.";

/**
 * The groups a tenant offers on the list of every account: its own, since a group belongs to one
 * tenant. A group without a tenant comes from the list of one tenant, where every group is its own.
 */
export function groupsOfTenant(groups: UsersGroup[], tenantId: string): UsersGroup[] {
    return groups.filter((group) => !group.tenantId || group.tenantId === tenantId);
}

/** Who looks at the list: a platform admin, and what the viewer may do, null outside the dashboard. */
export interface GroupViewer {
    platformAdmin: boolean;
    permissions: readonly string[] | null;
}

/** A group as both tabs list it, `superAdmin` being the group with every permission. */
export interface GrantedGroup {
    permissions: readonly string[];
    superAdmin: boolean;
}

const ALL = AVAILABLE_PERMISSIONS.map((permission) => permission.id);

/**
 * Why the viewer may not change the account of this user, their password, second factor,
 * sessions, name, email or the account itself, null when they may. The own account is always the
 * viewer's to change, and whoever manages the accounts of the platform changes any but that of a
 * platform admin.
 */
export function accountLock(user: Pick<UserRow, "superAdmin" | "elsewhere" | "isYou">, viewerPlatformAdmin: boolean, managesAccounts = false): string | null {
    if (viewerPlatformAdmin || user.isYou) return null;
    if (user.superAdmin) return PLATFORM_ADMIN_ACCOUNT;
    if (managesAccounts) return null;
    return user.elsewhere ? SHARED_ACCOUNT : null;
}

/** What a group lets its members do: every permission for the group with every permission, else the ones DBackup knows. */
export function groupGrants(group: GrantedGroup): string[] {
    if (group.superAdmin) return [...ALL];
    const held = new Set(group.permissions);
    return ALL.filter((permission) => held.has(permission));
}

/**
 * Whether a group may do more than the viewer may, so the viewer neither gives it nor takes it
 * from anyone. A platform admin gives every group, and outside the dashboard nothing is hidden.
 *
 * The settings and the groups of the instance only count in the home tenant, which the browser
 * does not know, so they count here as everywhere. In another tenant that can hide a group the
 * server would let the viewer give.
 */
export function groupBeyond(group: GrantedGroup, viewer: GroupViewer): boolean {
    if (viewer.platformAdmin || viewer.permissions === null) return false;
    const held = new Set(viewer.permissions);
    return groupGrants(group).some((permission) => !held.has(permission));
}

/**
 * Why the viewer may not change the group of this user, null when they may: nobody changes their
 * own group, and nobody takes a group from someone that may do more than they may.
 */
export function groupLock(
    user: Pick<UserRow, "group" | "isYou">,
    groups: readonly (GrantedGroup & { id: string })[],
    viewer: GroupViewer
): string | null {
    if (user.isYou) return "Another admin changes your own group.";
    const current = user.group ? groups.find((group) => group.id === user.group?.id) : undefined;
    return current && groupBeyond(current, viewer) ? HELD_GROUP_BEYOND_YOU : null;
}
