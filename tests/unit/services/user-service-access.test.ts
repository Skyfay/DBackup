import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
    prisma: {
        group: { findUnique: vi.fn() },
        user: { findUnique: vi.fn(), findMany: vi.fn(), update: vi.fn() },
        session: { deleteMany: vi.fn() },
        $transaction: vi.fn(async (operations: Promise<unknown>[]) => Promise.all(operations)),
    },
    createUser: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({ default: mocks.prisma }));
vi.mock("@/services/auth/auth-service", () => ({ authService: { createUser: mocks.createUser } }));

const { userService } = await import("@/services/user/user-service");

describe("creating a user and ending their sessions", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.createUser.mockResolvedValue({ token: "t", user: { id: "u-new", name: "Sara Nguyen" } });
        mocks.prisma.session.deleteMany.mockResolvedValue({ count: 1 });
    });

    it("puts a new user into the picked group and ends the session Better Auth opened on the server", async () => {
        mocks.prisma.group.findUnique.mockResolvedValue({ id: "g-view" });

        const created = await userService.createUser({ name: "Sara Nguyen", email: "sara@example.ch", password: "correct horse", groupId: "g-view" });

        expect(created.id).toBe("u-new");
        expect(mocks.prisma.session.deleteMany).toHaveBeenCalledWith({ where: { userId: "u-new" } });
        expect(mocks.prisma.user.update).toHaveBeenCalledWith({ where: { id: "u-new" }, data: { groupId: "g-view" } });
    });

    it("creates a user without a group when none is picked", async () => {
        await userService.createUser({ name: "Sara Nguyen", email: "sara@example.ch", password: "correct horse", groupId: null });

        expect(mocks.prisma.user.update).not.toHaveBeenCalled();
        expect(mocks.prisma.session.deleteMany).toHaveBeenCalledWith({ where: { userId: "u-new" } });
    });

    it("refuses a group that no longer exists before creating anyone", async () => {
        mocks.prisma.group.findUnique.mockResolvedValue(null);

        await expect(userService.createUser({ name: "Sara Nguyen", email: "sara@example.ch", password: "correct horse", groupId: "gone" })).rejects.toThrow("The group no longer exists.");
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

    it("knows the SuperAdmin group and its members", async () => {
        mocks.prisma.group.findUnique.mockResolvedValue({ name: "SuperAdmin" });
        mocks.prisma.user.findMany.mockResolvedValue([{ id: "manu", name: "", email: "manu@example.ch" }]);

        expect(await userService.isSuperAdminGroup("g-super")).toBe(true);
        expect(await userService.isSuperAdminGroup("none")).toBe(false);
        expect(await userService.superAdminsAmong(["manu", "lena"])).toEqual([{ id: "manu", name: "manu@example.ch" }]);
    });
});
