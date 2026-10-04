import prisma from "@/lib/prisma";
import { AUDIT_AREAS, areaOfResource, QUICK_ACTIONS, type AuditQuick } from "@/lib/core/audit-areas";
import { AUDIT_ACTIONS, AUDIT_RESOURCES } from "@/lib/core/audit-types";
import { getDataRetentionValues } from "@/services/system/data-retention-service";
import { buildAuditWhere, type AuditFilter, type AuditQuery } from "./audit-query";
import { AUDIT_ROW_SELECT, networkOf, newPlacesOf, resolveTargets, toRow } from "./audit-rows";
import type { AuditFacets, AuditRow, AuditStats, AuditWhoOption } from "./audit-types";

const DAY_MS = 86_400_000;
/** The days the numbers above the list cover. */
export const AUDIT_STATS_DAYS = 30;

/** One page of entries, newest first, with every entry in words. */
export async function listAudit(query: AuditQuery, now = new Date()): Promise<{ rows: AuditRow[]; total: number }> {
    const where = buildAuditWhere(query, now);
    const [records, total] = await Promise.all([
        prisma.auditLog.findMany({
            where,
            orderBy: [{ createdAt: "desc" }, { id: "desc" }],
            skip: (query.page - 1) * query.pageSize,
            take: query.pageSize,
            select: AUDIT_ROW_SELECT,
        }),
        prisma.auditLog.count({ where }),
    ]);
    const [targets, newPlaces] = await Promise.all([resolveTargets(records), newPlacesOf(records)]);
    return { rows: records.map((record) => toRow(record, targets, newPlaces)), total };
}

const whoKey = (group: { userId: string | null; actorName: string | null; apiKeyId: string | null }) =>
    group.apiKeyId ? `key:${group.apiKeyId}` : group.userId ? `user:${group.userId}` : group.actorName ? `deleted:${group.actorName}` : "unknown";

/** How many entries each value of every filter keeps under the other filters. */
export async function getAuditFacets(filter: AuditFilter, now = new Date()): Promise<AuditFacets> {
    const [who, area, action, quick] = await Promise.all([
        prisma.auditLog.groupBy({ by: ["userId", "actorName", "apiKeyId"], where: buildAuditWhere(filter, now, "who"), _count: { _all: true } }),
        prisma.auditLog.groupBy({ by: ["resource"], where: buildAuditWhere(filter, now, "area"), _count: { _all: true } }),
        prisma.auditLog.groupBy({ by: ["action"], where: buildAuditWhere(filter, now, "action"), _count: { _all: true } }),
        prisma.auditLog.groupBy({ by: ["action"], where: buildAuditWhere(filter, now, "quick"), _count: { _all: true } }),
    ]);

    const tally = <T>(groups: (T & { _count: { _all: number } })[], keyOf: (group: T) => string | null) => {
        const result: Record<string, number> = {};
        for (const group of groups) {
            const key = keyOf(group);
            if (key) result[key] = (result[key] ?? 0) + group._count._all;
        }
        return result;
    };
    const byAction = tally(quick, (group) => group.action);
    const quickCounts = { all: Object.values(byAction).reduce((sum, value) => sum + value, 0) } as Record<AuditQuick, number>;
    for (const [value, actions] of Object.entries(QUICK_ACTIONS) as [Exclude<AuditQuick, "all">, string[]][]) {
        quickCounts[value] = actions.reduce((sum, name) => sum + (byAction[name] ?? 0), 0);
    }
    return {
        who: tally(who, whoKey),
        area: tally(area, (group) => areaOfResource(group.resource)?.id ?? null),
        action: tally(action, (group) => group.action),
        quick: quickCounts,
    };
}

/** Everyone the log names, people first, then the API keys, for the Who filter. */
export async function getAuditWhoOptions(): Promise<AuditWhoOption[]> {
    const groups = await prisma.auditLog.groupBy({ by: ["userId", "actorName", "apiKeyId", "apiKeyName"], _count: { _all: true } });
    const userIds = [...new Set(groups.flatMap((group) => (group.userId && !group.apiKeyId ? [group.userId] : [])))];
    const users = userIds.length === 0 ? [] : await prisma.user.findMany({ where: { id: { in: userIds } }, select: { id: true, name: true, image: true } });
    const known = new Map(users.map((user) => [user.id, user]));

    const options = new Map<string, AuditWhoOption>();
    for (const group of groups) {
        const value = whoKey(group);
        if (options.has(value)) continue;
        if (group.apiKeyId) {
            options.set(value, { value, label: group.apiKeyName ?? "API key", group: "API keys", image: null, deleted: false });
        } else if (group.userId) {
            const user = known.get(group.userId);
            options.set(value, { value, label: user?.name ?? group.actorName ?? "Unknown", group: "People", image: user?.image ?? null, deleted: false });
        } else if (group.actorName) {
            options.set(value, { value, label: group.actorName, group: "People", image: null, deleted: true });
        } else {
            options.set(value, { value, label: "Unknown or deleted", group: "Other", image: null, deleted: false });
        }
    }
    const order = { People: 0, "API keys": 1, Other: 2 };
    return [...options.values()].sort((a, b) => order[a.group] - order[b.group] || a.label.localeCompare(b.label));
}

/** The numbers above the list, over the last 30 days. */
export async function getAuditStats(now = new Date()): Promise<AuditStats> {
    const since = new Date(now.getTime() - AUDIT_STATS_DAYS * DAY_MS);
    const [retention, groups, people, lastFailed, logins] = await Promise.all([
        getDataRetentionValues(),
        prisma.auditLog.groupBy({ by: ["action", "resource"], where: { createdAt: { gte: since } }, _count: { _all: true } }),
        prisma.auditLog.groupBy({ by: ["userId"], where: { createdAt: { gte: since }, action: AUDIT_ACTIONS.LOGIN, userId: { not: null } } }),
        prisma.auditLog.findFirst({ where: { action: AUDIT_ACTIONS.LOGIN_FAILED, createdAt: { gte: since } }, orderBy: { createdAt: "desc" }, select: { createdAt: true, ipAddress: true } }),
        // Every sign-in the log keeps, to tell a new place from a known one.
        prisma.auditLog.findMany({ where: { action: AUDIT_ACTIONS.LOGIN, userId: { not: null } }, orderBy: { createdAt: "asc" }, select: { userId: true, ipAddress: true, createdAt: true } }),
    ]);

    const count = (keep: (group: { action: string; resource: string }) => boolean) =>
        groups.filter(keep).reduce((sum, group) => sum + group._count._all, 0);
    const changes = QUICK_ACTIONS.changes;
    const byArea = new Map<string, number>();
    for (const group of groups) {
        if (!changes.includes(group.action)) continue;
        const area = areaOfResource(group.resource)?.label;
        if (area) byArea.set(area, (byArea.get(area) ?? 0) + group._count._all);
    }

    const seen = new Map<string, Set<string>>();
    let newPlaces = 0;
    for (const login of logins) {
        const network = networkOf(login.ipAddress);
        if (!network || !login.userId) continue;
        const networks = seen.get(login.userId);
        if (networks && !networks.has(network) && login.createdAt >= since) newPlaces += 1;
        if (networks) networks.add(network);
        else seen.set(login.userId, new Set([network]));
    }

    const exports = (resources: string[]) => count((group) => group.action === AUDIT_ACTIONS.EXPORT && resources.includes(group.resource));
    return {
        days: AUDIT_STATS_DAYS,
        keptDays: retention.auditLog,
        entries: count(() => true),
        signIns: { count: count((group) => group.action === AUDIT_ACTIONS.LOGIN), people: people.length, newPlaces },
        changes: {
            count: count((group) => changes.includes(group.action)),
            areas: [...byArea].sort((a, b) => b[1] - a[1]).slice(0, 2).map(([area]) => area),
        },
        sensitive: {
            count: count((group) => QUICK_ACTIONS.sensitive.includes(group.action)),
            reveals: exports([AUDIT_RESOURCES.CREDENTIAL, AUDIT_RESOURCES.VAULT]),
            downloads: exports([AUDIT_RESOURCES.BACKUP, AUDIT_RESOURCES.DESTINATION, AUDIT_RESOURCES.SYSTEM]),
            restores: count((group) => group.action === AUDIT_ACTIONS.RESTORE),
        },
        failed: {
            count: count((group) => group.action === AUDIT_ACTIONS.LOGIN_FAILED),
            last: lastFailed ? { at: lastFailed.createdAt.toISOString(), ipAddress: lastFailed.ipAddress } : null,
        },
    };
}

/** The ids of the areas in the order of the Area filter. */
export const AUDIT_AREA_IDS = AUDIT_AREAS.map((area) => area.id);
