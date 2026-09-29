"use server";

import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import { checkPermission } from "@/lib/auth/access-control";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { storageService } from "@/services/storage/storage-service";
import { backupAuditDetails } from "@/services/storage/backup-audit";
import { auditService } from "@/services/audit-service";
import { AUDIT_ACTIONS, AUDIT_RESOURCES } from "@/lib/core/audit-types";
import { revalidatePath } from "next/cache";
import { logger } from "@/lib/logging/logger";
import { wrapError, getErrorMessage } from "@/lib/logging/errors";

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
        revalidatePath(`/dashboard/backups`);
        await auditService.log(
            session.user.id,
            AUDIT_ACTIONS.UPDATE,
            AUDIT_RESOURCES.BACKUP,
            { action: locked ? "lock" : "unlock", ...(await backupAuditDetails(destinationId, filePath)) },
            destinationId
        );
        return { success: true, locked };
    } catch (error: unknown) {
        log.error("Failed to lock backup", { destinationId, filePath }, wrapError(error));
        return { success: false, error: getErrorMessage(error) };
    }
}
