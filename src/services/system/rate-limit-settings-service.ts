/**
 * Saves the rate limits of the Settings page and rebuilds the limiters of this process. The
 * middleware reads them through its internal endpoint within 30 seconds.
 */

import prisma from "@/lib/prisma";
import { RATE_LIMIT_KEYS, type RateLimitConfig } from "@/lib/rate-limit";
import { reloadRateLimits } from "@/lib/rate-limit/server";

export async function saveRateLimitConfig(config: RateLimitConfig): Promise<void> {
    const entries: { key: string; value: number; description: string }[] = [
        { key: RATE_LIMIT_KEYS.authPoints, value: config.auth.points, description: "Auth rate limit: max requests" },
        { key: RATE_LIMIT_KEYS.authDuration, value: config.auth.duration, description: "Auth rate limit: window in seconds" },
        { key: RATE_LIMIT_KEYS.apiPoints, value: config.api.points, description: "API rate limit: max requests" },
        { key: RATE_LIMIT_KEYS.apiDuration, value: config.api.duration, description: "API rate limit: window in seconds" },
        { key: RATE_LIMIT_KEYS.mutationPoints, value: config.mutation.points, description: "Mutation rate limit: max requests" },
        { key: RATE_LIMIT_KEYS.mutationDuration, value: config.mutation.duration, description: "Mutation rate limit: window in seconds" },
    ];

    await prisma.$transaction(
        entries.map(({ key, value, description }) =>
            prisma.systemSetting.upsert({
                where: { key },
                update: { value: String(value) },
                create: { key, value: String(value), description },
            })
        )
    );

    await reloadRateLimits();
}
