"use server"

import prisma from "@/lib/prisma";
import { User } from "better-auth";
import { revalidatePath } from "next/cache";

export async function getUsers() {
    return await prisma.user.findMany({
        orderBy: {
            createdAt: 'desc'
        }
    });
}

export async function deleteUser(userId: string) {
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
        return { success: true };
    } catch (error) {
        return { success: false, error: "Failed to delete user" };
    }
}

export async function updateUser(userId: string, data: { name?: string; email?: string; timezone?: string }) {
    try {
        await prisma.user.update({
            where: {
                id: userId
            },
            data: {
                name: data.name,
                email: data.email,
                timezone: data.timezone
            }
        });
        revalidatePath("/dashboard/users");
        return { success: true };
    } catch (error) {
         console.error(error);
        return { success: false, error: "Failed to update user" };
    }
}
