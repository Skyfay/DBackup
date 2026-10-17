"use server";

import { z } from "zod";
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

const LockSchema = z.object({
    destinationId: z.string().min(1).max(200),
    filePath: z.string().min(1).max(4096),
});

export async function lockBackup(destinationId: string, filePath: string) {
    // The delete permission, since a lock keeps a backup from being deleted.
    const user = await checkPermission(PERMISSIONS.STORAGE.DELETE);

    const parsed = LockSchema.safeParse({ destinationId, filePath });
    if (!parsed.success) return { success: false, error: "Invalid request" };

    try {
        const locked = await storageService.toggleLock(parsed.data.destinationId, parsed.data.filePath);
        revalidatePath(`/dashboard/backups`);
        await auditService.log(
            user.id,
            AUDIT_ACTIONS.UPDATE,
            AUDIT_RESOURCES.BACKUP,
            { action: locked ? "lock" : "unlock", ...(await backupAuditDetails(parsed.data.destinationId, parsed.data.filePath)) },
            parsed.data.destinationId
        );
        return { success: true, locked };
    } catch (error: unknown) {
        log.error("Failed to lock backup", { destinationId: parsed.data.destinationId, filePath: parsed.data.filePath }, wrapError(error));
        return { success: false, error: getErrorMessage(error) };
    }
}
