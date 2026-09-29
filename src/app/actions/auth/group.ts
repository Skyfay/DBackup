"use server"

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { checkPermission, getCurrentUserWithGroup } from "@/lib/auth/access-control";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { AUDIT_ACTIONS, AUDIT_RESOURCES } from "@/lib/core/audit-types";
import { BulkIdsSchema } from "@/lib/core/bulk-schema";
import { ValidationError, wrapError } from "@/lib/logging/errors";
import { logger } from "@/lib/logging/logger";
import { auditService } from "@/services/audit-service";
import { groupService } from "@/services/user/group-service";
import { userService } from "@/services/user/user-service";

const log = logger.child({ action: "group" });

const GroupSchema = z.object({
    name: z.string().trim().min(1, "Give the group a name.").max(100, "The name can have at most 100 characters."),
    permissions: z.array(z.string().max(64)).max(100),
    /** The template of the first step of New group, kept in the audit log. */
    template: z.string().max(40).optional(),
});

export type GroupFormValues = z.input<typeof GroupSchema>;

const IdSchema = z.string().min(1).max(200);

/** The message of a refusal the user can act on, a plain one for anything else. */
const messageOf = (error: unknown, fallback: string) => (error instanceof ValidationError ? error.message : fallback);

export async function createGroup(input: GroupFormValues) {
    await checkPermission(PERMISSIONS.GROUPS.WRITE);
    const parsed = GroupSchema.safeParse(input);
    if (!parsed.success) return { success: false, error: parsed.error.issues[0]?.message ?? "Invalid request" };
    const currentUser = await getCurrentUserWithGroup();

    try {
        const group = await groupService.create(parsed.data);
        revalidatePath("/dashboard/users");
        if (currentUser) {
            await auditService.log(
                currentUser.id,
                AUDIT_ACTIONS.CREATE,
                AUDIT_RESOURCES.GROUP,
                { name: group.name, permissions: group.permissions, ...(parsed.data.template ? { template: parsed.data.template } : {}) },
                group.id
            );
        }
        return { success: true, data: { id: group.id } };
    } catch (error: unknown) {
        log.error("Failed to create group", {}, wrapError(error));
        return { success: false, error: messageOf(error, "The group could not be created.") };
    }
}

/** Saves a group. The audit log gets what changed, not the whole list of permissions. */
export async function updateGroup(id: string, input: GroupFormValues) {
    await checkPermission(PERMISSIONS.GROUPS.WRITE);
    const groupId = IdSchema.safeParse(id);
    const parsed = GroupSchema.safeParse(input);
    if (!groupId.success || !parsed.success) return { success: false, error: parsed.error?.issues[0]?.message ?? "Invalid request" };
    const currentUser = await getCurrentUserWithGroup();

    try {
        const change = await groupService.update(groupId.data, parsed.data);
        revalidatePath("/dashboard/users");
        if (currentUser) {
            await auditService.log(currentUser.id, AUDIT_ACTIONS.UPDATE, AUDIT_RESOURCES.GROUP, { ...change }, groupId.data);
        }
        return { success: true };
    } catch (error: unknown) {
        log.error("Failed to update group", { groupId: groupId.data }, wrapError(error));
        return { success: false, error: messageOf(error, "The group could not be saved.") };
    }
}

/**
 * Deletes a group and moves its members to `moveTo`, another group or none. The own group of the
 * caller is refused, since it would move them out of it, and only a SuperAdmin moves people into
 * the SuperAdmin group.
 */
export async function deleteGroup(id: string, moveTo: string | null = null) {
    await checkPermission(PERMISSIONS.GROUPS.WRITE);
    const groupId = IdSchema.safeParse(id);
    const target = IdSchema.nullable().safeParse(moveTo);
    if (!groupId.success || !target.success) return { success: false, error: "Invalid request" };
    const currentUser = await getCurrentUserWithGroup();

    const membership = await groupService.membership(groupId.data, currentUser?.id ?? null);
    if (membership.includes) {
        return { success: false, error: "You are in this group. Another admin deletes it." };
    }
    if (membership.members > 0 && await userService.isSuperAdminGroup(target.data) && currentUser?.group?.name !== "SuperAdmin") {
        return { success: false, error: "Only a SuperAdmin can make someone a SuperAdmin." };
    }

    try {
        const result = await groupService.delete(groupId.data, target.data);
        revalidatePath("/dashboard/users");
        if (currentUser) {
            await auditService.log(currentUser.id, AUDIT_ACTIONS.DELETE, AUDIT_RESOURCES.GROUP, { name: result.name, moved: result.moved, moveTo: target.data }, groupId.data);
        }
        return { success: true, data: { moved: result.moved } };
    } catch (error: unknown) {
        log.error("Failed to delete group", { groupId: groupId.data }, wrapError(error));
        return { success: false, error: messageOf(error, "The group could not be deleted.") };
    }
}

/**
 * Deletes several groups. Groups with members are refused and listed, since each needs a group
 * for its members, which the delete of a single group asks for. SuperAdmin stays.
 */
export async function bulkDeleteGroups(ids: string[]) {
    await checkPermission(PERMISSIONS.GROUPS.WRITE);
    const currentUser = await getCurrentUserWithGroup();

    const parsed = BulkIdsSchema.safeParse(ids);
    if (!parsed.success) {
        return { success: false as const, error: "Invalid request" };
    }

    try {
        const result = await groupService.deleteMany(parsed.data);
        revalidatePath("/dashboard/users");

        if (currentUser) {
            await auditService.log(
                currentUser.id,
                AUDIT_ACTIONS.DELETE,
                AUDIT_RESOURCES.GROUP,
                { bulk: true, requested: parsed.data.length, succeeded: result.succeeded.length, failed: result.failed.length }
            );
        }

        return { success: true as const, data: result };
    } catch (error: unknown) {
        log.error("Failed to bulk delete groups", {}, wrapError(error));
        return { success: false as const, error: "Failed to delete groups" };
    }
}

/**
 * Moves people into a group, or into none, for Add people and Move of a group. Nobody moves
 * themselves, and only a SuperAdmin moves a SuperAdmin or makes someone one. Each move is
 * written to the audit log like a change of the group of one user.
 */
export async function moveUsersToGroup(userIds: string[], groupId: string | null) {
    await checkPermission(PERMISSIONS.USERS.WRITE);
    const ids = BulkIdsSchema.safeParse(userIds);
    const target = IdSchema.nullable().safeParse(groupId);
    if (!ids.success || !target.success) return { success: false as const, error: "Invalid request" };
    const currentUser = await getCurrentUserWithGroup();
    const actorSuperAdmin = currentUser?.group?.name === "SuperAdmin";

    if (await userService.isSuperAdminGroup(target.data) && !actorSuperAdmin) {
        return { success: false as const, error: "Only a SuperAdmin can make someone a SuperAdmin." };
    }

    try {
        const guarded = actorSuperAdmin ? [] : await userService.superAdminsAmong(ids.data);
        const movable = ids.data.filter((id) => id !== currentUser?.id && !guarded.some((user) => user.id === id));
        const result = await userService.moveUsers(movable, target.data);

        if (currentUser && ids.data.includes(currentUser.id)) {
            result.failed.push({ id: currentUser.id, name: currentUser.name || currentUser.email, error: "You cannot change your own group." });
        }
        for (const user of guarded) {
            result.failed.push({ id: user.id, name: user.name, error: "Only a SuperAdmin can change the group of a SuperAdmin." });
        }

        if (currentUser) {
            for (const id of result.succeeded) {
                await auditService.log(currentUser.id, AUDIT_ACTIONS.UPDATE, AUDIT_RESOURCES.USER, { change: "Updating Group", groupId: target.data ?? "none" }, id);
            }
        }
        revalidatePath("/dashboard/users");
        return { success: true as const, data: result };
    } catch (error: unknown) {
        log.error("Failed to move users", {}, wrapError(error));
        return { success: false as const, error: "The people could not be moved." };
    }
}
