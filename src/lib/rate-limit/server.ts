import prisma from '@/lib/prisma';
import { logger } from '@/lib/logging/logger';
import {
    RATE_LIMIT_KEYS,
    RATE_LIMIT_DEFAULTS,
    applyRateLimitConfig,
    type RateLimitConfig,
} from '.';

const log = logger.child({ module: "RateLimit" });

function parseSetting(settingMap: Map<string, string>, key: string, fallback: number): number {
    const val = settingMap.get(key);
    if (!val) return fallback;
    const num = parseInt(val, 10);
    return isNaN(num) || num < 1 ? fallback : num;
}

/**
 * Reload rate limiters from the database (SERVER CONTEXT ONLY).
 *
 * Reads SystemSetting values via Prisma and rebuilds local limiters.
 * Called on app startup (instrumentation.ts) and after settings changes
 * (server action).
 */
export async function reloadRateLimits(): Promise<void> {
    try {
        const keys = Object.values(RATE_LIMIT_KEYS);
        const settings = await prisma.systemSetting.findMany({
            where: { key: { in: keys } },
        });

        const settingMap = new Map(settings.map(s => [s.key, s.value]));

        const config: RateLimitConfig = {
            auth: {
                points: parseSetting(settingMap, RATE_LIMIT_KEYS.authPoints, RATE_LIMIT_DEFAULTS.auth.points),
                duration: parseSetting(settingMap, RATE_LIMIT_KEYS.authDuration, RATE_LIMIT_DEFAULTS.auth.duration),
            },
            api: {
                points: parseSetting(settingMap, RATE_LIMIT_KEYS.apiPoints, RATE_LIMIT_DEFAULTS.api.points),
                duration: parseSetting(settingMap, RATE_LIMIT_KEYS.apiDuration, RATE_LIMIT_DEFAULTS.api.duration),
            },
            mutation: {
                points: parseSetting(settingMap, RATE_LIMIT_KEYS.mutationPoints, RATE_LIMIT_DEFAULTS.mutation.points),
                duration: parseSetting(settingMap, RATE_LIMIT_KEYS.mutationDuration, RATE_LIMIT_DEFAULTS.mutation.duration),
            },
        };

        applyRateLimitConfig(config);

        log.info("Rate limiters reloaded from DB", {
            auth: `${config.auth.points}/${config.auth.duration}s`,
            api: `${config.api.points}/${config.api.duration}s`,
            mutation: `${config.mutation.points}/${config.mutation.duration}s`,
        });
    } catch (error) {
        log.warn("Failed to reload rate limits from DB, using current values", { error: String(error) });
    }
}

/**
 * Get current rate limit configuration from DB (for displaying in UI).
 * Falls back to defaults on error. SERVER CONTEXT ONLY.
 */
export async function getRateLimitConfig(): Promise<RateLimitConfig> {
    try {
        const keys = Object.values(RATE_LIMIT_KEYS);
        const settings = await prisma.systemSetting.findMany({
            where: { key: { in: keys } },
        });

        const settingMap = new Map(settings.map(s => [s.key, s.value]));

        return {
            auth: {
                points: parseSetting(settingMap, RATE_LIMIT_KEYS.authPoints, RATE_LIMIT_DEFAULTS.auth.points),
                duration: parseSetting(settingMap, RATE_LIMIT_KEYS.authDuration, RATE_LIMIT_DEFAULTS.auth.duration),
            },
            api: {
                points: parseSetting(settingMap, RATE_LIMIT_KEYS.apiPoints, RATE_LIMIT_DEFAULTS.api.points),
                duration: parseSetting(settingMap, RATE_LIMIT_KEYS.apiDuration, RATE_LIMIT_DEFAULTS.api.duration),
            },
            mutation: {
                points: parseSetting(settingMap, RATE_LIMIT_KEYS.mutationPoints, RATE_LIMIT_DEFAULTS.mutation.points),
                duration: parseSetting(settingMap, RATE_LIMIT_KEYS.mutationDuration, RATE_LIMIT_DEFAULTS.mutation.duration),
            },
        };
    } catch {
        return { ...RATE_LIMIT_DEFAULTS };
    }
}
