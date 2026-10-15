"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { checkPermission, checkPlatformAdmin, hasPermissionWithContext } from "@/lib/auth/access-control";
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

/** Whether the viewer may look after this tenant: a platform admin every tenant, anyone else the tenants they may open. */
async function reaches(viewer: { id: string; isPlatformAdmin: boolean }, tenantId: string): Promise<boolean> {
    if (viewer.isPlatformAdmin) return true;
    return (await tenantService.switchable(viewer.id, false)).some((tenant) => tenant.id === tenantId);
}

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

    const [members, accounts, users] = await Promise.all([
        membershipService.members(parsed.data),
        hasPermissionWithContext(viewer, PERMISSIONS.PLATFORM.TENANTS_WRITE) ? membershipService.accounts() : [],
        // The groups of that tenant as its Users tab lists them, read there, wherever the platform admin works.
        runAsTenant(parsed.data, () => getUsersModel(viewer.id, true, parsed.data)),
    ]);
    return {
        success: true,
        data: { members, accounts, groups: users.groups.map((group) => ({ id: group.id, name: group.name, fullAccess: group.superAdmin })) },
    };
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
