import type { AccountActor } from "@/lib/auth/account-access";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { reachCovers, type PlatformReach } from "@/lib/auth/platform-group-caps";
import { HOME_TENANT_ID } from "@/lib/tenant/home";
import { userService } from "@/services/user/user-service";

/**
 * Ending a membership can hand an account to whoever ends it. The admin of a tenant changes an
 * account that works in their tenant alone (`accountRefusal`), so someone who manages the users of
 * tenant Z and takes an account of tenants T and Z out of T owns it afterwards: they set its
 * password, sign in as it and add it back to T. The same holds for someone who manages the tenants
 * and adds the account to Z first. So a membership ends only when the account does not afterwards
 * work alone in tenants where the caller manages the users (`users:write` there, or the reach of
 * their right to manage the accounts of the platform), unless the caller may change the account
 * already, which a platform admin or someone who manages the accounts of its tenants may.
 */

export const MEMBERSHIP_END_HANDS_OVER =
    "Afterwards this account would work only in tenants where you manage the users, which would let you change it. Someone who manages the accounts of the platform, or a platform admin, ends this membership.";

/** Who ends a membership: the account that acts, the owner of an API key, with what they may do in the tenant they work in. */
export interface MembershipEnder {
    id: string;
    isPlatformAdmin: boolean;
    /** The tenant the caller works in, null in All tenants. */
    tenantId: string | null;
    /** What the caller may do there, read from their groups when left out. */
    permissions?: readonly string[];
}

/** Whether the caller manages the users of a tenant: `users:write` there, or the reach of `platform-accounts:write`. */
async function managesUsersIn(callerId: string, tenantId: string, accountsReach: PlatformReach): Promise<boolean> {
    if (reachCovers(accountsReach, tenantId)) return true;
    return (await userService.permissionsIn(callerId, tenantId)).includes(PERMISSIONS.USERS.WRITE);
}

/**
 * Why the caller may not end the membership of the account in `tenantId`, null when they may. See
 * the rule above. An account that is gone, or no member there, passes, the change then says so.
 */
export async function membershipEndRefusal(caller: MembershipEnder, userId: string, tenantId: string): Promise<string | null> {
    if (caller.isPlatformAdmin) return null;
    const target = await userService.accountOf(userId);
    if (!target) return null;
    // The tenants it holds a membership in, which for an account of no tenant are none, whichever tenant it counts as one of.
    const memberships = target.groups ? target.groups.map((membership) => membership.tenantId) : target.tenantIds;
    // Only a platform admin changes the memberships of a platform admin, which the callers check.
    if (target.isPlatformAdmin || !memberships.includes(tenantId)) return null;

    // The right to manage the accounts of the platform counts from the home tenant, see `permissionsIn`, wherever the caller works.
    const platformPermissions = await userService.permissionsIn(caller.id, HOME_TENANT_ID);
    const managesAccounts = platformPermissions.includes(PERMISSIONS.PLATFORM.ACCOUNTS_WRITE);
    const permissions = caller.permissions ?? (await userService.permissionsIn(caller.id, caller.tenantId ?? HOME_TENANT_ID));
    const actor: AccountActor & { id: string } = {
        id: caller.id,
        isPlatformAdmin: false,
        tenantId: caller.tenantId,
        permissions: managesAccounts && !permissions.includes(PERMISSIONS.PLATFORM.ACCOUNTS_WRITE) ? [...permissions, PERMISSIONS.PLATFORM.ACCOUNTS_WRITE] : permissions,
    };
    // Whoever may change the account already gains nothing by ending one of its memberships.
    if ((await userService.accountRefusalFor(actor, userId)) === null) return null;

    const accountsReach = await userService.accountsReachOf({ id: caller.id, isPlatformAdmin: false, permissions: platformPermissions });
    const left = memberships.filter((id) => id !== tenantId);
    // An account of no tenant counts as one of the home tenant, or of the tenant whose provider claims its email, see `accountOf`.
    const tenantsLeft = left.length > 0 ? left : [await userService.placelessTenantOf(userId)];
    for (const id of tenantsLeft) {
        if (!(await managesUsersIn(caller.id, id, accountsReach))) return null;
    }
    return MEMBERSHIP_END_HANDS_OVER;
}
