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
