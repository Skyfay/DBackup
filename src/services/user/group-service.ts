import prisma from "@/lib/prisma";
import { runAsSystem, runAsTenant } from "@/lib/tenant/context";
import { HOME_TENANT_ID } from "@/lib/tenant/home";
import type { Tx } from "@/lib/prisma-tx";
import { AVAILABLE_PERMISSIONS, PERMISSIONS } from "@/lib/auth/permissions";
import { groupPermissions, PLATFORM_ADMIN_ROLE } from "@/lib/auth/owner-permissions";
import { areaChanges, knownPermissions } from "@/lib/auth/permission-areas";
import { runBulk, type BulkResult } from "@/lib/core/bulk";
import { ConflictError, NotFoundError, ValidationError } from "@/lib/logging/errors";
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

/** Why a group the platform gives the tenant is not changed or deleted there. */
export const fromPlatform = (name: string) => `${name} comes from the platform, which changes and deletes it.`;

/** Why a change that moves or ends the memberships of a group stops when people joined it after its checks. */
export const MEMBERS_CHANGED = "The members of this group changed meanwhile, try again.";

/**
 * Stops a change that moves or ends the memberships of a group when someone holds it now who was
 * not among the members its caller checked, like a person another admin added in between. Read
 * inside the transaction of the change, right before it moves or ends them.
 */
export async function assertMembersUnchanged(tx: Pick<Tx, "tenantMembership">, groupId: string, checked: readonly string[]): Promise<void> {
    const known = new Set(checked);
    const members = await tx.tenantMembership.findMany({ where: { groupId }, select: { userId: true } });
    if (members.some((member) => !known.has(member.userId))) throw new ConflictError(MEMBERS_CHANGED);
}

/**
 * A sign-in provider the delete of a group changed, for the audit log of the platform: the group
 * it adds new people to and whether it adds anyone, before and after.
 */
export interface ProviderMove {
    id: string;
    name: string;
    /** The tenant of the provider, null for one of the platform, which its entry names by `namedTenants`. */
    tenantId: string | null;
    before: { group: string | null; allowProvisioning: boolean };
    after: { group: string | null; allowProvisioning: boolean };
}

/**
 * Sends the new people of the sign-in providers that add them to a deleted group where its members
 * go, also one of the platform, bounded like the move of the members, see `settlePlacement`.
 * Without a group to go to, a provider adds people without a group, and one of a tenant, which adds
 * people into a group only, adds nobody. Returns what changed of each provider, read in the same
 * transaction, since the change of a provider goes into the audit log like an edit of it.
 */
export async function settleProviders(tx: Pick<Tx, "ssoProvider">, group: { id: string; name: string }, moveTo: { id: string; name: string } | null): Promise<ProviderMove[]> {
    const providers = await tx.ssoProvider.findMany({ where: { defaultGroupId: group.id }, select: { id: true, name: true, tenantId: true, allowProvisioning: true } });
    if (providers.length === 0) return [];
    await tx.ssoProvider.updateMany({ where: { defaultGroupId: group.id, tenantId: { not: null } }, data: moveTo ? { defaultGroupId: moveTo.id } : { defaultGroupId: null, allowProvisioning: false } });
    await tx.ssoProvider.updateMany({ where: { defaultGroupId: group.id }, data: { defaultGroupId: moveTo?.id ?? null } });
    return providers.map((provider) => ({
        id: provider.id,
        name: provider.name,
        tenantId: provider.tenantId,
        before: { group: group.name, allowProvisioning: provider.allowProvisioning },
        after: { group: moveTo?.name ?? null, allowProvisioning: provider.tenantId && !moveTo ? false : provider.allowProvisioning },
    }));
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
export const managesMembers = (group: { permissions: string; fullAccess: boolean }) => groupPermissions(group).includes(PERMISSIONS.USERS.WRITE);

/**
 * Refuses a change of a group that would leave a tenant without anyone who manages its members,
 * like `membershipService.setRole` does for one person: the group stops managing them, or goes
 * with its members moved to a group that does not or out of the tenant, and in a tenant where its
 * members were the only ones who did, nobody would be left. A platform admin manages every tenant,
 * so their change goes through. `client` is the transaction of the change, the app's client else.
 */
export async function assertManagersStay(
    group: { id: string; permissions: string; fullAccess: boolean },
    managesAfter: boolean,
    by: MembershipActor,
    client: Pick<Tx, "tenantMembership" | "tenant"> = prisma,
): Promise<void> {
    if (by.platformAdmin || managesAfter || !managesMembers(group)) return;
    const tenantIds = (await client.tenantMembership.findMany({ where: { groupId: group.id }, select: { tenantId: true }, distinct: ["tenantId"] })).map((row) => row.tenantId);
    if (tenantIds.length === 0) return;
    const others = await client.tenantMembership.findMany({
        where: { tenantId: { in: tenantIds }, groupId: { not: group.id } },
        select: { tenantId: true, group: { select: { permissions: true, fullAccess: true } } },
    });
    const left = tenantIds.filter((tenantId) => !others.some((row) => row.tenantId === tenantId && managesMembers(row.group)));
    if (left.length === 0) return;
    const names = (await client.tenant.findMany({ where: { id: { in: left } }, select: { name: true }, orderBy: { name: "asc" } })).map((tenant) => tenant.name);
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
        if (group.templateId) throw new ValidationError(fromPlatform(group.name));

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
     * which the database would do on its own. `checkedMembers` are the members the caller checked
     * before, and someone else holding it by then stops the delete (`assertMembersUnchanged`).
     */
    async delete(id: string, moveTo: string | null, by: MembershipActor, checkedMembers?: readonly string[]) {
        const group = await prisma.group.findUnique({ where: { id }, select: { id: true, name: true, permissions: true, fullAccess: true, templateId: true } });
        if (!group) throw new NotFoundError("Group", id);
        if (group.fullAccess) throw new ValidationError(`${group.name} holds every permission and cannot be deleted.`);
        if (group.templateId) throw new ValidationError(fromPlatform(group.name));
        if (moveTo === id) throw new ValidationError("Pick another group for its members.");
        const target = moveTo ? await prisma.group.findUnique({ where: { id: moveTo }, select: { name: true, permissions: true, fullAccess: true } }) : null;
        if (moveTo && !target) throw new ValidationError("The group for the members no longer exists.");
        await assertManagersStay(group, !!target && managesMembers(target), by);

        return prisma.$transaction(async (tx) => {
            if (checkedMembers) await assertMembersUnchanged(tx, id, checkedMembers);
            const moved = moveTo
                ? await tx.tenantMembership.updateMany({ where: { groupId: id }, data: { groupId: moveTo } })
                : await tx.tenantMembership.deleteMany({ where: { groupId: id } });
            const ssoProviders = await settleProviders(tx, group, moveTo && target ? { id: moveTo, name: target.name } : null);
            await tx.group.delete({ where: { id } });
            return { name: group.name, moved: moved.count, ssoProviders };
        });
    },

    /**
     * Deletes several groups without members. A group with members is refused, since they need a
     * group of their own first, and so is the group with every permission. The members are checked
     * in the delete itself, so someone who joins in between keeps the group.
     */
    async deleteMany(ids: string[]): Promise<BulkResult & { ssoProviders: ProviderMove[] }> {
        const groups = await prisma.group.findMany({ where: { id: { in: ids } }, select: { id: true, name: true, fullAccess: true, templateId: true } });
        const names = new Map(groups.map((group) => [group.id, group.name]));
        const full = new Set(groups.filter((group) => group.fullAccess).map((group) => group.id));
        const platform = new Set(groups.filter((group) => group.templateId).map((group) => group.id));

        const ssoProviders: ProviderMove[] = [];
        const result = await runBulk(
            ids,
            async (id) => {
                if (!names.has(id)) throw new ValidationError("The group no longer exists.");
                if (full.has(id)) throw new ValidationError(`${names.get(id)} holds every permission and cannot be deleted.`);
                if (platform.has(id)) throw new ValidationError(fromPlatform(names.get(id) ?? "This group"));
                const changed = await prisma.$transaction(async (tx) => {
                    const { count } = await tx.group.deleteMany({ where: { id, memberships: { none: {} } } });
                    if (count === 0) throw new ValidationError("People are in it. Delete it on its own to move them to another group.");
                    return settleProviders(tx, { id, name: names.get(id) ?? id }, null);
                });
                // Kept once the delete went through, a provider of a group that stays changed nothing.
                ssoProviders.push(...changed);
            },
            (id) => names.get(id)
        );
        return { ...result, ssoProviders };
    },

    /** The names of groups by id, for the audit log of a bulk delete, read before the delete. */
    async namesOf(ids: readonly string[]): Promise<Map<string, string>> {
        const groups = ids.length === 0 ? [] : await prisma.group.findMany({ where: { id: { in: [...ids] } }, select: { id: true, name: true } });
        return new Map(groups.map((group) => [group.id, group.name]));
    },

    /** The group itself, null when it is gone. */
    async find(groupId: string) {
        return prisma.group.findUnique({ where: { id: groupId }, select: { id: true, name: true, permissions: true, fullAccess: true, templateId: true } });
    },

    /** A group of any tenant, for the platform, which moves people between the groups of every tenant. */
    async findAnywhere(groupId: string) {
        return runAsSystem(() => prisma.group.findUnique({ where: { id: groupId }, select: { id: true, name: true, permissions: true, fullAccess: true, tenantId: true } }));
    },

    /** Whether a platform admin holds the group, whose membership only a platform admin moves or ends. */
    async holdsPlatformAdmin(groupId: string): Promise<boolean> {
        return (await prisma.tenantMembership.count({ where: { groupId, user: { platformRole: PLATFORM_ADMIN_ROLE } } })) > 0;
    },

    /** The accounts that hold the group, in its tenant. */
    async memberIds(groupId: string): Promise<string[]> {
        return (await prisma.tenantMembership.findMany({ where: { groupId }, select: { userId: true } })).map((membership) => membership.userId);
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
