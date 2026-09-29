import { beforeEach, describe, expect, it, vi } from "vitest";
import { PermissionError } from "@/lib/logging/errors";

const mocks = vi.hoisted(() => ({
    allowed: true,
    viewer: { id: "admin", name: "Ada", email: "ada@example.ch", group: { name: "Admins" } } as { id: string; name: string; email: string; group: { name: string } | null },
    viewerSession: "s-admin",
    service: {
        createUser: vi.fn(),
        isSuperAdminGroup: vi.fn(),
        isSuperAdmin: vi.fn(),
        superAdminsAmong: vi.fn(),
        updateUserGroup: vi.fn(),
        deleteUser: vi.fn(),
        deleteUsers: vi.fn(),
        resetTwoFactor: vi.fn(),
        revokeSession: vi.fn(),
        revokeSessions: vi.fn(),
    },
    setPassword: vi.fn(),
    audit: vi.fn(),
}));

vi.mock("@/lib/auth/access-control", () => ({
    checkPermission: vi.fn(async (permission: string) => {
        if (!mocks.allowed) throw new PermissionError(permission);
    }),
    getCurrentUserWithGroup: vi.fn(async () => mocks.viewer),
}));
vi.mock("@/lib/auth", () => ({ auth: { api: { getSession: vi.fn(async () => ({ session: { id: mocks.viewerSession } })) } } }));
vi.mock("next/headers", () => ({ headers: vi.fn(async () => new Headers()) }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/prisma", () => ({ default: {} }));
vi.mock("@/services/user/user-service", () => ({ userService: mocks.service }));
vi.mock("@/services/auth/auth-service", () => ({ authService: { setPassword: mocks.setPassword } }));
vi.mock("@/services/audit-service", () => ({ auditService: { log: mocks.audit } }));
vi.mock("@/services/notifications/system-notification-service", () => ({ notify: vi.fn(async () => undefined) }));

const { bulkDeleteUsers, createUser, deleteUser, updateUserGroup } = await import("@/app/actions/auth/user");
const { resetUserTwoFactor, revokeUserSession, revokeUserSessions, setUserPassword } = await import("@/app/actions/auth/user-security");

const ADMIN = { id: "admin", name: "Ada", email: "ada@example.ch", group: { name: "Admins" } };
const SUPER = { id: "root", name: "Root", email: "root@example.ch", group: { name: "SuperAdmin" } };

describe("what an admin may do to other users", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.allowed = true;
        mocks.viewer = ADMIN;
        mocks.service.isSuperAdmin.mockResolvedValue(false);
        mocks.service.isSuperAdminGroup.mockResolvedValue(false);
        mocks.service.superAdminsAmong.mockResolvedValue([]);
        mocks.service.createUser.mockResolvedValue({ id: "u-new" });
        mocks.service.deleteUsers.mockImplementation(async (ids: string[]) => ({ succeeded: ids, failed: [] }));
        mocks.service.revokeSessions.mockResolvedValue(2);
    });

    it("creates a user in the picked group", async () => {
        const result = await createUser({ name: "Sara Nguyen", email: "sara@example.ch", password: "correct horse", groupId: "g-view" });

        expect(result).toEqual({ success: true, data: { id: "u-new" } });
        expect(mocks.service.createUser).toHaveBeenCalledWith({ name: "Sara Nguyen", email: "sara@example.ch", password: "correct horse", groupId: "g-view" });
    });

    it("lets only a SuperAdmin make someone a SuperAdmin", async () => {
        mocks.service.isSuperAdminGroup.mockResolvedValue(true);

        const result = await createUser({ name: "Sara Nguyen", email: "sara@example.ch", password: "correct horse", groupId: "g-super" });

        expect(result).toEqual({ success: false, error: "Only a SuperAdmin can make someone a SuperAdmin." });
        expect(mocks.service.createUser).not.toHaveBeenCalled();
    });

    it("lets only a SuperAdmin move a SuperAdmin into another group", async () => {
        mocks.service.isSuperAdmin.mockResolvedValue(true);

        expect(await updateUserGroup("root", "none")).toEqual({ success: false, error: "Only a SuperAdmin can change the group of a SuperAdmin." });
        expect(mocks.service.updateUserGroup).not.toHaveBeenCalled();
    });

    it("never deletes the own account, and a SuperAdmin only for a SuperAdmin", async () => {
        expect(await deleteUser("admin")).toEqual({ success: false, error: "You cannot delete your own account." });

        mocks.service.isSuperAdmin.mockResolvedValue(true);
        expect(await deleteUser("root")).toEqual({ success: false, error: "Only a SuperAdmin can delete a SuperAdmin." });
        expect(mocks.service.deleteUser).not.toHaveBeenCalled();
    });

    it("reports the SuperAdmins and the own account of a bulk delete instead of sending them", async () => {
        mocks.service.superAdminsAmong.mockResolvedValue([{ id: "root", name: "Root" }]);

        const result = await bulkDeleteUsers(["lena", "root", "admin"]);

        expect(mocks.service.deleteUsers).toHaveBeenCalledWith(["lena"]);
        expect(result).toEqual({
            success: true,
            data: {
                succeeded: ["lena"],
                failed: [
                    { id: "admin", name: "Ada", error: "You cannot delete your own account." },
                    { id: "root", name: "Root", error: "Only a SuperAdmin can delete a SuperAdmin." },
                ],
            },
        });
    });

    it("sets a new password, signs the user out everywhere and writes it to the audit log", async () => {
        const result = await setUserPassword("lena", { password: "a new password", signOut: true });

        expect(result).toEqual({ success: true, data: { signedOut: 2 } });
        expect(mocks.setPassword).toHaveBeenCalledWith("lena", "a new password");
        expect(mocks.service.revokeSessions).toHaveBeenCalledWith("lena");
        expect(mocks.audit).toHaveBeenCalledWith("admin", "UPDATE", "USER", { change: "Password Set", signedOut: 2 }, "lena");
    });

    it("keeps the sessions when the admin says so", async () => {
        await setUserPassword("lena", { password: "a new password", signOut: false });

        expect(mocks.service.revokeSessions).not.toHaveBeenCalled();
    });

    it("refuses the own password, a short one and the password of a SuperAdmin", async () => {
        expect(await setUserPassword("admin", { password: "a new password", signOut: true })).toEqual({ success: false, error: "Change your own password under Profile." });
        expect(await setUserPassword("lena", { password: "short", signOut: true })).toEqual({ success: false, error: "The password needs at least 8 characters." });

        mocks.service.isSuperAdmin.mockResolvedValue(true);
        expect(await setUserPassword("root", { password: "a new password", signOut: true })).toEqual({ success: false, error: "Only a SuperAdmin can set the password of a SuperAdmin." });
        expect(mocks.setPassword).not.toHaveBeenCalled();
    });

    it("lets a SuperAdmin set the password of another SuperAdmin", async () => {
        mocks.viewer = SUPER;
        mocks.service.isSuperAdmin.mockResolvedValue(true);

        expect((await setUserPassword("root-2", { password: "a new password", signOut: false })).success).toBe(true);
        expect(mocks.setPassword).toHaveBeenCalledWith("root-2", "a new password");
    });

    it("lets only a SuperAdmin reset the second factor of a SuperAdmin or sign them out", async () => {
        mocks.service.isSuperAdmin.mockResolvedValue(true);

        expect(await resetUserTwoFactor("root-2")).toEqual({ success: false, error: "Only a SuperAdmin can reset the second factor of a SuperAdmin." });
        expect(await revokeUserSessions("root-2")).toEqual({ success: false, error: "Only a SuperAdmin can sign out a SuperAdmin." });
        expect(await revokeUserSession("root-2", "s-root")).toEqual({ success: false, error: "Only a SuperAdmin can sign out a SuperAdmin." });
        expect(mocks.service.resetTwoFactor).not.toHaveBeenCalled();
        expect(mocks.service.revokeSessions).not.toHaveBeenCalled();
        expect(mocks.service.revokeSession).not.toHaveBeenCalled();

        mocks.viewer = SUPER;
        mocks.service.revokeSession.mockResolvedValue(true);
        expect(await resetUserTwoFactor("root-2")).toEqual({ success: true });
        expect(await revokeUserSessions("root-2")).toEqual({ success: true, data: { count: 2 } });
        expect(await revokeUserSession("root-2", "s-root")).toEqual({ success: true });
    });

    it("never ends the session the admin is using", async () => {
        expect(await revokeUserSession("admin", "s-admin")).toEqual({ success: false, error: "This is the session you are using. Sign out from the menu instead." });
        expect(mocks.service.revokeSession).not.toHaveBeenCalled();
    });

    it("needs the permission to change users", async () => {
        mocks.allowed = false;

        await expect(setUserPassword("lena", { password: "a new password", signOut: true })).rejects.toBeInstanceOf(PermissionError);
        await expect(createUser({ name: "Sara Nguyen", email: "sara@example.ch", password: "correct horse", groupId: null })).rejects.toBeInstanceOf(PermissionError);
        expect(mocks.setPassword).not.toHaveBeenCalled();
        expect(mocks.service.createUser).not.toHaveBeenCalled();
    });
});
