"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { checkPermission, checkPlatformAdmin, hasPermissionWithContext } from "@/lib/auth/access-control";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { AUDIT_ACTIONS, AUDIT_RESOURCES } from "@/lib/core/audit-types";
import { NotFoundError, PermissionError, ValidationError, wrapError } from "@/lib/logging/errors";
import { logger } from "@/lib/logging/logger";
import { HOME_TENANT_ID } from "@/lib/tenant/home";
import { auditService } from "@/services/audit-service";
import { membershipService } from "@/services/tenant/membership-service";
import { membersFor, setMemberAs, type TenantMembersData } from "@/services/tenant/member-admin";
import type { TenantAdminActor } from "@/services/tenant/tenant-admin";

/**
 * Who works in which tenant, as whoever manages the tenants decides it on the Tenants page and in
 * the panel of an account: the members of a tenant with their group, any account added to it, and,
 * for a platform admin alone, who is a platform admin. Someone of a platform group sees and changes
 * the tenants they may open, never their own membership or that of a platform admin. A tenant
 * admin adds people to their own tenant through an invitation instead.
 */

const log = logger.child({ action: "tenant-members" });

const IdSchema = z.string().min(1).max(200);

const messageOf = (error: unknown, fallback: string) =>
    error instanceof ValidationError || error instanceof NotFoundError || error instanceof PermissionError ? error.message : fallback;

/** The viewer as the rules of `member-admin.ts` read them, their reach read per check from their platform group. */
const actorOf = (viewer: { id: string; isPlatformAdmin: boolean; tenantId: string | null }): TenantAdminActor => ({ id: viewer.id, isPlatformAdmin: viewer.isPlatformAdmin, tenantId: viewer.tenantId });

export type { TenantMembersData };

/** The members of a tenant with what Add member offers, which only whoever may change the members gets. */
export async function getTenantMembers(tenantId: string): Promise<{ success: true; data: TenantMembersData } | { success: false; error: string }> {
    const viewer = await checkPermission(PERMISSIONS.PLATFORM.TENANTS_READ);
    const parsed = IdSchema.safeParse(tenantId);
    if (!parsed.success) return { success: false, error: "Invalid request" };
    try {
        return { success: true, data: await membersFor(actorOf(viewer), parsed.data, hasPermissionWithContext(viewer, PERMISSIONS.PLATFORM.TENANTS_WRITE)) };
    } catch (error: unknown) {
        if (!(error instanceof NotFoundError)) log.error("Reading the members of a tenant failed", { tenantId: parsed.data }, wrapError(error));
        return { success: false, error: messageOf(error, "The members could not be read.") };
    }
}

/** Gives an account a group in a tenant, which adds it there, or takes it out of the tenant with null. */
export async function setTenantMember(tenantId: string, userId: string, groupId: string | null) {
    const viewer = await checkPermission(PERMISSIONS.PLATFORM.TENANTS_WRITE);
    const tenant = IdSchema.safeParse(tenantId);
    const user = IdSchema.safeParse(userId);
    const group = IdSchema.nullable().safeParse(groupId);
    if (!tenant.success || !user.success || !group.success) return { success: false as const, error: "Invalid request" };

    try {
        await setMemberAs(actorOf(viewer), tenant.data, user.data, group.data);
        revalidatePath("/dashboard", "layout");
        return { success: true as const };
    } catch (error: unknown) {
        if (!(error instanceof ValidationError || error instanceof NotFoundError || error instanceof PermissionError)) log.error("Setting a tenant member failed", { tenantId: tenant.data }, wrapError(error));
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
