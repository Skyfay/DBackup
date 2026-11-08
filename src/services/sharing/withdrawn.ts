import prisma from "@/lib/prisma";
import { AUDIT_ACTIONS, AUDIT_RESOURCES } from "@/lib/core/audit-types";
import { providedIds } from "./provided";

/**
 * What a customer lost when another tenant stopped sharing a destination or a channel with it, for
 * the note on the Connections page. The tenant that shares writes the stop into the customer's
 * audit log, see `actions/tenant/connection-share.ts`, so this reads that log and nothing of the
 * other tenant.
 */

/** How long the note stays on the page after a stop. */
export const WITHDRAWN_DAYS = 14;

export interface WithdrawnConnection {
    /** The id of the audit entry, which keys the note. */
    id: string;
    configId: string;
    name: string;
    kind: "destination" | "channel";
    at: string;
    /** The jobs that wrote to the destination or named the channel, which lost it. */
    jobs: string[];
    /** The notification templates that named the channel, which lost it. */
    templates: string[];
    /** How many backups of the tenant were deleted from the destination. */
    backups: number;
}

const names = (value: unknown): string[] => (Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string") : []);

/**
 * The connections other tenants stopped sharing with the open tenant in the last days, newest
 * first. A connection shared again since, or one of the tenant's own whose stop it wrote itself,
 * is left out.
 */
export async function withdrawnConnections(tenantId: string, now = new Date()): Promise<WithdrawnConnection[]> {
    const since = new Date(now.getTime() - WITHDRAWN_DAYS * 24 * 60 * 60 * 1000);
    const entries = await prisma.auditLog.findMany({
        where: {
            action: AUDIT_ACTIONS.UPDATE,
            resource: { in: [AUDIT_RESOURCES.DESTINATION, AUDIT_RESOURCES.ADAPTER] },
            createdAt: { gte: since },
            details: { contains: '"action":"unshare"' },
            resourceId: { not: null },
        },
        orderBy: { createdAt: "desc" },
        select: { id: true, resource: true, resourceId: true, details: true, createdAt: true },
        take: 50,
    });
    if (entries.length === 0) return [];

    const ids = [...new Set(entries.map((entry) => entry.resourceId!))];
    const [own, provided] = await Promise.all([
        prisma.adapterConfig.findMany({ where: { id: { in: ids } }, select: { id: true } }),
        providedIds(tenantId, ids),
    ]);
    const skip = new Set([...own.map((config) => config.id), ...provided]);

    const seen = new Set<string>();
    const result: WithdrawnConnection[] = [];
    for (const entry of entries) {
        const configId = entry.resourceId!;
        if (skip.has(configId) || seen.has(configId)) continue;
        seen.add(configId);
        let details: Record<string, unknown>;
        try {
            details = JSON.parse(entry.details ?? "{}");
        } catch {
            continue;
        }
        if (details.action !== "unshare") continue;
        result.push({
            id: entry.id,
            configId,
            name: typeof details.name === "string" ? details.name : "A connection",
            kind: entry.resource === AUDIT_RESOURCES.DESTINATION ? "destination" : "channel",
            at: entry.createdAt.toISOString(),
            jobs: names(details.jobs),
            templates: names(details.templates),
            backups: typeof details.backups === "number" ? details.backups : 0,
        });
    }
    return result;
}
