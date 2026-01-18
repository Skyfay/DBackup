'use server';

import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import { getUserPermissions } from "@/lib/access-control";
import { PERMISSIONS } from "@/lib/permissions";
import * as encryptionService from "@/services/encryption-service";
import { revalidatePath } from "next/cache";

/**
 * Returns all encryption profiles.
 * Requires SETTINGS:READ or JOBS:READ or JOBS:WRITE permission.
 */
export async function getEncryptionProfiles() {
    const headersList = await headers();
    const session = await auth.api.getSession({ headers: headersList });
    if (!session) return { success: false, error: "Unauthorized" };

    const permissions = await getUserPermissions();
    const hasAccess =
        permissions.includes(PERMISSIONS.SETTINGS.READ) ||
        permissions.includes(PERMISSIONS.JOBS.READ) ||
        permissions.includes(PERMISSIONS.JOBS.WRITE);

    if (!hasAccess) {
        return { success: false, error: "Insufficient permissions" };
    }

    try {
        const profiles = await encryptionService.getEncryptionProfiles();
        return { success: true, data: profiles };
    } catch (e: any) {
        return { success: false, error: e.message };
    }
}

/**
 * Revels the decrypted master key for a profile.
 * Requires SETTINGS:WRITE permission (highly sensitive).
 */
export async function revealMasterKey(id: string) {
    const headersList = await headers();
    const session = await auth.api.getSession({ headers: headersList });
    if (!session) return { success: false, error: "Unauthorized" };

    const permissions = await getUserPermissions();
    if (!permissions.includes(PERMISSIONS.SETTINGS.WRITE)) {
        return { success: false, error: "Insufficient permissions" };
    }

    try {
        const key = await encryptionService.getDecryptedMasterKey(id);
        return { success: true, data: key };
    } catch (e: any) {
        return { success: false, error: e.message };
    }
}

/**
 * Creates a new encryption profile.
 * Requires SETTINGS:WRITE permission.
 */
export async function createEncryptionProfile(name: string, description?: string) {
    const headersList = await headers();
    const session = await auth.api.getSession({ headers: headersList });
    if (!session) return { success: false, error: "Unauthorized" };

    const permissions = await getUserPermissions();
    if (!permissions.includes(PERMISSIONS.SETTINGS.WRITE)) {
        return { success: false, error: "Insufficient permissions" };
    }

    try {
        const profile = await encryptionService.createEncryptionProfile(name, description);
        revalidatePath("/dashboard/settings");
        revalidatePath("/dashboard/jobs"); // Revalidate jobs usually where dropdowns are
        return { success: true, data: profile };
    } catch (e: any) {
        return { success: false, error: e.message };
    }
}

/**
 * Deletes an encryption profile.
 * Requires SETTINGS:WRITE permission.
 */
export async function deleteEncryptionProfile(id: string) {
    const headersList = await headers();
    const session = await auth.api.getSession({ headers: headersList });
    if (!session) return { success: false, error: "Unauthorized" };

    const permissions = await getUserPermissions();
    if (!permissions.includes(PERMISSIONS.SETTINGS.WRITE)) {
        return { success: false, error: "Insufficient permissions" };
    }

    try {
        // Warning: This action is destructive and might brick backups.
        // The service does the deletion. Caller should warn user.
        await encryptionService.deleteEncryptionProfile(id);
        revalidatePath("/dashboard/settings");
        revalidatePath("/dashboard/jobs");
        return { success: true };
    } catch (e: any) {
        return { success: false, error: e.message };
    }
}
