import type { AuthContext } from "@/lib/auth/access-control";
import { roleRefusal, type AccountActor } from "@/lib/auth/account-access";
import { AUDIT_ACTIONS, AUDIT_RESOURCES } from "@/lib/core/audit-types";
import { runAsTenant } from "@/lib/tenant/context";
import { HOME_TENANT_ID } from "@/lib/tenant/home";
import { auditService } from "@/services/audit-service";
import { membershipService, type TenantMember } from "@/services/tenant/membership-service";
import { GROUP_GONE, MemberGoneError, placementRefusal, PLATFORM_ADMIN_MEMBERSHIP, tenantGroupRefusal, type TenantCaller } from "@/services/tenant/member-rules";
import { ACCOUNT_UNKNOWN } from "@/services/user/account-visibility";
import { membershipEndRefusal } from "@/services/tenant/membership-end";
import { assertManages, platformOrigin, TenantAdminRefusal, TenantGoneError, tenantOrigin, type TenantAdminActor } from "@/services/tenant/tenant-admin";
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

/**
 * The entry of a change of a membership, in the log of the tenant, named after the account. A
 * change from Platform > Tenants also goes into the log of the platform, like the other changes
 * the platform makes to a tenant.
 */
async function logMembership(actor: Pick<TenantAdminActor, "id" | "apiKeyId">, tenantId: string, tenantName: string, userId: string, group: { name: string } | null, fromPlatform = false) {
    const [account] = await userService.namesOf([userId]);
    const details = {
        change: group ? "Tenant group set" : "Removed from tenant",
        ...(account ? { name: account.name } : {}),
        tenant: tenantName,
        // The id beside the name, so the log of the home tenant shows the entry only to whoever reaches the tenant.
        tenantId,
        ...(group ? { group: group.name } : {}),
    };
    await auditService.log(actor.id, AUDIT_ACTIONS.UPDATE, AUDIT_RESOURCES.USER, details, userId, tenantOrigin(actor, tenantId));
    if (fromPlatform && tenantId !== HOME_TENANT_ID) await auditService.log(actor.id, AUDIT_ACTIONS.UPDATE, AUDIT_RESOURCES.USER, details, userId, platformOrigin(actor));
}

/**
 * Gives an account a group in a tenant the actor looks after, which adds it there, or takes it out
 * of the tenant with null. Nobody but a platform admin changes their own membership or that of a
 * platform admin, nobody gives or takes a group that may do more than they may in that tenant, and
 * nobody takes an account out so that it works alone where they manage the users.
 */
export async function setMemberAs(actor: TenantAdminActor, tenantId: string, userId: string, groupId: string | null): Promise<void> {
    if (!actor.isPlatformAdmin) {
        // A tenant beyond the actor reads as gone before anything else, so the answer tells nothing
        // about the account, like whether it is one of a platform admin.
        await assertManages(actor, tenantId);
        if (userId === actor.id) throw new TenantAdminRefusal(OWN_MEMBERSHIP);
        if (await membershipService.isPlatformAdmin(userId)) {
            // A platform admin the actor may not see reads like an account that does not exist.
            if (!(await seesAccount(actor, userId))) throw new MemberGoneError("User", ACCOUNT_GONE);
            throw new TenantAdminRefusal(PLATFORM_ADMIN_MEMBERSHIP);
        }
    }
    // A group belongs to its tenant, so it is looked up there, and one of another tenant reads as gone.
    const [target, role] = await Promise.all([tenantService.find(tenantId), groupId ? runAsTenant(tenantId, () => groupService.find(groupId)) : null]);
    if (!target) throw new TenantGoneError(tenantId);
    if (groupId && !role) throw new MemberGoneError("Group", GROUP_GONE);
    const current = await membershipService.roleOf(userId, tenantId);
    // Taking out someone who is no member there removes nothing, so it answers like an account that
    // does not exist, also for one beyond the actor, and writes no entry.
    if (!groupId && !current) throw new MemberGoneError("User", ACCOUNT_GONE);
    if (!actor.isPlatformAdmin) {
        const caps = await actorIn(actor, tenantId);
        if (role && roleRefusal(caps, role)) throw new TenantAdminRefusal(GROUP_BEYOND);
        if (current && roleRefusal(caps, current)) throw new TenantAdminRefusal(HELD_BEYOND);
        // A new membership adds only an account the actor may see, like Add member offers it.
        // Otherwise someone of a platform group of one tenant could pull an account of another in.
        if (role && !current && !(await seesAccount(actor, userId))) throw new MemberGoneError("User", ACCOUNT_GONE);
        // An account of no tenant joins another tenant than its place only from someone who reaches that
        // place, or the admins of this tenant could change it afterwards, see `placementRefusal`.
        const placed = role && !current ? await placementRefusal(actor, userId, tenantId) : null;
        if (placed) throw new TenantAdminRefusal(placed);
        // Taking an account out never leaves it working alone where the actor manages the users,
        // which would let them change it, see `membershipEndRefusal`.
        const handsOver = groupId ? null : await membershipEndRefusal(actor, userId, tenantId);
        if (handsOver) throw new TenantAdminRefusal(handsOver);
    }
    // A platform admin manages every tenant, so they may leave one without anyone else who does.
    await membershipService.setRole(userId, tenantId, groupId, { platformAdmin: actor.isPlatformAdmin });
    await logMembership(actor, tenantId, target.name, userId, role, true);
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
    // An account that does not exist or that the caller may not see reads as gone, like in `setMemberAs`.
    if (refused === ACCOUNT_UNKNOWN) throw new MemberGoneError("User", ACCOUNT_GONE);
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
        authMethod: ctx.authMethod,
        apiKeyId: ctx.authMethod === "apikey" ? ctx.apiKeyId ?? null : null,
    };
}
