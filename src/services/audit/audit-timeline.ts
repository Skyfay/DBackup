import { formatInTimeZone, fromZonedTime } from "date-fns-tz";
import prisma from "@/lib/prisma";
import { isSensitive } from "@/lib/core/audit-areas";
import { buildAuditWhere, type AuditFilter } from "./audit-query";
import { actorOf } from "./audit-rows";
import type { AuditTimeline, AuditTimelineRow } from "./audit-types";

/** A day as `yyyy-MM-dd`, like the timelines of the Backups page. */
const DAY = /^\d{4}-\d{2}-\d{2}$/;
/** The most days one request may span, a little more than the widest timeline. */
export const TIMELINE_MAX_DAYS = 93;

const nextDay = (day: string) => {
    const date = new Date(`${day}T00:00:00Z`);
    date.setUTCDate(date.getUTCDate() + 1);
    return date.toISOString().slice(0, 10);
};

export function validRange(from: string, to: string): boolean {
    if (!DAY.test(from) || !DAY.test(to) || from > to) return false;
    const span = (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000;
    return span <= TIMELINE_MAX_DAYS;
}

const ORDER = { person: 0, key: 1, unknown: 2 };

/**
 * Who wrote how many entries on each day from `from` to `to`, the days as the viewer's time zone
 * cuts them, under every filter but the period, which the days replace. A row per person and per
 * API key, the ones without a name last.
 */
export async function getAuditTimeline(
    from: string,
    to: string,
    timeZone: string,
    filter: Omit<AuditFilter, "period" | "from" | "to">,
    now = new Date()
): Promise<AuditTimeline> {
    const start = fromZonedTime(`${from}T00:00:00`, timeZone);
    const end = fromZonedTime(`${nextDay(to)}T00:00:00`, timeZone);
    const records = await prisma.auditLog.findMany({
        where: buildAuditWhere({ ...filter, period: "all", from: start, to: end }, now),
        select: {
            createdAt: true,
            userId: true,
            actorName: true,
            apiKeyId: true,
            apiKeyName: true,
            action: true,
            details: true,
            user: { select: { name: true, image: true, group: { select: { name: true } } } },
        },
    });

    const rows = new Map<string, AuditTimelineRow>();
    for (const record of records) {
        const actor = actorOf(record);
        const row = rows.get(actor.key) ?? { actor, total: 0, days: {} };
        const day = formatInTimeZone(record.createdAt, timeZone, "yyyy-MM-dd");
        const cell = row.days[day] ?? { count: 0, sensitive: 0 };
        cell.count += 1;
        if (isSensitive(record.action)) cell.sensitive += 1;
        row.days[day] = cell;
        row.total += 1;
        rows.set(actor.key, row);
    }
    return {
        from,
        to,
        rows: [...rows.values()].sort((a, b) => ORDER[a.actor.kind] - ORDER[b.actor.kind] || a.actor.name.localeCompare(b.actor.name)),
    };
}
