import prisma from "@/lib/prisma";
import { PLATFORM_ADMIN_ROLE, PLATFORM_PERMISSIONS } from "@/lib/auth/owner-permissions";
import type { PlatformGroupShape, PlatformReach } from "@/lib/auth/platform-group-caps";
import { scopeText } from "@/lib/auth/platform-group-summary";
import { areaChanges, knownPermissions, knownPlatformPermissions, PLATFORM_AREAS, PLATFORM_GROUP_TENANT_AREAS } from "@/lib/auth/permission-areas";
import { NotFoundError, ValidationError } from "@/lib/logging/errors";
import { parsePermissions } from "./users-model";
import type { PlatformGroupChoice } from "./platform-groups-types";

/**
 * The platform groups of the people of the MSP: rights on the instance itself, and rights in the
 * tenants of their scope on top of the group someone holds there. A person holds one platform
 * group or the built-in Platform admin, which is `User.platformRole`, never both. Who may do what
 * here is the caller's to check, see `platform-group-caps.ts`.
 */

export interface PlatformGroupInput {
    name: string;
    platformPermissions: readonly string[];
    tenantPermissions: readonly string[];
    allTenants: boolean;
    /** The tenants of the scope, while it does not cover every tenant. */
    tenantIds: readonly string[];
}

/** What changed in a platform group, as the audit log keeps it, in the shapes `audit-changes.ts` reads. */
export interface PlatformGroupChange {
    name: string;
    renamedFrom?: string;
    /** The levels of the areas on the platform and in the tenants that moved, by the id of the area. */
    areas: { area: string; from: string; to: string }[];
    /** Where it counts before and after, while that changed. */
    changes?: { field: string; from: string; to: string }[];
}

const SHAPE = { platformPermissions: true, tenantPermissions: true, allTenants: true, tenants: { select: { tenantId: true } } } as const;

/** A stored platform group as the caps and the pages read it. */
function shapeOf(group: { platformPermissions: string; tenantPermissions: string; allTenants: boolean; tenants: { tenantId: string }[] }): PlatformGroupShape {
    return {
        platformPermissions: knownPlatformPermissions(parsePermissions(group.platformPermissions)),
        tenantPermissions: tenantRights(parsePermissions(group.tenantPermissions)),
        allTenants: group.allTenants,
        tenantIds: group.allTenants ? [] : group.tenants.map((tenant) => tenant.tenantId),
    };
}

/** The rights a platform group may give in the tenants: those of a group of a tenant, never the settings of the instance. */
const tenantRights = (ids: Iterable<string>) => knownPermissions(ids).filter((permission) => !PLATFORM_PERMISSIONS.has(permission));

/** A name is unique among the platform groups, and never the name of the built-in one. */
async function assertFreeName(name: string, exceptId?: string) {
    if (name.toLowerCase() === "platform admin") throw new ValidationError("Platform admin is the name of the built-in platform group.");
    const clash = await prisma.platformGroup.findFirst({ where: { name }, select: { id: true } });
    if (clash && clash.id !== exceptId) throw new ValidationError(`A platform group with the name "${name}" already exists.`);
}

/** What is stored: known rights only, and the tenants of the scope that exist. Refuses rights in the tenants without a tenant to count in. */
async function cleanInput(input: PlatformGroupInput) {
    const name = input.name.trim();
    if (!name) throw new ValidationError("Give the platform group a name.");
    const platformPermissions = knownPlatformPermissions(input.platformPermissions);
    const tenantPermissions = tenantRights(input.tenantPermissions);
    const tenantIds = input.allTenants
        ? []
        : (await prisma.tenant.findMany({ where: { id: { in: [...new Set(input.tenantIds)] } }, select: { id: true } })).map((tenant) => tenant.id);
    if (!input.allTenants && tenantIds.length === 0 && tenantPermissions.length > 0) {
        throw new ValidationError("Pick the tenants where its rights count, or All tenants.");
    }
    return { name, platformPermissions, tenantPermissions, allTenants: input.allTenants, tenantIds };
}

/** "Platform admin", the name of a platform group, or "No platform group", for the audit log and the toasts. */
const ADMIN_LABEL = "Platform admin";
const NONE_LABEL = "No platform group";

export const platformGroupService = {
    /** The platform group of an account as the caps read it, none for an account without one. */
    async shapeOf(userId: string): Promise<{ id: string; shape: PlatformGroupShape } | null> {
        const user = await prisma.user.findUnique({ where: { id: userId }, select: { platformGroup: { select: { id: true, ...SHAPE } } } });
        return user?.platformGroup ? { id: user.platformGroup.id, shape: shapeOf(user.platformGroup) } : null;
    },

    /** Whether the platform group of an account reaches a tenant, which decides the tenants it looks after on the platform. */
    async reaches(userId: string, tenantId: string): Promise<boolean> {
        const own = await this.shapeOf(userId);
        return !!own && (own.shape.allTenants || own.shape.tenantIds.includes(tenantId));
    },

    /** The tenants among these the platform group of an account reaches, the ones it looks after on the platform. */
    async reachedAmong(userId: string, tenantIds: readonly string[]): Promise<string[]> {
        const own = await this.shapeOf(userId);
        if (!own) return [];
        return own.shape.allTenants ? [...tenantIds] : tenantIds.filter((tenantId) => own.shape.tenantIds.includes(tenantId));
    },

    /** Whether the platform group of an account reaches every tenant, the ones made later too. */
    async reachesAll(userId: string): Promise<boolean> {
        return (await this.shapeOf(userId))?.shape.allTenants ?? false;
    },

    /**
     * The tenants an account looks after on the platform, which bounds what its rights of the platform
     * touch: every tenant for a platform admin and a platform group of all tenants, the tenants of its
     * platform group otherwise, none without one. An API key reaches what its owner reaches.
     */
    async reachOf(userId: string): Promise<PlatformReach> {
        const user = await prisma.user.findUnique({ where: { id: userId }, select: { platformRole: true, platformGroup: { select: SHAPE } } });
        if (user?.platformRole === PLATFORM_ADMIN_ROLE) return "all";
        if (!user?.platformGroup) return [];
        const shape = shapeOf(user.platformGroup);
        return shape.allTenants ? "all" : shape.tenantIds;
    },

    /** The accounts that work in a tenant the platform group of an account reaches. */
    async peopleReached(userId: string): Promise<string[]> {
        const own = await this.shapeOf(userId);
        if (!own) return [];
        const users = await prisma.user.findMany({
            where: own.shape.allTenants ? {} : { memberships: { some: { tenantId: { in: [...own.shape.tenantIds] } } } },
            select: { id: true },
        });
        return users.map((user) => user.id);
    },

    /** One platform group as the caps read it, with its name, null when it is gone. */
    async find(id: string): Promise<{ id: string; name: string; shape: PlatformGroupShape } | null> {
        const group = await prisma.platformGroup.findUnique({ where: { id }, select: { id: true, name: true, ...SHAPE } });
        return group ? { id: group.id, name: group.name, shape: shapeOf(group) } : null;
    },

    /** Every platform group with its members and its tenants, by name. */
    async list() {
        const groups = await prisma.platformGroup.findMany({
            orderBy: { name: "asc" },
            select: {
                id: true,
                name: true,
                createdAt: true,
                ...SHAPE,
                members: { select: { id: true, name: true, email: true, image: true }, orderBy: { name: "asc" } },
            },
        });
        return groups.map((group) => ({ id: group.id, name: group.name, createdAt: group.createdAt, members: group.members, ...shapeOf(group) }));
    },

    /** The platform admins, the members of the built-in Platform admin. */
    async platformAdmins() {
        return prisma.user.findMany({ where: { platformRole: PLATFORM_ADMIN_ROLE }, select: { id: true, name: true, email: true, image: true }, orderBy: { name: "asc" } });
    },

    async create(input: PlatformGroupInput) {
        const clean = await cleanInput(input);
        await assertFreeName(clean.name);
        const group = await prisma.platformGroup.create({
            data: {
                name: clean.name,
                platformPermissions: JSON.stringify(clean.platformPermissions),
                tenantPermissions: JSON.stringify(clean.tenantPermissions),
                allTenants: clean.allTenants,
                tenants: { create: clean.tenantIds.map((tenantId) => ({ tenantId })) },
            },
            select: { id: true },
        });
        return { id: group.id, ...clean };
    },

    /** Changes a platform group and says what changed. Its members get every change with their next request. */
    async update(id: string, input: PlatformGroupInput): Promise<PlatformGroupChange> {
        const group = await prisma.platformGroup.findUnique({ where: { id }, select: { name: true, ...SHAPE } });
        if (!group) throw new NotFoundError("Platform group", id);
        const clean = await cleanInput(input);
        await assertFreeName(clean.name, id);
        const before = shapeOf(group);

        await prisma.$transaction([
            prisma.platformGroupTenant.deleteMany({ where: { groupId: id } }),
            prisma.platformGroup.update({
                where: { id },
                data: {
                    name: clean.name,
                    platformPermissions: JSON.stringify(clean.platformPermissions),
                    tenantPermissions: JSON.stringify(clean.tenantPermissions),
                    allTenants: clean.allTenants,
                    tenants: { create: clean.tenantIds.map((tenantId) => ({ tenantId })) },
                },
            }),
        ]);

        const changes = [
            ...areaChanges(new Set(before.platformPermissions), new Set(clean.platformPermissions), PLATFORM_AREAS),
            ...areaChanges(new Set(before.tenantPermissions), new Set(clean.tenantPermissions), PLATFORM_GROUP_TENANT_AREAS),
        ];
        const scopeBefore = scopeText(before);
        const scopeAfter = scopeText(clean);
        const sameTenants = before.allTenants === clean.allTenants && before.tenantIds.length === clean.tenantIds.length && before.tenantIds.every((tenantId) => clean.tenantIds.includes(tenantId));
        return {
            name: clean.name,
            ...(group.name !== clean.name ? { renamedFrom: group.name } : {}),
            areas: changes.map((change) => ({ area: change.area.id, from: change.from, to: change.to })),
            ...(sameTenants ? {} : { changes: [{ field: "Where", from: scopeBefore, to: scopeAfter }] }),
        };
    },

    /** Deletes a platform group. Its members keep their account and their groups in the tenants, and hold no platform group any more. */
    async delete(id: string): Promise<{ name: string; members: number }> {
        const group = await prisma.platformGroup.findUnique({ where: { id }, select: { name: true, _count: { select: { members: true } } } });
        if (!group) throw new NotFoundError("Platform group", id);
        await prisma.platformGroup.delete({ where: { id } });
        return { name: group.name, members: group._count.members };
    },

    /**
     * Gives an account its platform group: none, the built-in Platform admin or another one. Either
     * clears the other, since an account holds one, and the last platform admin stays one.
     */
    async setFor(userId: string, choice: PlatformGroupChoice): Promise<{ from: string; to: string }> {
        return prisma.$transaction(async (tx) => {
            const user = await tx.user.findUnique({ where: { id: userId }, select: { platformRole: true, platformGroup: { select: { name: true } } } });
            if (!user) throw new NotFoundError("User", userId);
            const wasAdmin = user.platformRole === PLATFORM_ADMIN_ROLE;
            const from = wasAdmin ? ADMIN_LABEL : user.platformGroup?.name ?? NONE_LABEL;

            if (wasAdmin && choice.kind !== "admin") {
                const others = await tx.user.count({ where: { platformRole: PLATFORM_ADMIN_ROLE, id: { not: userId } } });
                if (others === 0) throw new ValidationError("The last platform admin stays one.");
            }
            if (choice.kind === "admin") {
                await tx.user.update({ where: { id: userId }, data: { platformRole: PLATFORM_ADMIN_ROLE, platformGroupId: null } });
                return { from, to: ADMIN_LABEL };
            }
            if (choice.kind === "none") {
                await tx.user.update({ where: { id: userId }, data: { platformRole: null, platformGroupId: null } });
                return { from, to: NONE_LABEL };
            }
            const group = await tx.platformGroup.findUnique({ where: { id: choice.id }, select: { name: true } });
            if (!group) throw new ValidationError("The platform group no longer exists.");
            await tx.user.update({ where: { id: userId }, data: { platformRole: null, platformGroupId: choice.id } });
            return { from, to: group.name };
        });
    },

    /** Whether the account is a platform admin and which platform group it holds, for the guards of the actions. */
    async holderOf(userId: string): Promise<{ platformAdmin: boolean; groupId: string | null } | null> {
        const user = await prisma.user.findUnique({ where: { id: userId }, select: { platformRole: true, platformGroupId: true } });
        return user ? { platformAdmin: user.platformRole === PLATFORM_ADMIN_ROLE, groupId: user.platformGroupId } : null;
    },
};
