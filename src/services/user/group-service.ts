import prisma from "@/lib/prisma";
import { areaChanges, knownPermissions } from "@/lib/auth/permission-areas";
import { runBulk, type BulkResult } from "@/lib/core/bulk";
import { NotFoundError, ValidationError } from "@/lib/logging/errors";
import { parsePermissions, SUPER_ADMIN_GROUP } from "./users-model";

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

async function assertFreeName(name: string, exceptId?: string) {
    const clash = await prisma.group.findUnique({ where: { name }, select: { id: true } });
    if (clash && clash.id !== exceptId) throw new ValidationError(`A group with the name "${name}" already exists.`);
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

    /** Changes the name and the permissions of a group and says what changed. The SuperAdmin group stays as it is. */
    async update(id: string, input: GroupInput): Promise<GroupChange> {
        const group = await prisma.group.findUnique({ where: { id } });
        if (!group) throw new NotFoundError("Group", id);
        if (group.name === SUPER_ADMIN_GROUP) throw new ValidationError("The SuperAdmin group cannot be edited.");

        const name = input.name.trim();
        await assertFreeName(name, id);
        const before = new Set(parsePermissions(group.permissions));
        const permissions = knownPermissions(input.permissions);
        const after = new Set<string>(permissions);
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
     * Deletes a group and moves its members to another group, or to none, in one step. A member
     * never loses the group without a word, which the database would do on its own.
     */
    async delete(id: string, moveTo: string | null) {
        const group = await prisma.group.findUnique({ where: { id }, select: { id: true, name: true } });
        if (!group) throw new NotFoundError("Group", id);
        if (group.name === SUPER_ADMIN_GROUP) throw new ValidationError("The SuperAdmin group cannot be deleted.");
        if (moveTo === id) throw new ValidationError("Pick another group for its members.");
        if (moveTo && !(await prisma.group.findUnique({ where: { id: moveTo }, select: { id: true } }))) {
            throw new ValidationError("The group for the members no longer exists.");
        }

        const [moved] = await prisma.$transaction([
            prisma.user.updateMany({ where: { groupId: id }, data: { groupId: moveTo } }),
            prisma.group.delete({ where: { id } }),
        ]);
        return { name: group.name, moved: moved.count };
    },

    /**
     * Deletes several groups without members. A group with members is refused, since they need a
     * group of their own first, and so is the SuperAdmin group. The members are checked in the
     * delete itself, so someone who joins in between keeps the group.
     */
    async deleteMany(ids: string[]): Promise<BulkResult> {
        const groups = await prisma.group.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } });
        const names = new Map(groups.map((group) => [group.id, group.name]));

        return runBulk(
            ids,
            async (id) => {
                if (!names.has(id)) throw new Error("The group no longer exists.");
                if (names.get(id) === SUPER_ADMIN_GROUP) throw new Error("The SuperAdmin group cannot be deleted.");
                const { count } = await prisma.group.deleteMany({ where: { id, users: { none: {} } } });
                if (count === 0) throw new Error("People are in it. Delete it on its own to move them to another group.");
            },
            (id) => names.get(id)
        );
    },

    /** Whether the group has members, and whether the user is one of them. */
    async membership(groupId: string, userId: string | null) {
        const group = await prisma.group.findUnique({ where: { id: groupId }, select: { name: true, users: { select: { id: true } } } });
        return {
            exists: group !== null,
            superAdmin: group?.name === SUPER_ADMIN_GROUP,
            members: group?.users.length ?? 0,
            includes: Boolean(userId && group?.users.some((user) => user.id === userId)),
        };
    },
};
