import { beforeEach, describe, expect, it, vi } from "vitest";
import { AVAILABLE_PERMISSIONS } from "@/lib/auth/permissions";

const mocks = vi.hoisted(() => ({
    prisma: {
        group: { findUnique: vi.fn(), findFirst: vi.fn(), findMany: vi.fn(), create: vi.fn(), update: vi.fn(), delete: vi.fn(), deleteMany: vi.fn() },
        tenantMembership: { updateMany: vi.fn(), deleteMany: vi.fn(), findMany: vi.fn() },
        tenant: { findMany: vi.fn() },
        ssoProvider: { updateMany: vi.fn() },
        // A list of queries, or a function that gets the client, like Prisma.
        $transaction: vi.fn(async (operations: Promise<unknown>[] | ((tx: unknown) => Promise<unknown>)): Promise<unknown> =>
            typeof operations === "function" ? operations(mocks.prisma) : Promise.all(operations)
        ),
    },
}));

vi.mock("@/lib/prisma", () => ({ default: mocks.prisma }));

const { ensureFullAccessGroup, groupService } = await import("@/services/user/group-service");

/** Who changes a group: the admin of a tenant, held by the guard that keeps a manager, or a platform admin, who manages every tenant. */
const TENANT_ADMIN = { platformAdmin: false };
const PLATFORM_ADMIN = { platformAdmin: true };

describe("making, changing and deleting groups", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.prisma.group.create.mockImplementation(async ({ data }: { data: { name: string } }) => ({ id: "g-new", ...data }));
        // No other group of the tenant has the name unless a test says so.
        mocks.prisma.group.findFirst.mockResolvedValue(null);
        mocks.prisma.tenantMembership.updateMany.mockResolvedValue({ count: 2 });
        mocks.prisma.tenantMembership.deleteMany.mockResolvedValue({ count: 2 });
        mocks.prisma.group.delete.mockResolvedValue({});
    });

    it("stores only the permissions DBackup knows", async () => {
        mocks.prisma.group.findUnique.mockResolvedValue(null);

        const created = await groupService.create({ name: " Ops ", permissions: ["jobs:read", "made:up"] });

        expect(created).toEqual({ id: "g-new", name: "Ops", permissions: ["jobs:read"] });
        expect(mocks.prisma.group.create).toHaveBeenCalledWith({ data: { name: "Ops", permissions: JSON.stringify(["jobs:read"]) } });
    });

    it("refuses a name another group of the tenant has", async () => {
        mocks.prisma.group.findFirst.mockResolvedValue({ id: "g-other" });

        await expect(groupService.create({ name: "Viewers", permissions: [] })).rejects.toThrow('A group with the name "Viewers" already exists.');
    });

    it("says what an edit changed, down to the level of each area", async () => {
        mocks.prisma.group.findUnique.mockImplementation(async ({ where }: { where: { id?: string; name?: string } }) =>
            where.id ? { id: "g-ops", name: "Operators", permissions: JSON.stringify(["storage:read", "templates:read"]), fullAccess: false } : null
        );

        const change = await groupService.update("g-ops", { name: "Ops", permissions: ["storage:read", "storage:download", "storage:restore", "templates:read"] }, TENANT_ADMIN);

        expect(change).toEqual({
            name: "Ops",
            renamedFrom: "Operators",
            added: ["storage:download", "storage:restore"],
            removed: [],
            areas: [{ area: "backups", from: "see", to: "use" }],
        });
    });

    it("never edits or deletes the full access group", async () => {
        mocks.prisma.group.findUnique.mockResolvedValue({ id: "g-full", name: "Admin", permissions: "[]", fullAccess: true });

        await expect(groupService.update("g-full", { name: "Admin", permissions: [] }, TENANT_ADMIN)).rejects.toThrow("Admin holds every permission and cannot be edited.");
        await expect(groupService.delete("g-full", null, TENANT_ADMIN)).rejects.toThrow("Admin holds every permission and cannot be deleted.");
        expect(mocks.prisma.group.update).not.toHaveBeenCalled();
        expect(mocks.prisma.group.delete).not.toHaveBeenCalled();
    });

    it("protects a group by its full access, never by its name", async () => {
        // A group called SuperAdmin by an earlier version that holds less is a group like any other.
        mocks.prisma.group.findUnique.mockImplementation(async ({ where }: { where: { id?: string; name?: string } }) =>
            where.id ? { id: "g-old", name: "SuperAdmin", permissions: JSON.stringify(["jobs:read"]), fullAccess: false } : null
        );

        await expect(groupService.update("g-old", { name: "SuperAdmin", permissions: ["jobs:read", "jobs:execute"] }, TENANT_ADMIN)).resolves.toMatchObject({ added: ["jobs:execute"] });
        expect(mocks.prisma.group.update).toHaveBeenCalled();
    });

    it("moves the members to the picked group in every tenant, in the same step as the delete", async () => {
        mocks.prisma.group.findUnique.mockImplementation(async ({ where }: { where: { id: string } }) => ({ id: where.id, name: where.id === "g-ops" ? "Operators" : "Viewers", fullAccess: false }));

        const result = await groupService.delete("g-ops", "g-view", TENANT_ADMIN);

        expect(result).toEqual({ name: "Operators", moved: 2 });
        expect(mocks.prisma.$transaction).toHaveBeenCalledTimes(1);
        expect(mocks.prisma.tenantMembership.updateMany).toHaveBeenCalledWith({ where: { groupId: "g-ops" }, data: { groupId: "g-view" } });
        expect(mocks.prisma.group.delete).toHaveBeenCalledWith({ where: { id: "g-ops" } });
    });

    it("ends the memberships of the group when its members go to no group", async () => {
        mocks.prisma.group.findUnique.mockResolvedValue({ id: "g-ops", name: "Operators", fullAccess: false });

        expect(await groupService.delete("g-ops", null, TENANT_ADMIN)).toEqual({ name: "Operators", moved: 2 });
        expect(mocks.prisma.tenantMembership.deleteMany).toHaveBeenCalledWith({ where: { groupId: "g-ops" } });
        expect(mocks.prisma.tenantMembership.updateMany).not.toHaveBeenCalled();
    });

    it("sends the new people of a sign-in provider where the members go", async () => {
        mocks.prisma.group.findUnique.mockImplementation(async ({ where }: { where: { id: string } }) => ({ id: where.id, name: where.id === "g-ops" ? "Operators" : "Viewers", fullAccess: false }));

        await groupService.delete("g-ops", "g-view", TENANT_ADMIN);
        await groupService.delete("g-ops", null, TENANT_ADMIN);

        expect(mocks.prisma.ssoProvider.updateMany).toHaveBeenNthCalledWith(1, { where: { defaultGroupId: "g-ops" }, data: { defaultGroupId: "g-view" } });
        expect(mocks.prisma.ssoProvider.updateMany).toHaveBeenNthCalledWith(2, { where: { defaultGroupId: "g-ops" }, data: { defaultGroupId: null } });
    });

    it("refuses to move the members into the group that is deleted, or into one that is gone", async () => {
        mocks.prisma.group.findUnique.mockImplementation(async ({ where }: { where: { id: string } }) => (where.id === "g-ops" ? { id: "g-ops", name: "Operators", fullAccess: false } : null));

        await expect(groupService.delete("g-ops", "g-ops", TENANT_ADMIN)).rejects.toThrow("Pick another group for its members.");
        await expect(groupService.delete("g-ops", "g-gone", TENANT_ADMIN)).rejects.toThrow("The group for the members no longer exists.");
        expect(mocks.prisma.group.delete).not.toHaveBeenCalled();
    });

    describe("the people who manage the members of a tenant", () => {
        const MANAGERS = { id: "g-managers", name: "Managers", permissions: JSON.stringify(["users:read", "users:write"]), fullAccess: false };
        const VIEWERS = { permissions: JSON.stringify(["users:read"]), fullAccess: false };

        /** Acme's members are managed by this group alone, Globex has another manager too. */
        function memberships() {
            mocks.prisma.tenantMembership.findMany.mockImplementation(async ({ where }: { where: { groupId?: unknown } }) =>
                typeof where.groupId === "string"
                    ? [{ tenantId: "acme" }, { tenantId: "globex" }]
                    : [{ tenantId: "acme", group: VIEWERS }, { tenantId: "globex", group: { permissions: "[]", fullAccess: true } }]
            );
            mocks.prisma.tenant.findMany.mockResolvedValue([{ name: "Acme GmbH" }]);
        }

        it("keeps the right to manage users in the only group that manages the members of a tenant", async () => {
            memberships();
            mocks.prisma.group.findUnique.mockResolvedValueOnce(MANAGERS);
            mocks.prisma.group.findFirst.mockResolvedValueOnce(null);

            await expect(groupService.update("g-managers", { name: "Managers", permissions: ["users:read"] }, TENANT_ADMIN)).rejects.toThrow("Nobody would manage the members of Acme GmbH any more");
            expect(mocks.prisma.group.update).not.toHaveBeenCalled();
        });

        it("refuses to delete it when its members would go to a group that cannot manage them", async () => {
            memberships();
            mocks.prisma.group.findUnique.mockImplementation(async ({ where }: { where: { id?: string } }) => (where.id === "g-managers" ? MANAGERS : VIEWERS));

            await expect(groupService.delete("g-managers", "g-viewers", TENANT_ADMIN)).rejects.toThrow("Acme GmbH");
            await expect(groupService.delete("g-managers", null, TENANT_ADMIN)).rejects.toThrow("Acme GmbH");
            expect(mocks.prisma.group.delete).not.toHaveBeenCalled();
        });

        it("lets a platform admin take the right away or delete the group, since they manage every tenant", async () => {
            memberships();
            mocks.prisma.group.findUnique.mockImplementation(async ({ where }: { where: { id?: string } }) => (where.id === "g-managers" ? MANAGERS : VIEWERS));

            await expect(groupService.update("g-managers", { name: "Managers", permissions: ["users:read"] }, PLATFORM_ADMIN)).resolves.toMatchObject({ removed: ["users:write"] });
            await expect(groupService.delete("g-managers", null, PLATFORM_ADMIN)).resolves.toMatchObject({ name: "Managers" });
            expect(mocks.prisma.tenantMembership.findMany).not.toHaveBeenCalled();
            expect(mocks.prisma.group.delete).toHaveBeenCalledWith({ where: { id: "g-managers" } });
        });

        it("lets it go when its members move to a group that manages them too", async () => {
            memberships();
            mocks.prisma.group.findUnique.mockImplementation(async ({ where }: { where: { id?: string } }) =>
                where.id === "g-managers" ? MANAGERS : { permissions: JSON.stringify(["users:write"]), fullAccess: false });

            await expect(groupService.delete("g-managers", "g-leads", TENANT_ADMIN)).resolves.toMatchObject({ name: "Managers" });
            expect(mocks.prisma.tenantMembership.findMany).not.toHaveBeenCalled();
        });
    });

    it("deletes several groups only while nobody is in them", async () => {
        mocks.prisma.group.findMany.mockResolvedValue([
            { id: "g-empty", name: "Empty", fullAccess: false },
            { id: "g-ops", name: "Operators", fullAccess: false },
            { id: "g-full", name: "Admin", fullAccess: true },
        ]);
        mocks.prisma.group.deleteMany.mockImplementation(async ({ where }: { where: { id: string } }) => ({ count: where.id === "g-empty" ? 1 : 0 }));

        const result = await groupService.deleteMany(["g-empty", "g-ops", "g-full"]);

        expect(result.succeeded).toEqual(["g-empty"]);
        expect(result.failed.map((failure) => [failure.id, failure.error])).toEqual([
            ["g-ops", "People are in it. Delete it on its own to move them to another group."],
            ["g-full", "Admin holds every permission and cannot be deleted."],
        ]);
        // Members of any tenant keep a group.
        expect(mocks.prisma.group.deleteMany).toHaveBeenCalledWith({ where: { id: "g-empty", memberships: { none: {} } } });
        // Only the group that went is cleared as the group of new people of a provider.
        expect(mocks.prisma.ssoProvider.updateMany).toHaveBeenCalledTimes(1);
        expect(mocks.prisma.ssoProvider.updateMany).toHaveBeenCalledWith({ where: { defaultGroupId: "g-empty" }, data: { defaultGroupId: null } });
    });

    it("counts the members of a group in one tenant and knows whether the viewer is one", async () => {
        mocks.prisma.group.findUnique.mockResolvedValue({ fullAccess: false, memberships: [{ userId: "lena" }, { userId: "tom" }] });

        expect(await groupService.membership("g-ops", "tenant-a", "lena")).toEqual({ exists: true, fullAccess: false, members: 2, includes: true });
        expect(mocks.prisma.group.findUnique).toHaveBeenCalledWith({
            where: { id: "g-ops" },
            select: { fullAccess: true, memberships: { where: { tenantId: "tenant-a" }, select: { userId: true } } },
        });
        expect((await groupService.membership("g-ops", "tenant-a", "manu")).includes).toBe(false);

        mocks.prisma.group.findUnique.mockResolvedValue(null);
        expect(await groupService.membership("g-gone", "tenant-a", "lena")).toEqual({ exists: false, fullAccess: false, members: 0, includes: false });
    });

    it("finds the full access group the first account gets, and makes none when it exists", async () => {
        mocks.prisma.group.findFirst.mockResolvedValue({ id: "g-full" });

        expect(await ensureFullAccessGroup()).toBe("g-full");
        expect(mocks.prisma.group.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { fullAccess: true } }));
        expect(mocks.prisma.group.create).not.toHaveBeenCalled();
    });

    it("makes the full access group with every permission when none is left, beside an ordinary group called Admin", async () => {
        mocks.prisma.group.findFirst.mockResolvedValue(null);
        mocks.prisma.group.findMany.mockResolvedValue([]);

        expect(await ensureFullAccessGroup()).toBe("g-new");
        expect(mocks.prisma.group.create).toHaveBeenCalledWith(expect.objectContaining({
            data: { name: "Admin", fullAccess: true, permissions: JSON.stringify(AVAILABLE_PERMISSIONS.map((permission) => permission.id)) },
        }));

        // A name is unique, so an ordinary group called Admin keeps its name.
        mocks.prisma.group.findMany.mockResolvedValue([{ name: "Admin" }]);
        await ensureFullAccessGroup();
        expect(mocks.prisma.group.create).toHaveBeenLastCalledWith(expect.objectContaining({ data: expect.objectContaining({ name: "Admin (full access)", fullAccess: true }) }));
    });
});
