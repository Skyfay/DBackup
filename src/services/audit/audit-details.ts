import prisma from "@/lib/prisma";
import { changesOf } from "@/lib/core/audit-changes";
import { AUDIT_ACTIONS, AUDIT_RESOURCES } from "@/lib/core/audit-types";
import { getDataRetentionValues } from "@/services/system/data-retention-service";
import { AUDIT_ROW_SELECT, deviceOf, networkOf, newPlacesOf, parseDetails, resolveTargets, targetOf, toLine, type AuditRecord } from "./audit-rows";
import type { AuditDetails } from "./audit-types";

/** The earlier entries of a record the panel lists, and the entries of a session at most. */
const EARLIER_LIMIT = 3;
const SESSION_LIMIT = 30;

const USERS = "/dashboard/users";

/** Where the record of an entry is shown. Most pages open on their list, a job opens its details. */
function recordLink(record: AuditRecord, name: string | null): AuditDetails["record"] {
    const page = (label: string, href: string) => ({ label: `Open ${label}`, href });
    switch (record.resource) {
        case AUDIT_RESOURCES.JOB:
            return record.resourceId ? page(name ?? "the job", `/dashboard/jobs?job=${encodeURIComponent(record.resourceId)}`) : page("Jobs", "/dashboard/jobs");
        case AUDIT_RESOURCES.USER:
            return page("Users", `${USERS}?tab=users`);
        case AUDIT_RESOURCES.GROUP:
            return page("Groups", `${USERS}?tab=groups`);
        case AUDIT_RESOURCES.API_KEY:
            return page("API keys", `${USERS}?tab=apikeys`);
        case AUDIT_RESOURCES.SSO_PROVIDER:
            return page("SSO", `${USERS}?tab=sso`);
        case AUDIT_RESOURCES.ADAPTER:
        case AUDIT_RESOURCES.SOURCE:
            return page("Connections", "/dashboard/connections");
        case AUDIT_RESOURCES.VAULT:
        case AUDIT_RESOURCES.CREDENTIAL:
            return page("the Vault", "/dashboard/vault");
        case AUDIT_RESOURCES.TEMPLATE:
            return page("Templates", "/dashboard/templates");
        case AUDIT_RESOURCES.BACKUP:
        case AUDIT_RESOURCES.DESTINATION:
            return page("Backups", "/dashboard/backups");
        case AUDIT_RESOURCES.SYSTEM:
            return page("Settings", "/dashboard/settings");
        default:
            return null;
    }
}

/**
 * The panel of one entry: what changed, the sign-in it came from, the entries of the same record
 * before it, and for a sign-in what happened in that session and where the person signed in from
 * before. Null when the entry is gone.
 */
export async function getAuditEntryDetails(id: string): Promise<AuditDetails | null> {
    const record = await prisma.auditLog.findUnique({ where: { id }, select: AUDIT_ROW_SELECT });
    if (!record) return null;
    const details = parseDetails(record.details);
    const isSignIn = record.action === AUDIT_ACTIONS.LOGIN;

    const [retention, signIn, earlier, boundary] = await Promise.all([
        getDataRetentionValues(),
        record.userId && !isSignIn
            ? prisma.auditLog.findFirst({
                  where: { userId: record.userId, action: AUDIT_ACTIONS.LOGIN, createdAt: { lte: record.createdAt } },
                  orderBy: { createdAt: "desc" },
                  select: { createdAt: true, details: true, userAgent: true, ipAddress: true },
              })
            : null,
        record.resourceId
            ? prisma.auditLog.findMany({
                  where: { resource: record.resource, resourceId: record.resourceId, createdAt: { lt: record.createdAt } },
                  orderBy: { createdAt: "desc" },
                  take: EARLIER_LIMIT,
                  select: AUDIT_ROW_SELECT,
              })
            : [],
        // A session ends with the next sign-in or sign-out of the same person.
        isSignIn && record.userId
            ? prisma.auditLog.findFirst({
                  where: { userId: record.userId, action: { in: [AUDIT_ACTIONS.LOGIN, AUDIT_ACTIONS.LOGOUT] }, createdAt: { gt: record.createdAt } },
                  orderBy: { createdAt: "asc" },
                  select: { createdAt: true, action: true },
              })
            : null,
    ]);

    const [sessionRecords, before, newPlaces] = await Promise.all([
        isSignIn && record.userId
            ? prisma.auditLog.findMany({
                  where: {
                      userId: record.userId,
                      apiKeyId: null,
                      action: { not: AUDIT_ACTIONS.LOGIN },
                      createdAt: { gt: record.createdAt, ...(boundary ? { lte: boundary.createdAt } : {}) },
                  },
                  orderBy: { createdAt: "asc" },
                  take: SESSION_LIMIT,
                  select: AUDIT_ROW_SELECT,
              })
            : [],
        isSignIn && record.userId
            ? prisma.auditLog.findMany({
                  where: { userId: record.userId, action: AUDIT_ACTIONS.LOGIN, createdAt: { lt: record.createdAt } },
                  select: { ipAddress: true },
              })
            : [],
        isSignIn ? newPlacesOf([record]) : Promise.resolve(new Set<string>()),
    ]);

    const targets = await resolveTargets([record, ...earlier, ...sessionRecords]);
    const name = typeof details.name === "string" ? details.name : targetOf(targets, record);

    return {
        id: record.id,
        changes: changesOf(details),
        signIn: signIn
            ? {
                  at: signIn.createdAt.toISOString(),
                  method: typeof parseDetails(signIn.details).method === "string" ? String(parseDetails(signIn.details).method) : null,
                  device: deviceOf(signIn.userAgent),
                  ipAddress: signIn.ipAddress,
              }
            : null,
        session: isSignIn
            ? {
                  lines: sessionRecords.map((entry) => toLine(entry, targets)),
                  endedAt: boundary?.createdAt.toISOString() ?? null,
                  signedOut: boundary?.action === AUDIT_ACTIONS.LOGOUT,
              }
            : null,
        usualNetworks: newPlaces.has(record.id)
            ? [...new Set(before.map((entry) => networkOf(entry.ipAddress)).filter((network): network is string => network !== null))]
            : [],
        earlier: earlier.map((entry) => toLine(entry, targets)),
        record: recordLink(record, name),
        browser: record.userAgent && record.userAgent !== "unknown" ? record.userAgent : null,
        stored: record.details ? JSON.stringify(details, null, 2) : null,
        keptDays: retention.auditLog,
    };
}
