"use server";

import prisma from "@/lib/prisma";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { checkPermission } from "@/lib/auth/access-control";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { logger } from "@/lib/logging/logger";
import { wrapError } from "@/lib/logging/errors";
import { RATE_LIMIT_KEYS, RATE_LIMIT_DEFAULTS } from "@/lib/rate-limit";
import { reloadRateLimits } from "@/lib/rate-limit/server";
import { AUDIT_ACTIONS, AUDIT_RESOURCES } from "@/lib/core/audit-types";
import { auditService } from "@/services/audit-service";
import { rateLimitSettings, settingsChanges, SETTINGS_AREAS } from "@/services/system/settings-audit";

const log = logger.child({ action: "rate-limit-settings" });

const rateLimitSchema = z.object({
    authPoints: z.coerce.number().min(1).max(1000),
    authDuration: z.coerce.number().min(10).max(3600),
    apiPoints: z.coerce.number().min(1).max(10000),
    apiDuration: z.coerce.number().min(10).max(3600),
    mutationPoints: z.coerce.number().min(1).max(1000),
    mutationDuration: z.coerce.number().min(10).max(3600),
});

export type RateLimitFormData = z.infer<typeof rateLimitSchema>;

export async function updateRateLimitSettings(data: RateLimitFormData) {
    const user = await checkPermission(PERMISSIONS.SETTINGS.WRITE);

    const result = rateLimitSchema.safeParse(data);
    if (!result.success) {
        return { success: false, error: result.error.issues[0].message };
    }

    try {
        const before = await rateLimitSettings();
        const entries: { key: string; value: string; description: string }[] = [
            { key: RATE_LIMIT_KEYS.authPoints, value: String(result.data.authPoints), description: "Auth rate limit: max requests" },
            { key: RATE_LIMIT_KEYS.authDuration, value: String(result.data.authDuration), description: "Auth rate limit: window in seconds" },
            { key: RATE_LIMIT_KEYS.apiPoints, value: String(result.data.apiPoints), description: "API rate limit: max requests" },
            { key: RATE_LIMIT_KEYS.apiDuration, value: String(result.data.apiDuration), description: "API rate limit: window in seconds" },
            { key: RATE_LIMIT_KEYS.mutationPoints, value: String(result.data.mutationPoints), description: "Mutation rate limit: max requests" },
            { key: RATE_LIMIT_KEYS.mutationDuration, value: String(result.data.mutationDuration), description: "Mutation rate limit: window in seconds" },
        ];

        await prisma.$transaction(
            entries.map(({ key, value, description }) =>
                prisma.systemSetting.upsert({
                    where: { key },
                    update: { value },
                    create: { key, value, description },
                })
            )
        );

        // Reload in-memory rate limiters with new values
        await reloadRateLimits();

        log.info("Rate limit settings updated", {
            auth: `${result.data.authPoints}/${result.data.authDuration}s`,
            api: `${result.data.apiPoints}/${result.data.apiDuration}s`,
            mutation: `${result.data.mutationPoints}/${result.data.mutationDuration}s`,
        });

        const changes = settingsChanges(before, await rateLimitSettings());
        if (changes.length > 0) {
            await auditService.log(user.id, AUDIT_ACTIONS.UPDATE, AUDIT_RESOURCES.SYSTEM, { area: SETTINGS_AREAS.RATE_LIMITS, changes });
        }

        revalidatePath("/dashboard/settings");
        return { success: true };
    } catch (error: unknown) {
        log.error("Failed to update rate limit settings", {}, wrapError(error));
        return { success: false, error: "Failed to update rate limit settings" };
    }
}

export async function resetRateLimitSettings() {
    const user = await checkPermission(PERMISSIONS.SETTINGS.WRITE);

    try {
        const before = await rateLimitSettings();
        const entries: { key: string; value: string; description: string }[] = [
            { key: RATE_LIMIT_KEYS.authPoints, value: String(RATE_LIMIT_DEFAULTS.auth.points), description: "Auth rate limit: max requests" },
            { key: RATE_LIMIT_KEYS.authDuration, value: String(RATE_LIMIT_DEFAULTS.auth.duration), description: "Auth rate limit: window in seconds" },
            { key: RATE_LIMIT_KEYS.apiPoints, value: String(RATE_LIMIT_DEFAULTS.api.points), description: "API rate limit: max requests" },
            { key: RATE_LIMIT_KEYS.apiDuration, value: String(RATE_LIMIT_DEFAULTS.api.duration), description: "API rate limit: window in seconds" },
            { key: RATE_LIMIT_KEYS.mutationPoints, value: String(RATE_LIMIT_DEFAULTS.mutation.points), description: "Mutation rate limit: max requests" },
            { key: RATE_LIMIT_KEYS.mutationDuration, value: String(RATE_LIMIT_DEFAULTS.mutation.duration), description: "Mutation rate limit: window in seconds" },
        ];

        await prisma.$transaction(
            entries.map(({ key, value, description }) =>
                prisma.systemSetting.upsert({
                    where: { key },
                    update: { value },
                    create: { key, value, description },
                })
            )
        );

        await reloadRateLimits();

        log.info("Rate limit settings reset to defaults");

        const changes = settingsChanges(before, await rateLimitSettings());
        if (changes.length > 0) {
            await auditService.log(user.id, AUDIT_ACTIONS.UPDATE, AUDIT_RESOURCES.SYSTEM, { area: SETTINGS_AREAS.RATE_LIMITS, action: "reset", changes });
        }

        revalidatePath("/dashboard/settings");
        return { success: true };
    } catch (error: unknown) {
        log.error("Failed to reset rate limit settings", {}, wrapError(error));
        return { success: false, error: "Failed to reset rate limit settings" };
    }
}
