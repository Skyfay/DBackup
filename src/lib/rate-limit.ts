import { RateLimiterMemory } from 'rate-limiter-flexible';
import { logger } from './logger';

const log = logger.child({ module: "RateLimit" });

// ── Default Values ─────────────────────────────────────────────

export const RATE_LIMIT_DEFAULTS = {
    auth: { points: 5, duration: 60 },
    api: { points: 100, duration: 60 },
    mutation: { points: 20, duration: 60 },
} as const;

export interface RateLimitConfig {
    auth: { points: number; duration: number };
    api: { points: number; duration: number };
    mutation: { points: number; duration: number };
}

// ── SystemSetting Keys ─────────────────────────────────────────

export const RATE_LIMIT_KEYS = {
    authPoints: "rateLimit.auth.points",
    authDuration: "rateLimit.auth.duration",
    apiPoints: "rateLimit.api.points",
    apiDuration: "rateLimit.api.duration",
    mutationPoints: "rateLimit.mutation.points",
    mutationDuration: "rateLimit.mutation.duration",
} as const;

// ── Module-local Limiter Instances ─────────────────────────────

let _limiters = {
    auth: new RateLimiterMemory({
        points: RATE_LIMIT_DEFAULTS.auth.points,
        duration: RATE_LIMIT_DEFAULTS.auth.duration,
    }),
    api: new RateLimiterMemory({
        points: RATE_LIMIT_DEFAULTS.api.points,
        duration: RATE_LIMIT_DEFAULTS.api.duration,
    }),
    mutation: new RateLimiterMemory({
        points: RATE_LIMIT_DEFAULTS.mutation.points,
        duration: RATE_LIMIT_DEFAULTS.mutation.duration,
    }),
};

// ── Public Getters ─────────────────────────────────────────────

/** Auth limiter – login attempts */
export function getAuthLimiter() { return _limiters.auth; }
/** API (GET) limiter – read requests */
export function getApiLimiter() { return _limiters.api; }
/** Mutation limiter – write requests (POST/PUT/DELETE) */
export function getMutationLimiter() { return _limiters.mutation; }

// ── Helpers ────────────────────────────────────────────────────

function parseSetting(settingMap: Map<string, string>, key: string, fallback: number): number {
    const val = settingMap.get(key);
    if (!val) return fallback;
    const num = parseInt(val, 10);
    return isNaN(num) || num < 1 ? fallback : num;
}

function rebuildLimiters(config: RateLimitConfig): void {
    _limiters = {
        auth: new RateLimiterMemory({ points: config.auth.points, duration: config.auth.duration }),
        api: new RateLimiterMemory({ points: config.api.points, duration: config.api.duration }),
        mutation: new RateLimiterMemory({ points: config.mutation.points, duration: config.mutation.duration }),
    };
}

// ── Public API ─────────────────────────────────────────────────

/**
 * Apply an externally-fetched config to the module-local rate limiters.
 *
 * Called from middleware after fetching config via the internal API endpoint.
 * This is Edge Runtime safe — no Prisma, no Node.js APIs.
 */
export function applyExternalConfig(config: RateLimitConfig): void {
    rebuildLimiters(config);
    log.info("Rate limiters updated from external config", {
        auth: `${config.auth.points}/${config.auth.duration}s`,
        api: `${config.api.points}/${config.api.duration}s`,
        mutation: `${config.mutation.points}/${config.mutation.duration}s`,
    });
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
        const prisma = (await import('./prisma')).default;

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

        rebuildLimiters(config);

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
        const prisma = (await import('./prisma')).default;
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
