import { requestHeaders } from "@/lib/server/request-headers";
import { explicitScope, type TenantScope } from "./context";

async function requestContext() {
    let headers: Headers;
    try {
        headers = await requestHeaders();
    } catch {
        return null;
    }
    const { getAuthContext } = await import("@/lib/auth/access-control");
    return getAuthContext(headers).catch(() => null);
}

/**
 * The tenant of the request being handled, from its session or its API key, null outside a
 * request or for an account without a tenant. Read once per request, see `getAuthContext`.
 */
export async function requestTenantId(): Promise<string | null> {
    return (await requestContext())?.tenantId ?? null;
}

/** The scope of the request being handled: its tenant, every tenant to read for All tenants, or none. */
export async function requestScope(): Promise<TenantScope | null> {
    const ctx = await requestContext();
    if (ctx?.allTenants) return { kind: "all" };
    return ctx?.tenantId ? { kind: "tenant", tenantId: ctx.tenantId } : null;
}

/**
 * The tenant the code that runs now acts for: the one of `runAsTenant`, else the one of the
 * request. Null in the system scope and outside both, where a caller that writes a row has to
 * name its tenant itself.
 */
export async function currentTenantId(): Promise<string | null> {
    const scope = explicitScope();
    if (scope) return scope.kind === "tenant" ? scope.tenantId : null;
    return requestTenantId();
}
