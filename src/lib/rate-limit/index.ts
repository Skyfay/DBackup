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

// ── Limiters of the process ────────────────────────────────────

type Limiters = { auth: RateLimiterMemory; api: RateLimiterMemory; mutation: RateLimiterMemory };

interface LimiterState {
    limiters: Limiters;
    /** The limits the limiters were built with, so an unchanged config keeps their counters. */
    applied: RateLimitConfig;
}

/**
 * The limiters live on `globalThis`, not in this module. The proxy is built as a bundle of its own
 * with its own copy of this module, while the server action that saves the limits and the start
 * that reads them run in the bundle of the app. One process holds both, so a key of the process
 * gives them the same limiters and the same counters.
 */
const STATE_KEY = Symbol.for("dbackup.rateLimiters");

function freshState(): LimiterState {
    return {
        limiters: {
            auth: new RateLimiterMemory({ points: RATE_LIMIT_DEFAULTS.auth.points, duration: RATE_LIMIT_DEFAULTS.auth.duration }),
            api: new RateLimiterMemory({ points: RATE_LIMIT_DEFAULTS.api.points, duration: RATE_LIMIT_DEFAULTS.api.duration }),
            mutation: new RateLimiterMemory({ points: RATE_LIMIT_DEFAULTS.mutation.points, duration: RATE_LIMIT_DEFAULTS.mutation.duration }),
        },
        applied: {
            auth: { ...RATE_LIMIT_DEFAULTS.auth },
            api: { ...RATE_LIMIT_DEFAULTS.api },
            mutation: { ...RATE_LIMIT_DEFAULTS.mutation },
        },
    };
}

function state(): LimiterState {
    const holder = globalThis as typeof globalThis & { [STATE_KEY]?: LimiterState };
    holder[STATE_KEY] ??= freshState();
    return holder[STATE_KEY];
}

// ── Public Getters ─────────────────────────────────────────────

/** Auth limiter – login attempts */
export function getAuthLimiter() { return state().limiters.auth; }
/** API (GET) limiter – read requests */
export function getApiLimiter() { return state().limiters.api; }
/** Mutation limiter – write requests (POST/PUT/DELETE) */
export function getMutationLimiter() { return state().limiters.mutation; }

// ── Helpers ────────────────────────────────────────────────────

const same = (a: { points: number; duration: number }, b: { points: number; duration: number }) =>
    a.points === b.points && a.duration === b.duration;

/**
 * Builds a limiter anew only where its limit changed. A new limiter starts counting from zero, so
 * saving one limit keeps the counters of the others.
 */
function rebuildLimiters(config: RateLimitConfig): boolean {
    const current = state();
    const kinds = ["auth", "api", "mutation"] as const;
    let changed = false;
    for (const kind of kinds) {
        if (same(current.applied[kind], config[kind])) continue;
        current.limiters = { ...current.limiters, [kind]: new RateLimiterMemory({ points: config[kind].points, duration: config[kind].duration }) };
        changed = true;
    }
    current.applied = { auth: { ...config.auth }, api: { ...config.api }, mutation: { ...config.mutation } };
    return changed;
}

// ── Public API ─────────────────────────────────────────────────

/**
 * Applies the limits read from the database to the limiters of the process, which the proxy
 * counts with. Called by `reloadRateLimits()` at the start and after the limits are saved.
 */
export function applyRateLimitConfig(config: RateLimitConfig): void {
    if (!rebuildLimiters(config)) return;
    log.info("Rate limiters updated", {
        auth: `${config.auth.points}/${config.auth.duration}s`,
        api: `${config.api.points}/${config.api.duration}s`,
        mutation: `${config.mutation.points}/${config.mutation.duration}s`,
    });
}
