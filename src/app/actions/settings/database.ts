"use server";

import { revalidatePath } from "next/cache";
import { checkPermission } from "@/lib/auth/access-control";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { AUDIT_ACTIONS, AUDIT_RESOURCES } from "@/lib/core/audit-types";
import { getErrorMessage, wrapError } from "@/lib/logging/errors";
import { logger } from "@/lib/logging/logger";
import { auditService } from "@/services/audit-service";
import { vacuumDatabase } from "@/services/system/database-service";

const log = logger.child({ action: "database" });

/** Runs VACUUM on the DBackup database. Refused while backups or restores are running. */
export async function vacuumDatabaseAction() {
    const user = await checkPermission(PERMISSIONS.SETTINGS.WRITE);

    try {
        const result = await vacuumDatabase();
        await auditService.log(user.id, AUDIT_ACTIONS.EXECUTE, AUDIT_RESOURCES.SYSTEM, {
            action: "database_vacuum",
            beforeBytes: result.beforeBytes,
            afterBytes: result.afterBytes,
            durationMs: result.durationMs,
        });
        revalidatePath("/dashboard/settings");
        return { success: true, data: result };
    } catch (error: unknown) {
        log.warn("Database vacuum did not complete", {}, wrapError(error));
        return { success: false, error: getErrorMessage(error) };
    }
}
