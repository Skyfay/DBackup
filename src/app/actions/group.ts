"use server"

import prisma from "@/lib/prisma";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { checkPermission, getCurrentUserWithGroup } from "@/lib/access-control";
import { PERMISSIONS } from "@/lib/permissions";
import { auditService } from "@/services/audit-service";
import { AUDIT_ACTIONS, AUDIT_RESOURCES } from "@/lib/core/audit-types";
import { logger } from "@/lib/logger";
import { wrapError } from "@/lib/errors";

const log = logger.child({ action: "group" });

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
    const currentUser = await getCurrentUserWithGroup();

    try {
        const validated = groupSchema.parse(data);

        const newGroup = await prisma.group.create({
            data: {
                name: validated.name,
                permissions: JSON.stringify(validated.permissions),
            }
        });

        revalidatePath("/dashboard/users");

        if (currentUser) {
            await auditService.log(
                currentUser.id,
                AUDIT_ACTIONS.CREATE,
                AUDIT_RESOURCES.GROUP,
                validated,
                newGroup.id
            );
        }

        return { success: true };
    } catch (error: unknown) {
        log.error("Failed to create group", {}, wrapError(error));
        return { success: false, error: "Failed to create group" };
    }
}

export async function updateGroup(id: string, data: GroupFormValues) {
    await checkPermission(PERMISSIONS.GROUPS.WRITE);
    const currentUser = await getCurrentUserWithGroup();

    try {
        const validated = groupSchema.parse(data);

        // Check if group is SuperAdmin
        const existingGroup = await prisma.group.findUnique({
            where: { id }
        });

        if (existingGroup?.name === "SuperAdmin") {
             return { success: false, error: "The SuperAdmin group cannot be edited manually." };
        }

        await prisma.group.update({
            where: { id },
            data: {
                name: validated.name,
                permissions: JSON.stringify(validated.permissions),
            }
        });

        revalidatePath("/dashboard/users");

        if (currentUser) {
            await auditService.log(
                currentUser.id,
                AUDIT_ACTIONS.UPDATE,
                AUDIT_RESOURCES.GROUP,
                validated,
                id
            );
        }

        return { success: true };
    } catch (error: unknown) {
        log.error("Failed to update group", { groupId: id }, wrapError(error));
        return { success: false, error: "Failed to update group" };
    }
}

export async function deleteGroup(id: string) {
    await checkPermission(PERMISSIONS.GROUPS.WRITE);
    const currentUser = await getCurrentUserWithGroup();

    try {
        const group = await prisma.group.findUnique({
            where: { id }
        });

        if (group?.name === "SuperAdmin") {
            return { success: false, error: "The SuperAdmin group cannot be deleted." };
        }

        await prisma.group.delete({
            where: { id }
        });

        revalidatePath("/dashboard/users");

        if (currentUser) {
            await auditService.log(
                currentUser.id,
                AUDIT_ACTIONS.DELETE,
                AUDIT_RESOURCES.GROUP,
                { name: group?.name },
                id
            );
        }

        return { success: true };
    } catch (error: unknown) {
        log.error("Failed to delete group", { groupId: id }, wrapError(error));
        return { success: false, error: "Failed to delete group. Ensure no users are assigned to it." };
    }
}
