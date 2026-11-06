"use server";

import { checkPermission } from "@/lib/auth/access-control";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { ConfigService } from "@/services/config/config-service";
import { RestoreOptions } from "@/lib/types/config-backup";
import { logger } from "@/lib/logging/logger";
import { userMessage } from "@/lib/logging/user-message";
import { connectionName } from "@/services/adapters/adapter-audit";
import { auditService } from "@/services/audit-service";
import { PLATFORM_LOG } from "@/services/system/settings-save";
import { AUDIT_ACTIONS, AUDIT_RESOURCES } from "@/lib/core/audit-types";
import { runAsTenant } from "@/lib/tenant/context";
import { HOME_TENANT_ID } from "@/lib/tenant/home";
import { z } from "zod";

const log = logger.child({ action: "config-management" });
const configService = new ConfigService();

/**
 * A restore writes users, groups and sign-in providers from a file, so it could make anyone a
 * platform admin. Only a platform admin restores a configuration. Restore from a file is the route
 * `/api/settings/config-backup/restore`, since a Server Action takes at most 1 MB.
 */
const ONLY_SUPER_ADMIN = { success: false as const, error: "Only a platform admin restores a configuration backup." };

const RestoreFromStorageSchema = z.object({
    storageConfigId: z.string().min(1).max(200),
    file: z.string().min(1).max(4096).refine((value) => !value.includes("\0"), "Invalid path"),
    decryptionProfileId: z.string().min(1).max(200).optional(),
    options: z.object({
        settings: z.boolean(),
        adapters: z.boolean(),
        jobs: z.boolean(),
        users: z.boolean(),
        sso: z.boolean(),
        profiles: z.boolean(),
        statistics: z.boolean().optional(),
    }).strict().optional(),
});

/**
 * Restores a configuration backup from storage.
 */
export async function restoreFromStorageAction(
    storageConfigId: string,
    file: string,
    decryptionProfileId?: string,
    options?: RestoreOptions
) {
    const user = await checkPermission(PERMISSIONS.SETTINGS.WRITE);
    if (!user.isPlatformAdmin) return ONLY_SUPER_ADMIN;

    const parsed = RestoreFromStorageSchema.safeParse({ storageConfigId, file, decryptionProfileId, options });
    if (!parsed.success) return { success: false as const, error: parsed.error.issues[0]?.message ?? "Invalid request" };
    const input = parsed.data;

    try {
        const executionId = await configService.restoreFromStorage(input.storageConfigId, input.file, input.decryptionProfileId, input.options);
        // Written once the restore started, it runs on in the background. The configuration backups
        // lie on a destination of the home tenant, which names it.
        await auditService.log(user.id, AUDIT_ACTIONS.RESTORE, AUDIT_RESOURCES.SYSTEM, {
            action: "config_restore",
            file: input.file,
            destination: await runAsTenant(HOME_TENANT_ID, () => connectionName(input.storageConfigId)),
        }, undefined, PLATFORM_LOG);
        return { success: true, executionId };
    } catch (error: unknown) {
        return { success: false, error: userMessage(error, "The restore could not be started. The server log has the details.", log, "Restore from storage error") };
    }
}
