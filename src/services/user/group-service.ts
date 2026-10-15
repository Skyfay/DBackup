import prisma from "@/lib/prisma";
import { runAsTenant } from "@/lib/tenant/context";
import { HOME_TENANT_ID } from "@/lib/tenant/home";
import type { Tx } from "@/lib/prisma-tx";
import { AVAILABLE_PERMISSIONS, PERMISSIONS } from "@/lib/auth/permissions";
import { groupPermissions } from "@/lib/auth/owner-permissions";
import { areaChanges, knownPermissions } from "@/lib/auth/permission-areas";
import { runBulk, type BulkResult } from "@/lib/core/bulk";
import { NotFoundError, ValidationError } from "@/lib/logging/errors";
import type { MembershipActor } from "@/services/tenant/membership-service";
import { parsePermissions } from "./users-model";

export interface GroupInput {
    name: string;
    permissions: string[];
}

/** What changed in a group, as the audit log keeps it: the name before, and the permissions and levels that moved. */
export interface GroupChange {
    name: string;
    renamedFrom?: string;
    added: string[];
    removed: string[];
    areas: { area: string; from: string; to: string }[];
}

/** A name is unique within its tenant, the one the code runs in. */
async function assertFreeName(name: string, exceptId?: string) {
    const clash = await prisma.group.findFirst({ where: { name }, select: { id: true } });
    if (clash && clash.id !== exceptId) throw new ValidationError(`A group with the name "${name}" already exists.`);
}

/** The part of a client this needs, the app's or a transaction of it. */
type GroupClient = Pick<Tx, "group">;

/**
 * The group with every permission of a tenant, made when there is none yet. It is called Admin
 * unless an ordinary group has that name already, like the migration names it.
 */
export function ensureFullAccessGroup(client: GroupClient = prisma, tenantId: string = HOME_TENANT_ID): Promise<string> {
    // In the tenant of the group, whatever the code around runs in. The first sign-in runs it while
    // its own request still works out its tenant.
    return runAsTenant(tenantId, async () => {
        const existing = await client.group.findFirst({ where: { fullAccess: true }, select: { id: true } });
        if (existing) return existing.id;
        const taken = new Set((await client.group.findMany({ where: { name: { startsWith: "Admin" } }, select: { name: true } })).map((group) => group.name));
        const name = ["Admin", "Admin (full access)"].find((candidate) => !taken.has(candidate)) ?? `Admin (full access ${taken.size})`;
        const created = await client.group.create({
            data: { name, fullAccess: true, permissions: JSON.stringify(AVAILABLE_PERMISSIONS.map((permission) => permission.id)) },
            select: { id: true },
        });
        return created.id;
    });
}

/** Whether a group lets its members manage the people of their tenant. */
const managesMembers = (group: { permissions: string; fullAccess: boolean }) => groupPermissions(group).includes(PERMISSIONS.USERS.WRITE);

/**
 * Refuses a change of a group that would leave a tenant without anyone who manages its members,
 * like `membershipService.setRole` does for one person: the group stops managing them, and in a
 * tenant where its members were the only ones who did, nobody would be left. A platform admin
 * manages every tenant, so their change goes through.
 */
async function assertManagersStay(group: { id: string; permissions: string; fullAccess: boolean }, managesAfter: boolean, by: MembershipActor): Promise<void> {
    if (by.platformAdmin || managesAfter || !managesMembers(group)) return;
    const tenantIds = (await prisma.tenantMembership.findMany({ where: { groupId: group.id }, select: { tenantId: true }, distinct: ["tenantId"] })).map((row) => row.tenantId);
    if (tenantIds.length === 0) return;
    const others = await prisma.tenantMembership.findMany({
        where: { tenantId: { in: tenantIds }, groupId: { not: group.id } },
        select: { tenantId: true, group: { select: { permissions: true, fullAccess: true } } },
    });
    const left = tenantIds.filter((tenantId) => !others.some((row) => row.tenantId === tenantId && managesMembers(row.group)));
    if (left.length === 0) return;
    const names = (await prisma.tenant.findMany({ where: { id: { in: left } }, select: { name: true }, orderBy: { name: "asc" } })).map((tenant) => tenant.name);
    throw new ValidationError(`Nobody would manage the members of ${names.join(", ")} any more. Give someone there that right first, or keep it in this group.`);
}

export const groupService = {
    /** Creates a group. Only permissions DBackup knows are stored. */
    async create(input: GroupInput) {
        const name = input.name.trim();
        await assertFreeName(name);
        const permissions = knownPermissions(input.permissions);
        const group = await prisma.group.create({ data: { name, permissions: JSON.stringify(permissions) } });
        return { id: group.id, name, permissions };
    },

    /** Changes the name and the permissions of a group and says what changed. The group with every permission stays as it is. */
    async update(id: string, input: GroupInput, by: MembershipActor): Promise<GroupChange> {
        const group = await prisma.group.findUnique({ where: { id } });
        if (!group) throw new NotFoundError("Group", id);
        if (group.fullAccess) throw new ValidationError(`${group.name} holds every permission and cannot be edited.`);

        const name = input.name.trim();
        await assertFreeName(name, id);
        const before = new Set(parsePermissions(group.permissions));
        const permissions = knownPermissions(input.permissions);
        const after = new Set<string>(permissions);
        await assertManagersStay(group, after.has(PERMISSIONS.USERS.WRITE), by);
        await prisma.group.update({ where: { id }, data: { name, permissions: JSON.stringify(permissions) } });

        return {
            name,
            ...(group.name !== name ? { renamedFrom: group.name } : {}),
            added: permissions.filter((permission) => !before.has(permission)),
            removed: [...before].filter((permission) => !after.has(permission)),
            areas: areaChanges(before, after).map((change) => ({ area: change.area.id, from: change.from, to: change.to })),
        };
    },

    /**
     * Deletes a group and moves its members to another group of its tenant, or to none, which
     * takes them out of the tenant, in one step. A member never loses the group without a word,
     * which the database would do on its own.
     */
    async delete(id: string, moveTo: string | null, by: MembershipActor) {
        const group = await prisma.group.findUnique({ where: { id }, select: { id: true, name: true, permissions: true, fullAccess: true } });
        if (!group) throw new NotFoundError("Group", id);
        if (group.fullAccess) throw new ValidationError(`${group.name} holds every permission and cannot be deleted.`);
        if (moveTo === id) throw new ValidationError("Pick another group for its members.");
        const target = moveTo ? await prisma.group.findUnique({ where: { id: moveTo }, select: { permissions: true, fullAccess: true } }) : null;
        if (moveTo && !target) throw new ValidationError("The group for the members no longer exists.");
        await assertManagersStay(group, !!target && managesMembers(target), by);

        // A sign-in provider that adds new people to the group adds them where its members go.
        // Without a group to go to, a member leaves the tenant, since a membership needs a group.
        const [moved] = await prisma.$transaction([
            moveTo
                ? prisma.tenantMembership.updateMany({ where: { groupId: id }, data: { groupId: moveTo } })
                : prisma.tenantMembership.deleteMany({ where: { groupId: id } }),
            prisma.ssoProvider.updateMany({ where: { defaultGroupId: id }, data: { defaultGroupId: moveTo } }),
            prisma.group.delete({ where: { id } }),
        ]);
        return { name: group.name, moved: moved.count };
    },

    /**
     * Deletes several groups without members. A group with members is refused, since they need a
     * group of their own first, and so is the group with every permission. The members are checked
     * in the delete itself, so someone who joins in between keeps the group.
     */
    async deleteMany(ids: string[]): Promise<BulkResult> {
        const groups = await prisma.group.findMany({ where: { id: { in: ids } }, select: { id: true, name: true, fullAccess: true } });
        const names = new Map(groups.map((group) => [group.id, group.name]));
        const full = new Set(groups.filter((group) => group.fullAccess).map((group) => group.id));

        return runBulk(
            ids,
            async (id) => {
                if (!names.has(id)) throw new Error("The group no longer exists.");
                if (full.has(id)) throw new Error(`${names.get(id)} holds every permission and cannot be deleted.`);
                await prisma.$transaction(async (tx) => {
                    const { count } = await tx.group.deleteMany({ where: { id, memberships: { none: {} } } });
                    if (count === 0) throw new Error("People are in it. Delete it on its own to move them to another group.");
                    // A sign-in provider that added new people to it adds them without a group from now on.
                    await tx.ssoProvider.updateMany({ where: { defaultGroupId: id }, data: { defaultGroupId: null } });
                });
            },
            (id) => names.get(id)
        );
    },

    /** The group itself, null when it is gone. */
    async find(groupId: string) {
        return prisma.group.findUnique({ where: { id: groupId }, select: { id: true, name: true, permissions: true, fullAccess: true } });
    },

    /** Whether the user holds the group. A group belongs to one tenant, so only there. */
    async heldBy(groupId: string, userId: string): Promise<boolean> {
        return (await prisma.tenantMembership.count({ where: { groupId, userId } })) > 0;
    },

    /** Whether the group has members in the tenant, and whether the user is one of them. */
    async membership(groupId: string, tenantId: string, userId: string | null) {
        const group = await prisma.group.findUnique({
            where: { id: groupId },
            select: { fullAccess: true, memberships: { where: { tenantId }, select: { userId: true } } },
        });
        return {
            exists: group !== null,
            fullAccess: group?.fullAccess ?? false,
            members: group?.memberships.length ?? 0,
            includes: Boolean(userId && group?.memberships.some((membership) => membership.userId === userId)),
        };
    },
};
