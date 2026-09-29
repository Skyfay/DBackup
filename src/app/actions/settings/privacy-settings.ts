"use server"

import prisma from "@/lib/prisma";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { checkPermission } from "@/lib/auth/access-control";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { logger } from "@/lib/logging/logger";
import { wrapError } from "@/lib/logging/errors";
import { AUDIT_ACTIONS, AUDIT_RESOURCES } from "@/lib/core/audit-types";
import { auditService } from "@/services/audit-service";
import { privacySettings, settingsChanges, SETTINGS_AREAS } from "@/services/system/settings-audit";

const log = logger.child({ action: "privacy-settings" });

const privacySettingsSchema = z.object({
    includeActorInMetadata: z.boolean(),
});

export async function updatePrivacySettings(data: z.infer<typeof privacySettingsSchema>) {
    const user = await checkPermission(PERMISSIONS.SETTINGS.WRITE);

    const result = privacySettingsSchema.safeParse(data);
    if (!result.success) {
        return { success: false, error: result.error.issues[0].message };
    }

    try {
        const before = await privacySettings();
        await prisma.systemSetting.upsert({
            where: { key: "privacy.includeActorInMetadata" },
            update: { value: String(result.data.includeActorInMetadata) },
            create: { key: "privacy.includeActorInMetadata", value: String(result.data.includeActorInMetadata) },
        });
        const changes = settingsChanges(before, await privacySettings());
        if (changes.length > 0) {
            await auditService.log(user.id, AUDIT_ACTIONS.UPDATE, AUDIT_RESOURCES.SYSTEM, { area: SETTINGS_AREAS.PRIVACY, changes });
        }

        log.info("Privacy settings updated", { includeActorInMetadata: result.data.includeActorInMetadata });
        revalidatePath("/dashboard/settings");
        return { success: true };
    } catch (error) {
        const wrapped = wrapError(error);
        log.error("Failed to update privacy settings", {}, wrapped);
        return { success: false, error: "Failed to save settings." };
    }
}
