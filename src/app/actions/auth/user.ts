"use server"

import { revalidatePath } from "next/cache";
import { checkPermission, currentSessionId, getViewer, hasPermission, hasPermissionWithContext, type Viewer } from "@/lib/auth/access-control";
import { ACCOUNT_CHANGE, emailClaimScope, roleRefusal } from "@/lib/auth/account-access";
import { reachCovers } from "@/lib/auth/platform-group-caps";
import { MAX_PASSWORD_LENGTH } from "@/lib/auth/password-policy";
import { PERMISSIONS, TRASH_ADMIN_PERMISSION } from "@/lib/auth/permissions";
import { authService } from "@/services/auth/auth-service";
import { userService } from "@/services/user/user-service";
import { groupService } from "@/services/user/group-service";
import { membershipService } from "@/services/tenant/membership-service";
import { tenantGroupRefusal } from "@/services/tenant/member-rules";
import { tenantService } from "@/services/tenant/tenant-service";
import { claimedEmailRefusal } from "@/services/sso/email-domain-claims";
import { auditService } from "@/services/audit-service";
import { accountLogOrigin } from "@/services/audit/account-log";
import { AUDIT_ACTIONS, AUDIT_RESOURCES } from "@/lib/core/audit-types";
import { auditValue } from "@/lib/core/audit-diff";
import { logger } from "@/lib/logging/logger";
import { wrapError, getErrorMessage, ValidationError } from "@/lib/logging/errors";
import { notify } from "@/services/notifications/system-notification-service";
import { NOTIFICATION_EVENTS } from "@/lib/notifications";
import { BulkIdsSchema } from "@/lib/core/bulk-schema";
import { DeleteModeSchema, PERMANENT_DELETE_REFUSED, type DeleteMode } from "@/lib/core/delete-mode";
import { getAutoRedirectOnJobStart, setAutoRedirectOnJobStart } from "@/services/user/preference-service";
import { runAsTenant } from "@/lib/tenant/context";
import { z } from "zod";

const log = logger.child({ action: "user" });

const BEYOND_TENANT = "Your platform group does not reach this tenant, and you may not manage its users.";

/**
 * Why the caller may not change this account, null when they may: the account of a platform admin,
 * and one that also works in another tenant, is for a platform admin alone. See `accountRefusal`.
 */
async function accountRefused(userId: string, caller: Viewer): Promise<string | null> {
    return userService.accountRefusalFor(caller, userId);
}

/** Why the caller may not give this group to anyone in their tenant, null when they may. Nobody hands out more than they hold. */
async function groupRefused(groupId: string | null, caller: Viewer): Promise<string | null> {
    if (!groupId || groupId === "none") return null;
    const group = await groupService.find(groupId);
    if (!group) return "The group no longer exists.";
    return roleRefusal(caller, group);
}

const CreateUserSchema = z.object({
    name: z.string().trim().min(2, "Name must be at least 2 characters.").max(100),
    email: z.string().trim().email("Invalid email address."),
    // The rules of Settings > Passwords are checked by the service, which names the one it breaks.
    password: z.string().min(1, "Enter a password.").max(MAX_PASSWORD_LENGTH, `Password can have at most ${MAX_PASSWORD_LENGTH} characters.`),
    /** The group the user starts in, none for a user who sees nothing until someone picks one. */
    groupId: z.string().min(1).nullable(),
    /** The tenant the user starts in, which whoever manages the accounts of the platform names on the list of every account. Elsewhere it is the open one. */
    tenantId: z.string().min(1).max(200).optional(),
});

export type CreateUserInput = z.input<typeof CreateUserSchema>;

export async function createUser(input: CreateUserInput) {
    await checkPermission(ACCOUNT_CHANGE);
    const parsed = CreateUserSchema.safeParse(input);
    if (!parsed.success) {
        return { success: false, error: parsed.error.issues[0]?.message ?? "Invalid request" };
    }
    const { tenantId: picked, ...data } = parsed.data;
    const currentUser = await getViewer();
    // The new account joins the tenant of whoever creates it. Whoever manages the accounts of the
    // platform names the tenant on the list of every account, from All tenants or from inside any tenant.
    const names = currentUser && (currentUser.isPlatformAdmin || hasPermissionWithContext(currentUser, PERMISSIONS.PLATFORM.ACCOUNTS_WRITE));
    const tenantId = currentUser?.allTenants || (names && picked) ? picked : currentUser?.tenantId;
    if (!currentUser || (!currentUser.allTenants && !tenantId)) return { success: false, error: "Unauthorized" };
    if (!tenantId) return { success: false, error: "Pick the tenant the person works in." };
    // Someone of a platform group names only a tenant they may open.
    if (!currentUser.isPlatformAdmin && tenantId !== currentUser.tenantId && !(await tenantService.switchable(currentUser.id, false)).some((tenant) => tenant.id === tenantId)) {
        return { success: false, error: "The tenant no longer exists." };
    }

    // A group belongs to its tenant, so it is looked up there, and nobody gives one that may do more
    // than they may in that tenant, which may be another than the one they work in.
    const actor = tenantId === currentUser.tenantId || currentUser.isPlatformAdmin
        ? currentUser
        : { ...currentUser, tenantId, permissions: await userService.permissionsIn(currentUser.id, tenantId) };
    // The right to manage the accounts of the platform adds people to the tenants it reaches, the
    // right to manage the users of a tenant to that tenant.
    const reach = await userService.accountsReachOf(currentUser);
    if (!currentUser.isPlatformAdmin && !reachCovers(reach, tenantId) && !actor.permissions.includes(PERMISSIONS.USERS.WRITE)) {
        return { success: false, error: BEYOND_TENANT };
    }
    const claimScope = emailClaimScope({ ...currentUser, reach });
    const claimed = await claimedEmailRefusal(data.email, [tenantId, ...claimScope.tenantIds], claimScope.platformLevel);
    if (claimed) return { success: false, error: claimed };

    const refused = await runAsTenant(tenantId, () => groupRefused(data.groupId, actor));
    if (refused) return { success: false, error: refused };

    try {
        const user = await userService.createUser({ ...data, tenantId });
        revalidatePath("/dashboard/users");

        await auditService.log(
            currentUser.id,
            AUDIT_ACTIONS.CREATE,
            AUDIT_RESOURCES.USER,
            { name: data.name, email: data.email, groupId: data.groupId },
            user.id,
            { tenantId }
        );

        // System notification (fire-and-forget)
        notify({
            eventType: NOTIFICATION_EVENTS.USER_CREATED,
            data: {
                userName: data.name,
                email: data.email,
                createdBy: currentUser?.name,
                timestamp: new Date().toISOString(),
            },
        }).catch(() => {});

        return { success: true, data: { id: user.id } };
    } catch (error: unknown) {
        return { success: false, error: getErrorMessage(error) };
    }
}

/**
 * Gives a user a group in the caller's tenant, or takes them out of it with none. Nobody changes
 * their own group or gives one that may do more than they may.
 */
export async function updateUserGroup(userId: string, groupId: string | null) {
    const currentUser = await checkPermission(PERMISSIONS.USERS.WRITE);
    // All tenants holds a group per tenant, which the panel of the user changes with `setTenantMember`.
    if (currentUser.allTenants) return { success: false, error: "Open a tenant, or change the group per tenant in the panel of the user." };
    if (!currentUser.tenantId) return { success: false, error: "Unauthorized" };

    // Nobody changes their own group, gives one to someone of another tenant, or gives or takes one beyond them.
    const refused = await tenantGroupRefusal(currentUser, userId, groupId);
    if (refused) return { success: false, error: refused };

    try {
        await membershipService.setRole(userId, currentUser.tenantId, groupId === "none" ? null : groupId, { platformAdmin: currentUser.isPlatformAdmin });
        revalidatePath("/dashboard/users");

        if (currentUser) {
            await auditService.log(
                currentUser.id,
                AUDIT_ACTIONS.UPDATE,
                AUDIT_RESOURCES.USER,
                { change: "Updating Group", groupId },
                userId
            );
        }

        return { success: true };
    } catch (error: unknown) {
        log.error("Failed to update user group", { userId }, wrapError(error));
        return { success: false, error: getErrorMessage(error) || "Failed to update user group" };
    }
}

/** Deletes a user, who waits in Recently deleted unless `permanently`. */
export async function deleteUser(userId: string, mode?: DeleteMode) {
    await checkPermission(ACCOUNT_CHANGE);
    const currentUser = await getViewer();
    const parsedMode = DeleteModeSchema.safeParse(mode);
    if (!parsedMode.success) return { success: false, error: "Invalid request" };
    const { permanently = false } = parsedMode.data;
    if (permanently && !(await hasPermission(TRASH_ADMIN_PERMISSION))) return { success: false, error: PERMANENT_DELETE_REFUSED };

    // Refused here and not only left out of the menus, like in the bulk delete.
    if (!currentUser) return { success: false, error: "Unauthorized" };
    if (currentUser.id === userId) {
        return { success: false, error: "You cannot delete your own account." };
    }
    const refused = await accountRefused(userId, currentUser);
    if (refused) return { success: false, error: refused };

    try {
        // Read before the delete, which ends the memberships.
        const origin = await accountLogOrigin(currentUser, userId);
        const deleted = await userService.deleteUser(userId, { permanently, by: currentUser.id });
        revalidatePath("/dashboard/users");
        revalidatePath("/dashboard/settings");

        await auditService.log(
            currentUser.id,
            AUDIT_ACTIONS.DELETE,
            AUDIT_RESOURCES.USER,
            { name: deleted.name || deleted.email, ...(permanently ? { permanently: true } : {}) },
            userId,
            origin
        );

        return { success: true };
    } catch (error: unknown) {
        return { success: false, error: getErrorMessage(error) || "Failed to delete user" };
    }
}

export async function togglePasskeyTwoFactor(userId: string, enabled: boolean) {
    const currentUser = await getViewer();
    if (!currentUser) throw new Error("Unauthorized");

    // Allow user to edit their own settings, as far as their group allows, otherwise require permission
    if (currentUser.id !== userId) {
        await checkPermission(ACCOUNT_CHANGE);
        const refused = await accountRefused(userId, currentUser);
        if (refused) return { success: false, error: refused };
    } else if (!(await hasPermission(PERMISSIONS.PROFILE.MANAGE_PASSKEYS))) {
        return { success: false, error: "Your group may not change your passkeys." };
    }

    try {
        const origin = await accountLogOrigin(currentUser, userId);
        const user = await userService.togglePasskeyTwoFactor(userId, enabled);
        revalidatePath("/dashboard/settings");
        // The switch of the page turns it the other way.
        const changes = [{ field: "Passkey as second factor", from: auditValue(!enabled), to: auditValue(enabled) }];
        await auditService.log(currentUser.id, AUDIT_ACTIONS.UPDATE, AUDIT_RESOURCES.USER, { name: user?.name, changes }, userId, origin);
        return { success: true };
    } catch (error: unknown) {
        log.error("Failed to toggle passkey 2FA", { userId }, wrapError(error));
        return { success: false, error: getErrorMessage(error) || "Failed to update passkey settings" };
    }
}

const OwnPasswordSchema = z.object({
    currentPassword: z.string().min(1, "Enter the password you have now."),
    // The rules of Settings > Passwords are checked by the service, which names the one it breaks.
    newPassword: z.string().min(1, "Enter a new password.").max(MAX_PASSWORD_LENGTH, `The password can have at most ${MAX_PASSWORD_LENGTH} characters.`),
});

/**
 * Changes the own password with the current one. The new one follows the rules of
 * Settings > Passwords, and every other session of the account ends, so the old password stops
 * working everywhere at once.
 * @no-permission-required - Self-service: only the own password, as far as `profile:update_password` allows, checked below.
 */
export async function updateOwnPassword(currentPassword: string, newPassword: string) {
    const currentUser = await getViewer();
    if (!currentUser) throw new Error("Unauthorized");
    if (!(await hasPermission(PERMISSIONS.PROFILE.UPDATE_PASSWORD))) {
        return { success: false, error: "Your group may not change your password." };
    }
    const parsed = OwnPasswordSchema.safeParse({ currentPassword, newPassword });
    if (!parsed.success) return { success: false, error: parsed.error.issues[0]?.message ?? "Invalid request" };

    if (!(await userService.hasPassword(currentUser.id))) {
        return { success: false, error: "No password account found. Please set up a password first." };
    }

    try {
        // Checked against the stored hash, without signing in.
        if (!(await authService.verifyPassword(currentUser.id, parsed.data.currentPassword))) {
            return { success: false, error: "Incorrect current password" };
        }
        const origin = await accountLogOrigin(currentUser, currentUser.id);
        await authService.setPassword(currentUser.id, parsed.data.newPassword);
        const signedOut = await userService.revokeSessions(currentUser.id, await currentSessionId());

        await auditService.log(
            currentUser.id,
            AUDIT_ACTIONS.UPDATE,
            AUDIT_RESOURCES.USER,
            { change: "Password Changed", signedOut },
            currentUser.id,
            origin
        );

        return { success: true, data: { signedOut } };
    } catch (error: unknown) {
        if (error instanceof ValidationError) return { success: false, error: error.message };
        log.error("Failed to update password", { userId: currentUser.id }, wrapError(error));
        return { success: false, error: getErrorMessage(error) || "Failed to update password" };
    }
}

export async function updateUser(userId: string, data: { name?: string; email?: string; timezone?: string; dateFormat?: string; timeFormat?: string }) {
    const currentUser = await getViewer();
    if (!currentUser) throw new Error("Unauthorized");

    // Allow user to edit their own profile, otherwise require permission
    if (currentUser.id !== userId) {
        await checkPermission(ACCOUNT_CHANGE);
        const refused = await accountRefused(userId, currentUser);
        if (refused) return { success: false, error: refused };
        // Compared with the email of the account being changed, so a change of its name alone never meets the check of a claimed domain.
        const emailChanges = data.email !== undefined && data.email !== (await userService.emailOf(userId));
        if (emailChanges) {
            // Someone of a platform group of some tenants gives the emails their tenants claim, see `emailClaimScope`.
            const scope = emailClaimScope({ ...currentUser, reach: await userService.accountsReachOf(currentUser) });
            const claimed = await claimedEmailRefusal(data.email!, [...(currentUser.tenantId ? [currentUser.tenantId] : []), ...scope.tenantIds], scope.platformLevel);
            if (claimed) return { success: false, error: claimed };
        }
    } else {
        // @no-permission-required - Self-service: the own account, as far as the `profile:*` permissions below allow.
        // The own name and email change only as far as the profile permissions allow, whatever else the group gives.
        const emailChanges = data.email !== undefined && data.email !== currentUser.email;
        if (data.name !== undefined && data.name !== currentUser.name && !(await hasPermission(PERMISSIONS.PROFILE.UPDATE_NAME))) {
            return { success: false, error: "Your group may not change your name." };
        }
        if (emailChanges && !(await hasPermission(PERMISSIONS.PROFILE.UPDATE_EMAIL))) {
            return { success: false, error: "Your group may not change your email." };
        }
        const claimed = emailChanges ? await userService.ownEmailRefusal(currentUser.id, data.email!) : null;
        if (claimed) return { success: false, error: claimed };
    }

    try {
        const origin = await accountLogOrigin(currentUser, userId);
        await userService.updateUser(userId, data);
        revalidatePath("/dashboard/users");
        revalidatePath("/dashboard/settings");

        await auditService.log(
            currentUser.id,
            AUDIT_ACTIONS.UPDATE,
            AUDIT_RESOURCES.USER,
            data,
            userId,
            origin
        );

        return { success: true };
    } catch (error: unknown) {
         log.error("Failed to update user", { userId }, wrapError(error));
        return { success: false, error: getErrorMessage(error) || "Failed to update user" };
    }
}

/**
 * Update user preferences (self-service)
 * Users can only update their own preferences - no admin permission required
 * @no-permission-required
 */
export async function updateUserPreferences(userId: string, data: { autoRedirectOnJobStart?: boolean }) {
    const currentUser = await getViewer();
    if (!currentUser) throw new Error("Unauthorized");

    // Allow user to edit their own preferences only
    if (currentUser.id !== userId) {
        throw new Error("You can only update your own preferences");
    }

    try {
        await setAutoRedirectOnJobStart(userId, data.autoRedirectOnJobStart);

        revalidatePath("/dashboard/profile");

        await auditService.log(
            currentUser.id,
            AUDIT_ACTIONS.UPDATE,
            AUDIT_RESOURCES.USER,
            { preferences: data },
            userId,
            await accountLogOrigin(currentUser, userId)
        );

        return { success: true };
    } catch (error: unknown) {
        log.error("Failed to update preferences", { userId }, wrapError(error));
        return { success: false, error: getErrorMessage(error) || "Failed to update preferences" };
    }
}

/**
 * Get user preference value (self-service)
 * Users can only read their own preferences - no admin permission required
 * @no-permission-required
 */
export async function getUserPreference(key: 'autoRedirectOnJobStart'): Promise<boolean> {
    const currentUser = await getViewer();
    if (!currentUser) return true; // Default to true if not logged in

    if (key === 'autoRedirectOnJobStart') {
        return getAutoRedirectOnJobStart(currentUser.id);
    }

    return true;
}

/**
 * Deletes several users.
 *
 * The caller's own account is refused here rather than only being hidden in the UI, since
 * a client-side check is not a guarantee. An account the caller may not change is reported
 * instead of sent. The last-platform-admin and last-user guards live in the service and surface
 * as per-user failures.
 */
export async function bulkDeleteUsers(userIds: string[], mode?: DeleteMode) {
    await checkPermission(ACCOUNT_CHANGE);
    const currentUser = await getViewer();

    const parsed = BulkIdsSchema.safeParse(userIds);
    const parsedMode = DeleteModeSchema.safeParse(mode);
    if (!parsed.success || !parsedMode.success) {
        return { success: false as const, error: "Invalid request" };
    }
    const { permanently = false } = parsedMode.data;
    if (permanently && !(await hasPermission(TRASH_ADMIN_PERMISSION))) return { success: false as const, error: PERMANENT_DELETE_REFUSED };

    try {
        if (!currentUser) return { success: false as const, error: "Unauthorized" };
        const guarded: { id: string; error: string }[] = [];
        for (const id of parsed.data) {
            if (id === currentUser.id) continue;
            const refused = await accountRefused(id, currentUser);
            if (refused) guarded.push({ id, error: refused });
        }
        const deletable = parsed.data.filter((id) => id !== currentUser.id && !guarded.some((user) => user.id === id));
        // Read before the delete, which ends the memberships.
        const origin = await accountLogOrigin(currentUser, deletable);
        const result = await userService.deleteUsers(deletable, { permanently, by: currentUser.id });

        if (currentUser && parsed.data.includes(currentUser.id)) {
            result.failed.push({
                id: currentUser.id,
                name: currentUser.name || currentUser.email,
                error: "You cannot delete your own account.",
            });
        }
        const names = new Map((await userService.namesOf(guarded.map((user) => user.id))).map((user) => [user.id, user.name]));
        for (const user of guarded) {
            result.failed.push({ id: user.id, name: names.get(user.id) ?? user.id, error: user.error });
        }

        revalidatePath("/dashboard/users");
        revalidatePath("/dashboard/settings");

        await auditService.log(
            currentUser.id,
            AUDIT_ACTIONS.DELETE,
            AUDIT_RESOURCES.USER,
            { bulk: true, requested: parsed.data.length, succeeded: result.succeeded.length, failed: result.failed.length, ...(permanently ? { permanently: true } : {}) },
            undefined,
            origin
        );

        return { success: true as const, data: result };
    } catch (error: unknown) {
        log.error("Failed to bulk delete users", {}, wrapError(error));
        return { success: false as const, error: getErrorMessage(error) || "Failed to delete users" };
    }
}
