import type { Prisma } from "@prisma/client";
import { QUICK_ACTIONS, resourcesOfAreas, type AuditQuick } from "@/lib/core/audit-areas";
import { HOME_TENANT_ID } from "@/lib/tenant/home";

/** How far back the list reaches. `all` is everything the log still keeps. */
export type AuditPeriod = "24h" | "7d" | "30d" | "90d" | "all";

export const AUDIT_PERIOD_DAYS: Record<AuditPeriod, number | null> = { "24h": 1, "7d": 7, "30d": 30, "90d": 90, all: null };

export const AUDIT_MAX_PAGE_SIZE = 100;

const DAY_MS = 86_400_000;

export interface AuditFilter {
    /** Keys of the Who filter: `user:<id>`, `key:<id>`, `deleted:<name>` or `unknown`. */
    who: string[];
    /** Ids of the areas, like `jobs`. */
    areas: string[];
    actions: string[];
    quick: AuditQuick;
    period: AuditPeriod;
    /** A range from the timeline, which takes the place of the period. */
    from?: Date;
    to?: Date;
    /** Only the entries of one record. */
    record?: { resource: string; resourceId: string } | null;
    search?: string;
    /** Ids of the tenants whose log is read, for the Tenant filter of All tenants. Every one the scope reads when empty. */
    tenants?: string[];
    /**
     * The tenant whose log the viewer reads, null or left out in All tenants. It decides whose
     * address a search may match, see `addressShownWhere`. Never read from the query.
     */
    viewerTenantId?: string | null;
}

export interface AuditQuery extends AuditFilter {
    page: number;
    pageSize: number;
}

/** The entries of one key of the Who filter. A person means what they did themselves, their keys are their own keys. */
export function whoWhere(key: string): Prisma.AuditLogWhereInput | null {
    if (key === "unknown") return { userId: null, actorName: null, apiKeyId: null };
    const at = key.indexOf(":");
    if (at < 1) return null;
    const kind = key.slice(0, at);
    const value = key.slice(at + 1);
    if (!value) return null;
    if (kind === "user") return { userId: value, apiKeyId: null };
    if (kind === "key") return { apiKeyId: value };
    if (kind === "deleted") return { userId: null, actorName: value, apiKeyId: null };
    return null;
}

/**
 * The entries whose address the log shows, as `originShown` in audit-rows.ts decides it per row, so
 * a search never finds an entry by an address its row keeps hidden. In a tenant these are the
 * entries of the home tenant, those without a person and those of its own members. In All tenants
 * the person would have to be a member of the tenant of each row, which a query cannot compare, so
 * only the entries of the home tenant and those without a person. A deleted account kept its name
 * and counts as a person, whose memberships are gone.
 */
export function addressShownWhere(viewerTenantId: string | null | undefined): Prisma.AuditLogWhereInput {
    const shown: Prisma.AuditLogWhereInput[] = [{ tenantId: HOME_TENANT_ID }, { userId: null, actorName: null }];
    if (viewerTenantId) shown.push({ tenantId: viewerTenantId, user: { is: { memberships: { some: { tenantId: viewerTenantId } } } } });
    return { OR: shown };
}

/**
 * The entries a filter keeps. `omit` leaves one filter out, so the counts beside that filter say
 * what each of its values would keep under the others.
 */
export function buildAuditWhere(filter: AuditFilter, now: Date, omit?: "who" | "area" | "action" | "quick" | "tenant"): Prisma.AuditLogWhereInput {
    const and: Prisma.AuditLogWhereInput[] = [];

    if (filter.from || filter.to) {
        and.push({ createdAt: { ...(filter.from ? { gte: filter.from } : {}), ...(filter.to ? { lt: filter.to } : {}) } });
    } else {
        const days = AUDIT_PERIOD_DAYS[filter.period];
        if (days) and.push({ createdAt: { gte: new Date(now.getTime() - days * DAY_MS) } });
    }

    if (omit !== "who" && filter.who.length > 0) {
        const or = filter.who.map(whoWhere).filter((entry): entry is Prisma.AuditLogWhereInput => entry !== null);
        and.push(or.length > 0 ? { OR: or } : { id: "" });
    }
    if (omit !== "area" && filter.areas.length > 0) and.push({ resource: { in: resourcesOfAreas(filter.areas) } });
    if (omit !== "action" && filter.actions.length > 0) and.push({ action: { in: filter.actions } });
    if (omit !== "quick" && filter.quick !== "all") and.push({ action: { in: QUICK_ACTIONS[filter.quick] } });
    if (filter.record) and.push({ resource: filter.record.resource, resourceId: filter.record.resourceId });
    if (omit !== "tenant" && filter.tenants && filter.tenants.length > 0) and.push({ tenantId: { in: filter.tenants } });

    // SQLite matches LIKE without case for ASCII, so the search needs no mode of its own.
    const search = filter.search?.trim();
    if (search) {
        and.push({
            OR: [
                { actorName: { contains: search } },
                { apiKeyName: { contains: search } },
                { AND: [{ ipAddress: { contains: search } }, addressShownWhere(filter.viewerTenantId)] },
                { resourceId: { contains: search } },
                { details: { contains: search } },
                // The email of a person, who shows by name alone, matches in a tenant only for the
                // people whose origin the log shows, so the email of someone of the platform cannot
                // be guessed letter by letter. All tenants is for the platform, which sees every account.
                filter.viewerTenantId
                    ? { AND: [{ user: { is: { email: { contains: search } } } }, addressShownWhere(filter.viewerTenantId)] }
                    : { user: { is: { email: { contains: search } } } },
            ],
        });
    }
    return and.length > 0 ? { AND: and } : {};
}
