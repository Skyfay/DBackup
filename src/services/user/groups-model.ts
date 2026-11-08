import prisma from "@/lib/prisma";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { AUDIT_ACTIONS, AUDIT_RESOURCES } from "@/lib/core/audit-types";
import { PLATFORM_ADMIN_ROLE } from "@/lib/auth/owner-permissions";
import { reachCovers, type PlatformReach } from "@/lib/auth/platform-group-caps";
import { peopleOf, roleIn } from "@/services/tenant/membership-service";
import { runAsSystem } from "@/lib/tenant/context";
import { parsePermissions } from "./users-model";
import type { GroupActor, GroupRow, GroupsModel, TenantGroupTemplateRow } from "./groups-types";
import { tenantGroupTemplates } from "./tenant-group-templates";

/** The newest entries of the audit log read at most, so a log with years of changes stays quick. */
const AUDIT_LIMIT = 1000;

export interface ListedGroup {
    id: string;
    name: string;
    permissions: string;
    fullAccess: boolean;
    createdAt: Date;
    /** The group for tenants of the platform it is in its tenant, none for a group of the tenant's own. */
    templateId?: string | null;
    /** The tenant it belongs to, for the list of every tenant on the Platform. */
    tenantId?: string;
    /** Its members, who hold it in its tenant. */
    users: { id: string; name: string; email: string; image: string | null }[];
}

export interface ListedPerson {
    id: string;
    name: string;
    email: string;
    /** Their group in the tenant the list is for. */
    groupId: string | null;
    platformAdmin: boolean;
}

export interface GroupAuditRow {
    resourceId: string | null;
    action: string;
    createdAt: Date;
    user: { name: string } | null;
    /** The name the user had when the entry was written, kept after the user is deleted. */
    actorName?: string | null;
}

interface BuildInput {
    groups: ListedGroup[];
    people: ListedPerson[];
    /** Newest first. */
    audit: GroupAuditRow[];
    viewerId: string | null;
    viewerPlatformAdmin: boolean;
    /** Whether the viewer may see the users, which decides if the model names people outside the groups. */
    withPeople: boolean;
    /** The groups of every tenant, read only on the Platform. People move between groups inside a tenant only, so the model lists nobody to move. */
    allTenants?: boolean;
}

const actorOf = (row: GroupAuditRow): GroupActor => ({ at: row.createdAt.toISOString(), by: row.user?.name ?? row.actorName ?? null });

/** The Groups tab: every group with its members and what the audit log knows, and the numbers above the list. */
export function buildGroupsModel({ groups, people, audit, viewerId, viewerPlatformAdmin, withPeople, allTenants = false }: BuildInput): GroupsModel {
    const made = new Map<string, GroupActor>();
    const changed = new Map<string, GroupActor>();
    for (const row of audit) {
        if (!row.resourceId) continue;
        // The rows are newest first, so the last create wins and the first update stays.
        if (row.action === AUDIT_ACTIONS.CREATE) made.set(row.resourceId, actorOf(row));
        else if (row.action === AUDIT_ACTIONS.UPDATE && !changed.has(row.resourceId)) changed.set(row.resourceId, actorOf(row));
    }

    const rows: GroupRow[] = groups
        .map((group) => ({
            id: group.id,
            name: group.name,
            ...(group.tenantId ? { tenantId: group.tenantId } : {}),
            superAdmin: group.fullAccess,
            fromPlatform: Boolean(group.templateId),
            permissions: parsePermissions(group.permissions),
            members: group.users.map((user) => ({ ...user, isYou: user.id === viewerId })).sort((a, b) => a.name.localeCompare(b.name)),
            createdAt: group.createdAt.toISOString(),
            made: made.get(group.id) ?? null,
            changed: changed.get(group.id) ?? null,
        }))
        .sort((a, b) => Number(b.superAdmin) - Number(a.superAdmin) || a.name.localeCompare(b.name));

    const may = (row: GroupRow, permission: string) => row.superAdmin || row.permissions.includes(permission);
    const withoutGroup = people.filter((person) => !person.groupId);

    return {
        groups: rows,
        stats: {
            groups: rows.length,
            people: people.length,
            inGroup: people.length - withoutGroup.length,
            // Names of people outside every group only reach a viewer who may see the users.
            withoutGroup: withPeople ? withoutGroup.map((person) => person.name) : [],
            canDelete: rows.filter((row) => may(row, PERMISSIONS.STORAGE.DELETE)).map((row) => row.name),
            canReveal: rows.filter((row) => may(row, PERMISSIONS.CREDENTIALS.REVEAL)).map((row) => row.name),
            empty: rows.filter((row) => row.members.length === 0).map((row) => row.name),
        },
        people: withPeople && !allTenants
            ? people.map((person) => ({
                  id: person.id,
                  name: person.name,
                  email: person.email,
                  groupId: person.groupId,
                  superAdmin: person.platformAdmin,
                  isYou: person.id === viewerId,
              }))
            : null,
        viewerPlatformAdmin,
        allTenants,
    };
}

/**
 * The entries of the audit log that made or changed a group, newest first, wherever they were
 * written. With `ids` only those of these groups, so the entries of other tenants never push the
 * ones of a tenant out of the newest that are read.
 */
function groupAudit(ids?: readonly string[]) {
    return runAsSystem(() => prisma.auditLog.findMany({
        where: { resource: AUDIT_RESOURCES.GROUP, action: { in: [AUDIT_ACTIONS.CREATE, AUDIT_ACTIONS.UPDATE] }, ...(ids ? { resourceId: { in: [...ids] } } : {}) },
        orderBy: { createdAt: "desc" },
        take: AUDIT_LIMIT,
        select: { resourceId: true, action: true, createdAt: true, actorName: true, user: { select: { name: true } } },
    }));
}

/**
 * The groups of every tenant for Users & Groups of the Platform, each with its tenant and its
 * members, read only. Whoever may see the accounts of the platform opens it from any tenant, so it
 * reads every tenant, also the ones they may not open, which `platformTenantNames` names. Someone
 * of a platform group of some tenants sees the groups of those tenants alone, `reach`.
 */
export async function getPlatformGroupsModel(viewerId: string | null, reach: PlatformReach = "all"): Promise<GroupsModel> {
    const inReach = (tenantId: string) => reachCovers(reach, tenantId);
    const [listed, audit, templates] = await runAsSystem(() => Promise.all([
        prisma.group.findMany({
            where: reach === "all" ? undefined : { tenantId: { in: [...reach] } },
            select: {
                id: true,
                name: true,
                permissions: true,
                fullAccess: true,
                createdAt: true,
                tenantId: true,
                templateId: true,
                memberships: { select: { user: { select: { id: true, name: true, email: true, image: true } } } },
            },
        }),
        groupAudit(),
        tenantGroupTemplates.list(),
    ]));
    const groups = listed.map(({ memberships, ...group }) => ({ ...group, users: memberships.map((membership) => membership.user) }));
    // The people of a tenant move between its groups in that tenant, so none are listed here.
    const model = buildGroupsModel({ groups, people: [], audit, viewerId, viewerPlatformAdmin: true, withPeople: false, allTenants: true });
    // The groups for tenants keep the entries of their own log, made and changed on the platform.
    const made = new Map<string, GroupActor>();
    const changed = new Map<string, GroupActor>();
    for (const row of audit) {
        if (!row.resourceId) continue;
        if (row.action === AUDIT_ACTIONS.CREATE) made.set(row.resourceId, actorOf(row));
        else if (row.action === AUDIT_ACTIONS.UPDATE && !changed.has(row.resourceId)) changed.set(row.resourceId, actorOf(row));
    }
    const rows: TenantGroupTemplateRow[] = templates.map((template) => ({
        id: template.id,
        name: template.name,
        permissions: template.permissions,
        allTenants: template.allTenants,
        // A tenant beyond the reach of the viewer stays unnamed, also by its id.
        tenantIds: template.tenantIds.filter(inReach),
        groups: template.groups.filter((group) => inReach(group.tenantId)).map((group) => ({
            tenantId: group.tenantId,
            groupId: group.id,
            members: group.members.map((user) => ({ ...user, isYou: user.id === viewerId })).sort((a, b) => a.name.localeCompare(b.name)),
        })),
        createdAt: template.createdAt.toISOString(),
        made: made.get(template.id) ?? null,
        changed: changed.get(template.id) ?? null,
    }));
    return { ...model, templates: rows };
}

/**
 * The names of the tenants for Users & Groups of the Platform, whose groups and accounts belong to
 * every tenant: every one for a reach of all tenants, else the tenants of the reach alone, so
 * someone of a platform group of some tenants never learns the names of the others.
 */
export async function platformTenantNames(reach: PlatformReach): Promise<{ id: string; name: string }[]> {
    if (reach !== "all" && reach.length === 0) return [];
    return prisma.tenant.findMany({
        where: reach === "all" ? undefined : { id: { in: [...reach] } },
        select: { id: true, name: true },
        orderBy: { name: "asc" },
    });
}

/** Loads the Groups tab with the groups of a tenant and their members, read in that tenant. */
export async function getGroupsModel(viewerId: string | null, viewerPlatformAdmin: boolean, withPeople: boolean, tenantId: string): Promise<GroupsModel> {
    const [listed, people] = await Promise.all([
        prisma.group.findMany({
            where: { tenantId },
            select: {
                id: true,
                name: true,
                permissions: true,
                fullAccess: true,
                createdAt: true,
                templateId: true,
                memberships: { where: { tenantId }, select: { user: { select: { id: true, name: true, email: true, image: true } } } },
            },
        }),
        prisma.user
            .findMany({ where: peopleOf(tenantId), select: { id: true, name: true, email: true, platformRole: true, memberships: roleIn(tenantId) }, orderBy: { name: "asc" } })
            .then((users) => users.map((user): ListedPerson => ({
                id: user.id,
                name: user.name,
                email: user.email,
                groupId: user.memberships[0]?.group.id ?? null,
                platformAdmin: user.platformRole === PLATFORM_ADMIN_ROLE,
            }))),
    ]);
    // A group belongs to its tenant, whose log holds its entries. Read wherever they were written,
    // but only those of the groups of this tenant.
    const audit = await groupAudit(listed.map((group) => group.id));
    const groups = listed.map(({ memberships, ...group }) => ({ ...group, users: memberships.map((membership) => membership.user) }));
    return buildGroupsModel({ groups, people, audit, viewerId, viewerPlatformAdmin, withPeople });
}
