"use server";

import { z } from "zod";
import { checkPermission } from "@/lib/auth/access-control";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { saveRateLimitConfig } from "@/services/system/rate-limit-settings-service";
import { rateLimitSettings, SETTINGS_AREAS } from "@/services/system/settings-audit";
import { invalid, savePart, type SaveResult } from "@/lib/settings/save-part";

const window = z.coerce.number().int().min(10, "A window is at least 10 seconds").max(3600, "A window is at most 3600 seconds");

const rateLimitSchema = z.object({
    auth: z.object({ points: z.coerce.number().int().min(1).max(1000), duration: window }),
    api: z.object({ points: z.coerce.number().int().min(1).max(10000), duration: window }),
    mutation: z.object({ points: z.coerce.number().int().min(1).max(1000), duration: window }),
});

export type RateLimitFormData = z.infer<typeof rateLimitSchema>;

export async function updateRateLimitSettings(data: RateLimitFormData): Promise<SaveResult> {
    const user = await checkPermission(PERMISSIONS.SETTINGS.WRITE);

    const parsed = rateLimitSchema.safeParse(data);
    if (!parsed.success) return invalid(parsed.error.issues);
    return savePart(user.id, SETTINGS_AREAS.RATE_LIMITS, rateLimitSettings, () => saveRateLimitConfig(parsed.data));
}
