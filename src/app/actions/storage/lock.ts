"use server";

import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import { checkPermission } from "@/lib/access-control";
import { PERMISSIONS } from "@/lib/permissions";
import { storageService } from "@/services/storage-service";
import { revalidatePath } from "next/cache";

export async function lockBackup(destinationId: string, filePath: string) {
    const session = await auth.api.getSession({
        headers: await headers()
    });

    if (!session) {
        throw new Error("Unauthorized");
    }

    await checkPermission(PERMISSIONS.STORAGE.DELETE); // Reuse delete permission for managing retention locks? Or WRITE? Let's use Delete since it prevents deletion.

    try {
        await storageService.toggleLock(destinationId, filePath);
        revalidatePath(`/dashboard/storage`);
        return { success: true };
    } catch (error: any) {
        console.error("Failed to lock backup:", error);
        return { success: false, error: error.message };
    }
}
