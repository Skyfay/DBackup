"use server"

import { revalidatePath } from "next/cache";
import { checkPermission, getCurrentUserWithGroup } from "@/lib/access-control";
import { PERMISSIONS } from "@/lib/permissions";
import { userService } from "@/services/user-service";
import { authService } from "@/services/auth-service";
import { auditService } from "@/services/audit-service";
import { AUDIT_ACTIONS, AUDIT_RESOURCES } from "@/lib/core/audit-types";

export async function createUser(data: { name: string; email: string; password: string }) {
    await checkPermission(PERMISSIONS.USERS.WRITE);
    const currentUser = await getCurrentUserWithGroup();

    try {
        const result = await authService.createUser(data);
        revalidatePath("/dashboard/users");

        if (currentUser) {
            await auditService.log(
                currentUser.id,
                AUDIT_ACTIONS.CREATE,
                AUDIT_RESOURCES.USER,
                { name: data.name, email: data.email },
                result.user.id
            );
        }

        return { success: true };
    } catch (error: any) {
        return { success: false, error: error.message };
    }
}

export async function getUsers() {
    await checkPermission(PERMISSIONS.USERS.READ);
    return await userService.getUsers();
}

export async function updateUserGroup(userId: string, groupId: string | null) {
    await checkPermission(PERMISSIONS.USERS.WRITE);
    const currentUser = await getCurrentUserWithGroup();

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
    } catch (error: any) {
        console.error("Failed to update user group:", error);
        return { success: false, error: error.message || "Failed to update user group" };
    }
}

export async function resetUserTwoFactor(userId: string) {
    await checkPermission(PERMISSIONS.USERS.WRITE);

    try {
        await userService.resetTwoFactor(userId);
        return { success: true };
    } catch (error: any) {
        console.error("Failed to reset 2FA:", error);
        return { success: false, error: error.message || "Failed to reset 2FA" };
    }
}

export async function deleteUser(userId: string) {
    await checkPermission(PERMISSIONS.USERS.WRITE);
    const currentUser = await getCurrentUserWithGroup();

    try {
        await userService.deleteUser(userId);
        revalidatePath("/dashboard/users");
        revalidatePath("/dashboard/settings");

        if (currentUser) {
            await auditService.log(
                currentUser.id,
                AUDIT_ACTIONS.DELETE,
                AUDIT_RESOURCES.USER,
                undefined,
                userId
            );
        }

        return { success: true };
    } catch (error: any) {
        return { success: false, error: error.message || "Failed to delete user" };
    }
}

export async function togglePasskeyTwoFactor(userId: string, enabled: boolean) {
    const currentUser = await getCurrentUserWithGroup();
    if (!currentUser) throw new Error("Unauthorized");

    // Allow user to edit their own settings, otherwise require permission
    if (currentUser.id !== userId) {
        await checkPermission(PERMISSIONS.USERS.WRITE);
    }

    try {
        await userService.togglePasskeyTwoFactor(userId, enabled);
        revalidatePath("/dashboard/settings");
        return { success: true };
    } catch (error: any) {
        console.error(error);
        return { success: false, error: error.message || "Failed to update passkey settings" };
    }
}

import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import prisma from "@/lib/prisma";

export async function updateOwnPassword(currentPassword: string, newPassword: string) {
    const currentUser = await getCurrentUserWithGroup();
    if (!currentUser) throw new Error("Unauthorized");

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
    } catch (_error: any) {
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
    } catch (error: any) {
        console.error("Failed to update password:", error);
        return { success: false, error: error.message || "Failed to update password" };
    }
}

export async function updateUser(userId: string, data: { name?: string; email?: string; timezone?: string; dateFormat?: string; timeFormat?: string }) {
    const currentUser = await getCurrentUserWithGroup();
    if (!currentUser) throw new Error("Unauthorized");

    // Allow user to edit their own profile, otherwise require permission
    if (currentUser.id !== userId) {
        await checkPermission(PERMISSIONS.USERS.WRITE);
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
    } catch (error: any) {
         console.error(error);
        return { success: false, error: error.message || "Failed to update user" };
    }
}
