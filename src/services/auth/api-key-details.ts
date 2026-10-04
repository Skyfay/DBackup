import prisma from "@/lib/prisma";
import { AUDIT_ACTIONS, AUDIT_RESOURCES } from "@/lib/core/audit-types";
import { getDataRetentionValues } from "@/services/system/data-retention-service";
import { API_TRIGGER } from "./api-keys-model";
import type { ApiKeyDetails } from "./api-keys-types";

/** The runs the panel of a key lists at most. */
const RUN_LIMIT = 5;

interface AuditEntry {
    action: string;
    createdAt: Date;
    details: string | null;
}

/** The names a key had before, each with the moment it gave the name up, as the audit log knows them. */
export function formerNames(audit: AuditEntry[]): { name: string; until: Date }[] {
    return audit.flatMap((entry) => {
        if (entry.action !== AUDIT_ACTIONS.UPDATE || !entry.details?.includes('"renamedFrom"')) return [];
        try {
            const details = JSON.parse(entry.details) as { renamedFrom?: unknown };
            return typeof details.renamedFrom === "string" ? [{ name: details.renamedFrom, until: entry.createdAt }] : [];
        } catch {
            return [];
        }
    });
}

/**
 * The panel of one key beyond its row: the runs it started, who made it and when it was last
 * rotated, as far as the audit log still knows. Null when the key is gone.
 *
 * A run names the key it came from by the name the key had then, so the runs are found by every
 * name the key had, each up to its rename, and never from before the key was made.
 */
export async function getApiKeyDetails(id: string): Promise<ApiKeyDetails | null> {
    const key = await prisma.apiKey.findUnique({ where: { id }, select: { id: true, name: true, createdAt: true } });
    if (!key) return null;

    const [audit, retention] = await Promise.all([
        prisma.auditLog.findMany({
            where: { resource: AUDIT_RESOURCES.API_KEY, resourceId: id, action: { in: [AUDIT_ACTIONS.CREATE, AUDIT_ACTIONS.UPDATE] } },
            orderBy: { createdAt: "desc" },
            take: 50,
            select: { action: true, createdAt: true, details: true, actorName: true, user: { select: { name: true } } },
        }),
        getDataRetentionValues(),
    ]);
    const runs = await prisma.execution.findMany({
        where: {
            triggerType: API_TRIGGER,
            startedAt: { gte: key.createdAt },
            OR: [{ triggerLabel: key.name }, ...formerNames(audit).map((former) => ({ triggerLabel: former.name, startedAt: { lt: former.until } }))],
        },
        orderBy: { startedAt: "desc" },
        take: RUN_LIMIT,
        select: { id: true, status: true, startedAt: true, job: { select: { name: true } } },
    });

    const made = audit.find((entry) => entry.action === AUDIT_ACTIONS.CREATE);
    const rotated = audit.find((entry) => entry.action === AUDIT_ACTIONS.UPDATE && entry.details?.includes('"action":"rotate"'));
    // The name kept on the entry names who did it after that user is deleted.
    const actor = (entry: typeof made) => (entry ? { at: entry.createdAt.toISOString(), by: entry.user?.name ?? entry.actorName ?? null } : null);

    return {
        id,
        runs: runs.map((run) => ({ id: run.id, job: run.job?.name ?? null, status: run.status, at: run.startedAt.toISOString() })),
        made: actor(made),
        rotated: actor(rotated),
        auditDays: retention.auditLog,
    };
}
