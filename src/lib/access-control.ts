import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import { Permission } from "@/lib/permissions";
import prisma from "@/lib/prisma";

export async function getCurrentUserWithGroup() {
    const session = await auth.api.getSession({
        headers: await headers()
    });

    if (!session?.user) {
        return null;
    }

    const user = await prisma.user.findUnique({
        where: { id: session.user.id },
        include: { group: true }
    });

    return user;
}

export async function checkPermission(permission: Permission) {
    const user = await getCurrentUserWithGroup();

    if (!user) {
        throw new Error("Unauthorized");
    }

    if (!user.group) {
        throw new Error(`Forbidden: No group assigned. Missing permission: ${permission}`);
    }

    let permissions: string[] = [];
    try {
        permissions = JSON.parse(user.group.permissions);
    } catch (e) {
        console.error("Failed to parse group permissions", e);
    }

    if (!permissions.includes(permission)) {
        throw new Error(`Forbidden: You do not have the required permission: ${permission}`);
    }

    return user;
}

export async function getUserPermissions(): Promise<string[]> {
    const user = await getCurrentUserWithGroup();
    if (!user || !user.group) return [];

    try {
        return JSON.parse(user.group.permissions);
    } catch {
        return [];
    }
}

export async function hasPermission(permission: Permission): Promise<boolean> {
    try {
        await checkPermission(permission);
        return true;
    } catch {
        return false;
    }
}
