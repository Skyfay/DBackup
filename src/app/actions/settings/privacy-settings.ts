"use server"

import prisma from "@/lib/prisma";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { checkPermission } from "@/lib/auth/access-control";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { logger } from "@/lib/logging/logger";
import { wrapError } from "@/lib/logging/errors";

const log = logger.child({ action: "privacy-settings" });

const privacySettingsSchema = z.object({
    includeActorInMetadata: z.boolean(),
});

export async function updatePrivacySettings(data: z.infer<typeof privacySettingsSchema>) {
    await checkPermission(PERMISSIONS.SETTINGS.WRITE);

    const result = privacySettingsSchema.safeParse(data);
    if (!result.success) {
        return { success: false, error: result.error.issues[0].message };
    }

    try {
        await prisma.systemSetting.upsert({
            where: { key: "privacy.includeActorInMetadata" },
            update: { value: String(result.data.includeActorInMetadata) },
            create: { key: "privacy.includeActorInMetadata", value: String(result.data.includeActorInMetadata) },
        });

        log.info("Privacy settings updated", { includeActorInMetadata: result.data.includeActorInMetadata });
        revalidatePath("/dashboard/settings");
        return { success: true };
    } catch (error) {
        const wrapped = wrapError(error);
        log.error("Failed to update privacy settings", {}, wrapped);
        return { success: false, error: "Failed to save settings." };
    }
}
