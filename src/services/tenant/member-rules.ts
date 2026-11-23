import { roleRefusal, type AccountActor } from "@/lib/auth/account-access";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { reachCovers } from "@/lib/auth/platform-group-caps";
import { NotFoundError } from "@/lib/logging/errors";
import { HOME_TENANT_ID } from "@/lib/tenant/home";
import { membershipEndRefusal } from "@/services/tenant/membership-end";
import { membershipService } from "@/services/tenant/membership-service";
import { groupService } from "@/services/user/group-service";
import { platformGroupService } from "@/services/user/platform-group-service";
import { userService } from "@/services/user/user-service";
import { ACCOUNT_UNKNOWN, shownAccountName } from "@/services/user/account-visibility";

/**
 * Who gives a group of a tenant to someone from inside that tenant, on the Users tab and through
 * `/api/tenants/{id}/members` with `users:write`. Whoever manages the tenants follows the rules of
 * `member-admin.ts` instead.
 */

export const PLATFORM_ADMIN_MEMBERSHIP = "Only a platform admin changes the memberships of a platform admin.";
export const OUTSIDER = "This account works in another tenant. Add people to this tenant with an invitation.";
export const OWN_GROUP = "You cannot change your own group assignment.";
export const HELD_BEYOND_USER = "This user's group may do more than you may, so only someone who may do all of it changes it.";
export const GROUP_GONE = "The group no longer exists.";

/** Something that is gone, or that the actor may not see, in a plain sentence. */
export class MemberGoneError extends NotFoundError {
    constructor(what: string, message: string) {
        super(what, "");
        this.message = message;
    }
}

/** Who changes the group of someone in their own tenant: the admin of the tenant, with what they may do there. */
export interface TenantCaller extends AccountActor {
    id: string;
    /** An API key acts with its own rights, `permissions`, never with all of its owner's. */
    authMethod?: "session" | "apikey";
}

/** Who gives someone a membership, see `placementRefusal`. */
export interface PlacingActor {
    id: string;
    isPlatformAdmin: boolean;
    authMethod?: "session" | "apikey";
    /** What the session or the key may do, which counts for an API key instead of the rights of its owner. */
    permissions?: readonly string[];
}

/**
 * Why the actor may not give an account a membership in this tenant, null when they may. An account
 * of no tenant counts as one of the home tenant, or of the tenant whose sign-in provider claims its
 * email, see `userService.accountOf` and `placelessTenantOf`. A membership in another tenant makes it
 * an account of that tenant, whose admins then change it and set its password, so it goes there only
 * from a platform admin or someone whose rights of the platform reach its place: `platform-tenants:write`
 * or `platform-accounts:write` with a platform group that reaches that tenant, for an API key held by
 * the key itself. An account with a
 * membership already, and one that is gone, pass, the other rules and the change decide. Every path
 * that gives someone else a membership asks this, joining through an invitation oneself does not.
 */
export async function placementRefusal(actor: PlacingActor, userId: string, tenantId: string): Promise<string | null> {
    if (actor.isPlatformAdmin) return null;
    const target = await userService.accountOf(userId);
    if (!target || (target.groups?.length ?? 0) > 0) return null;
    // For an account of no tenant the tenants it counts as one of are its place, none for the home tenant.
    const place = target.tenantIds[0] ?? HOME_TENANT_ID;
    if (place === tenantId) return null;
    // The rights of the platform count from the home tenant, see `permissionsIn`, wherever the actor works.
    // An API key counts with the rights it holds, which never reach beyond its owner's, see `getAuthContext`.
    const platform = actor.authMethod === "apikey" ? actor.permissions ?? [] : await userService.permissionsIn(actor.id, HOME_TENANT_ID);
    if (!platform.includes(PERMISSIONS.PLATFORM.TENANTS_WRITE) && !platform.includes(PERMISSIONS.PLATFORM.ACCOUNTS_WRITE)) return OUTSIDER;
    return reachCovers(await platformGroupService.reachOf(actor.id), place) ? null : OUTSIDER;
}

/**
 * Why the caller may not give this group of their tenant to an account, or take its group, null
 * when they may: never their own, `ACCOUNT_UNKNOWN` for an account that does not exist or that
 * they may not see, only to the people of the tenant (`isPersonOf`), so nobody pulls
 * an account of another tenant into theirs, never to a platform admin unless a platform admin
 * gives it, and never a group that may do more than they may, given or taken. Taking someone out
 * never leaves them working alone in tenants where the caller manages the users, see
 * `membershipEndRefusal`.
 */
export async function tenantGroupRefusal(caller: TenantCaller, userId: string, groupId: string | null): Promise<string | null> {
    if (caller.id === userId) return OWN_GROUP;
    // An account that does not exist and one the caller may not see answer alike, before anything tells them apart.
    const viewer = { userId: caller.id, tenantId: caller.tenantId, allTenants: false, isPlatformAdmin: caller.isPlatformAdmin, permissions: [...caller.permissions] };
    if ((await shownAccountName(viewer, userId)) === null) return ACCOUNT_UNKNOWN;
    if (!caller.isPlatformAdmin && caller.tenantId) {
        if (!(await membershipService.isPersonOf(userId, caller.tenantId))) return OUTSIDER;
        // An account of no tenant whose email the provider of another tenant claims counts as one of
        // that tenant, so the home tenant does not pull it in either, see `placementRefusal`.
        const placed = await placementRefusal(caller, userId, caller.tenantId);
        if (placed) return placed;
        // An account of no tenant shows in the home tenant, and one of the platform keeps its own rules.
        if (await membershipService.isPlatformAdmin(userId)) return PLATFORM_ADMIN_MEMBERSHIP;
    }
    if (groupId && groupId !== "none") {
        const group = await groupService.find(groupId);
        if (!group) return GROUP_GONE;
        const refused = roleRefusal(caller, group);
        if (refused) return refused;
    }
    if (caller.isPlatformAdmin || !caller.tenantId) return null;
    const current = await membershipService.roleOf(userId, caller.tenantId);
    if (current && roleRefusal(caller, current)) return HELD_BEYOND_USER;
    return groupId === null || groupId === "none" ? membershipEndRefusal(caller, userId, caller.tenantId) : null;
}

