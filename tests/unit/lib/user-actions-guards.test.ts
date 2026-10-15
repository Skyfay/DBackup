import { beforeEach, describe, expect, it, vi } from "vitest";
import { PermissionError, ValidationError } from "@/lib/logging/errors";
import { AVAILABLE_PERMISSIONS, PERMISSIONS } from "@/lib/auth/permissions";
import { HOME_TENANT_ID } from "@/lib/tenant/home";

interface TestViewer {
    id: string;
    name: string;
    email: string;
    isPlatformAdmin: boolean;
    tenantId: string | null;
    permissions: string[];
    role: { id: string; name: string } | null;
    allTenants?: boolean;
}

interface TestGroup {
    id: string;
    name: string;
    permissions: string;
    fullAccess: boolean;
}

const mocks = vi.hoisted(() => ({
    allowed: true,
    mayChangeSettings: true,
    viewer: null as unknown as TestViewer,
    viewerSession: "s-admin",
    service: {
        createUser: vi.fn(),
        accountOf: vi.fn(),
        namesOf: vi.fn(),
        deleteUser: vi.fn(),
        deleteUsers: vi.fn(),
        resetTwoFactor: vi.fn(),
        revokeSession: vi.fn(),
        revokeSessions: vi.fn(),
        permissionsIn: vi.fn(),
    },
    groups: { find: vi.fn() },
    memberships: { setRole: vi.fn(), roleOf: vi.fn() },
    setPassword: vi.fn(),
    audit: vi.fn(),
}));

vi.mock("@/lib/auth/access-control", () => ({
    checkPermission: vi.fn(async (permission: string) => {
        if (!mocks.allowed) throw new PermissionError(permission);
        return mocks.viewer;
    }),
    getViewer: vi.fn(async () => mocks.viewer),
    hasPermission: vi.fn(async () => mocks.mayChangeSettings),
    // A platform admin passes everything inside a tenant, like the real check.
    hasPermissionWithContext: (viewer: TestViewer, permission: string) => (viewer.isPlatformAdmin && !viewer.allTenants) || viewer.permissions.includes(permission),
    currentSessionId: vi.fn(async () => mocks.viewerSession),
}));
vi.mock("@/lib/auth", () => ({ auth: { api: { getSession: vi.fn(async () => ({ session: { id: mocks.viewerSession } })) } } }));
vi.mock("next/headers", () => ({ headers: vi.fn(async () => new Headers()) }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/prisma", () => ({ default: {} }));
vi.mock("@/services/user/user-service", () => ({ userService: mocks.service }));
vi.mock("@/services/user/group-service", () => ({ groupService: mocks.groups }));
vi.mock("@/services/tenant/membership-service", () => ({ membershipService: mocks.memberships }));
vi.mock("@/services/auth/auth-service", () => ({ authService: { setPassword: mocks.setPassword } }));
vi.mock("@/services/audit-service", () => ({ auditService: { log: mocks.audit } }));
vi.mock("@/services/notifications/system-notification-service", () => ({ notify: vi.fn(async () => undefined) }));

const { bulkDeleteUsers, createUser, deleteUser, updateUserGroup } = await import("@/app/actions/auth/user");
const { resetUserTwoFactor, revokeUserSession, revokeUserSessions, setUserPassword } = await import("@/app/actions/auth/user-security");

/** Manages the users of the home tenant, without every permission. */
const ADMIN: TestViewer = {
    id: "admin",
    name: "Ada",
    email: "ada@example.ch",
    isPlatformAdmin: false,
    tenantId: HOME_TENANT_ID,
    permissions: [PERMISSIONS.USERS.READ, PERMISSIONS.USERS.WRITE, PERMISSIONS.JOBS.READ, PERMISSIONS.HISTORY.READ],
    role: { id: "g-admins", name: "Admins" },
};
const PLATFORM_ADMIN: TestViewer = {
    id: "root",
    name: "Root",
    email: "root@example.ch",
    isPlatformAdmin: true,
    tenantId: HOME_TENANT_ID,
    permissions: AVAILABLE_PERMISSIONS.map((permission) => permission.id),
    role: null,
};
/** Manages the users of a customer, with every permission there. */
const CUSTOMER_ADMIN: TestViewer = {
    id: "carla",
    name: "Carla",
    email: "carla@customer.ch",
    isPlatformAdmin: false,
    tenantId: "tenant-a",
    permissions: [PERMISSIONS.USERS.READ, PERMISSIONS.USERS.WRITE, PERMISSIONS.JOBS.READ],
    role: { id: "g-customer-admins", name: "Customer admins" },
};

const VIEWERS: TestGroup = { id: "g-view", name: "Viewers", permissions: JSON.stringify([PERMISSIONS.JOBS.READ]), fullAccess: false };
const FULL_ACCESS: TestGroup = { id: "g-full", name: "Admin", permissions: "[]", fullAccess: true };
const DELETERS: TestGroup = { id: "g-delete", name: "Deleters", permissions: JSON.stringify([PERMISSIONS.JOBS.READ, PERMISSIONS.STORAGE.DELETE]), fullAccess: false };

/** The accounts the guards look at: whose they are decides who may change them. */
const ACCOUNTS: Record<string, { isPlatformAdmin: boolean; tenantIds: string[] }> = {
    lena: { isPlatformAdmin: false, tenantIds: [HOME_TENANT_ID] },
    root: { isPlatformAdmin: true, tenantIds: [HOME_TENANT_ID] },
    "root-2": { isPlatformAdmin: true, tenantIds: [] },
    // A technician who works for the platform and for a customer.
    tech: { isPlatformAdmin: false, tenantIds: [HOME_TENANT_ID, "tenant-a"] },
    // Works for the customer alone.
    "cust-user": { isPlatformAdmin: false, tenantIds: ["tenant-a"] },
};

const PLATFORM_ONLY = "Only a platform admin can change the account of a platform admin.";
const OTHER_TENANTS = "This account also works in other tenants. Only a platform admin can change it.";
const GROUP_TOO_STRONG = "This group may do more than you may, so you cannot give it to anyone.";

describe("what an admin may do to other users", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.allowed = true;
        mocks.mayChangeSettings = true;
        mocks.viewer = ADMIN;
        mocks.service.accountOf.mockImplementation(async (id: string) => ACCOUNTS[id] ?? { isPlatformAdmin: false, tenantIds: [HOME_TENANT_ID] });
        mocks.service.namesOf.mockImplementation(async (ids: string[]) => ids.map((id) => ({ id, name: id === "root" ? "Root" : id === "tech" ? "Tom Tech" : id })));
        mocks.service.createUser.mockResolvedValue({ id: "u-new" });
        mocks.service.deleteUsers.mockImplementation(async (ids: string[]) => ({ succeeded: ids, failed: [] }));
        mocks.service.revokeSessions.mockResolvedValue(2);
        mocks.groups.find.mockImplementation(async (id: string) => [VIEWERS, FULL_ACCESS, DELETERS].find((group) => group.id === id) ?? null);
        mocks.memberships.roleOf.mockResolvedValue(VIEWERS);
        mocks.memberships.setRole.mockResolvedValue(undefined);
    });

    it("creates a user in the picked group, in the tenant of the creator", async () => {
        const result = await createUser({ name: "Sara Nguyen", email: "sara@example.ch", password: "correct horse", groupId: "g-view" });

        expect(result).toEqual({ success: true, data: { id: "u-new" } });
        expect(mocks.service.createUser).toHaveBeenCalledWith({ name: "Sara Nguyen", email: "sara@example.ch", password: "correct horse", groupId: "g-view", tenantId: HOME_TENANT_ID });
    });

    it("never gives a new user a group that may do more than the creator", async () => {
        expect(await createUser({ name: "Sara Nguyen", email: "sara@example.ch", password: "correct horse", groupId: "g-full" }))
            .toEqual({ success: false, error: GROUP_TOO_STRONG });
        // One permission the creator lacks is enough.
        expect(await createUser({ name: "Sara Nguyen", email: "sara@example.ch", password: "correct horse", groupId: "g-delete" }))
            .toEqual({ success: false, error: GROUP_TOO_STRONG });
        expect(await createUser({ name: "Sara Nguyen", email: "sara@example.ch", password: "correct horse", groupId: "g-gone" }))
            .toEqual({ success: false, error: "The group no longer exists." });
        expect(mocks.service.createUser).not.toHaveBeenCalled();
    });

    it("lets a platform admin give a new user the full access group", async () => {
        mocks.viewer = PLATFORM_ADMIN;

        expect((await createUser({ name: "Sara Nguyen", email: "sara@example.ch", password: "correct horse", groupId: "g-full" })).success).toBe(true);
        expect(mocks.service.createUser).toHaveBeenCalledWith(expect.objectContaining({ groupId: "g-full", tenantId: HOME_TENANT_ID }));
    });

    it("gives a user a group in the tenant of the admin, or takes them out with none", async () => {
        expect(await updateUserGroup("lena", "g-view")).toEqual({ success: true });
        expect(mocks.memberships.setRole).toHaveBeenCalledWith("lena", HOME_TENANT_ID, "g-view", { platformAdmin: false });

        expect(await updateUserGroup("lena", "none")).toEqual({ success: true });
        expect(mocks.memberships.setRole).toHaveBeenCalledWith("lena", HOME_TENANT_ID, null, { platformAdmin: false });
    });

    it("never changes the own group", async () => {
        expect(await updateUserGroup("admin", "g-view")).toEqual({ success: false, error: "You cannot change your own group assignment." });
        expect(mocks.memberships.setRole).not.toHaveBeenCalled();
    });

    it("never gives a group that may do more than the admin, nor takes one from someone who may", async () => {
        expect(await updateUserGroup("lena", "g-full")).toEqual({ success: false, error: GROUP_TOO_STRONG });

        // Taking the full access group from someone would let a weaker admin demote a stronger one.
        mocks.memberships.roleOf.mockResolvedValue(FULL_ACCESS);
        expect(await updateUserGroup("lena", "none")).toEqual({
            success: false,
            error: "This user's group may do more than you may, so only someone who may do all of it changes it.",
        });
        expect(mocks.memberships.setRole).not.toHaveBeenCalled();

        mocks.viewer = PLATFORM_ADMIN;
        expect(await updateUserGroup("lena", "none")).toEqual({ success: true });
        // A platform admin manages every tenant, so the service lets them leave one without a manager.
        expect(mocks.memberships.setRole).toHaveBeenCalledWith("lena", HOME_TENANT_ID, null, { platformAdmin: true });
    });

    it("hands on why the last member who manages members keeps that right", async () => {
        mocks.memberships.setRole.mockRejectedValueOnce(new ValidationError("Nobody else manages the members of this tenant. Give someone that right first."));

        expect(await updateUserGroup("lena", "none")).toEqual({ success: false, error: "Nobody else manages the members of this tenant. Give someone that right first." });
        expect(mocks.audit).not.toHaveBeenCalled();
    });

    it("never deletes the own account, and a platform admin only for a platform admin", async () => {
        expect(await deleteUser("admin")).toEqual({ success: false, error: "You cannot delete your own account." });

        expect(await deleteUser("root")).toEqual({ success: false, error: PLATFORM_ONLY });
        expect(mocks.service.deleteUser).not.toHaveBeenCalled();

        mocks.viewer = PLATFORM_ADMIN;
        mocks.service.deleteUser.mockResolvedValue({ name: "Root 2", email: "root2@example.ch" });
        expect(await deleteUser("root-2")).toEqual({ success: true });
        expect(mocks.service.deleteUser).toHaveBeenCalledWith("root-2", { permanently: false, by: "root" });
    });

    it("never lets the admin of one tenant delete an account that also works in another", async () => {
        expect(await deleteUser("tech")).toEqual({ success: false, error: OTHER_TENANTS });

        mocks.viewer = CUSTOMER_ADMIN;
        expect(await deleteUser("tech")).toEqual({ success: false, error: OTHER_TENANTS });
        expect(mocks.service.deleteUser).not.toHaveBeenCalled();

        mocks.service.deleteUser.mockResolvedValue({ name: "Customer user", email: "user@customer.ch" });
        expect(await deleteUser("cust-user")).toEqual({ success: true });
    });

    it("hands on that the last platform admin is not deleted", async () => {
        mocks.viewer = PLATFORM_ADMIN;
        mocks.service.deleteUser.mockRejectedValueOnce(new Error("Cannot delete the last platform admin."));

        expect(await deleteUser("root-2")).toEqual({ success: false, error: "Cannot delete the last platform admin." });
        expect(mocks.audit).not.toHaveBeenCalled();
    });

    it("deletes a user permanently only for someone who may change the settings", async () => {
        mocks.mayChangeSettings = false;
        const refused = { success: false, error: "Deleting permanently needs the right to change the settings." };

        expect(await deleteUser("lena", { permanently: true })).toEqual(refused);
        expect(await bulkDeleteUsers(["lena"], { permanently: true })).toEqual(refused);
        expect(mocks.service.deleteUser).not.toHaveBeenCalled();
        expect(mocks.service.deleteUsers).not.toHaveBeenCalled();

        mocks.mayChangeSettings = true;
        mocks.service.deleteUser.mockResolvedValue({ name: "Lena", email: "lena@example.ch" });
        expect(await deleteUser("lena", { permanently: true })).toEqual({ success: true });
        expect(mocks.service.deleteUser).toHaveBeenCalledWith("lena", { permanently: true, by: "admin" });
    });

    it("reports the platform admins, the accounts of other tenants and the own account of a bulk delete instead of sending them", async () => {
        const result = await bulkDeleteUsers(["lena", "root", "tech", "admin"]);

        expect(mocks.service.deleteUsers).toHaveBeenCalledWith(["lena"], { permanently: false, by: "admin" });
        expect(result).toEqual({
            success: true,
            data: {
                succeeded: ["lena"],
                failed: [
                    { id: "admin", name: "Ada", error: "You cannot delete your own account." },
                    { id: "root", name: "Root", error: PLATFORM_ONLY },
                    { id: "tech", name: "Tom Tech", error: OTHER_TENANTS },
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

    it("hands on the rule of Settings > Passwords that a new password breaks", async () => {
        mocks.setPassword.mockRejectedValueOnce(new ValidationError("The password needs 12 characters or more."));

        expect(await setUserPassword("lena", { password: "short", signOut: true })).toEqual({ success: false, error: "The password needs 12 characters or more." });
        expect(mocks.service.revokeSessions).not.toHaveBeenCalled();
        expect(mocks.audit).not.toHaveBeenCalled();
    });

    it("refuses the own password, an empty one and the password of a platform admin", async () => {
        expect(await setUserPassword("admin", { password: "a new password", signOut: true })).toEqual({ success: false, error: "Change your own password under Profile." });
        expect(await setUserPassword("lena", { password: "", signOut: true })).toEqual({ success: false, error: "Enter a password." });

        expect(await setUserPassword("root", { password: "a new password", signOut: true })).toEqual({ success: false, error: PLATFORM_ONLY });
        expect(mocks.setPassword).not.toHaveBeenCalled();
    });

    it("never lets a tenant admin set the password of an account that also works in another tenant", async () => {
        // Whoever knows that password signs in to every tenant the account works in.
        mocks.viewer = CUSTOMER_ADMIN;

        expect(await setUserPassword("tech", { password: "a new password", signOut: true })).toEqual({ success: false, error: OTHER_TENANTS });
        expect(await setUserPassword("lena", { password: "a new password", signOut: true })).toEqual({ success: false, error: OTHER_TENANTS });
        expect(mocks.setPassword).not.toHaveBeenCalled();

        expect((await setUserPassword("cust-user", { password: "a new password", signOut: false })).success).toBe(true);
        expect(mocks.setPassword).toHaveBeenCalledWith("cust-user", "a new password");
    });

    it("lets a platform admin set the password of another platform admin", async () => {
        mocks.viewer = PLATFORM_ADMIN;

        expect((await setUserPassword("root-2", { password: "a new password", signOut: false })).success).toBe(true);
        expect(mocks.setPassword).toHaveBeenCalledWith("root-2", "a new password");
    });

    it("lets only a platform admin reset the second factor of a platform admin or sign them out", async () => {
        expect(await resetUserTwoFactor("root-2")).toEqual({ success: false, error: PLATFORM_ONLY });
        expect(await revokeUserSessions("root-2")).toEqual({ success: false, error: PLATFORM_ONLY });
        expect(await revokeUserSession("root-2", "s-root")).toEqual({ success: false, error: PLATFORM_ONLY });
        expect(mocks.service.resetTwoFactor).not.toHaveBeenCalled();
        expect(mocks.service.revokeSessions).not.toHaveBeenCalled();
        expect(mocks.service.revokeSession).not.toHaveBeenCalled();

        mocks.viewer = PLATFORM_ADMIN;
        mocks.service.revokeSession.mockResolvedValue(true);
        expect(await resetUserTwoFactor("root-2")).toEqual({ success: true });
        expect(await revokeUserSessions("root-2")).toEqual({ success: true, data: { count: 2 } });
        expect(await revokeUserSession("root-2", "s-root")).toEqual({ success: true });
    });

    it("never lets a tenant admin reset the second factor of an account of other tenants or sign it out", async () => {
        expect(await resetUserTwoFactor("tech")).toEqual({ success: false, error: OTHER_TENANTS });
        expect(await revokeUserSessions("tech")).toEqual({ success: false, error: OTHER_TENANTS });
        expect(await revokeUserSession("tech", "s-tech")).toEqual({ success: false, error: OTHER_TENANTS });
        expect(mocks.service.resetTwoFactor).not.toHaveBeenCalled();
        expect(mocks.service.revokeSessions).not.toHaveBeenCalled();
        expect(mocks.service.revokeSession).not.toHaveBeenCalled();
    });

    it("never ends the session the admin is using", async () => {
        expect(await revokeUserSession("admin", "s-admin")).toEqual({ success: false, error: "This is the session you are using. Sign out from the menu instead." });
        expect(mocks.service.revokeSession).not.toHaveBeenCalled();
    });

    it("needs the permission to change users", async () => {
        mocks.allowed = false;

        await expect(setUserPassword("lena", { password: "a new password", signOut: true })).rejects.toBeInstanceOf(PermissionError);
        await expect(createUser({ name: "Sara Nguyen", email: "sara@example.ch", password: "correct horse", groupId: null })).rejects.toBeInstanceOf(PermissionError);
        await expect(updateUserGroup("lena", "g-view")).rejects.toBeInstanceOf(PermissionError);
        expect(mocks.setPassword).not.toHaveBeenCalled();
        expect(mocks.service.createUser).not.toHaveBeenCalled();
        expect(mocks.memberships.setRole).not.toHaveBeenCalled();
    });
});

describe("users in All tenants, where a platform admin opens no tenant", () => {
    const IN_ALL_TENANTS: TestViewer = { ...PLATFORM_ADMIN, tenantId: null, allTenants: true };

    beforeEach(() => {
        vi.clearAllMocks();
        mocks.allowed = true;
        mocks.mayChangeSettings = true;
        mocks.viewer = IN_ALL_TENANTS;
        mocks.service.accountOf.mockImplementation(async (id: string) => ACCOUNTS[id] ?? { isPlatformAdmin: false, tenantIds: [HOME_TENANT_ID] });
        mocks.service.createUser.mockResolvedValue({ id: "u-new" });
        mocks.service.deleteUser.mockResolvedValue({ name: "Tom Tech", email: "tom@example.ch" });
        mocks.groups.find.mockImplementation(async (id: string) => [VIEWERS, FULL_ACCESS, DELETERS].find((group) => group.id === id) ?? null);
    });

    it("creates a user in the tenant the platform admin picked, and logs it there", async () => {
        const result = await createUser({ name: "Sara Nguyen", email: "sara@example.ch", password: "correct horse", groupId: "g-view", tenantId: "tenant-a" });

        expect(result).toEqual({ success: true, data: { id: "u-new" } });
        expect(mocks.service.createUser).toHaveBeenCalledWith({ name: "Sara Nguyen", email: "sara@example.ch", password: "correct horse", groupId: "g-view", tenantId: "tenant-a" });
        expect(mocks.audit).toHaveBeenCalledWith("root", "CREATE", "USER", { name: "Sara Nguyen", email: "sara@example.ch", groupId: "g-view" }, "u-new", { tenantId: "tenant-a" });
    });

    it("asks for the tenant of a new user, since All tenants is none", async () => {
        expect(await createUser({ name: "Sara Nguyen", email: "sara@example.ch", password: "correct horse", groupId: "g-view" }))
            .toEqual({ success: false, error: "Pick the tenant the person works in." });
        expect(mocks.service.createUser).not.toHaveBeenCalled();
    });

    it("ignores a tenant sent from inside a tenant, where a new user joins the open one", async () => {
        mocks.viewer = ADMIN;

        await createUser({ name: "Sara Nguyen", email: "sara@example.ch", password: "correct horse", groupId: "g-view", tenantId: "tenant-a" });
        expect(mocks.service.createUser).toHaveBeenCalledWith(expect.objectContaining({ tenantId: HOME_TENANT_ID }));
    });

    it("creates a user in the tenant someone of a platform group names, with a group capped by what they may there", async () => {
        // Nina manages the accounts of the platform and works in the home tenant, where she may run jobs.
        mocks.viewer = { ...ADMIN, id: "nina", permissions: [PERMISSIONS.PLATFORM.ACCOUNTS_WRITE, PERMISSIONS.JOBS.READ] };
        mocks.service.permissionsIn.mockResolvedValue([PERMISSIONS.JOBS.READ, PERMISSIONS.JOBS.EXECUTE]);

        expect(await createUser({ name: "Sara Nguyen", email: "sara@example.ch", password: "correct horse", groupId: "g-view", tenantId: "tenant-a" })).toEqual({ success: true, data: { id: "u-new" } });
        expect(mocks.service.permissionsIn).toHaveBeenCalledWith("nina", "tenant-a");
        expect(mocks.service.createUser).toHaveBeenCalledWith(expect.objectContaining({ tenantId: "tenant-a", groupId: "g-view" }));

        // The deleters may delete backups, which Nina may not in tenant-a, whatever she may elsewhere.
        expect(await createUser({ name: "Tom", email: "tom@example.ch", password: "correct horse", groupId: "g-delete", tenantId: "tenant-a" })).toEqual(expect.objectContaining({ success: false }));
        expect(mocks.service.createUser).toHaveBeenCalledTimes(1);
    });

    it("changes the account itself, which belongs to no tenant, but no group of one tenant", async () => {
        expect(await resetUserTwoFactor("tech")).toEqual({ success: true });
        expect(await deleteUser("tech")).toEqual({ success: true });
        expect(mocks.service.deleteUser).toHaveBeenCalledWith("tech", { permanently: false, by: "root" });

        expect(await updateUserGroup("tech", "g-view")).toEqual({ success: false, error: "Open a tenant, or change the group per tenant in the panel of the user." });
        expect(mocks.memberships.setRole).not.toHaveBeenCalled();
    });
});
