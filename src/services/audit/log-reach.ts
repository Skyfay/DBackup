import type { Prisma } from "@prisma/client";
import prisma from "@/lib/prisma";
import { AUDIT_ACTIONS, AUDIT_RESOURCES } from "@/lib/core/audit-types";
import { NOTIFICATION_EVENTS } from "@/lib/notifications/types";
import { HOME_TENANT_ID } from "@/lib/tenant/home";
import { membersOfAny } from "@/services/tenant/membership-service";
import { platformGroupService } from "@/services/user/platform-group-service";

/**
 * The log of the home tenant is the log of the platform: the sign-ins, sign-outs and failed sign-ins
 * of every account land there, and the messages of the channels of the platform about the records
 * of every tenant. Someone whose platform group reaches some tenants only reads there what concerns
 * the tenants they reach. A platform admin, a platform group of all tenants and a member of the
 * home tenant without a platform group read all of it, as before.
 */

/** Who reads a log, as a route or a check of a picture knows them. */
export interface LogReader {
    userId: string;
    tenantId: string | null;
    isPlatformAdmin: boolean;
    allTenants?: boolean;
}

/** How a reader sees the log of the tenant they work in. */
export interface LogView {
    /** The tenants whose accounts the reader sees in the log of the home tenant, null for every one. */
    reach: readonly string[] | null;
    viewerId: string;
    /** What a cache of the log is kept by, so one reader never gets the numbers of another. */
    key: string;
}

/** A reader who sees every entry, for code that reads the log without a viewer, like a test. */
export const FULL_VIEW: LogView = { reach: null, viewerId: "", key: "all" };

/**
 * The tenants whose accounts the reader sees in the log of the home tenant: the reach of their
 * platform group while it covers some tenants only and they read the log of the home tenant, null
 * otherwise. The log of any other tenant is that tenant's own and never narrowed here.
 */
export async function logReachOf(reader: LogReader): Promise<readonly string[] | null> {
    if (reader.tenantId !== HOME_TENANT_ID || reader.isPlatformAdmin || reader.allTenants) return null;
    const own = await platformGroupService.shapeOf(reader.userId);
    if (!own || own.shape.allTenants) return null;
    return [...own.shape.tenantIds].sort();
}

/** The view of the log a reader gets, with its cache key. */
export async function logViewOf(reader: LogReader): Promise<LogView> {
    const reach = await logReachOf(reader);
    return { reach, viewerId: reader.userId, key: reach ? `reach:${reader.userId}:${reach.join(",")}` : "all" };
}

/**
 * The accounts the view sees in the log: those with a membership in a tenant of the reach, an
 * account of no tenant counting as one of the home tenant (`membersOfAny`), and the own account.
 */
function accountsOf(view: LogView): Prisma.UserWhereInput {
    return { OR: [{ id: view.viewerId }, membersOfAny(view.reach ?? [])] };
}

/**
 * The entries about a tenant a view keeps: an entry about a tenant (`resource` TENANT) only of a
 * tenant of the reach, and an entry whose details name tenants by `tenantId`, like the databases
 * the home tenant gave away, only when one of them is of the reach. The details are JSON text, so a
 * named tenant is found by `"tenantId":"<id>"`, which also hides an entry of a tenant deleted since.
 */
function aboutReachedTenants(reach: readonly string[]): Prisma.AuditLogWhereInput[] {
    return [
        { OR: [{ resource: { not: AUDIT_RESOURCES.TENANT } }, { resourceId: null }, { resourceId: { in: [...reach] } }] },
        {
            OR: [
                { details: null },
                { NOT: { details: { contains: '"tenantId":' } } },
                ...reach.map((tenantId) => ({ details: { contains: `"tenantId":${JSON.stringify(tenantId)}` } })),
            ],
        },
    ];
}

/**
 * The entries of the log of the home tenant a view keeps, null for every entry: those of an
 * account it sees, and those of no person, but a failed sign-in of an account it does not see.
 * A failed sign-in names the account it tried by `resourceId` alone, without a relation, so the
 * accounts of the failed sign-ins the log holds are looked up first. An entry of a deleted account
 * kept its name only, and nothing tells its tenants any more, so it stays hidden. Of these it
 * keeps only the entries about tenants of the reach, see `aboutReachedTenants`, so whoever acted,
 * an entry about a customer beyond the reach, like its rename or delete, stays hidden.
 */
export async function auditVisibleWhere(view: LogView): Promise<Prisma.AuditLogWhereInput | null> {
    if (!view.reach) return null;
    const tried = await prisma.auditLog.findMany({
        where: { tenantId: HOME_TENANT_ID, action: AUDIT_ACTIONS.LOGIN_FAILED, resourceId: { not: null } },
        distinct: ["resourceId"],
        select: { resourceId: true },
    });
    const triedIds = tried.flatMap((entry) => (entry.resourceId ? [entry.resourceId] : []));
    const seen = triedIds.length === 0
        ? []
        : await prisma.user.findMany({ where: { AND: [{ id: { in: triedIds } }, accountsOf(view)] }, select: { id: true } });
    return {
        AND: [
            {
                OR: [
                    { userId: { not: null }, user: { is: accountsOf(view) } },
                    { userId: null, actorName: null, action: { not: AUDIT_ACTIONS.LOGIN_FAILED } },
                    { userId: null, actorName: null, action: AUDIT_ACTIONS.LOGIN_FAILED, OR: [{ resourceId: null }, { resourceId: { in: seen.map((user) => user.id) } }] },
                ],
            },
            ...aboutReachedTenants(view.reach),
        ],
    };
}

/**
 * Whether a view sees the account of an entry of the log, for one entry that was read already: the
 * own account, one of no tenant while the reach covers the home tenant, or one with a membership
 * in a tenant of the reach. True for a view of every entry.
 */
export function viewSeesAccount(view: LogView | undefined, user: { id?: string; memberships: readonly { tenantId: string }[] } | null, userId: string | null): boolean {
    if (!view?.reach) return true;
    if (userId && userId === view.viewerId) return true;
    if (!user) return false;
    const reach = view.reach;
    if (user.memberships.length === 0) return reach.includes(HOME_TENANT_ID);
    return user.memberships.some((membership) => reach.includes(membership.tenantId));
}

/** The events of the channels of the platform that concern no record of any tenant. */
const PLATFORM_EVENTS: string[] = [NOTIFICATION_EVENTS.UPDATE_AVAILABLE, NOTIFICATION_EVENTS.CONFIG_BACKUP];

/**
 * The messages of the notification log of the home tenant a view keeps, null for every one. A
 * message of a channel of the platform may concern a record of any tenant, which its row does not
 * name, so a view of some tenants keeps the messages of a run of the home tenant, which is the only
 * run the log of the platform links (`platformRun`), and the events that concern no tenant at all.
 */
export function notificationLogVisibleWhere(view: LogView): Prisma.NotificationLogWhereInput | null {
    if (!view.reach) return null;
    return { OR: [{ executionId: { not: null } }, { eventType: { in: PLATFORM_EVENTS } }] };
}

/** The field of the message of a failed integrity check that names the other tenants, see `integrityCheckFailureTemplate`. */
export const OTHER_TENANTS_FIELD = "Other tenants";

/** A message of the notification log as `notificationShownTo` reads and changes it. */
interface ShownMessage {
    eventType: string;
    fields: string | null;
    renderedHtml: string | null;
    renderedPayload: string | null;
}

/**
 * A message of the notification log as a view reads it. The message of the platform about a failed
 * integrity check names every other tenant with copies that failed, `Acme: 2 of 40, Globex: 1 of 9`,
 * so a view of some tenants reads how many tenants it names and nothing of the mail or the payload
 * that went out, which carry the names too. Any other message, and any view of every tenant, as it is.
 */
export function notificationShownTo<T extends ShownMessage>(view: LogView, row: T): T {
    if (!view.reach || row.eventType !== NOTIFICATION_EVENTS.INTEGRITY_CHECK_FAILURE || !row.fields) return row;
    let fields: unknown;
    try {
        fields = JSON.parse(row.fields);
    } catch {
        return { ...row, fields: null, renderedHtml: null, renderedPayload: null };
    }
    if (!Array.isArray(fields)) return { ...row, fields: null, renderedHtml: null, renderedPayload: null };
    const counted = fields.map((field: { name?: unknown; value?: unknown; inline?: unknown }) => {
        if (field?.name !== OTHER_TENANTS_FIELD) return field;
        // Each tenant reads "<name>: <failed> of <total>", so the count never needs a name.
        const count = typeof field.value === "string" ? (field.value.match(/: \d+ of \d+(?=, |$)/g) ?? []).length : 0;
        return { ...field, value: count === 1 ? "1 other tenant" : `${count} other tenants` };
    });
    return { ...row, fields: JSON.stringify(counted), renderedHtml: null, renderedPayload: null };
}

