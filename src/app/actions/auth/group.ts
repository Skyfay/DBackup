"use server"

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { checkPermission, hasPermissionWithContext, type Viewer } from "@/lib/auth/access-control";
import { roleRefusal } from "@/lib/auth/account-access";
import { capToTenant, groupCapRefusal } from "@/lib/auth/group-caps";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { namedTenants } from "@/lib/core/audit-tenants";
import { AUDIT_ACTIONS, AUDIT_RESOURCES } from "@/lib/core/audit-types";
import type { BulkResult } from "@/lib/core/bulk";
import { BulkIdsSchema } from "@/lib/core/bulk-schema";
import { ConflictError, NotFoundError, ValidationError, wrapError } from "@/lib/logging/errors";
import { logger } from "@/lib/logging/logger";
import { auditService } from "@/services/audit-service";
import { fromPlatform, groupService, type ProviderMove } from "@/services/user/group-service";
import { providerPlacementChanges } from "@/services/sso/oidc-audit";
import { PLATFORM_LOG } from "@/services/system/settings-save";
import { MEMBERSHIP_END_HANDS_OVER, membershipEndRefusal } from "@/services/tenant/membership-end";
import { membershipService } from "@/services/tenant/membership-service";
import { placementRefusal, PLATFORM_ADMIN_MEMBERSHIP } from "@/services/tenant/member-rules";
import { userService } from "@/services/user/user-service";
import { maySeeAccount } from "@/services/user/account-visibility";

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

/** Why a group without a group for its members stays, see `membershipEndRefusal`. */
const MEMBER_HANDED_OVER = "One of its members would afterwards work only in tenants where you manage the users. Pick a group for its members, or let someone who manages the accounts of the platform delete it.";

const OPEN_A_TENANT = "Open a tenant to change its groups.";
const GROUP_BEYOND = "This group may do more than you may, so only someone who may do all of it changes it.";
const MOVE_BEYOND = "This group may do more than you may, so you cannot move anyone into it.";
const HOLDS_PLATFORM_ADMIN = "A platform admin is in this group, so only a platform admin deletes it.";
const MEMBERS_NEED_USERS = "People are in this group, and moving them takes the right to manage users.";

/** The message of a refusal the user can act on, a plain one for anything else. */
const messageOf = (error: unknown, fallback: string) => (error instanceof ValidationError || error instanceof NotFoundError || error instanceof ConflictError ? error.message : fallback);

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
 * more than they may, and nobody moves people into a group that may do more than they may. A group
 * with members also needs the right to manage users, since its delete moves them.
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
    // The delete moves or ends the membership of every member, and only a platform admin changes that of a platform admin.
    if (!viewer.isPlatformAdmin && (await groupService.holdsPlatformAdmin(groupId.data))) return { success: false, error: HOLDS_PLATFORM_ADMIN };
    const memberIds = viewer.isPlatformAdmin ? [] : await groupService.memberIds(groupId.data);
    // Moving people to another group or out of the tenant is a change of users, like Move of a group.
    if (memberIds.length > 0 && !hasPermissionWithContext(viewer, PERMISSIONS.USERS.WRITE)) return { success: false, error: MEMBERS_NEED_USERS };
    // Without a group to go to, its members leave the tenant, which never leaves one of them working
    // alone where the viewer manages the users, see `membershipEndRefusal`.
    if (!moveToGroup) {
        for (const memberId of memberIds) {
            const handsOver = await membershipEndRefusal(viewer, memberId, scope.tenantId);
            if (handsOver) return { success: false, error: MEMBER_HANDED_OVER };
        }
    }

    try {
        // Someone who joined since the checks above was checked by none of them, so the delete stops then.
        const result = await groupService.delete(groupId.data, target.data, { platformAdmin: viewer.isPlatformAdmin }, viewer.isPlatformAdmin ? undefined : memberIds);
        revalidatePath("/dashboard/users");
        await auditService.log(viewer.id, AUDIT_ACTIONS.DELETE, AUDIT_RESOURCES.GROUP, { name: result.name, moved: result.moved, moveTo: target.data }, groupId.data);
        await logProviderMoves(viewer.id, result.ssoProviders);
        return { success: true, data: { moved: result.moved } };
    } catch (error: unknown) {
        log.error("Failed to delete group", { groupId: groupId.data }, wrapError(error));
        return { success: false, error: messageOf(error, "The group could not be deleted.") };
    }
}

/**
 * A sign-in provider the delete of a group changed, written like an edit of the provider, into the
 * log of the platform with the other changes of the providers, see `actions/auth/oidc.ts`.
 */
async function logProviderMoves(userId: string, providers: readonly ProviderMove[]) {
    for (const provider of providers) {
        const changes = providerPlacementChanges(provider.before, provider.after);
        if (changes.length === 0) continue;
        await auditService.log(userId, AUDIT_ACTIONS.UPDATE, AUDIT_RESOURCES.SSO_PROVIDER, { name: provider.name, changes, ...namedTenants([provider.tenantId]) }, provider.id, PLATFORM_LOG);
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
        // Read first, the groups are gone afterwards.
        const names = await groupService.namesOf(allowed);
        const deleted = allowed.length > 0 ? await groupService.deleteMany(allowed) : { succeeded: [], failed: [], ssoProviders: [] };
        const result: BulkResult = { succeeded: deleted.succeeded, failed: [...deleted.failed, ...beyond] };
        revalidatePath("/dashboard/users");

        await auditService.log(
            viewer.id,
            AUDIT_ACTIONS.DELETE,
            AUDIT_RESOURCES.GROUP,
            { bulk: true, requested: parsed.data.length, succeeded: result.succeeded.length, failed: result.failed.length, names: result.succeeded.flatMap((id) => names.get(id) ?? []) },
        );
        await logProviderMoves(viewer.id, deleted.ssoProviders);

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
        const platformAdmins: string[] = [];
        // Taking someone out of the tenant never leaves them working alone where the viewer manages the users.
        const handedOver: string[] = [];
        if (!viewer.isPlatformAdmin) {
            for (const id of ids.data) {
                if (id === viewer.id) continue;
                if (!(await membershipService.isPersonOf(id, tenantId))) {
                    outsiders.push(id);
                    continue;
                }
                // An account of no tenant whose email the provider of another tenant claims counts as one
                // of that tenant, so the home tenant does not pull it in, see `placementRefusal`.
                if (await placementRefusal(viewer, id, tenantId)) {
                    outsiders.push(id);
                    continue;
                }
                // A platform admin who works here is one of the people, so the answer may say why.
                if (await membershipService.isPlatformAdmin(id)) {
                    platformAdmins.push(id);
                    continue;
                }
                const current = await membershipService.roleOf(id, tenantId);
                if (current && roleRefusal(viewer, current)) guarded.push(id);
                else if (!target.data && (await membershipEndRefusal(viewer, id, tenantId))) handedOver.push(id);
            }
        }
        const held = new Set([...guarded, ...outsiders, ...platformAdmins, ...handedOver]);
        const movable = ids.data.filter((id) => id !== viewer.id && !held.has(id));
        const result = await membershipService.setRoles(movable, tenantId, target.data, { platformAdmin: viewer.isPlatformAdmin });

        if (ids.data.includes(viewer.id)) {
            result.failed.push({ id: viewer.id, name: viewer.name || viewer.email, error: "You cannot change your own group." });
        }
        for (const user of await userService.namesOf(guarded)) {
            result.failed.push({ id: user.id, name: user.name, error: "This user's group may do more than you may, so only someone who may do all of it changes it." });
        }
        for (const user of await userService.namesOf(platformAdmins)) {
            result.failed.push({ id: user.id, name: user.name, error: PLATFORM_ADMIN_MEMBERSHIP });
        }
        for (const user of await userService.namesOf(handedOver)) {
            result.failed.push({ id: user.id, name: user.name, error: MEMBERSHIP_END_HANDS_OVER });
        }
        // An account the viewer may not see, or one that does not exist, reads as gone, without its name.
        const outsiderNames = new Map((await userService.namesOf(outsiders)).map((user) => [user.id, user.name]));
        for (const id of outsiders) {
            const name = outsiderNames.get(id);
            if (name !== undefined && (await maySeeAccount({ ...viewer, userId: viewer.id }, id))) {
                result.failed.push({ id, name, error: "This account works in another tenant. Add people to this tenant with an invitation." });
            } else {
                result.failed.push({ id, name: id, error: "The user no longer exists." });
            }
        }

        // Each entry names the user and the group, which may both be gone by the time someone reads it.
        const movedNames = new Map((await userService.namesOf(result.succeeded)).map((user) => [user.id, user.name]));
        for (const id of result.succeeded) {
            await auditService.log(
                viewer.id,
                AUDIT_ACTIONS.UPDATE,
                AUDIT_RESOURCES.USER,
                { change: "Updating Group", name: movedNames.get(id), groupId: target.data ?? "none", ...(group ? { group: group.name } : {}) },
                id
            );
        }
        revalidatePath("/dashboard/users");
        return { success: true as const, data: result };
    } catch (error: unknown) {
        log.error("Failed to move users", {}, wrapError(error));
        return { success: false as const, error: "The people could not be moved." };
    }
}
