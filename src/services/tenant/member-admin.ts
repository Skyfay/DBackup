import type { AuthContext } from "@/lib/auth/access-control";
import { roleRefusal, type AccountActor } from "@/lib/auth/account-access";
import { AUDIT_ACTIONS, AUDIT_RESOURCES } from "@/lib/core/audit-types";
import { runAsTenant } from "@/lib/tenant/context";
import { auditService } from "@/services/audit-service";
import { membershipService, type TenantMember } from "@/services/tenant/membership-service";
import { GROUP_GONE, MemberGoneError, PLATFORM_ADMIN_MEMBERSHIP, tenantGroupRefusal, type TenantCaller } from "@/services/tenant/member-rules";
import { assertManages, TenantAdminRefusal, TenantGoneError, tenantOrigin, type TenantAdminActor } from "@/services/tenant/tenant-admin";
import { tenantService } from "@/services/tenant/tenant-service";
import { groupService } from "@/services/user/group-service";
import { platformGroupService } from "@/services/user/platform-group-service";
import { userService } from "@/services/user/user-service";
import { getUsersModel } from "@/services/user/users-model";

/**
 * Who works in which tenant. Whoever manages the tenants gives any account they see a group in a
 * tenant they look after, on Platform > Tenants and through `/api/tenants/{id}/members`. The admin
 * of a tenant changes the group of its own people only, on the Users tab and through the same
 * route with `users:write`, and adds others through an invitation. The caller checked the right.
 */

export const GROUP_BEYOND = "This group may do more than you may in this tenant, so you cannot give it to anyone.";
export const HELD_BEYOND = "This account's group may do more than you may in this tenant, so only someone who may do all of it changes it.";
export const OWN_MEMBERSHIP = "Another admin changes your own membership.";
/** An account the actor may not see reads as one that does not exist. */
export const ACCOUNT_GONE = "The account no longer exists.";

export interface TenantMembersData {
    members: TenantMember[];
    /** Every account Add member offers, for whoever may change the members. */
    accounts: { id: string; name: string; email: string; platformAdmin: boolean }[];
    groups: { id: string; name: string; fullAccess: boolean }[];
}

/** The actor as the caps of a tenant read them: what they may do there, by their groups and their platform group. */
export async function actorIn(actor: Pick<TenantAdminActor, "id" | "isPlatformAdmin">, tenantId: string): Promise<AccountActor> {
    return { isPlatformAdmin: actor.isPlatformAdmin, tenantId, permissions: actor.isPlatformAdmin ? [] : await userService.permissionsIn(actor.id, tenantId) };
}

/**
 * The accounts Add member offers: every account for a platform admin, else the people of the
 * tenants the actor's platform group reaches, every account for a reach of all tenants. Never a
 * platform admin or the actor, whose memberships a platform admin changes.
 */
async function addableAccounts(actor: TenantAdminActor) {
    const accounts = await membershipService.accounts();
    if (actor.isPlatformAdmin) return accounts;
    const others = accounts.filter((account) => !account.platformAdmin && account.id !== actor.id);
    if (actor.reach === "all") return others;
    const reachable = new Set(await platformGroupService.peopleReached(actor.id));
    return others.filter((account) => reachable.has(account.id));
}

/** Whether the actor sees an account: a platform admin every one, anyone else the people of the tenants their platform group reaches. */
async function seesAccount(actor: TenantAdminActor, userId: string): Promise<boolean> {
    if (actor.isPlatformAdmin || actor.reach === "all") return true;
    return (await platformGroupService.peopleReached(actor.id)).includes(userId);
}

/** The members of a tenant the actor looks after, with what Add member offers when they may change the members. */
export async function membersFor(actor: TenantAdminActor, tenantId: string, changes: boolean): Promise<TenantMembersData> {
    if (!(await tenantService.find(tenantId))) throw new TenantGoneError(tenantId);
    await assertManages(actor, tenantId);
    const [members, accounts, users, caps] = await Promise.all([
        membershipService.members(tenantId),
        changes ? addableAccounts(actor) : [],
        // The groups of that tenant as its Users tab lists them, read there, wherever the actor works.
        runAsTenant(tenantId, () => getUsersModel(actor.id, true, tenantId)),
        actorIn(actor, tenantId),
    ]);
    // Add member offers the groups the actor may give in that tenant.
    const groups = users.groups.filter((group) => !roleRefusal(caps, { permissions: JSON.stringify(group.permissions), fullAccess: group.superAdmin }));
    return { members, accounts, groups: groups.map((group) => ({ id: group.id, name: group.name, fullAccess: group.superAdmin })) };
}

/** The entry of a change of a membership, in the log of the tenant. */
async function logMembership(actor: Pick<TenantAdminActor, "id" | "apiKeyId">, tenantId: string, tenantName: string, userId: string, group: { name: string } | null) {
    await auditService.log(
        actor.id,
        AUDIT_ACTIONS.UPDATE,
        AUDIT_RESOURCES.USER,
        { change: group ? "Tenant group set" : "Removed from tenant", tenant: tenantName, ...(group ? { group: group.name } : {}) },
        userId,
        tenantOrigin(actor, tenantId)
    );
}

/**
 * Gives an account a group in a tenant the actor looks after, which adds it there, or takes it out
 * of the tenant with null. Nobody but a platform admin changes their own membership or that of a
 * platform admin, and nobody gives or takes a group that may do more than they may in that tenant.
 */
export async function setMemberAs(actor: TenantAdminActor, tenantId: string, userId: string, groupId: string | null): Promise<void> {
    if (!actor.isPlatformAdmin) {
        if (userId === actor.id) throw new TenantAdminRefusal(OWN_MEMBERSHIP);
        if (await membershipService.isPlatformAdmin(userId)) throw new TenantAdminRefusal(PLATFORM_ADMIN_MEMBERSHIP);
        await assertManages(actor, tenantId);
    }
    // A group belongs to its tenant, so it is looked up there, and one of another tenant reads as gone.
    const [target, role] = await Promise.all([tenantService.find(tenantId), groupId ? runAsTenant(tenantId, () => groupService.find(groupId)) : null]);
    if (!target) throw new TenantGoneError(tenantId);
    if (groupId && !role) throw new MemberGoneError("Group", GROUP_GONE);
    if (!actor.isPlatformAdmin) {
        const caps = await actorIn(actor, tenantId);
        if (role && roleRefusal(caps, role)) throw new TenantAdminRefusal(GROUP_BEYOND);
        const current = await membershipService.roleOf(userId, tenantId);
        if (current && roleRefusal(caps, current)) throw new TenantAdminRefusal(HELD_BEYOND);
        // A new membership adds only an account the actor may see, like Add member offers it.
        // Otherwise someone of a platform group of one tenant could pull an account of another in.
        if (role && !current && !(await seesAccount(actor, userId))) throw new MemberGoneError("User", ACCOUNT_GONE);
    }
    // A platform admin manages every tenant, so they may leave one without anyone else who does.
    await membershipService.setRole(userId, tenantId, groupId, { platformAdmin: actor.isPlatformAdmin });
    await logMembership(actor, tenantId, target.name, userId, role);
}

/**
 * Gives one of the people of the caller's own tenant a group there, or takes them out with null,
 * for an API key or a session of that tenant with `users:write`. Runs in the scope of the request,
 * the tenant of the caller.
 */
export async function setOwnTenantMemberAs(caller: TenantCaller & { apiKeyId?: string | null }, userId: string, groupId: string | null): Promise<void> {
    const tenantId = caller.tenantId;
    if (!tenantId) throw new TenantGoneError("");
    const refused = await tenantGroupRefusal(caller, userId, groupId);
    if (refused === GROUP_GONE) throw new MemberGoneError("Group", GROUP_GONE);
    if (refused) throw new TenantAdminRefusal(refused);
    const [target, role] = await Promise.all([tenantService.find(tenantId), groupId ? groupService.find(groupId) : null]);
    if (!target) throw new TenantGoneError(tenantId);
    await membershipService.setRole(userId, tenantId, groupId, { platformAdmin: caller.isPlatformAdmin });
    await logMembership(caller, tenantId, target.name, userId, role);
}

/** The caller of a route of the tenant itself, with what the session or the key may do there. */
export function tenantCallerOf(ctx: Pick<AuthContext, "userId" | "isPlatformAdmin" | "tenantId" | "permissions" | "authMethod" | "apiKeyId">): TenantCaller & { apiKeyId: string | null } {
    return {
        id: ctx.userId,
        isPlatformAdmin: ctx.isPlatformAdmin,
        tenantId: ctx.tenantId,
        permissions: ctx.permissions,
        apiKeyId: ctx.authMethod === "apikey" ? ctx.apiKeyId ?? null : null,
    };
}
