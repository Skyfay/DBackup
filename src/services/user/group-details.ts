import prisma from "@/lib/prisma";
import { GROUP_TEMPLATES } from "@/lib/auth/group-templates";
import { LEVEL_LABELS, PERMISSION_AREAS, type AreaLevel } from "@/lib/auth/permission-areas";
import { listWords } from "@/lib/auth/access-summary";
import { AUDIT_ACTIONS, AUDIT_RESOURCES } from "@/lib/core/audit-types";
import { getDataRetentionValues } from "@/services/system/data-retention-service";
import type { GroupDetails, GroupHistoryEntry } from "./groups-types";

/** The entries the history of a group shows at most. */
const HISTORY_LIMIT = 10;

function parse(details: string | null): Record<string, unknown> {
    if (!details) return {};
    try {
        const value: unknown = JSON.parse(details);
        return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
    } catch {
        return {};
    }
}

const LABELS = new Map(PERMISSION_AREAS.map((area) => [area.id, area.label]));

/** "Backups See to Use". */
function areaText(change: unknown): string | null {
    if (!change || typeof change !== "object") return null;
    const { area, from, to } = change as { area?: unknown; from?: unknown; to?: unknown };
    const label = typeof area === "string" ? LABELS.get(area) : undefined;
    const level = (value: unknown) => (typeof value === "string" && value in LEVEL_LABELS ? LEVEL_LABELS[value as AreaLevel] : null);
    if (!label || !level(from) || !level(to)) return null;
    return from === to ? `${label}` : `${label} ${level(from)} to ${level(to)}`;
}

/**
 * What an entry of the audit log did to a group, without who, like "changed Backups See to Use".
 * Entries from before the group kept its changes hold the whole list, which says less.
 */
export function groupEntryText(action: string, details: string | null): string {
    const data = parse(details);
    if (action === AUDIT_ACTIONS.CREATE) {
        const template = GROUP_TEMPLATES.find((entry) => entry.id === data.template);
        return template ? `made the group from the template ${template.label}` : "made the group";
    }
    if (action !== AUDIT_ACTIONS.UPDATE) return "changed the group";

    const parts: string[] = [];
    if (typeof data.renamedFrom === "string") parts.push(`renamed it from ${data.renamedFrom}`);
    if (Array.isArray(data.areas)) {
        const areas = data.areas.map(areaText).filter((text): text is string => text !== null);
        if (areas.length > 0) parts.push(`changed ${listWords(areas)}`);
    } else if (Array.isArray(data.permissions)) {
        parts.push("changed the permissions");
    }
    return parts.length > 0 ? parts.join(" and ") : "saved it without a change";
}

/** The history of one group: when it was made, how it changed and who moved in. Null when the group is gone. */
export async function getGroupDetails(groupId: string): Promise<GroupDetails | null> {
    const group = await prisma.group.findUnique({ where: { id: groupId }, select: { id: true } });
    if (!group) return null;

    const [entries, moves, retention] = await Promise.all([
        prisma.auditLog.findMany({
            where: { resource: AUDIT_RESOURCES.GROUP, resourceId: groupId, action: { in: [AUDIT_ACTIONS.CREATE, AUDIT_ACTIONS.UPDATE] } },
            orderBy: { createdAt: "desc" },
            take: HISTORY_LIMIT,
            select: { id: true, action: true, createdAt: true, details: true, user: { select: { name: true } } },
        }),
        // A change of the group of a user names the group in its details.
        prisma.auditLog.findMany({
            where: { resource: AUDIT_RESOURCES.USER, action: AUDIT_ACTIONS.UPDATE, details: { contains: groupId } },
            orderBy: { createdAt: "desc" },
            take: HISTORY_LIMIT,
            select: { id: true, createdAt: true, details: true, resourceId: true, user: { select: { name: true } } },
        }),
        getDataRetentionValues(),
    ]);

    const movedIds = moves.flatMap((move) => (move.resourceId && parse(move.details).groupId === groupId ? [move.resourceId] : []));
    const names = new Map(
        (movedIds.length > 0 ? await prisma.user.findMany({ where: { id: { in: movedIds } }, select: { id: true, name: true } }) : []).map((user) => [user.id, user.name])
    );

    const history: GroupHistoryEntry[] = [
        ...entries.map((entry) => ({
            id: entry.id,
            at: entry.createdAt.toISOString(),
            by: entry.user?.name ?? null,
            text: groupEntryText(entry.action, entry.details),
            kind: entry.action === AUDIT_ACTIONS.CREATE ? ("create" as const) : ("update" as const),
        })),
        ...moves
            .filter((move) => parse(move.details).groupId === groupId)
            .map((move) => ({
                id: move.id,
                at: move.createdAt.toISOString(),
                by: move.user?.name ?? null,
                text: `moved ${(move.resourceId && names.get(move.resourceId)) || "a user who is gone"} in`,
                kind: "member" as const,
            })),
    ]
        .sort((a, b) => b.at.localeCompare(a.at))
        .slice(0, HISTORY_LIMIT);

    return { id: groupId, history, auditDays: retention.auditLog };
}
