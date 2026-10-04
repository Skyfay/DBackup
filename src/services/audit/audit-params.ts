import { fromZonedTime } from "date-fns-tz";
import { z } from "zod";
import { AUDIT_AREAS } from "@/lib/core/audit-areas";
import { AUDIT_ACTIONS } from "@/lib/core/audit-types";
import { AUDIT_MAX_PAGE_SIZE, type AuditFilter, type AuditQuery } from "./audit-query";

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const areaIds = AUDIT_AREAS.map((area) => area.id) as [string, ...string[]];
const actions = Object.values(AUDIT_ACTIONS) as [string, ...string[]];

const FilterSchema = z.object({
    who: z.array(z.string().min(1).max(300)).max(200),
    area: z.array(z.enum(areaIds)).max(areaIds.length),
    action: z.array(z.enum(actions)).max(actions.length),
    quick: z.enum(["all", "changes", "signins", "sensitive"]).default("all"),
    period: z.enum(["24h", "7d", "30d", "90d", "all"]).default("30d"),
    search: z.string().max(200).optional(),
    record: z.string().max(300).regex(/^[A-Z_]+:.+$/).optional(),
    fromDay: z.string().regex(DAY).optional(),
    toDay: z.string().regex(DAY).optional(),
    tz: z.string().max(64).optional(),
});

const PageSchema = z.object({
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce.number().int().min(1).max(AUDIT_MAX_PAGE_SIZE).default(25),
});

/** A time zone the runtime knows, else UTC. */
export function timeZoneOr(value: string | undefined): string {
    if (!value) return "UTC";
    try {
        new Intl.DateTimeFormat("en-US", { timeZone: value });
        return value;
    } catch {
        return "UTC";
    }
}

const nextDay = (day: string) => {
    const date = new Date(`${day}T00:00:00Z`);
    date.setUTCDate(date.getUTCDate() + 1);
    return date.toISOString().slice(0, 10);
};

function rawFilter(params: URLSearchParams) {
    return {
        who: params.getAll("who"),
        area: params.getAll("area"),
        action: params.getAll("action"),
        quick: params.get("quick") ?? undefined,
        period: params.get("period") ?? undefined,
        search: params.get("search") ?? undefined,
        record: params.get("record") ?? undefined,
        fromDay: params.get("fromDay") ?? undefined,
        toDay: params.get("toDay") ?? undefined,
        tz: params.get("tz") ?? undefined,
    };
}

/**
 * The filter of the Audit log tab from the query of a request: `who`, `area` and `action` may
 * repeat, `quick`, `period` and `search` once, `record` as `<RESOURCE>:<id>`, and a range of days
 * from the timeline as `fromDay` and `toDay` in the time zone `tz`. Null when it does not parse.
 */
export function parseAuditFilter(params: URLSearchParams): AuditFilter | null {
    const parsed = FilterSchema.safeParse(rawFilter(params));
    if (!parsed.success) return null;
    const { who, area, action, quick, period, search, record, fromDay, toDay, tz } = parsed.data;
    const zone = timeZoneOr(tz);
    const at = record?.indexOf(":") ?? -1;
    return {
        who,
        areas: area,
        actions: action,
        quick,
        period,
        search,
        record: record && at > 0 ? { resource: record.slice(0, at), resourceId: record.slice(at + 1) } : null,
        ...(fromDay ? { from: fromZonedTime(`${fromDay}T00:00:00`, zone) } : {}),
        ...(toDay ? { to: fromZonedTime(`${nextDay(toDay)}T00:00:00`, zone) } : {}),
    };
}

export function parseAuditQuery(params: URLSearchParams): AuditQuery | null {
    const filter = parseAuditFilter(params);
    const page = PageSchema.safeParse({ page: params.get("page") ?? undefined, pageSize: params.get("pageSize") ?? undefined });
    return filter && page.success ? { ...filter, ...page.data } : null;
}
