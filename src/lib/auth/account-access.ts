import { groupPermissions, PLATFORM_PERMISSIONS, type OwnerGroup, type OwnerMembership } from "@/lib/auth/owner-permissions";
import { PERMISSIONS, type Permission } from "@/lib/auth/permissions";
import { platformGroupRefusal, reachCovers, type PlatformGroupShape, type PlatformReach } from "@/lib/auth/platform-group-caps";
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
    /** The actor's own platform group, which decides the platform groups they may give, see `platform-group-caps.ts`. */
    platformGroupShape?: PlatformGroupShape | null;
    /**
     * The tenants the actor looks after on the platform, see `platformGroupService.reachOf`. The
     * right to manage the accounts of the platform changes only the accounts of these tenants. None
     * when left out.
     */
    reach?: PlatformReach;
    /**
     * What the actor may do in the other tenants of the account, by tenant, which caps the groups
     * the account may hold there, see `heldGroupBeyond`. In a tenant left out they may do nothing.
     */
    permissionsByTenant?: Readonly<Record<string, readonly string[]>>;
}

export interface AccountTarget {
    isPlatformAdmin: boolean;
    /** The tenants the account works in. */
    tenantIds: readonly string[];
    /** The platform group the account holds, none for an account without one. */
    platformGroup?: PlatformGroupShape | null;
    /** The group the account holds in each of its tenants, none when left out. */
    groups?: readonly OwnerMembership[];
}

export const PLATFORM_ADMIN_ACCOUNT_REFUSAL = "Only a platform admin can change the account of a platform admin.";
export const PLATFORM_GROUP_ACCOUNT_REFUSAL = "This account holds a platform group. Only someone who may give that platform group can change it.";
export const SHARED_ACCOUNT_REFUSAL = "This account also works in other tenants. Only someone who manages the accounts of the platform can change it.";
export const BEYOND_REACH_ACCOUNT_REFUSAL = "This account works in a tenant your platform group does not reach. Only someone who reaches all of its tenants can change it.";
export const GROUP_BEYOND_ACCOUNT_REFUSAL = "This user's group may do more than you may, so only someone who may do all of it can change their account.";

/** The tenants an account belongs to for the reach: the ones it works in, the home tenant for an account of no tenant. */
const accountTenantsOf = (tenantIds: readonly string[]): readonly string[] => (tenantIds.length > 0 ? tenantIds : [HOME_TENANT_ID]);

/** Whether a reach covers every tenant an account works in, an account of no tenant counting as one of the home tenant. */
export const reachCoversAccount = (reach: PlatformReach, tenantIds: readonly string[]): boolean =>
    accountTenantsOf(tenantIds).every((tenantId) => reachCovers(reach, tenantId));

/**
 * Why the actor may not change the account, null when they may. Whoever changes how an account
 * signs in can sign in as it, so an account of the platform is changed only by someone who could
 * give it what it holds: a platform admin by a platform admin, a platform group by someone who
 * manages the accounts of the platform and may give that platform group. The right to manage the
 * accounts of the platform reaches the accounts whose tenants all lie in the reach of the actor,
 * every account but a platform admin's for a platform group of all tenants. Beyond that nobody but
 * a platform admin changes an account whose group in one of its tenants may do more than they may
 * there, see `heldGroupBeyond`.
 */
export function accountRefusal(actor: AccountActor, target: AccountTarget): string | null {
    if (actor.isPlatformAdmin) return null;
    const refused = placeRefusal(actor, target);
    if (refused) return refused;
    // Whoever changes how the account signs in can sign in as it, so its groups cap who changes it.
    return heldGroupBeyond(actor, target.groups ?? []) ? GROUP_BEYOND_ACCOUNT_REFUSAL : null;
}

/**
 * Whether the account holds, in one of its tenants, a group that may do more than the actor may
 * there, like `roleRefusal` judges a group to give: against what they may in the tenant they work
 * in now, and in another against `permissionsByTenant`.
 */
export function heldGroupBeyond(actor: Pick<AccountActor, "isPlatformAdmin" | "tenantId" | "permissions" | "permissionsByTenant">, groups: readonly OwnerMembership[]): boolean {
    if (actor.isPlatformAdmin) return false;
    return groups.some(({ tenantId, group }) => {
        const permissions = tenantId === actor.tenantId ? actor.permissions : actor.permissionsByTenant?.[tenantId] ?? [];
        return roleRefusal({ isPlatformAdmin: false, tenantId, permissions }, group) !== null;
    });
}

/** Why the actor may not change the account by whom it belongs to, null when they may. */
function placeRefusal(actor: AccountActor, target: AccountTarget): string | null {
    if (target.isPlatformAdmin) return PLATFORM_ADMIN_ACCOUNT_REFUSAL;
    const managesAccounts = actor.permissions.includes(PERMISSIONS.PLATFORM.ACCOUNTS_WRITE);
    const reached = managesAccounts && reachCoversAccount(actor.reach ?? [], target.tenantIds);
    if (target.platformGroup) {
        if (!managesAccounts) return PLATFORM_GROUP_ACCOUNT_REFUSAL;
        const refused = platformGroupRefusal({ isPlatformAdmin: false, permissions: actor.permissions, group: actor.platformGroupShape ?? null }, target.platformGroup);
        if (refused) return PLATFORM_GROUP_ACCOUNT_REFUSAL;
        return reached ? null : BEYOND_REACH_ACCOUNT_REFUSAL;
    }
    // Who manages the accounts of the platform changes any other account of the tenants they look after.
    if (reached) return null;
    // Beyond that they change an account only as the admin of a tenant, like anyone else.
    if (managesAccounts && !actor.permissions.includes(PERMISSIONS.USERS.WRITE)) return BEYOND_REACH_ACCOUNT_REFUSAL;
    if (!actor.tenantId) return managesAccounts ? BEYOND_REACH_ACCOUNT_REFUSAL : "You work in no tenant.";
    // An account of no tenant shows in the home tenant, whose admins give it a role.
    const own = target.tenantIds.length === 0 ? actor.tenantId === HOME_TENANT_ID : target.tenantIds.every((tenantId) => tenantId === actor.tenantId);
    if (own) return null;
    return managesAccounts ? BEYOND_REACH_ACCOUNT_REFUSAL : SHARED_ACCOUNT_REFUSAL;
}

/**
 * What the check of a claimed email reads for someone who gives an account an email, see
 * `claimedEmailRefusal`: whoever manages the accounts of the platform in every tenant gives any
 * email, someone of a platform group of some tenants also the emails of the domains the providers
 * of their tenants claim, anyone else only those of the tenants of the account.
 */
export function emailClaimScope(actor: Pick<AccountActor, "isPlatformAdmin" | "permissions" | "reach">): { platformLevel: boolean; tenantIds: readonly string[] } {
    if (actor.isPlatformAdmin) return { platformLevel: true, tenantIds: [] };
    if (!actor.permissions.includes(PERMISSIONS.PLATFORM.ACCOUNTS_WRITE)) return { platformLevel: false, tenantIds: [] };
    const reach = actor.reach ?? [];
    return reach === "all" ? { platformLevel: true, tenantIds: [] } : { platformLevel: false, tenantIds: reach };
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
