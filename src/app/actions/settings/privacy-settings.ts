"use server"

import { z } from "zod";
import { checkPermission } from "@/lib/auth/access-control";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { savePrivacySettings } from "@/services/system/system-settings-service";
import { privacySettings, SETTINGS_AREAS } from "@/services/system/settings-audit";
import { invalid, savePart, type SaveResult } from "@/lib/settings/save-part";

const privacySettingsSchema = z.object({
    includeActorInMetadata: z.boolean(),
});

export async function savePrivacySettingsAction(input: z.infer<typeof privacySettingsSchema>): Promise<SaveResult> {
    const user = await checkPermission(PERMISSIONS.SETTINGS.WRITE);

    const parsed = privacySettingsSchema.safeParse(input);
    if (!parsed.success) return invalid(parsed.error.issues);
    return savePart(user.id, SETTINGS_AREAS.PRIVACY, privacySettings, () => savePrivacySettings(parsed.data));
}
