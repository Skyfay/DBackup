import { RateLimiterMemory } from 'rate-limiter-flexible';
import { logger } from '@/lib/logging/logger';

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

/** The limits the limiters were built with, so an unchanged config keeps their counters. */
let _applied: RateLimitConfig = {
    auth: { ...RATE_LIMIT_DEFAULTS.auth },
    api: { ...RATE_LIMIT_DEFAULTS.api },
    mutation: { ...RATE_LIMIT_DEFAULTS.mutation },
};

const same = (a: { points: number; duration: number }, b: { points: number; duration: number }) =>
    a.points === b.points && a.duration === b.duration;

/**
 * Builds a limiter anew only where its limit changed. A new limiter starts counting from zero,
 * and the middleware applies the config every 30 seconds, which reset every counter each time.
 */
function rebuildLimiters(config: RateLimitConfig): boolean {
    const kinds = ["auth", "api", "mutation"] as const;
    let changed = false;
    for (const kind of kinds) {
        if (same(_applied[kind], config[kind])) continue;
        _limiters = { ..._limiters, [kind]: new RateLimiterMemory({ points: config[kind].points, duration: config[kind].duration }) };
        changed = true;
    }
    _applied = { auth: { ...config.auth }, api: { ...config.api }, mutation: { ...config.mutation } };
    return changed;
}

// ── Public API ─────────────────────────────────────────────────

/**
 * Apply an externally-fetched config to the module-local rate limiters.
 *
 * Called from middleware after fetching config via the internal API endpoint.
 * This is Edge Runtime safe - no Prisma, no Node.js APIs.
 */
export function applyExternalConfig(config: RateLimitConfig): void {
    if (!rebuildLimiters(config)) return;
    log.info("Rate limiters updated from external config", {
        auth: `${config.auth.points}/${config.auth.duration}s`,
        api: `${config.api.points}/${config.api.duration}s`,
        mutation: `${config.mutation.points}/${config.mutation.duration}s`,
    });
}


