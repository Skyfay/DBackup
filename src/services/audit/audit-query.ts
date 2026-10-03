import type { Prisma } from "@prisma/client";
import { QUICK_ACTIONS, resourcesOfAreas, type AuditQuick } from "@/lib/core/audit-areas";

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
 * The entries a filter keeps. `omit` leaves one filter out, so the counts beside that filter say
 * what each of its values would keep under the others.
 */
export function buildAuditWhere(filter: AuditFilter, now: Date, omit?: "who" | "area" | "action" | "quick"): Prisma.AuditLogWhereInput {
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

    // SQLite matches LIKE without case for ASCII, so the search needs no mode of its own.
    const search = filter.search?.trim();
    if (search) {
        and.push({
            OR: [
                { actorName: { contains: search } },
                { apiKeyName: { contains: search } },
                { ipAddress: { contains: search } },
                { resourceId: { contains: search } },
                { details: { contains: search } },
                { user: { is: { email: { contains: search } } } },
            ],
        });
    }
    return and.length > 0 ? { AND: and } : {};
}
