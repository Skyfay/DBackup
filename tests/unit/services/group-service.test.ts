import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
    prisma: {
        group: { findUnique: vi.fn(), findMany: vi.fn(), create: vi.fn(), update: vi.fn(), delete: vi.fn(), deleteMany: vi.fn() },
        user: { updateMany: vi.fn() },
        ssoProvider: { updateMany: vi.fn() },
        // A list of queries, or a function that gets the client, like Prisma.
        $transaction: vi.fn(async (operations: Promise<unknown>[] | ((tx: unknown) => Promise<unknown>)): Promise<unknown> =>
            typeof operations === "function" ? operations(mocks.prisma) : Promise.all(operations)
        ),
    },
}));

vi.mock("@/lib/prisma", () => ({ default: mocks.prisma }));

const { groupService } = await import("@/services/user/group-service");

describe("making, changing and deleting groups", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.prisma.group.create.mockImplementation(async ({ data }: { data: { name: string } }) => ({ id: "g-new", ...data }));
        mocks.prisma.user.updateMany.mockResolvedValue({ count: 2 });
        mocks.prisma.group.delete.mockResolvedValue({});
    });

    it("stores only the permissions DBackup knows", async () => {
        mocks.prisma.group.findUnique.mockResolvedValue(null);

        const created = await groupService.create({ name: " Ops ", permissions: ["jobs:read", "made:up"] });

        expect(created).toEqual({ id: "g-new", name: "Ops", permissions: ["jobs:read"] });
        expect(mocks.prisma.group.create).toHaveBeenCalledWith({ data: { name: "Ops", permissions: JSON.stringify(["jobs:read"]) } });
    });

    it("refuses a name another group has", async () => {
        mocks.prisma.group.findUnique.mockResolvedValue({ id: "g-other" });

        await expect(groupService.create({ name: "Viewers", permissions: [] })).rejects.toThrow('A group with the name "Viewers" already exists.');
    });

    it("says what an edit changed, down to the level of each area", async () => {
        mocks.prisma.group.findUnique.mockImplementation(async ({ where }: { where: { id?: string; name?: string } }) =>
            where.id ? { id: "g-ops", name: "Operators", permissions: JSON.stringify(["storage:read", "templates:read"]) } : null
        );

        const change = await groupService.update("g-ops", { name: "Ops", permissions: ["storage:read", "storage:download", "storage:restore", "templates:read"] });

        expect(change).toEqual({
            name: "Ops",
            renamedFrom: "Operators",
            added: ["storage:download", "storage:restore"],
            removed: [],
            areas: [{ area: "backups", from: "see", to: "use" }],
        });
    });

    it("never edits or deletes the SuperAdmin group", async () => {
        mocks.prisma.group.findUnique.mockResolvedValue({ id: "g-super", name: "SuperAdmin", permissions: "[]" });

        await expect(groupService.update("g-super", { name: "SuperAdmin", permissions: [] })).rejects.toThrow("The SuperAdmin group cannot be edited.");
        await expect(groupService.delete("g-super", null)).rejects.toThrow("The SuperAdmin group cannot be deleted.");
    });

    it("moves the members to the picked group in the same step as the delete", async () => {
        mocks.prisma.group.findUnique.mockImplementation(async ({ where }: { where: { id: string } }) => ({ id: where.id, name: where.id === "g-ops" ? "Operators" : "Viewers" }));

        const result = await groupService.delete("g-ops", "g-view");

        expect(result).toEqual({ name: "Operators", moved: 2 });
        expect(mocks.prisma.$transaction).toHaveBeenCalledTimes(1);
        expect(mocks.prisma.user.updateMany).toHaveBeenCalledWith({ where: { groupId: "g-ops" }, data: { groupId: "g-view" } });
        expect(mocks.prisma.group.delete).toHaveBeenCalledWith({ where: { id: "g-ops" } });
    });

    it("sends the new people of a sign-in provider where the members go", async () => {
        mocks.prisma.group.findUnique.mockImplementation(async ({ where }: { where: { id: string } }) => ({ id: where.id, name: where.id === "g-ops" ? "Operators" : "Viewers" }));

        await groupService.delete("g-ops", "g-view");
        await groupService.delete("g-ops", null);

        expect(mocks.prisma.ssoProvider.updateMany).toHaveBeenNthCalledWith(1, { where: { defaultGroupId: "g-ops" }, data: { defaultGroupId: "g-view" } });
        expect(mocks.prisma.ssoProvider.updateMany).toHaveBeenNthCalledWith(2, { where: { defaultGroupId: "g-ops" }, data: { defaultGroupId: null } });
    });

    it("refuses to move the members into the group that is deleted, or into one that is gone", async () => {
        mocks.prisma.group.findUnique.mockImplementation(async ({ where }: { where: { id: string } }) => (where.id === "g-ops" ? { id: "g-ops", name: "Operators" } : null));

        await expect(groupService.delete("g-ops", "g-ops")).rejects.toThrow("Pick another group for its members.");
        await expect(groupService.delete("g-ops", "g-gone")).rejects.toThrow("The group for the members no longer exists.");
        expect(mocks.prisma.group.delete).not.toHaveBeenCalled();
    });

    it("deletes several groups only while nobody is in them", async () => {
        mocks.prisma.group.findMany.mockResolvedValue([
            { id: "g-empty", name: "Empty" },
            { id: "g-ops", name: "Operators" },
            { id: "g-super", name: "SuperAdmin" },
        ]);
        mocks.prisma.group.deleteMany.mockImplementation(async ({ where }: { where: { id: string } }) => ({ count: where.id === "g-empty" ? 1 : 0 }));

        const result = await groupService.deleteMany(["g-empty", "g-ops", "g-super"]);

        expect(result.succeeded).toEqual(["g-empty"]);
        expect(result.failed.map((failure) => [failure.id, failure.error])).toEqual([
            ["g-ops", "People are in it. Delete it on its own to move them to another group."],
            ["g-super", "The SuperAdmin group cannot be deleted."],
        ]);
        expect(mocks.prisma.group.deleteMany).toHaveBeenCalledWith({ where: { id: "g-empty", users: { none: {} } } });
        // Only the group that went is cleared as the group of new people of a provider.
        expect(mocks.prisma.ssoProvider.updateMany).toHaveBeenCalledTimes(1);
        expect(mocks.prisma.ssoProvider.updateMany).toHaveBeenCalledWith({ where: { defaultGroupId: "g-empty" }, data: { defaultGroupId: null } });
    });
});
