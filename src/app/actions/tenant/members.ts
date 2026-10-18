"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { checkPermission, checkPlatformAdmin, hasPermissionWithContext } from "@/lib/auth/access-control";
import { roleRefusal, type AccountActor } from "@/lib/auth/account-access";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { AUDIT_ACTIONS, AUDIT_RESOURCES } from "@/lib/core/audit-types";
import { NotFoundError, ValidationError, wrapError } from "@/lib/logging/errors";
import { logger } from "@/lib/logging/logger";
import { runAsTenant } from "@/lib/tenant/context";
import { HOME_TENANT_ID } from "@/lib/tenant/home";
import { auditService } from "@/services/audit-service";
import { membershipService, type TenantMember } from "@/services/tenant/membership-service";
import { tenantService } from "@/services/tenant/tenant-service";
import { groupService } from "@/services/user/group-service";
import { platformGroupService } from "@/services/user/platform-group-service";
import { userService } from "@/services/user/user-service";
import { getUsersModel } from "@/services/user/users-model";

/**
 * Who works in which tenant, as whoever manages the tenants decides it on the Tenants page and in
 * the panel of an account: the members of a tenant with their group, any account added to it, and,
 * for a platform admin alone, who is a platform admin. Someone of a platform group sees and changes
 * the tenants they may open, never their own membership or that of a platform admin. A tenant
 * admin adds people to their own tenant through an invitation instead.
 */

const log = logger.child({ action: "tenant-members" });

const IdSchema = z.string().min(1).max(200);

const messageOf = (error: unknown, fallback: string) => (error instanceof ValidationError || error instanceof NotFoundError ? error.message : fallback);

/**
 * Whether the viewer may look after this tenant: a platform admin every tenant, anyone else the
 * tenants their platform group reaches. Being a member of a tenant gives no right on the platform.
 */
async function reaches(viewer: { id: string; isPlatformAdmin: boolean }, tenantId: string): Promise<boolean> {
    return viewer.isPlatformAdmin || platformGroupService.reaches(viewer.id, tenantId);
}

/** The viewer as the caps of a tenant read them: what they may do there, by their groups and their platform group. */
async function actorIn(viewer: { id: string; isPlatformAdmin: boolean }, tenantId: string): Promise<AccountActor> {
    return { isPlatformAdmin: viewer.isPlatformAdmin, tenantId, permissions: viewer.isPlatformAdmin ? [] : await userService.permissionsIn(viewer.id, tenantId) };
}

const GROUP_BEYOND = "This group may do more than you may in this tenant, so you cannot give it to anyone.";
const HELD_BEYOND = "This account's group may do more than you may in this tenant, so only someone who may do all of it changes it.";
/** An account the viewer may not see reads as one that does not exist. */
const ACCOUNT_GONE = "The account no longer exists.";

export interface TenantMembersData {
    members: TenantMember[];
    /** Every account of the instance, for Add member. */
    accounts: { id: string; name: string; email: string; platformAdmin: boolean }[];
    groups: { id: string; name: string; fullAccess: boolean }[];
}

/** The members of a tenant with what Add member offers, which only whoever may change the members gets. */
export async function getTenantMembers(tenantId: string): Promise<{ success: true; data: TenantMembersData } | { success: false; error: string }> {
    const viewer = await checkPermission(PERMISSIONS.PLATFORM.TENANTS_READ);
    const parsed = IdSchema.safeParse(tenantId);
    if (!parsed.success) return { success: false, error: "Invalid request" };
    if (!(await tenantService.find(parsed.data)) || !(await reaches(viewer, parsed.data))) return { success: false, error: "The tenant no longer exists." };

    const changes = hasPermissionWithContext(viewer, PERMISSIONS.PLATFORM.TENANTS_WRITE);
    const [members, accounts, users, actor] = await Promise.all([
        membershipService.members(parsed.data),
        changes ? addableAccounts(viewer) : [],
        // The groups of that tenant as its Users tab lists them, read there, wherever the platform admin works.
        runAsTenant(parsed.data, () => getUsersModel(viewer.id, true, parsed.data)),
        actorIn(viewer, parsed.data),
    ]);
    // Add member offers the groups the viewer may give in that tenant.
    const groups = users.groups.filter((group) => !roleRefusal(actor, { permissions: JSON.stringify(group.permissions), fullAccess: group.superAdmin }));
    return {
        success: true,
        data: { members, accounts, groups: groups.map((group) => ({ id: group.id, name: group.name, fullAccess: group.superAdmin })) },
    };
}

/**
 * The accounts Add member offers: every account for a platform admin, else the people of the
 * tenants the viewer's platform group reaches, every account for a group of all tenants. The right
 * to see the accounts of the platform reaches no further. Never a platform admin or the viewer,
 * whose memberships a platform admin changes.
 */
async function addableAccounts(viewer: { id: string; isPlatformAdmin: boolean }) {
    const accounts = await membershipService.accounts();
    if (viewer.isPlatformAdmin) return accounts;
    const reachable = new Set(await platformGroupService.peopleReached(viewer.id));
    return accounts.filter((account) => !account.platformAdmin && account.id !== viewer.id && reachable.has(account.id));
}

/** Whether the viewer sees an account: a platform admin every one, anyone else the people of the tenants their platform group reaches. */
async function seesAccount(viewer: { id: string; isPlatformAdmin: boolean }, userId: string): Promise<boolean> {
    return viewer.isPlatformAdmin || (await platformGroupService.peopleReached(viewer.id)).includes(userId);
}

/** Gives an account a group in a tenant, which adds it there, or takes it out of the tenant with null. */
export async function setTenantMember(tenantId: string, userId: string, groupId: string | null) {
    const viewer = await checkPermission(PERMISSIONS.PLATFORM.TENANTS_WRITE);
    const tenant = IdSchema.safeParse(tenantId);
    const user = IdSchema.safeParse(userId);
    const group = IdSchema.nullable().safeParse(groupId);
    if (!tenant.success || !user.success || !group.success) return { success: false as const, error: "Invalid request" };
    if (!viewer.isPlatformAdmin) {
        if (user.data === viewer.id) return { success: false as const, error: "Another admin changes your own membership." };
        if (await membershipService.isPlatformAdmin(user.data)) return { success: false as const, error: "Only a platform admin changes the memberships of a platform admin." };
        if (!(await reaches(viewer, tenant.data))) return { success: false as const, error: "The tenant no longer exists." };
    }

    try {
        // A group belongs to its tenant, so it is looked up there, and one of another tenant reads as gone.
        const groupId = group.data;
        const [target, role] = await Promise.all([tenantService.find(tenant.data), groupId ? runAsTenant(tenant.data, () => groupService.find(groupId)) : null]);
        if (!target) return { success: false as const, error: "The tenant no longer exists." };
        if (group.data && !role) return { success: false as const, error: "The group no longer exists." };
        // Nobody gives or takes a group that may do more than they may in that tenant.
        if (!viewer.isPlatformAdmin) {
            const actor = await actorIn(viewer, tenant.data);
            if (role && roleRefusal(actor, role)) return { success: false as const, error: GROUP_BEYOND };
            const current = await membershipService.roleOf(user.data, tenant.data);
            if (current && roleRefusal(actor, current)) return { success: false as const, error: HELD_BEYOND };
            // A new membership adds only an account the viewer may see, like Add member offers it.
            // Otherwise someone of a platform group of one tenant could pull an account of another in.
            if (role && !current && !(await seesAccount(viewer, user.data))) return { success: false as const, error: ACCOUNT_GONE };
        }
        // A platform admin manages every tenant, so they may leave one without anyone else who does.
        await membershipService.setRole(user.data, tenant.data, group.data, { platformAdmin: viewer.isPlatformAdmin });
        await auditService.log(
            viewer.id,
            AUDIT_ACTIONS.UPDATE,
            AUDIT_RESOURCES.USER,
            { change: role ? "Tenant group set" : "Removed from tenant", tenant: target.name, ...(role ? { group: role.name } : {}) },
            user.data,
            { tenantId: tenant.data }
        );
        revalidatePath("/dashboard", "layout");
        return { success: true as const };
    } catch (error: unknown) {
        if (!(error instanceof ValidationError || error instanceof NotFoundError)) log.error("Setting a tenant member failed", { tenantId: tenant.data }, wrapError(error));
        return { success: false as const, error: messageOf(error, "The member could not be changed.") };
    }
}

/**
 * Makes an account a platform admin or takes it back. Nobody changes their own, and the last
 * platform admin stays one.
 */
export async function setPlatformAdmin(userId: string, on: boolean) {
    const viewer = await checkPlatformAdmin();
    const user = IdSchema.safeParse(userId);
    if (!user.success) return { success: false as const, error: "Invalid request" };
    if (user.data === viewer.id) return { success: false as const, error: "Another platform admin changes your own role." };

    try {
        await membershipService.setPlatformAdmin(user.data, on);
        await auditService.log(viewer.id, AUDIT_ACTIONS.UPDATE, AUDIT_RESOURCES.USER, { change: on ? "Made platform admin" : "No platform admin any more" }, user.data, { tenantId: HOME_TENANT_ID });
        revalidatePath("/dashboard", "layout");
        return { success: true as const };
    } catch (error: unknown) {
        if (!(error instanceof ValidationError)) log.error("Changing a platform admin failed", { userId: user.data }, wrapError(error));
        return { success: false as const, error: messageOf(error, "The role could not be changed.") };
    }
}
