import prisma from "@/lib/prisma";
import { AUDIT_ACTIONS, AUDIT_RESOURCES } from "@/lib/core/audit-types";
import type { VaultActor } from "./vault-types";

/**
 * What the audit log still knows about the entries of the Vault: who made them, who changed them,
 * who revealed a secret and which recovery kits were downloaded. The log is cleaned after the days
 * of its retention, so every fact here may be missing for an older entry.
 */

/** The action of a revealed key or secret and of a downloaded kit, as the routes write them. */
export const VAULT_AUDIT = {
    KIT: "recovery_kit_download",
    REVEAL_KEY: "reveal_key",
    REVEAL_SECRET: "reveal",
} as const;

/** The newest entries read at most, so a log with years of reveals stays quick. */
const EXPORT_LIMIT = 1000;

interface Row {
    createdAt: Date;
    resourceId: string | null;
    details: string | null;
    user: { name: string } | null;
}

const ROW = { createdAt: true, resourceId: true, details: true, user: { select: { name: true } } } as const;

function detailsOf(row: Row): Record<string, unknown> {
    if (!row.details) return {};
    try {
        const value: unknown = JSON.parse(row.details);
        return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
    } catch {
        return {};
    }
}

const actorOf = (row: Row): VaultActor => ({ at: row.createdAt.toISOString(), by: row.user?.name ?? null });

/** The last time something happened to each entry and how often, from rows that are newest first. */
export interface Tally {
    last: VaultActor;
    count: number;
}

function tally(rows: Row[]): Map<string, Tally> {
    const result = new Map<string, Tally>();
    for (const row of rows) {
        if (!row.resourceId) continue;
        const current = result.get(row.resourceId);
        if (current) current.count += 1;
        else result.set(row.resourceId, { last: actorOf(row), count: 1 });
    }
    return result;
}

/** The first entry per id in the order of the rows. */
function firstOf(rows: Row[]): Map<string, VaultActor> {
    const result = new Map<string, VaultActor>();
    for (const row of rows) {
        if (row.resourceId && !result.has(row.resourceId)) result.set(row.resourceId, actorOf(row));
    }
    return result;
}

/** A downloaded recovery kit and the keys it held. */
export interface KitEntry extends VaultActor {
    profileIds: string[];
}

export interface KeyAudit {
    /** Newest first. */
    kits: KitEntry[];
    reveals: Map<string, Tally>;
    created: Map<string, VaultActor>;
}

/** What the audit log knows about the encryption keys with these ids. */
export async function keyAudit(ids: string[]): Promise<KeyAudit> {
    const [exports, creates] = await Promise.all([
        prisma.auditLog.findMany({
            where: { action: AUDIT_ACTIONS.EXPORT, resource: AUDIT_RESOURCES.VAULT },
            orderBy: { createdAt: "desc" },
            take: EXPORT_LIMIT,
            select: ROW,
        }),
        // A key is logged as a system entry, from the time before the Vault had a resource of its own.
        ids.length === 0
            ? Promise.resolve([] as Row[])
            : prisma.auditLog.findMany({
                  where: { action: AUDIT_ACTIONS.CREATE, resource: AUDIT_RESOURCES.SYSTEM, resourceId: { in: ids } },
                  orderBy: { createdAt: "asc" },
                  select: ROW,
              }),
    ]);

    const kits: KitEntry[] = [];
    const reveals: Row[] = [];
    for (const row of exports) {
        const details = detailsOf(row);
        if (details.action === VAULT_AUDIT.KIT && Array.isArray(details.profileIds)) {
            kits.push({ ...actorOf(row), profileIds: details.profileIds.filter((id): id is string => typeof id === "string") });
        } else if (details.action === VAULT_AUDIT.REVEAL_KEY) {
            reveals.push(row);
        }
    }

    return { kits, reveals: tally(reveals), created: firstOf(creates) };
}

export interface CredentialAudit {
    reveals: Map<string, Tally>;
    created: Map<string, VaultActor>;
    changed: Map<string, VaultActor>;
    /** Every reveal still in the log, newest first, for the numbers above the list. */
    revealRows: (VaultActor & { profileId: string })[];
}

/** What the audit log knows about the credential profiles with these ids. */
export async function credentialAudit(ids: string[]): Promise<CredentialAudit> {
    if (ids.length === 0) return { reveals: new Map(), created: new Map(), changed: new Map(), revealRows: [] };

    const rows = await prisma.auditLog.findMany({
        where: {
            resource: AUDIT_RESOURCES.CREDENTIAL,
            resourceId: { in: ids },
            action: { in: [AUDIT_ACTIONS.EXPORT, AUDIT_ACTIONS.CREATE, AUDIT_ACTIONS.UPDATE] },
        },
        orderBy: { createdAt: "desc" },
        take: EXPORT_LIMIT,
        select: { ...ROW, action: true },
    });

    const reveals = rows.filter((row) => row.action === AUDIT_ACTIONS.EXPORT);
    return {
        reveals: tally(reveals),
        // The rows are newest first, and a profile is made once.
        created: firstOf(rows.filter((row) => row.action === AUDIT_ACTIONS.CREATE).reverse()),
        changed: firstOf(rows.filter((row) => row.action === AUDIT_ACTIONS.UPDATE)),
        revealRows: reveals.flatMap((row) => (row.resourceId ? [{ ...actorOf(row), profileId: row.resourceId }] : [])),
    };
}
