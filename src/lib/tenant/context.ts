import { AsyncLocalStorage } from "node:async_hooks";

/**
 * Which tenant the code that runs now acts for. A request gets its tenant from the session or the
 * API key when it first touches tenant data, see `current.ts`. Everything that runs outside
 * a request says so itself: a run acts for the tenant of its job, the scheduler, the queue and the
 * system tasks act for all of them. A platform admin in All tenants reads every tenant and writes
 * none, which is the scope `all` of a request.
 */
export type TenantScope =
    | { kind: "tenant"; tenantId: string }
    | { kind: "system" }
    | { kind: "all" };

/**
 * One store for the whole process. Next.js builds several module graphs, and a store of each
 * graph would not see the scope another one set.
 */
const STORE_KEY = Symbol.for("dbackup.tenantScope");
type ScopeGlobal = typeof globalThis & { [STORE_KEY]?: AsyncLocalStorage<TenantScope> };

function store(): AsyncLocalStorage<TenantScope> {
    const holder = globalThis as ScopeGlobal;
    holder[STORE_KEY] ??= new AsyncLocalStorage<TenantScope>();
    return holder[STORE_KEY];
}

/** The scope something set around the code that runs now, none inside a plain request. */
export function explicitScope(): TenantScope | undefined {
    return store().getStore();
}

const isThenable = (value: unknown): value is PromiseLike<unknown> =>
    typeof value === "object" && value !== null && typeof (value as { then?: unknown }).then === "function";

function within<T>(scope: TenantScope, fn: () => T): T {
    return store().run(scope, () => {
        const result = fn();
        // Prisma starts a query only once it is awaited. Awaited after `run` returned, it would run
        // outside the scope, so a query handed back as it is starts here.
        if (isThenable(result)) return new Promise((resolve, reject) => result.then(resolve, reject)) as T;
        return result;
    });
}

/** Runs `fn` for one tenant: it reads only that tenant's rows and writes into it. */
export function runAsTenant<T>(tenantId: string, fn: () => T): T {
    return within({ kind: "tenant", tenantId }, fn);
}

/**
 * Runs `fn` for every tenant at once, unfiltered. For the scheduler, the queue, the system tasks
 * and the few lookups that must find a row before its tenant is known, like an API key by its
 * hash. A row it creates names its tenant itself.
 */
export function runAsSystem<T>(fn: () => T): T {
    return within({ kind: "system" }, fn);
}
