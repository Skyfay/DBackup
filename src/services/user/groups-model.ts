import prisma from "@/lib/prisma";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { AUDIT_ACTIONS, AUDIT_RESOURCES } from "@/lib/core/audit-types";
import { parsePermissions, SUPER_ADMIN_GROUP } from "./users-model";
import type { GroupActor, GroupRow, GroupsModel } from "./groups-types";

/** The newest entries of the audit log read at most, so a log with years of changes stays quick. */
const AUDIT_LIMIT = 1000;

export interface ListedGroup {
    id: string;
    name: string;
    permissions: string;
    createdAt: Date;
    users: { id: string; name: string; email: string; image: string | null }[];
}

export interface ListedPerson {
    id: string;
    name: string;
    email: string;
    groupId: string | null;
    group: { name: string } | null;
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
    viewerSuperAdmin: boolean;
    /** Whether the viewer may see the users, which decides if the model names people outside the groups. */
    withPeople: boolean;
}

const actorOf = (row: GroupAuditRow): GroupActor => ({ at: row.createdAt.toISOString(), by: row.user?.name ?? row.actorName ?? null });

/** The Groups tab: every group with its members and what the audit log knows, and the numbers above the list. */
export function buildGroupsModel({ groups, people, audit, viewerId, viewerSuperAdmin, withPeople }: BuildInput): GroupsModel {
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
            superAdmin: group.name === SUPER_ADMIN_GROUP,
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
        people: withPeople
            ? people.map((person) => ({
                  id: person.id,
                  name: person.name,
                  email: person.email,
                  groupId: person.groupId,
                  superAdmin: person.group?.name === SUPER_ADMIN_GROUP,
                  isYou: person.id === viewerId,
              }))
            : null,
        viewerSuperAdmin,
    };
}

/** Loads the Groups tab. */
export async function getGroupsModel(viewerId: string | null, viewerSuperAdmin: boolean, withPeople: boolean): Promise<GroupsModel> {
    const [groups, people, audit] = await Promise.all([
        prisma.group.findMany({
            select: { id: true, name: true, permissions: true, createdAt: true, users: { select: { id: true, name: true, email: true, image: true } } },
        }),
        prisma.user.findMany({ select: { id: true, name: true, email: true, groupId: true, group: { select: { name: true } } }, orderBy: { name: "asc" } }),
        prisma.auditLog.findMany({
            where: { resource: AUDIT_RESOURCES.GROUP, action: { in: [AUDIT_ACTIONS.CREATE, AUDIT_ACTIONS.UPDATE] } },
            orderBy: { createdAt: "desc" },
            take: AUDIT_LIMIT,
            select: { resourceId: true, action: true, createdAt: true, actorName: true, user: { select: { name: true } } },
        }),
    ]);
    return buildGroupsModel({ groups, people, audit, viewerId, viewerSuperAdmin, withPeople });
}
