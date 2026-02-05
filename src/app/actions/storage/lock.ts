"use server";

import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import { checkPermission } from "@/lib/access-control";
import { PERMISSIONS } from "@/lib/permissions";
import { storageService } from "@/services/storage-service";
import { revalidatePath } from "next/cache";
import { logger } from "@/lib/logger";
import { wrapError, getErrorMessage } from "@/lib/errors";

const log = logger.child({ action: "storage-lock" });

export async function lockBackup(destinationId: string, filePath: string) {
    const session = await auth.api.getSession({
        headers: await headers()
    });

    if (!session) {
        throw new Error("Unauthorized");
    }

    await checkPermission(PERMISSIONS.STORAGE.DELETE); // Reuse delete permission for managing retention locks? Or WRITE? Let's use Delete since it prevents deletion.

    try {
        const locked = await storageService.toggleLock(destinationId, filePath);
        revalidatePath(`/dashboard/storage`);
        return { success: true, locked };
    } catch (error: unknown) {
        log.error("Failed to lock backup", { destinationId, filePath }, wrapError(error));
        return { success: false, error: getErrorMessage(error) };
    }
}
