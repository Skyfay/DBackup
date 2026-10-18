/**
 * Process-wide cache for the dashboard overview.
 *
 * The aggregates behind the cards and charts scan weeks of executions, and the page re-renders
 * every few seconds while a job runs. They are computed once and shared until they expire or a
 * backup finishes. Each tenant has its own entries, since the same key names the numbers of
 * whoever asks, so a finished run clears only those of its tenant and of All tenants
 * (`invalidateTenantCaches`). A change of the platform clears every tenant (`invalidateDashboardCache`).
 */

import { explicitScope } from "@/lib/tenant/context";
import { requestScope } from "@/lib/tenant/current";

interface CacheEntry<T> {
    value: T;
    expiresAt: number;
    survivesInvalidation: boolean;
    readsOtherTenants: boolean;
}

interface CacheState {
    entries: Map<string, CacheEntry<unknown>>;
    pending: Map<string, Promise<unknown>>;
    /** Bumped on every invalidation of every tenant, so a load that started before it cannot store stale data. */
    generation: number;
    /** The same per scope, bumped when the runs of that tenant change. Absent in a state of an older version. */
    scopeGenerations?: Map<string, number>;
    /** The same for the values that read other tenants too, bumped whenever the runs of any tenant change. */
    acrossGeneration?: number;
    /** The keys of the loads under way that read other tenants too. */
    pendingAcross?: Set<string>;
}

export interface CacheOptions {
    /**
     * Keeps the entry when a finished backup clears the cache. Only for data a new run cannot
     * change, like the counts of past calendar days.
     */
    survivesInvalidation?: boolean;
    /**
     * The value reads what other tenants hold too, like the backups a shared server gives a
     * customer, so a finished run of any tenant clears it, not only one of the tenant that reads it.
     */
    readsOtherTenants?: boolean;
}

/** The scope of every tenant at once, which the system scope and All tenants read alike. */
const EVERY_TENANT = "*";

/**
 * Whose entries a caller reads: its tenant, `*` for every tenant at once, which the system scope
 * and All tenants read alike, unfiltered, and `-` for code of no tenant, like a request of an
 * account that works in none, which must never be served the numbers of every tenant.
 */
async function cacheScope(): Promise<string> {
    const scope = explicitScope() ?? (await requestScope());
    if (!scope) return "-";
    return scope.kind === "tenant" ? scope.tenantId : EVERY_TENANT;
}

// Stored on globalThis so the runner and the pages share one cache, even across module reloads.
const globalForCache = globalThis as unknown as { __dbackupDashboardCache?: CacheState };
const state: CacheState = (globalForCache.__dbackupDashboardCache ??= {
    entries: new Map(),
    pending: new Map(),
    generation: 0,
});

function scopeGenerations(): Map<string, number> {
    return (state.scopeGenerations ??= new Map());
}

function pendingAcross(): Set<string> {
    return (state.pendingAcross ??= new Set());
}

/** The scope a full key was stored under, the part before its first colon. Tenant ids hold none. */
function scopeOfKey(key: string): string {
    return key.slice(0, key.indexOf(":"));
}

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
    // Taken before the tenant is known, so an invalidation from then on keeps this load out too.
    const generation = state.generation;
    const scope = await cacheScope();
    key = `${scope}:${key}`;
    const entry = state.entries.get(key) as CacheEntry<T> | undefined;
    if (entry && entry.expiresAt > Date.now()) return entry.value;

    const inFlight = state.pending.get(key) as Promise<T> | undefined;
    if (inFlight) return inFlight;

    const survivesInvalidation = options.survivesInvalidation === true;
    const readsOtherTenants = options.readsOtherTenants === true;
    // Taken before the load starts, so a run that ends while it reads keeps its result out.
    const scopeGeneration = scopeGenerations().get(scope) ?? 0;
    const acrossGeneration = state.acrossGeneration ?? 0;
    const current = () =>
        state.generation === generation
        && (scopeGenerations().get(scope) ?? 0) === scopeGeneration
        && (!readsOtherTenants || (state.acrossGeneration ?? 0) === acrossGeneration);

    const promise = load()
        .then((value) => {
            if (survivesInvalidation || current()) {
                const now = Date.now();
                pruneExpired(now);
                state.entries.set(key, { value, expiresAt: now + ttlMs, survivesInvalidation, readsOtherTenants });
            }
            return value;
        })
        .finally(() => {
            if (state.pending.get(key) === promise) {
                state.pending.delete(key);
                pendingAcross().delete(key);
            }
        });

    state.pending.set(key, promise);
    if (readsOtherTenants) pendingAcross().add(key);
    return promise;
}

/**
 * Drops every cached dashboard value a new run can change, of every tenant. For changes of the
 * platform and of what jobs and notification templates use, which reach further than one tenant.
 */
export function invalidateDashboardCache(): void {
    state.generation++;
    for (const [key, entry] of state.entries) {
        if (!entry.survivesInvalidation) state.entries.delete(key);
    }
    state.pending.clear();
    pendingAcross().clear();
}

/**
 * Drops the cached values a finished run or a storage refresh of these tenants changes: those of
 * the tenants themselves, those of All tenants and the system scope, which count every tenant, and
 * those that read other tenants too. The entries of every other tenant stay, so a busy instance,
 * where some run ends every few seconds, still serves each tenant from its cache.
 */
export function invalidateTenantCaches(tenantIds: readonly string[]): void {
    const scopes = new Set([...tenantIds, EVERY_TENANT]);
    const generations = scopeGenerations();
    for (const scope of scopes) generations.set(scope, (generations.get(scope) ?? 0) + 1);
    state.acrossGeneration = (state.acrossGeneration ?? 0) + 1;

    for (const [key, entry] of state.entries) {
        if (entry.survivesInvalidation) continue;
        if (entry.readsOtherTenants || scopes.has(scopeOfKey(key))) state.entries.delete(key);
    }
    const across = pendingAcross();
    for (const key of [...state.pending.keys()]) {
        if (across.has(key) || scopes.has(scopeOfKey(key))) {
            state.pending.delete(key);
            across.delete(key);
        }
    }
}
