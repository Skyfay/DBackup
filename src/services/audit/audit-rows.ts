import type { Prisma } from "@prisma/client";
import prisma from "@/lib/prisma";
import { areaOfResource } from "@/lib/core/audit-areas";
import { changeSummary } from "@/lib/core/audit-changes";
import { describeEntry } from "@/lib/core/audit-sentence";
import { AUDIT_ACTIONS, AUDIT_RESOURCES } from "@/lib/core/audit-types";
import { describeAgent, parseUserAgent } from "@/lib/core/user-agent";
import type { AuditActor, AuditLine, AuditRow } from "./audit-types";

/** What a row of the list reads of an entry. */
export const AUDIT_ROW_SELECT = {
    id: true,
    createdAt: true,
    userId: true,
    actorName: true,
    apiKeyId: true,
    apiKeyName: true,
    action: true,
    resource: true,
    resourceId: true,
    details: true,
    ipAddress: true,
    userAgent: true,
    user: { select: { name: true, image: true, group: { select: { name: true } } } },
} satisfies Prisma.AuditLogSelect;

export type AuditRecord = Prisma.AuditLogGetPayload<{ select: typeof AUDIT_ROW_SELECT }>;

export function parseDetails(details: string | null): Record<string, unknown> {
    if (!details) return {};
    try {
        const value: unknown = JSON.parse(details);
        return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
    } catch {
        return {};
    }
}

/** Who wrote an entry. A key acts as its owner, so the owner is the line under its name. */
export function actorOf(record: Pick<AuditRecord, "userId" | "actorName" | "apiKeyId" | "apiKeyName" | "action" | "details" | "user">): AuditActor {
    const person = record.user?.name ?? record.actorName;
    if (record.apiKeyId) {
        return { kind: "key", key: `key:${record.apiKeyId}`, name: record.apiKeyName ?? "API key", sub: person ? `API key of ${person}` : "API key", image: null, deleted: false };
    }
    if (record.userId) {
        return { kind: "person", key: `user:${record.userId}`, name: person ?? "Unknown", sub: record.user?.group?.name ?? (record.user ? "No group" : null), image: record.user?.image ?? null, deleted: false };
    }
    if (record.actorName) {
        return { kind: "person", key: `deleted:${record.actorName}`, name: record.actorName, sub: "Deleted since", image: null, deleted: true };
    }
    const email = parseDetails(record.details).email;
    return record.action === AUDIT_ACTIONS.LOGIN_FAILED
        ? { kind: "unknown", key: "unknown", name: "Unknown", sub: typeof email === "string" ? email : null, image: null, deleted: false }
        : { kind: "unknown", key: "unknown", name: "Deleted user", sub: "before names were kept", image: null, deleted: true };
}

/** The browser and system, like "Firefox on macOS", or the tool, like "curl/8.5.0". */
export function deviceOf(userAgent: string | null): string | null {
    if (!userAgent || userAgent === "unknown") return null;
    return describeAgent(parseUserAgent(userAgent)) ?? userAgent.split(" ")[0].slice(0, 40);
}

/** The network of an address, so a new lease in the same place is no new place: 10.0.4.x, or the first half of IPv6. */
export function networkOf(ipAddress: string | null): string | null {
    if (!ipAddress || ipAddress === "unknown") return null;
    const v4 = ipAddress.replace(/^::ffff:/, "");
    if (/^\d{1,3}(\.\d{1,3}){3}$/.test(v4)) return `${v4.split(".").slice(0, 3).join(".")}.x`;
    if (ipAddress.includes(":")) return `${ipAddress.split(":").slice(0, 4).join(":")}::`;
    return ipAddress;
}

type Lookup = (ids: string[]) => Promise<{ id: string; name: string }[]>;

/** Where the name of a record lives, for entries that did not keep it. */
const NAMES: Partial<Record<string, Lookup>> = {
    [AUDIT_RESOURCES.USER]: (ids) => prisma.user.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } }),
    [AUDIT_RESOURCES.GROUP]: (ids) => prisma.group.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } }),
    [AUDIT_RESOURCES.JOB]: (ids) => prisma.job.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } }),
    [AUDIT_RESOURCES.ADAPTER]: (ids) => prisma.adapterConfig.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } }),
    [AUDIT_RESOURCES.CREDENTIAL]: (ids) => prisma.credentialProfile.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } }),
    [AUDIT_RESOURCES.VAULT]: (ids) => prisma.encryptionProfile.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } }),
    [AUDIT_RESOURCES.API_KEY]: (ids) => prisma.apiKey.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } }),
    [AUDIT_RESOURCES.SSO_PROVIDER]: (ids) => prisma.ssoProvider.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } }),
};

const targetKey = (resource: string, id: string) => `${resource}:${id}`;

/** The names of the records the entries are about, for the ones that did not keep a name, if the record still exists. */
export async function resolveTargets(records: Pick<AuditRecord, "resource" | "resourceId" | "details">[]): Promise<Map<string, string>> {
    const wanted = new Map<string, Set<string>>();
    for (const record of records) {
        if (!record.resourceId || !NAMES[record.resource]) continue;
        const details = parseDetails(record.details);
        // A change of a user names what happened, not the user, so the user is looked up too.
        if (typeof details.name === "string" && record.resource !== AUDIT_RESOURCES.USER) continue;
        const ids = wanted.get(record.resource) ?? new Set<string>();
        ids.add(record.resourceId);
        wanted.set(record.resource, ids);
    }
    const found = await Promise.all([...wanted].map(async ([resource, ids]) => {
        const rows = await NAMES[resource]!([...ids]).catch(() => []);
        return rows.map((row) => [targetKey(resource, row.id), row.name] as const);
    }));
    return new Map(found.flat());
}

export const targetOf = (targets: Map<string, string>, record: Pick<AuditRecord, "resource" | "resourceId">) =>
    record.resourceId ? targets.get(targetKey(record.resource, record.resourceId)) ?? null : null;

/**
 * The sign-ins among the entries that came from a network the person never signed in from, while
 * they had signed in before. A first sign-in ever is no new place.
 */
export async function newPlacesOf(records: Pick<AuditRecord, "id" | "action" | "userId" | "ipAddress" | "createdAt">[]): Promise<Set<string>> {
    const logins = records.filter((record) => record.action === AUDIT_ACTIONS.LOGIN && record.userId && networkOf(record.ipAddress));
    if (logins.length === 0) return new Set();
    const latest = new Date(Math.max(...logins.map((record) => record.createdAt.getTime())));
    const earlier = await prisma.auditLog.findMany({
        where: { action: AUDIT_ACTIONS.LOGIN, userId: { in: [...new Set(logins.map((record) => record.userId!))] }, createdAt: { lt: latest } },
        select: { userId: true, ipAddress: true, createdAt: true },
    });
    const result = new Set<string>();
    for (const login of logins) {
        const before = earlier.filter((entry) => entry.userId === login.userId && entry.createdAt < login.createdAt);
        if (before.length === 0) continue;
        const network = networkOf(login.ipAddress);
        if (!before.some((entry) => networkOf(entry.ipAddress) === network)) result.add(login.id);
    }
    return result;
}

export function toRow(record: AuditRecord, targets: Map<string, string>, newPlaces: Set<string>): AuditRow {
    const description = describeEntry(record, targetOf(targets, record));
    return {
        id: record.id,
        at: record.createdAt.toISOString(),
        actor: actorOf(record),
        action: record.action,
        resource: record.resource,
        resourceId: record.resourceId,
        area: areaOfResource(record.resource)?.label ?? null,
        parts: description.parts,
        summary: changeSummary(record.action, parseDetails(record.details)),
        glyph: description.glyph,
        kind: description.kind,
        device: deviceOf(record.userAgent),
        ipAddress: record.ipAddress,
        newPlace: newPlaces.has(record.id),
    };
}

/** An entry as one line of a panel, with who did it. */
export function toLine(record: AuditRecord, targets: Map<string, string>): AuditLine {
    const description = describeEntry(record, targetOf(targets, record));
    return { id: record.id, at: record.createdAt.toISOString(), by: actorOf(record).name, parts: description.parts, glyph: description.glyph, kind: description.kind };
}
