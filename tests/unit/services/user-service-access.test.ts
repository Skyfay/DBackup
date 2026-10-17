import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
    prisma: {
        group: { findUnique: vi.fn() },
        tenant: { findUnique: vi.fn() },
        user: { findUnique: vi.fn(), findMany: vi.fn(), update: vi.fn() },
        session: { deleteMany: vi.fn() },
        tenantMembership: { create: vi.fn() },
        $transaction: vi.fn(async (operations: Promise<unknown>[]) => Promise.all(operations)),
    },
    createUser: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({ default: mocks.prisma }));
vi.mock("@/services/auth/auth-service", () => ({ authService: { createUser: mocks.createUser } }));

const { userService } = await import("@/services/user/user-service");
const { membershipService } = await import("@/services/tenant/membership-service");

describe("creating a user and ending their sessions", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.createUser.mockResolvedValue({ token: "t", user: { id: "u-new", name: "Sara Nguyen" } });
        mocks.prisma.session.deleteMany.mockResolvedValue({ count: 1 });
        mocks.prisma.tenantMembership.create.mockResolvedValue({});
        mocks.prisma.tenant.findUnique.mockImplementation(async ({ where }: { where: { id: string } }) => ({ id: where.id }));
    });

    it("puts a new user into the picked group of the tenant and ends the session Better Auth opened on the server", async () => {
        mocks.prisma.group.findUnique.mockResolvedValue({ id: "g-view" });

        const created = await userService.createUser({ name: "Sara Nguyen", email: "sara@example.ch", password: "correct horse", groupId: "g-view", tenantId: "tenant-a" });

        expect(created.id).toBe("u-new");
        expect(mocks.prisma.session.deleteMany).toHaveBeenCalledWith({ where: { userId: "u-new" } });
        expect(mocks.prisma.tenantMembership.create).toHaveBeenCalledWith({ data: { userId: "u-new", tenantId: "tenant-a", groupId: "g-view" } });
    });

    it("creates a user without a group in the home tenant when none is picked", async () => {
        await userService.createUser({ name: "Sara Nguyen", email: "sara@example.ch", password: "correct horse", groupId: null, tenantId: "default" });

        expect(mocks.prisma.tenantMembership.create).not.toHaveBeenCalled();
        expect(mocks.prisma.session.deleteMany).toHaveBeenCalledWith({ where: { userId: "u-new" } });
    });

    it("needs a group for a new user of another tenant, where an account without one would vanish from the list", async () => {
        await expect(userService.createUser({ name: "Sara Nguyen", email: "sara@example.ch", password: "correct horse", groupId: null, tenantId: "tenant-a" }))
            .rejects.toThrow("Pick the group the person works with in this tenant.");
        expect(mocks.createUser).not.toHaveBeenCalled();
    });

    it("refuses a tenant that is gone, which a platform admin picked in All tenants, before creating anyone", async () => {
        mocks.prisma.group.findUnique.mockResolvedValue({ id: "g-view" });
        mocks.prisma.tenant.findUnique.mockResolvedValue(null);

        await expect(userService.createUser({ name: "Sara Nguyen", email: "sara@example.ch", password: "correct horse", groupId: "g-view", tenantId: "tenant-gone" }))
            .rejects.toThrow("The tenant no longer exists.");
        expect(mocks.createUser).not.toHaveBeenCalled();
    });

    it("refuses a group that no longer exists before creating anyone", async () => {
        mocks.prisma.group.findUnique.mockResolvedValue(null);

        await expect(userService.createUser({ name: "Sara Nguyen", email: "sara@example.ch", password: "correct horse", groupId: "gone", tenantId: "tenant-a" })).rejects.toThrow("The group no longer exists.");
        expect(mocks.createUser).not.toHaveBeenCalled();
    });

    it("ends one session only when it belongs to the user", async () => {
        mocks.prisma.session.deleteMany.mockResolvedValueOnce({ count: 0 });

        expect(await userService.revokeSession("lena", "s-of-tom")).toBe(false);
        expect(mocks.prisma.session.deleteMany).toHaveBeenCalledWith({ where: { id: "s-of-tom", userId: "lena" } });
    });

    it("keeps the session of the viewer when they sign themselves out elsewhere", async () => {
        mocks.prisma.session.deleteMany.mockResolvedValueOnce({ count: 2 });

        expect(await userService.revokeSessions("manu", "s-here")).toBe(2);
        expect(mocks.prisma.session.deleteMany).toHaveBeenCalledWith({ where: { userId: "manu", id: { not: "s-here" } } });
    });

    it("knows the platform admins among some accounts", async () => {
        mocks.prisma.user.findMany.mockResolvedValue([{ id: "manu", name: "", email: "manu@example.ch" }]);
        mocks.prisma.user.findUnique.mockResolvedValueOnce({ platformRole: "ADMIN" }).mockResolvedValueOnce({ platformRole: null });

        expect(await membershipService.platformAdminsAmong(["manu", "lena"])).toEqual([{ id: "manu", name: "manu@example.ch" }]);
        expect(mocks.prisma.user.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { id: { in: ["manu", "lena"] }, platformRole: "ADMIN" } }));
        expect(await membershipService.isPlatformAdmin("manu")).toBe(true);
        expect(await membershipService.isPlatformAdmin("lena")).toBe(false);
    });

    it("knows whose an account is, which decides who may change it", async () => {
        mocks.prisma.user.findUnique
            .mockResolvedValueOnce({ platformRole: null, memberships: [{ tenantId: "default" }, { tenantId: "tenant-a" }] })
            .mockResolvedValueOnce({ platformRole: "ADMIN", memberships: [] })
            .mockResolvedValueOnce(null);

        expect(await userService.accountOf("tech")).toEqual({ isPlatformAdmin: false, tenantIds: ["default", "tenant-a"], platformGroup: null });
        expect(await userService.accountOf("root")).toEqual({ isPlatformAdmin: true, tenantIds: [], platformGroup: null });
        expect(await userService.accountOf("gone")).toBeNull();
    });
});
