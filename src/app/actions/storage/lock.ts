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
import { userMessage } from "@/lib/logging/user-message";
import { configBackupFileRefusal } from "@/lib/server/config-backup-guard";
import { backupPathIssue } from "@/lib/server/backup-path-schema";
import { backupPathProblem } from "@/lib/tenant/storage-view";

const log = logger.child({ action: "storage-lock" });

const LockSchema = z.object({
    destinationId: z.string().min(1).max(200),
    filePath: z.string().min(1).max(4096).superRefine(backupPathIssue),
});

export async function lockBackup(destinationId: string, filePath: string) {
    // The delete permission, since a lock keeps a backup from being deleted.
    const user = await checkPermission(PERMISSIONS.STORAGE.DELETE);

    const parsed = LockSchema.safeParse({ destinationId, filePath });
    // The sentence of a path that leaves the destination is written for the user, see `backupPathProblem`.
    if (!parsed.success) return { success: false, error: backupPathProblem(filePath) ?? "Invalid request" };

    // A configuration backup is the platform's, only a platform admin keeps or frees it.
    const refused = await configBackupFileRefusal(
        { isPlatformAdmin: user.isPlatformAdmin, authMethod: "session", tenantId: user.tenantId },
        parsed.data.destinationId,
        parsed.data.filePath
    );
    if (refused) return { success: false, error: refused };

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
        // The provider's words of a shared destination may name its hosts and paths, so they stay in the log.
        const message = userMessage(error, "The lock could not be changed. The server log has the details.", log, "Failed to lock backup", { destinationId: parsed.data.destinationId, filePath: parsed.data.filePath });
        return { success: false, error: message };
    }
}
