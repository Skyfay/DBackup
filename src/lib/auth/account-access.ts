import { groupPermissions, PLATFORM_PERMISSIONS, type OwnerGroup } from "@/lib/auth/owner-permissions";
import { PERMISSIONS, type Permission } from "@/lib/auth/permissions";
import { HOME_TENANT_ID } from "@/lib/tenant/home";

/**
 * Who may change an account and hand out a role, on top of the right to manage users. An account
 * belongs to everyone it works for, so the admin of one tenant only changes accounts that work in
 * that tenant alone. Otherwise the admin of a customer could reset the password of a technician
 * and sign in to every tenant the technician works in.
 */

/**
 * Who changes an account: the admin of its tenant, who may manage the users there, or whoever
 * manages the accounts of the platform. `accountRefusal` then decides which accounts each may change.
 */
export const ACCOUNT_CHANGE: readonly Permission[] = [PERMISSIONS.USERS.WRITE, PERMISSIONS.PLATFORM.ACCOUNTS_WRITE];

export interface AccountActor {
    isPlatformAdmin: boolean;
    /** The tenant the actor works in now. */
    tenantId: string | null;
    /** What the actor may do there. */
    permissions: readonly string[];
}

export interface AccountTarget {
    isPlatformAdmin: boolean;
    /** The tenants the account works in. */
    tenantIds: readonly string[];
}

/** Why the actor may not change the account, null when they may. */
export function accountRefusal(actor: AccountActor, target: AccountTarget): string | null {
    if (actor.isPlatformAdmin) return null;
    if (target.isPlatformAdmin) return "Only a platform admin can change the account of a platform admin.";
    // Who manages the accounts of the platform changes any account but that of a platform admin.
    if (actor.permissions.includes(PERMISSIONS.PLATFORM.ACCOUNTS_WRITE)) return null;
    if (!actor.tenantId) return "You work in no tenant.";
    // An account of no tenant shows in the home tenant, whose admins give it a role.
    const own = target.tenantIds.length === 0 ? actor.tenantId === HOME_TENANT_ID : target.tenantIds.every((tenantId) => tenantId === actor.tenantId);
    return own ? null : "This account also works in other tenants. Only a platform admin can change it.";
}

/**
 * What a role gives in a tenant: the settings and the roles of the instance only count in the home
 * tenant, like in `permissionsIn`.
 */
export function roleGrantsIn(group: OwnerGroup, tenantId: string): string[] {
    const granted = groupPermissions(group);
    return tenantId === HOME_TENANT_ID ? granted : granted.filter((permission) => !PLATFORM_PERMISSIONS.has(permission));
}

/** Why the actor may not hand out the role in their tenant, null when they may. Nobody gives more than they hold. */
export function roleRefusal(actor: AccountActor, group: OwnerGroup): string | null {
    if (actor.isPlatformAdmin) return null;
    if (!actor.tenantId) return "You work in no tenant.";
    const held = new Set(actor.permissions);
    return roleGrantsIn(group, actor.tenantId).every((permission) => held.has(permission))
        ? null
        : "This group may do more than you may, so you cannot give it to anyone.";
}
