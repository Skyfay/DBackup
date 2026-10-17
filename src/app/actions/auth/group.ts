"use server"

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { checkPermission, type Viewer } from "@/lib/auth/access-control";
import { roleRefusal } from "@/lib/auth/account-access";
import { capToTenant, groupCapRefusal } from "@/lib/auth/group-caps";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { AUDIT_ACTIONS, AUDIT_RESOURCES } from "@/lib/core/audit-types";
import type { BulkResult } from "@/lib/core/bulk";
import { BulkIdsSchema } from "@/lib/core/bulk-schema";
import { NotFoundError, ValidationError, wrapError } from "@/lib/logging/errors";
import { logger } from "@/lib/logging/logger";
import { auditService } from "@/services/audit-service";
import { fromPlatform, groupService } from "@/services/user/group-service";
import { membershipService } from "@/services/tenant/membership-service";
import { userService } from "@/services/user/user-service";

/**
 * The groups of the tenant the viewer works in. A group belongs to one tenant, so it is made,
 * changed, deleted and given there, and its changes go into the audit log of that tenant. All
 * tenants, which changes no tenant, is refused. Nobody makes or changes a group that may do more
 * than they may, a group outside the home tenant never holds the settings of the instance, and
 * the group with every permission stays as it is.
 */

const log = logger.child({ action: "group" });

const GroupSchema = z.object({
    name: z.string().trim().min(1, "Give the group a name.").max(100, "The name can have at most 100 characters."),
    permissions: z.array(z.string().max(64)).max(100),
    /** The template of the first step of New group, kept in the audit log. */
    template: z.string().max(40).optional(),
});

export type GroupFormValues = z.input<typeof GroupSchema>;

const IdSchema = z.string().min(1).max(200);

const OPEN_A_TENANT = "Open a tenant to change its groups.";
const GROUP_BEYOND = "This group may do more than you may, so only someone who may do all of it changes it.";
const MOVE_BEYOND = "This group may do more than you may, so you cannot move anyone into it.";

/** The message of a refusal the user can act on, a plain one for anything else. */
const messageOf = (error: unknown, fallback: string) => (error instanceof ValidationError || error instanceof NotFoundError ? error.message : fallback);

/** The tenant whose groups the viewer changes, or why there is none. */
function tenantOf(viewer: Viewer): { tenantId: string } | { error: string } {
    return viewer.allTenants || !viewer.tenantId ? { error: OPEN_A_TENANT } : { tenantId: viewer.tenantId };
}

export async function createGroup(input: GroupFormValues) {
    const viewer = await checkPermission(PERMISSIONS.GROUPS.WRITE);
    const parsed = GroupSchema.safeParse(input);
    if (!parsed.success) return { success: false, error: parsed.error.issues[0]?.message ?? "Invalid request" };
    const scope = tenantOf(viewer);
    if ("error" in scope) return { success: false, error: scope.error };

    const permissions = capToTenant(parsed.data.permissions, scope.tenantId);
    const refused = groupCapRefusal(viewer, permissions);
    if (refused) return { success: false, error: refused };

    try {
        const group = await groupService.create({ name: parsed.data.name, permissions });
        revalidatePath("/dashboard/users");
        await auditService.log(
            viewer.id,
            AUDIT_ACTIONS.CREATE,
            AUDIT_RESOURCES.GROUP,
            { name: group.name, permissions: group.permissions, ...(parsed.data.template ? { template: parsed.data.template } : {}) },
            group.id
        );
        return { success: true, data: { id: group.id } };
    } catch (error: unknown) {
        log.error("Failed to create group", {}, wrapError(error));
        return { success: false, error: messageOf(error, "The group could not be created.") };
    }
}

/**
 * Saves a group. The audit log gets what changed, not the whole list of permissions. Nobody
 * changes the group they are in, since that would hand them any permission, nor a group that
 * may do more than they may.
 */
export async function updateGroup(id: string, input: GroupFormValues) {
    const viewer = await checkPermission(PERMISSIONS.GROUPS.WRITE);
    const groupId = IdSchema.safeParse(id);
    const parsed = GroupSchema.safeParse(input);
    if (!groupId.success || !parsed.success) return { success: false, error: parsed.error?.issues[0]?.message ?? "Invalid request" };
    const scope = tenantOf(viewer);
    if ("error" in scope) return { success: false, error: scope.error };

    if (await groupService.heldBy(groupId.data, viewer.id)) {
        return { success: false, error: "You are in this group. Another admin changes it." };
    }
    const group = await groupService.find(groupId.data);
    if (!group) return { success: false, error: "The group no longer exists." };
    if (group.fullAccess) return { success: false, error: `${group.name} holds every permission and cannot be edited.` };
    if (group.templateId) return { success: false, error: fromPlatform(group.name) };
    if (roleRefusal(viewer, group)) return { success: false, error: GROUP_BEYOND };

    const permissions = capToTenant(parsed.data.permissions, scope.tenantId);
    const refused = groupCapRefusal(viewer, permissions);
    if (refused) return { success: false, error: refused };

    try {
        const change = await groupService.update(groupId.data, { name: parsed.data.name, permissions }, { platformAdmin: viewer.isPlatformAdmin });
        revalidatePath("/dashboard/users");
        await auditService.log(viewer.id, AUDIT_ACTIONS.UPDATE, AUDIT_RESOURCES.GROUP, { ...change }, groupId.data);
        return { success: true };
    } catch (error: unknown) {
        log.error("Failed to update group", { groupId: groupId.data }, wrapError(error));
        return { success: false, error: messageOf(error, "The group could not be saved.") };
    }
}

/**
 * Deletes a group of the tenant and moves its members to `moveTo`, another group there, or to
 * none, which takes them out of the tenant. Nobody deletes their own group or one that may do
 * more than they may, and nobody moves people into a group that may do more than they may.
 */
export async function deleteGroup(id: string, moveTo: string | null = null) {
    const viewer = await checkPermission(PERMISSIONS.GROUPS.WRITE);
    const groupId = IdSchema.safeParse(id);
    const target = IdSchema.nullable().safeParse(moveTo);
    if (!groupId.success || !target.success) return { success: false, error: "Invalid request" };
    const scope = tenantOf(viewer);
    if ("error" in scope) return { success: false, error: scope.error };

    if (await groupService.heldBy(groupId.data, viewer.id)) {
        return { success: false, error: "You are in this group. Another admin deletes it." };
    }
    const group = await groupService.find(groupId.data);
    if (!group) return { success: false, error: "The group no longer exists." };
    if (group.templateId) return { success: false, error: fromPlatform(group.name) };
    if (roleRefusal(viewer, group)) return { success: false, error: GROUP_BEYOND };
    const moveToGroup = target.data ? await groupService.find(target.data) : null;
    if (target.data && !moveToGroup) return { success: false, error: "The group for the members no longer exists." };
    if (moveToGroup && roleRefusal(viewer, moveToGroup)) return { success: false, error: MOVE_BEYOND };

    try {
        const result = await groupService.delete(groupId.data, target.data, { platformAdmin: viewer.isPlatformAdmin });
        revalidatePath("/dashboard/users");
        await auditService.log(viewer.id, AUDIT_ACTIONS.DELETE, AUDIT_RESOURCES.GROUP, { name: result.name, moved: result.moved, moveTo: target.data }, groupId.data);
        return { success: true, data: { moved: result.moved } };
    } catch (error: unknown) {
        log.error("Failed to delete group", { groupId: groupId.data }, wrapError(error));
        return { success: false, error: messageOf(error, "The group could not be deleted.") };
    }
}

/**
 * Deletes several groups of the tenant. Groups with members are refused and listed, since each
 * needs a group for its members, which the delete of a single group asks for, and so is a group
 * that may do more than the viewer. The group with every permission stays.
 */
export async function bulkDeleteGroups(ids: string[]) {
    const viewer = await checkPermission(PERMISSIONS.GROUPS.WRITE);
    const parsed = BulkIdsSchema.safeParse(ids);
    if (!parsed.success) return { success: false as const, error: "Invalid request" };
    const scope = tenantOf(viewer);
    if ("error" in scope) return { success: false as const, error: scope.error };

    try {
        // A group that may do more than the viewer stays, with why.
        const beyond: BulkResult["failed"] = [];
        if (!viewer.isPlatformAdmin) {
            for (const id of parsed.data) {
                const group = await groupService.find(id);
                if (group && roleRefusal(viewer, group)) beyond.push({ id, name: group.name, error: GROUP_BEYOND });
            }
        }
        const allowed = parsed.data.filter((id) => !beyond.some((entry) => entry.id === id));
        const deleted = allowed.length > 0 ? await groupService.deleteMany(allowed) : { succeeded: [], failed: [] };
        const result: BulkResult = { succeeded: deleted.succeeded, failed: [...deleted.failed, ...beyond] };
        revalidatePath("/dashboard/users");

        await auditService.log(
            viewer.id,
            AUDIT_ACTIONS.DELETE,
            AUDIT_RESOURCES.GROUP,
            { bulk: true, requested: parsed.data.length, succeeded: result.succeeded.length, failed: result.failed.length },
        );

        return { success: true as const, data: result };
    } catch (error: unknown) {
        log.error("Failed to bulk delete groups", {}, wrapError(error));
        return { success: false as const, error: "Failed to delete groups" };
    }
}

/**
 * Moves people into a group, or into none, in the caller's tenant, for Add people and Move of a
 * group. Nobody moves themselves, gives a group that may do more than they may, or moves someone
 * whose group may do more. Each move is written to the audit log like a change of the group of
 * one user.
 */
export async function moveUsersToGroup(userIds: string[], groupId: string | null) {
    const viewer = await checkPermission(PERMISSIONS.USERS.WRITE);
    const ids = BulkIdsSchema.safeParse(userIds);
    const target = IdSchema.nullable().safeParse(groupId);
    if (!ids.success || !target.success) return { success: false as const, error: "Invalid request" };
    // A group is given in one tenant, All tenants gives none.
    const scope = tenantOf(viewer);
    if ("error" in scope) return { success: false as const, error: "Open a tenant to move people between groups." };
    const tenantId = scope.tenantId;

    const group = target.data ? await groupService.find(target.data) : null;
    if (target.data && !group) return { success: false as const, error: "The group no longer exists." };
    const refused = group ? roleRefusal(viewer, group) : null;
    if (refused) return { success: false as const, error: refused };

    try {
        // Nobody takes a group from someone that may do more than they may, and only the people of
        // the tenant get one of its groups here, see `outsiderRefused` in user.ts.
        const guarded: string[] = [];
        const outsiders: string[] = [];
        if (!viewer.isPlatformAdmin) {
            for (const id of ids.data) {
                if (!(await membershipService.isPersonOf(id, tenantId)) || (await membershipService.isPlatformAdmin(id))) {
                    outsiders.push(id);
                    continue;
                }
                const current = await membershipService.roleOf(id, tenantId);
                if (current && roleRefusal(viewer, current)) guarded.push(id);
            }
        }
        const movable = ids.data.filter((id) => id !== viewer.id && !guarded.includes(id) && !outsiders.includes(id));
        const result = await membershipService.setRoles(movable, tenantId, target.data, { platformAdmin: viewer.isPlatformAdmin });

        if (ids.data.includes(viewer.id)) {
            result.failed.push({ id: viewer.id, name: viewer.name || viewer.email, error: "You cannot change your own group." });
        }
        for (const user of await userService.namesOf(guarded)) {
            result.failed.push({ id: user.id, name: user.name, error: "This user's group may do more than you may, so only someone who may do all of it changes it." });
        }
        for (const user of await userService.namesOf(outsiders)) {
            result.failed.push({ id: user.id, name: user.name, error: "This account works in another tenant. Add people to this tenant with an invitation." });
        }

        for (const id of result.succeeded) {
            await auditService.log(viewer.id, AUDIT_ACTIONS.UPDATE, AUDIT_RESOURCES.USER, { change: "Updating Group", groupId: target.data ?? "none" }, id);
        }
        revalidatePath("/dashboard/users");
        return { success: true as const, data: result };
    } catch (error: unknown) {
        log.error("Failed to move users", {}, wrapError(error));
        return { success: false as const, error: "The people could not be moved." };
    }
}
