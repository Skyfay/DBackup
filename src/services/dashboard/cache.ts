/**
 * Process-wide cache for the dashboard overview.
 *
 * The aggregates behind the cards and charts scan weeks of executions, and the page re-renders
 * every few seconds while a job runs. They are computed once and shared until they expire or a
 * backup finishes, which calls invalidateDashboardCache().
 */

interface CacheEntry<T> {
    value: T;
    expiresAt: number;
    survivesInvalidation: boolean;
}

interface CacheState {
    entries: Map<string, CacheEntry<unknown>>;
    pending: Map<string, Promise<unknown>>;
    /** Bumped on every invalidation, so a load that started before it cannot store stale data. */
    generation: number;
}

export interface CacheOptions {
    /**
     * Keeps the entry when a finished backup clears the cache. Only for data a new run cannot
     * change, like the counts of past calendar days.
     */
    survivesInvalidation?: boolean;
}

// Stored on globalThis so the runner and the pages share one cache, even across module reloads.
const globalForCache = globalThis as unknown as { __dbackupDashboardCache?: CacheState };
const state: CacheState = (globalForCache.__dbackupDashboardCache ??= {
    entries: new Map(),
    pending: new Map(),
    generation: 0,
});

/** Keys that embed a date roll over daily, so expired entries are dropped instead of piling up. */
function pruneExpired(now: number): void {
    for (const [key, entry] of state.entries) {
        if (entry.expiresAt <= now) state.entries.delete(key);
    }
}

/**
 * Returns the cached value for `key`, or runs `load` once and caches its result for `ttlMs`.
 * Concurrent callers share the same in-flight load. A failed load is not cached.
 */
export async function cached<T>(
    key: string,
    ttlMs: number,
    load: () => Promise<T>,
    options: CacheOptions = {},
): Promise<T> {
    const entry = state.entries.get(key) as CacheEntry<T> | undefined;
    if (entry && entry.expiresAt > Date.now()) return entry.value;

    const inFlight = state.pending.get(key) as Promise<T> | undefined;
    if (inFlight) return inFlight;

    const survivesInvalidation = options.survivesInvalidation === true;
    const generation = state.generation;
    const promise = load()
        .then((value) => {
            if (survivesInvalidation || state.generation === generation) {
                const now = Date.now();
                pruneExpired(now);
                state.entries.set(key, { value, expiresAt: now + ttlMs, survivesInvalidation });
            }
            return value;
        })
        .finally(() => {
            if (state.pending.get(key) === promise) state.pending.delete(key);
        });

    state.pending.set(key, promise);
    return promise;
}

/**
 * Drops every cached dashboard value a new run can change. Called when a backup finishes, and
 * when jobs or notification templates change which connections they use.
 */
export function invalidateDashboardCache(): void {
    state.generation++;
    for (const [key, entry] of state.entries) {
        if (!entry.survivesInvalidation) state.entries.delete(key);
    }
    state.pending.clear();
}
