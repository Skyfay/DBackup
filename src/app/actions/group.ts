"use server"

import prisma from "@/lib/prisma";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { checkPermission } from "@/lib/access-control";
import { PERMISSIONS } from "@/lib/permissions";

const groupSchema = z.object({
    name: z.string().min(1, "Name is required"),
    permissions: z.array(z.string()),
});

export type GroupFormValues = z.infer<typeof groupSchema>;

export async function getGroups() {
    await checkPermission(PERMISSIONS.GROUPS.READ);

    const groups = await prisma.group.findMany({
        orderBy: {
            createdAt: 'desc'
        },
        include: {
            _count: {
                select: { users: true }
            }
        }
    });

    // Parse permissions JSON
    return groups.map(group => ({
        ...group,
        permissions: JSON.parse(group.permissions) as string[]
    }));
}

export async function createGroup(data: GroupFormValues) {
    await checkPermission(PERMISSIONS.GROUPS.WRITE);

    try {
        const validated = groupSchema.parse(data);

        await prisma.group.create({
            data: {
                name: validated.name,
                permissions: JSON.stringify(validated.permissions),
            }
        });

        revalidatePath("/dashboard/users");
        return { success: true };
    } catch (error) {
        console.error("Failed to create group:", error);
        return { success: false, error: "Failed to create group" };
    }
}

export async function updateGroup(id: string, data: GroupFormValues) {
    await checkPermission(PERMISSIONS.GROUPS.WRITE);

    try {
        const validated = groupSchema.parse(data);

        await prisma.group.update({
            where: { id },
            data: {
                name: validated.name,
                permissions: JSON.stringify(validated.permissions),
            }
        });

        revalidatePath("/dashboard/users");
        return { success: true };
    } catch (error) {
        console.error("Failed to update group:", error);
        return { success: false, error: "Failed to update group" };
    }
}

export async function deleteGroup(id: string) {
    await checkPermission(PERMISSIONS.GROUPS.WRITE);

    try {
        await prisma.group.delete({
            where: { id }
        });

        revalidatePath("/dashboard/users");
        return { success: true };
    } catch (error) {
        console.error("Failed to delete group:", error);
        return { success: false, error: "Failed to delete group. Ensure no users are assigned to it." };
    }
}
