"use server"

import { revalidatePath } from "next/cache";
import { checkPermission, getCurrentUserWithGroup, hasPermission } from "@/lib/auth/access-control";
import { PERMISSIONS, TRASH_ADMIN_PERMISSION } from "@/lib/auth/permissions";
import { userService } from "@/services/user/user-service";
import { auditService } from "@/services/audit-service";
import { AUDIT_ACTIONS, AUDIT_RESOURCES } from "@/lib/core/audit-types";
import { logger } from "@/lib/logging/logger";
import { wrapError, getErrorMessage } from "@/lib/logging/errors";
import { notify } from "@/services/notifications/system-notification-service";
import { NOTIFICATION_EVENTS } from "@/lib/notifications";
import { BulkIdsSchema } from "@/lib/core/bulk-schema";
import { DeleteModeSchema, PERMANENT_DELETE_REFUSED, type DeleteMode } from "@/lib/core/delete-mode";
import { z } from "zod";

const log = logger.child({ action: "user" });

const CreateUserSchema = z.object({
    name: z.string().trim().min(2, "Name must be at least 2 characters.").max(100),
    email: z.string().trim().email("Invalid email address."),
    password: z.string().min(8, "Password must be at least 8 characters.").max(128, "Password can have at most 128 characters."),
    /** The group the user starts in, none for a user who sees nothing until someone picks one. */
    groupId: z.string().min(1).nullable(),
});

export type CreateUserInput = z.input<typeof CreateUserSchema>;

export async function createUser(input: CreateUserInput) {
    await checkPermission(PERMISSIONS.USERS.WRITE);
    const parsed = CreateUserSchema.safeParse(input);
    if (!parsed.success) {
        return { success: false, error: parsed.error.issues[0]?.message ?? "Invalid request" };
    }
    const data = parsed.data;
    const currentUser = await getCurrentUserWithGroup();

    if (await userService.isSuperAdminGroup(data.groupId) && currentUser?.group?.name !== "SuperAdmin") {
        return { success: false, error: "Only a SuperAdmin can make someone a SuperAdmin." };
    }

    try {
        const user = await userService.createUser(data);
        revalidatePath("/dashboard/users");

        if (currentUser) {
            await auditService.log(
                currentUser.id,
                AUDIT_ACTIONS.CREATE,
                AUDIT_RESOURCES.USER,
                { name: data.name, email: data.email, groupId: data.groupId },
                user.id
            );
        }

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

export async function updateUserGroup(userId: string, groupId: string | null) {
    await checkPermission(PERMISSIONS.USERS.WRITE);
    const currentUser = await getCurrentUserWithGroup();

    // Prevent self-group-change (users cannot change their own group)
    if (currentUser && currentUser.id === userId) {
        return { success: false, error: "You cannot change your own group assignment." };
    }

    // Only SuperAdmins can assign users to the SuperAdmin group
    const actorSuperAdmin = currentUser?.group?.name === "SuperAdmin";
    if (await userService.isSuperAdminGroup(groupId) && !actorSuperAdmin) {
        return { success: false, error: "Only a SuperAdmin can make someone a SuperAdmin." };
    }
    if (!actorSuperAdmin && await userService.isSuperAdmin(userId)) {
        return { success: false, error: "Only a SuperAdmin can change the group of a SuperAdmin." };
    }

    try {
        await userService.updateUserGroup(userId, groupId);
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
    await checkPermission(PERMISSIONS.USERS.WRITE);
    const currentUser = await getCurrentUserWithGroup();
    const parsedMode = DeleteModeSchema.safeParse(mode);
    if (!parsedMode.success) return { success: false, error: "Invalid request" };
    const { permanently = false } = parsedMode.data;
    if (permanently && !(await hasPermission(TRASH_ADMIN_PERMISSION))) return { success: false, error: PERMANENT_DELETE_REFUSED };

    // Refused here and not only left out of the menus, like in the bulk delete.
    if (currentUser?.id === userId) {
        return { success: false, error: "You cannot delete your own account." };
    }
    if (currentUser?.group?.name !== "SuperAdmin" && await userService.isSuperAdmin(userId)) {
        return { success: false, error: "Only a SuperAdmin can delete a SuperAdmin." };
    }

    try {
        const deleted = await userService.deleteUser(userId, { permanently, by: currentUser?.id });
        revalidatePath("/dashboard/users");
        revalidatePath("/dashboard/settings");

        if (currentUser) {
            await auditService.log(
                currentUser.id,
                AUDIT_ACTIONS.DELETE,
                AUDIT_RESOURCES.USER,
                { name: deleted.name || deleted.email, ...(permanently ? { permanently: true } : {}) },
                userId
            );
        }

        return { success: true };
    } catch (error: unknown) {
        return { success: false, error: getErrorMessage(error) || "Failed to delete user" };
    }
}

export async function togglePasskeyTwoFactor(userId: string, enabled: boolean) {
    const currentUser = await getCurrentUserWithGroup();
    if (!currentUser) throw new Error("Unauthorized");

    // Allow user to edit their own settings, as far as their group allows, otherwise require permission
    if (currentUser.id !== userId) {
        await checkPermission(PERMISSIONS.USERS.WRITE);
    } else if (!(await hasPermission(PERMISSIONS.PROFILE.MANAGE_PASSKEYS))) {
        return { success: false, error: "Your group may not change your passkeys." };
    }

    try {
        await userService.togglePasskeyTwoFactor(userId, enabled);
        revalidatePath("/dashboard/settings");
        return { success: true };
    } catch (error: unknown) {
        log.error("Failed to toggle passkey 2FA", { userId }, wrapError(error));
        return { success: false, error: getErrorMessage(error) || "Failed to update passkey settings" };
    }
}

import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import prisma from "@/lib/prisma";

// @no-permission-required - Self-service: Users can always change their own password
export async function updateOwnPassword(currentPassword: string, newPassword: string) {
    const currentUser = await getCurrentUserWithGroup();
    if (!currentUser) throw new Error("Unauthorized");
    if (!(await hasPermission(PERMISSIONS.PROFILE.UPDATE_PASSWORD))) {
        return { success: false, error: "Your group may not change your password." };
    }

    // 1. Verify user has a credential account
    const account = await prisma.account.findFirst({
        where: {
            userId: currentUser.id,
            providerId: "credential"
        }
    });

    if (!account) {
        return { success: false, error: "No password account found. Please set up a password first." };
    }

    // 2. Verify current password by attempting a "dry run" sign-in
    try {
        await auth.api.signInEmail({
            body: {
                email: currentUser.email,
                password: currentPassword
            },
            asResponse: true // Prevent actual sign-in side effects (cookies)
        });
    } catch (_error: unknown) {
        // better-auth throws on failed sign-in
        return { success: false, error: "Incorrect current password" };
    }

    // 3. Update password via delete & set sequence
    // Using setPassword requires the user to NOT have a password.
    // Since changePassword endpoint is strict about session type, we must use this workaround.
    try {
        const headersList = await headers();

        // Transaction manually managed: Delete then Set
        // 1. Delete credential account
        await prisma.account.deleteMany({
            where: {
                userId: currentUser.id,
                providerId: "credential"
            }
        });

        // 2. Set new password
        await auth.api.setPassword({
            headers: headersList,
            body: {
                newPassword: newPassword,
                // Passing revokeOtherSessions: true if supported would be good,
                // but setPassword might not support it in all versions.
            }
        });

        await auditService.log(
            currentUser.id,
            AUDIT_ACTIONS.UPDATE,
            AUDIT_RESOURCES.USER,
            { change: "Password Changed" },
            currentUser.id
        );

        return { success: true };
    } catch (error: unknown) {
        log.error("Failed to update password", { userId: currentUser.id }, wrapError(error));
        return { success: false, error: getErrorMessage(error) || "Failed to update password" };
    }
}

export async function updateUser(userId: string, data: { name?: string; email?: string; timezone?: string; dateFormat?: string; timeFormat?: string }) {
    const currentUser = await getCurrentUserWithGroup();
    if (!currentUser) throw new Error("Unauthorized");

    // Allow user to edit their own profile, otherwise require permission
    if (currentUser.id !== userId) {
        await checkPermission(PERMISSIONS.USERS.WRITE);
    } else if (!(await hasPermission(PERMISSIONS.USERS.WRITE))) {
        // Someone who may not change users changes their own name and email only as far as their group allows.
        if (data.name !== undefined && data.name !== currentUser.name && !(await hasPermission(PERMISSIONS.PROFILE.UPDATE_NAME))) {
            return { success: false, error: "Your group may not change your name." };
        }
        if (data.email !== undefined && data.email !== currentUser.email && !(await hasPermission(PERMISSIONS.PROFILE.UPDATE_EMAIL))) {
            return { success: false, error: "Your group may not change your email." };
        }
    }

    try {
        await userService.updateUser(userId, data);
        revalidatePath("/dashboard/users");
        revalidatePath("/dashboard/settings");

        await auditService.log(
            currentUser.id,
            AUDIT_ACTIONS.UPDATE,
            AUDIT_RESOURCES.USER,
            data,
            userId
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
    const currentUser = await getCurrentUserWithGroup();
    if (!currentUser) throw new Error("Unauthorized");

    // Allow user to edit their own preferences only
    if (currentUser.id !== userId) {
        throw new Error("You can only update your own preferences");
    }

    try {
        await prisma.user.update({
            where: { id: userId },
            data: {
                autoRedirectOnJobStart: data.autoRedirectOnJobStart,
            },
        });

        revalidatePath("/dashboard/profile");

        await auditService.log(
            currentUser.id,
            AUDIT_ACTIONS.UPDATE,
            AUDIT_RESOURCES.USER,
            { preferences: data },
            userId
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
    const currentUser = await getCurrentUserWithGroup();
    if (!currentUser) return true; // Default to true if not logged in

    const user = await prisma.user.findUnique({
        where: { id: currentUser.id },
        select: { autoRedirectOnJobStart: true },
    });

    if (key === 'autoRedirectOnJobStart') {
        return user?.autoRedirectOnJobStart ?? true;
    }

    return true;
}

/**
 * Deletes several users.
 *
 * The caller's own account is refused here rather than only being hidden in the UI, since
 * a client-side check is not a guarantee. The last-SuperAdmin and last-user guards live in
 * the service and surface as per-user failures.
 */
export async function bulkDeleteUsers(userIds: string[], mode?: DeleteMode) {
    await checkPermission(PERMISSIONS.USERS.WRITE);
    const currentUser = await getCurrentUserWithGroup();

    const parsed = BulkIdsSchema.safeParse(userIds);
    const parsedMode = DeleteModeSchema.safeParse(mode);
    if (!parsed.success || !parsedMode.success) {
        return { success: false as const, error: "Invalid request" };
    }
    const { permanently = false } = parsedMode.data;
    if (permanently && !(await hasPermission(TRASH_ADMIN_PERMISSION))) return { success: false as const, error: PERMANENT_DELETE_REFUSED };

    try {
        // Someone who is no SuperAdmin cannot delete one, so those are reported instead of sent.
        const guarded = currentUser?.group?.name === "SuperAdmin" ? [] : await userService.superAdminsAmong(parsed.data);
        const deletable = parsed.data.filter((id) => id !== currentUser?.id && !guarded.some((user) => user.id === id));
        const result = await userService.deleteUsers(deletable, { permanently, by: currentUser?.id });

        if (currentUser && parsed.data.includes(currentUser.id)) {
            result.failed.push({
                id: currentUser.id,
                name: currentUser.name || currentUser.email,
                error: "You cannot delete your own account.",
            });
        }
        for (const user of guarded) {
            if (user.id !== currentUser?.id) result.failed.push({ id: user.id, name: user.name, error: "Only a SuperAdmin can delete a SuperAdmin." });
        }

        revalidatePath("/dashboard/users");
        revalidatePath("/dashboard/settings");

        if (currentUser) {
            await auditService.log(
                currentUser.id,
                AUDIT_ACTIONS.DELETE,
                AUDIT_RESOURCES.USER,
                { bulk: true, requested: parsed.data.length, succeeded: result.succeeded.length, failed: result.failed.length, ...(permanently ? { permanently: true } : {}) }
            );
        }

        return { success: true as const, data: result };
    } catch (error: unknown) {
        log.error("Failed to bulk delete users", {}, wrapError(error));
        return { success: false as const, error: getErrorMessage(error) || "Failed to delete users" };
    }
}
