import { roleRefusal, type AccountActor } from "@/lib/auth/account-access";
import { NotFoundError } from "@/lib/logging/errors";
import { membershipService } from "@/services/tenant/membership-service";
import { groupService } from "@/services/user/group-service";

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
}

/**
 * Why the caller may not give this group of their tenant to an account, or take its group, null
 * when they may: never their own, only to the people of the tenant (`isPersonOf`), so nobody pulls
 * an account of another tenant into theirs, never to a platform admin unless a platform admin
 * gives it, and never a group that may do more than they may, given or taken.
 */
export async function tenantGroupRefusal(caller: TenantCaller, userId: string, groupId: string | null): Promise<string | null> {
    if (caller.id === userId) return OWN_GROUP;
    if (!caller.isPlatformAdmin && caller.tenantId) {
        if (!(await membershipService.isPersonOf(userId, caller.tenantId))) return OUTSIDER;
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
    return current && roleRefusal(caller, current) ? HELD_BEYOND_USER : null;
}

