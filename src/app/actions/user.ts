"use server"

import prisma from "@/lib/prisma";
import { User } from "better-auth";
import { revalidatePath } from "next/cache";
import { checkPermission, getCurrentUserWithGroup } from "@/lib/access-control";
import { PERMISSIONS } from "@/lib/permissions";

export async function getUsers() {
    await checkPermission(PERMISSIONS.USERS.READ);

    return await prisma.user.findMany({
        orderBy: {
            createdAt: 'desc'
        },
        include: {
            group: true
        }
    });
}

export async function updateUserGroup(userId: string, groupId: string | null) {
    await checkPermission(PERMISSIONS.USERS.WRITE);

    try {
        await prisma.user.update({
            where: {
                id: userId
            },
            data: {
                groupId: groupId === "none" ? null : groupId
            }
        });
        revalidatePath("/dashboard/users");
        return { success: true };
    } catch (error) {
        console.error("Failed to update user group:", error);
        return { success: false, error: "Failed to update user group" };
    }
}

export async function deleteUser(userId: string) {
    await checkPermission(PERMISSIONS.USERS.WRITE);

    try {
        // Check if user is the last one? maybe not necessary for now but good practice
        const userCount = await prisma.user.count();
        if (userCount <= 1) {
             throw new Error("Cannot delete the last user.");
        }

        await prisma.user.delete({
            where: {
                id: userId
            }
        });
        revalidatePath("/dashboard/users");
        revalidatePath("/dashboard/settings");
        return { success: true };
    } catch (error) {
        return { success: false, error: "Failed to update user" };
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
        await prisma.user.update({
            where: {
                id: userId
            },
            data: {
                passkeyTwoFactor: enabled,
                twoFactorEnabled: enabled // Force enable native 2FA flag to trigger 2FA flow
            }
        });
        
        revalidatePath("/dashboard/settings");
        return { success: true };
    } catch (error) {
        console.error(error);
        return { success: false, error: "Failed to update passkey settings" };
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
        await prisma.user.update({
            where: {
                id: userId
            },
            data: {
                name: data.name,
                email: data.email,
                timezone: data.timezone,
                dateFormat: data.dateFormat,
                timeFormat: data.timeFormat
            }
        });
        revalidatePath("/dashboard/users");
        revalidatePath("/dashboard/settings");
        return { success: true };
    } catch (error) {
         console.error(error);
        return { success: false, error: "Failed to update user" };
    }
}
