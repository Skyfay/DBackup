/**
 * The tenants an entry of the audit log names by their name, kept by id beside it, so the log of
 * the home tenant shows the entry only to whoever reaches them (`aboutReachedTenants` in
 * `src/services/audit/log-reach.ts`). One tenant goes into `tenantId`, several into `tenantIds`.
 */

/** The key of the details that lists several tenants an entry names. */
export const TENANT_IDS_KEY = "tenantIds";

/** The ids of the tenants an entry names, for its details: `{ tenantId }` for one, `{ tenantIds }` for several, nothing for none. */
export function namedTenants(ids: readonly (string | null | undefined)[]): { tenantId?: string; tenantIds?: string[] } {
    const unique = [...new Set(ids.filter((id): id is string => typeof id === "string" && id !== ""))].sort();
    if (unique.length === 0) return {};
    return unique.length === 1 ? { tenantId: unique[0] } : { [TENANT_IDS_KEY]: unique };
}

/**
 * The tenants of `tenantIds` in the details of an entry, null when its details are no JSON or hold
 * no list of ids there, like a list with anything but text in it.
 */
export function listedTenants(details: string | null): string[] | null {
    if (!details) return null;
    try {
        const parsed: unknown = JSON.parse(details);
        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
        const listed = (parsed as Record<string, unknown>)[TENANT_IDS_KEY];
        return Array.isArray(listed) && listed.every((id): id is string => typeof id === "string") ? listed : null;
    } catch {
        return null;
    }
}
