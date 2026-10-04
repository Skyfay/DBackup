import { beforeEach, describe, expect, it, vi } from "vitest";
import { PermissionError } from "@/lib/logging/errors";

const mocks = vi.hoisted(() => ({
    denied: new Set<string>(),
    viewer: { id: "admin", name: "Ada", email: "ada@example.ch", group: { name: "Admins" }, groupId: "g-admins" } as { id: string; name: string; email: string; group: { name: string } | null; groupId: string | null },
    groups: { create: vi.fn(), update: vi.fn(), delete: vi.fn(), deleteMany: vi.fn(), membership: vi.fn() },
    users: { isSuperAdminGroup: vi.fn(), superAdminsAmong: vi.fn(), moveUsers: vi.fn() },
    audit: vi.fn(),
}));

vi.mock("@/lib/auth/access-control", () => ({
    checkPermission: vi.fn(async (permission: string) => {
        if (mocks.denied.has(permission)) throw new PermissionError(permission);
    }),
    getCurrentUserWithGroup: vi.fn(async () => mocks.viewer),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/services/user/group-service", () => ({ groupService: mocks.groups }));
vi.mock("@/services/user/user-service", () => ({ userService: mocks.users }));
vi.mock("@/services/audit-service", () => ({ auditService: { log: mocks.audit } }));

const { createGroup, deleteGroup, moveUsersToGroup, updateGroup } = await import("@/app/actions/auth/group");

describe("what may be done to groups and their people", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.denied = new Set();
        mocks.viewer = { id: "admin", name: "Ada", email: "ada@example.ch", group: { name: "Admins" }, groupId: "g-admins" };
        mocks.groups.membership.mockResolvedValue({ exists: true, superAdmin: false, members: 2, includes: false });
        mocks.groups.delete.mockResolvedValue({ name: "Operators", moved: 2 });
        mocks.users.isSuperAdminGroup.mockResolvedValue(false);
        mocks.users.superAdminsAmong.mockResolvedValue([]);
        mocks.users.moveUsers.mockImplementation(async (ids: string[]) => ({ succeeded: ids, failed: [] }));
    });

    it("keeps the template of a new group in the audit log", async () => {
        mocks.groups.create.mockResolvedValue({ id: "g-new", name: "Operators", permissions: ["jobs:read"] });

        expect(await createGroup({ name: "Operators", permissions: ["jobs:read"], template: "operator" })).toEqual({ success: true, data: { id: "g-new" } });
        expect(mocks.audit).toHaveBeenCalledWith("admin", "CREATE", "GROUP", { name: "Operators", permissions: ["jobs:read"], template: "operator" }, "g-new");
    });

    it("writes what an edit changed to the audit log, not the whole list", async () => {
        const change = { name: "Ops", added: ["storage:download"], removed: [], areas: [{ area: "backups", from: "see", to: "use" }] };
        mocks.groups.update.mockResolvedValue(change);

        expect(await updateGroup("g-ops", { name: "Ops", permissions: ["storage:read", "storage:download"] })).toEqual({ success: true });
        expect(mocks.audit).toHaveBeenCalledWith("admin", "UPDATE", "GROUP", change, "g-ops");
    });

    it("never changes the group of the one who changes it, which would hand them any permission", async () => {
        expect(await updateGroup("g-admins", { name: "Admins", permissions: ["settings:write", "users:write"] })).toEqual({
            success: false,
            error: "You are in this group. Another admin changes it.",
        });
        expect(mocks.groups.update).not.toHaveBeenCalled();
        expect(mocks.audit).not.toHaveBeenCalled();
    });

    it("deletes a group and moves its members to the picked one", async () => {
        expect(await deleteGroup("g-ops", "g-view")).toEqual({ success: true, data: { moved: 2 } });
        expect(mocks.groups.delete).toHaveBeenCalledWith("g-ops", "g-view");
        expect(mocks.audit).toHaveBeenCalledWith("admin", "DELETE", "GROUP", { name: "Operators", moved: 2, moveTo: "g-view" }, "g-ops");
    });

    it("never deletes the group of the one who deletes", async () => {
        mocks.groups.membership.mockResolvedValue({ exists: true, superAdmin: false, members: 2, includes: true });

        expect(await deleteGroup("g-admins", null)).toEqual({ success: false, error: "You are in this group. Another admin deletes it." });
        expect(mocks.groups.delete).not.toHaveBeenCalled();
    });

    it("lets only a SuperAdmin move members into the SuperAdmin group", async () => {
        mocks.users.isSuperAdminGroup.mockResolvedValue(true);

        expect(await deleteGroup("g-ops", "g-super")).toEqual({ success: false, error: "Only a SuperAdmin can make someone a SuperAdmin." });
        expect(await moveUsersToGroup(["lena"], "g-super")).toEqual({ success: false, error: "Only a SuperAdmin can make someone a SuperAdmin." });
        expect(mocks.groups.delete).not.toHaveBeenCalled();
        expect(mocks.users.moveUsers).not.toHaveBeenCalled();
    });

    it("moves people but reports the own account and the SuperAdmins", async () => {
        mocks.users.superAdminsAmong.mockResolvedValue([{ id: "root", name: "Root" }]);

        const result = await moveUsersToGroup(["lena", "admin", "root"], "g-view");

        expect(mocks.users.moveUsers).toHaveBeenCalledWith(["lena"], "g-view");
        expect(result).toEqual({
            success: true,
            data: {
                succeeded: ["lena"],
                failed: [
                    { id: "admin", name: "Ada", error: "You cannot change your own group." },
                    { id: "root", name: "Root", error: "Only a SuperAdmin can change the group of a SuperAdmin." },
                ],
            },
        });
        expect(mocks.audit).toHaveBeenCalledWith("admin", "UPDATE", "USER", { change: "Updating Group", groupId: "g-view" }, "lena");
    });

    it("needs the right to change groups, and to change users for moving people", async () => {
        mocks.denied = new Set(["groups:write", "users:write"]);

        await expect(deleteGroup("g-ops", null)).rejects.toBeInstanceOf(PermissionError);
        await expect(moveUsersToGroup(["lena"], null)).rejects.toBeInstanceOf(PermissionError);
        expect(mocks.groups.delete).not.toHaveBeenCalled();
        expect(mocks.users.moveUsers).not.toHaveBeenCalled();
    });
});
