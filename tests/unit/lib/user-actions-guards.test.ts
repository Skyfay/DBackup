import { beforeEach, describe, expect, it, vi } from "vitest";
import { PermissionError, ValidationError } from "@/lib/logging/errors";
import { AVAILABLE_PERMISSIONS, PERMISSIONS } from "@/lib/auth/permissions";
import { HOME_TENANT_ID } from "@/lib/tenant/home";
import { Prisma } from "@prisma/client";

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
    /** The tenants the platform group of the viewer reaches, which bounds the right to manage the accounts of the platform. */
    reach: [] as "all" | string[],
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
        accountRefusalFor: vi.fn(),
        accountsReachOf: vi.fn(),
        emailOf: vi.fn(),
        emailTenantsOf: vi.fn(async (id: string): Promise<string[]> => {
            const tenantIds = ACCOUNTS[id]?.tenantIds ?? [HOME_TENANT_ID];
            return tenantIds.length > 0 ? tenantIds : [HOME_TENANT_ID];
        }),
        updateUser: vi.fn(),
    },
    groups: { find: vi.fn() },
    memberships: { setRole: vi.fn(), roleOf: vi.fn(), isPersonOf: vi.fn(), isPlatformAdmin: vi.fn() },
    tenants: { switchable: vi.fn() },
    setPassword: vi.fn(),
    audit: vi.fn(),
    emailRefusal: vi.fn(async (..._args: unknown[]): Promise<string | null> => null),
    /** The check of an email given to an existing account. */
    takenEmail: vi.fn(async (..._args: unknown[]): Promise<string | null> => null),
    /** The accounts whose membership may not end, see `membershipEndRefusal`. */
    endRefused: new Set<string>(),
    /** The check of a claimed domain, free unless a test says otherwise. */
    claimedEmail: vi.fn(async (..._args: unknown[]): Promise<string | null> => null),
    /** The accounts the viewer sees, every one when null, see `maySeeAccount`. */
    seen: null as Set<string> | null,
    /** Ids of accounts that do not exist. */
    missing: new Set<string>(),
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
vi.mock("@/services/tenant/tenant-service", () => ({ tenantService: mocks.tenants }));
vi.mock("@/services/tenant/membership-end", () => ({
    membershipEndRefusal: vi.fn(async (_caller: unknown, id: string) => (mocks.endRefused.has(id) ? "hands over" : null)),
}));
vi.mock("@/services/sso/email-domain-claims", () => ({ claimedEmailRefusal: (...args: unknown[]) => mocks.claimedEmail(...args) }));
// An email without an account, unless a test says otherwise, see tests/unit/services/new-account-email.test.ts.
vi.mock("@/services/user/new-account-email", () => ({
    newAccountEmailRefusal: (...args: unknown[]) => mocks.emailRefusal(...args),
    takenEmailRefusal: (...args: unknown[]) => mocks.takenEmail(...args),
    CHANGED_EMAIL_ANSWERS: { known: "known", refused: "refused", spent: "spent" },
    EMAIL_REFUSED: "This email cannot be given to this account. Pick another email.",
}));
vi.mock("@/services/user/account-visibility", () => ({
    maySeeAccount: vi.fn(async (_viewer: unknown, id: string) => mocks.seen?.has(id) ?? true),
    // An account the test does not know does not exist, one the viewer does not see reads the same.
    shownAccountName: vi.fn(async (_viewer: unknown, id: string) => (mocks.missing.has(id) || !(mocks.seen?.has(id) ?? true) ? null : id === "root" ? "Root" : id === "tech" ? "Tom Tech" : id)),
    ACCOUNT_UNKNOWN: "The user no longer exists.",
}));

// Where the entry of a deleted account would wait, by the real rule from the accounts of the test.
vi.mock("@/services/trash/account-place", async () => {
    const { accountTrashPlace } = await vi.importActual<typeof import("@/services/trash/account-place")>("@/services/trash/account-place");
    return {
        accountTrashPlace,
        accountTrashPlaceOf: vi.fn(async (id: string) => {
            const account = ACCOUNTS[id] ?? { isPlatformAdmin: false, tenantIds: [HOME_TENANT_ID] };
            return accountTrashPlace({
                platformRole: account.isPlatformAdmin ? "ADMIN" : null,
                platformGroupId: account.platformGroup ? "pg" : null,
                memberships: account.tenantIds.map((tenantId) => ({ tenantId })),
                apiKeys: [],
            });
        }),
    };
});

const { accountRefusal } = await vi.importActual<typeof import("@/lib/auth/account-access")>("@/lib/auth/account-access");

/** The service decides with the real rule, from the accounts of the test and the reach of the viewer. */
function decideAccounts() {
    mocks.reach = [];
    mocks.service.accountsReachOf.mockImplementation(async (caller: TestViewer) =>
        caller.isPlatformAdmin ? "all" : caller.permissions.includes(PERMISSIONS.PLATFORM.ACCOUNTS_WRITE) ? mocks.reach : []);
    mocks.service.accountRefusalFor.mockImplementation(async (caller: TestViewer, id: string) => {
        const target = await mocks.service.accountOf(id);
        if (!target) return null;
        // Like the service: what the caller may in the other tenants of the account caps the groups it holds there.
        const permissionsByTenant: Record<string, string[]> = {};
        for (const { tenantId } of target.groups ?? []) if (tenantId !== caller.tenantId) permissionsByTenant[tenantId] = await mocks.service.permissionsIn(caller.id, tenantId);
        return accountRefusal({ ...caller, platformGroupShape: null, reach: await mocks.service.accountsReachOf(caller), permissionsByTenant }, target);
    });
    mocks.memberships.isPersonOf.mockResolvedValue(true);
    mocks.memberships.isPlatformAdmin.mockResolvedValue(false);
    mocks.endRefused = new Set();
    mocks.tenants.switchable.mockResolvedValue([{ id: HOME_TENANT_ID, name: "Home" }, { id: "tenant-a", name: "A" }]);
}

const { bulkDeleteUsers, createUser, deleteUser, togglePasskeyTwoFactor, updateUser, updateUserGroup } = await import("@/app/actions/auth/user");
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
const ACCOUNTS: Record<string, {
    isPlatformAdmin: boolean;
    tenantIds: string[];
    platformGroup?: { platformPermissions: string[]; tenantPermissions: string[]; allTenants: boolean; tenantIds: string[] };
    groups?: { tenantId: string; group: TestGroup }[];
}> = {
    // A technician of a platform group who works in no tenant.
    "platform-tech": { isPlatformAdmin: false, tenantIds: [], platformGroup: { platformPermissions: [PERMISSIONS.PLATFORM.ACCOUNTS_WRITE], tenantPermissions: [], allTenants: true, tenantIds: [] } },
    lena: { isPlatformAdmin: false, tenantIds: [HOME_TENANT_ID] },
    root: { isPlatformAdmin: true, tenantIds: [HOME_TENANT_ID] },
    "root-2": { isPlatformAdmin: true, tenantIds: [] },
    // A technician who works for the platform and for a customer.
    tech: { isPlatformAdmin: false, tenantIds: [HOME_TENANT_ID, "tenant-a"] },
    // Works for the customer alone.
    "cust-user": { isPlatformAdmin: false, tenantIds: ["tenant-a"] },
    // Works for another customer alone.
    "globex-user": { isPlatformAdmin: false, tenantIds: ["tenant-b"] },
    // Works in no tenant yet, which counts as the home tenant.
    fresh: { isPlatformAdmin: false, tenantIds: [] },
    // The Admin of the home tenant, whose group may do everything there.
    "home-admin": { isPlatformAdmin: false, tenantIds: [HOME_TENANT_ID], groups: [{ tenantId: HOME_TENANT_ID, group: FULL_ACCESS }] },
    // The Admin of tenant A, and someone there who only reads the jobs.
    "a-admin": { isPlatformAdmin: false, tenantIds: ["tenant-a"], groups: [{ tenantId: "tenant-a", group: FULL_ACCESS }] },
    "a-viewer": { isPlatformAdmin: false, tenantIds: ["tenant-a"], groups: [{ tenantId: "tenant-a", group: VIEWERS }] },
};

const GROUP_BEYOND = "This user's group may do more than you may, so only someone who may do all of it can change their account.";

const PLATFORM_ONLY = "Only a platform admin can change the account of a platform admin.";
const OTHER_TENANTS = "This account also works in other tenants. Only someone who manages the accounts of the platform can change it.";
const GROUP_TOO_STRONG = "This group may do more than you may, so you cannot give it to anyone.";

describe("what an admin may do to other users", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.allowed = true;
        mocks.mayChangeSettings = true;
        mocks.viewer = ADMIN;
        mocks.service.accountOf.mockImplementation(async (id: string) => ACCOUNTS[id] ?? { isPlatformAdmin: false, tenantIds: [HOME_TENANT_ID] });
        decideAccounts();
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

    it("answers an email of an existing account with what the creator may know, and makes no account", async () => {
        mocks.emailRefusal.mockResolvedValueOnce("This email cannot get a new account here. Send the person an invitation of the tenant instead.");

        expect(await createUser({ name: "Gina", email: "gina@globex.example", password: "correct horse", groupId: "g-view" }))
            .toEqual({ success: false, error: "This email cannot get a new account here. Send the person an invitation of the tenant instead.", field: "email" });
        expect(mocks.emailRefusal).toHaveBeenCalledWith("gina@globex.example", expect.objectContaining({ userId: ADMIN.id, isPlatformAdmin: false }), HOME_TENANT_ID);
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
        mocks.service.deleteUser.mockRejectedValueOnce(new ValidationError("Cannot delete the last platform admin."));

        expect(await deleteUser("root-2")).toEqual({ success: false, error: "Cannot delete the last platform admin." });
        expect(mocks.audit).not.toHaveBeenCalled();
    });

    it("deletes a user permanently only for someone who may change the settings of the tenant the account would wait in", async () => {
        const refused = { success: false, error: "Deleting permanently needs the right to change the settings." };

        expect(await deleteUser("lena", { permanently: true })).toEqual(refused);
        expect(await bulkDeleteUsers(["lena"], { permanently: true })).toEqual({ success: true, data: { succeeded: [], failed: [{ id: "lena", name: "lena", error: refused.error }] } });
        expect(mocks.service.deleteUser).not.toHaveBeenCalled();
        expect(mocks.service.deleteUsers).toHaveBeenCalledWith([], { permanently: true, by: "admin" });

        mocks.viewer = { ...ADMIN, permissions: [...ADMIN.permissions, PERMISSIONS.TENANT_SETTINGS.WRITE] };
        mocks.service.deleteUser.mockResolvedValue({ name: "Lena", email: "lena@example.ch" });
        expect(await deleteUser("lena", { permanently: true })).toEqual({ success: true });
        expect(mocks.service.deleteUser).toHaveBeenCalledWith("lena", { permanently: true, by: "admin" });
    });

    it("rejects an id that is no string of a sane length before it reaches the service", async () => {
        const invalid = { success: false, error: "Invalid request" };
        expect(await deleteUser("" as string)).toEqual(invalid);
        expect(await deleteUser({ id: "lena" } as unknown as string)).toEqual(invalid);
        expect(await deleteUser("x".repeat(201))).toEqual(invalid);
        expect(await updateUserGroup(["lena"] as unknown as string, "g-view")).toEqual(invalid);
        expect(await updateUserGroup("lena", { id: "g-view" } as unknown as string)).toEqual(invalid);
        expect(mocks.service.deleteUser).not.toHaveBeenCalled();
        expect(mocks.memberships.setRole).not.toHaveBeenCalled();
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
        expect(mocks.audit).toHaveBeenCalledWith("admin", "UPDATE", "USER", { change: "Password Set", name: "lena", signedOut: 2 }, "lena", { tenantId: HOME_TENANT_ID });
    });

    it("names the account in the entry of a change, also when its name stays", async () => {
        mocks.service.updateUser.mockResolvedValue(undefined);
        expect(await updateUser("lena", { timezone: "Europe/Zurich" })).toEqual({ success: true });
        expect(mocks.audit).toHaveBeenCalledWith("admin", "UPDATE", "USER", { timezone: "Europe/Zurich", name: "lena" }, "lena", expect.anything());
    });

    it("answers with a fixed sentence when the service fails for another reason, and keeps its words in the log", async () => {
        mocks.viewer = PLATFORM_ADMIN;
        mocks.service.deleteUser.mockRejectedValueOnce(new Error("SQLITE_BUSY: database is locked"));
        expect(await deleteUser("lena")).toEqual({ success: false, error: "The user could not be deleted." });
        mocks.setPassword.mockRejectedValueOnce(new Error("Prisma: Record to update not found"));
        expect(await setUserPassword("lena", { password: "a new password", signOut: false })).toEqual({ success: false, error: "The password could not be set." });
        mocks.service.resetTwoFactor.mockRejectedValueOnce(new Error("Prisma: Record to update not found"));
        expect(await resetUserTwoFactor("lena")).toEqual({ success: false, error: "The second factor could not be reset." });
        mocks.service.createUser.mockRejectedValueOnce(new Error("UNIQUE constraint failed: user.email"));
        expect(await createUser({ name: "Sara Nguyen", email: "sara@example.ch", password: "correct horse", groupId: "g-view" })).toEqual({ success: false, error: "The user could not be created." });
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

    it("never lets an admin change the account of someone whose group may do more, like the Admin of the tenant", async () => {
        expect(await setUserPassword("home-admin", { password: "a new password", signOut: true })).toEqual({ success: false, error: GROUP_BEYOND });
        expect(await resetUserTwoFactor("home-admin")).toEqual({ success: false, error: GROUP_BEYOND });
        expect(await revokeUserSessions("home-admin")).toEqual({ success: false, error: GROUP_BEYOND });
        expect(await updateUser("home-admin", { name: "Renamed", email: "mine@example.ch" })).toEqual({ success: false, error: GROUP_BEYOND });
        expect(await deleteUser("home-admin")).toEqual({ success: false, error: GROUP_BEYOND });
        expect(mocks.setPassword).not.toHaveBeenCalled();
        expect(mocks.service.resetTwoFactor).not.toHaveBeenCalled();
        expect(mocks.service.updateUser).not.toHaveBeenCalled();
        expect(mocks.service.deleteUser).not.toHaveBeenCalled();

        // A platform admin does.
        mocks.viewer = PLATFORM_ADMIN;
        expect((await setUserPassword("home-admin", { password: "a new password", signOut: false })).success).toBe(true);
    });

    it("answers an email of an account the admin may not see with the fixed sentence, also when the database refuses it", async () => {
        mocks.service.emailOf.mockResolvedValue("lena@example.ch");
        mocks.takenEmail.mockResolvedValueOnce("This email cannot be given to this account. Pick another email.");

        expect(await updateUser("lena", { email: "Gina@Globex.example" })).toEqual({ success: false, error: "This email cannot be given to this account. Pick another email." });
        expect(mocks.takenEmail).toHaveBeenCalledWith("gina@globex.example", expect.objectContaining({ userId: "admin" }), HOME_TENANT_ID, expect.anything(), { accountId: "lena" });
        expect(mocks.service.updateUser).not.toHaveBeenCalled();

        // Taken meanwhile: never the words of the database.
        mocks.service.updateUser.mockRejectedValueOnce(new Prisma.PrismaClientKnownRequestError("Unique constraint failed on the fields: (`email`)", { code: "P2002", clientVersion: "6" }));
        expect(await updateUser("lena", { email: "sara@example.ch" })).toEqual({ success: false, error: "This email cannot be given to this account. Pick another email." });
    });

    it("never takes someone out of the tenant when they would then work alone where the admin manages the users", async () => {
        mocks.endRefused = new Set(["tech"]);

        expect(await updateUserGroup("tech", "none")).toEqual({ success: false, error: "hands over" });
        expect(await updateUserGroup("tech", null)).toEqual({ success: false, error: "hands over" });
        expect(mocks.memberships.setRole).not.toHaveBeenCalled();
        // Another group ends no membership.
        expect(await updateUserGroup("tech", "g-view")).toEqual({ success: true });
    });

    it("names the user and the group in the entry of a change of the group", async () => {
        await updateUserGroup("lena", "g-view");

        expect(mocks.audit).toHaveBeenCalledWith("admin", "UPDATE", "USER", { change: "Updating Group", name: "lena", groupId: "g-view", group: "Viewers" }, "lena");
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
        decideAccounts();
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
        mocks.reach = ["tenant-a"];
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

    it("never gives a group to an account of another tenant, nor touches an account of a platform group", async () => {
        mocks.viewer = ADMIN;
        mocks.memberships.isPersonOf.mockResolvedValue(false);
        expect(await updateUserGroup("cust-user", "g-view")).toEqual({ success: false, error: "This account works in another tenant. Add people to this tenant with an invitation." });
        expect(mocks.memberships.setRole).not.toHaveBeenCalled();

        mocks.memberships.isPersonOf.mockResolvedValue(true);
        expect(await setUserPassword("platform-tech", { password: "correct horse", signOut: true })).toEqual({ success: false, error: "This account holds a platform group. Only someone who may give that platform group can change it." });
        expect(await resetUserTwoFactor("platform-tech")).toEqual(expect.objectContaining({ success: false }));
        expect(mocks.setPassword).not.toHaveBeenCalled();
    });
});

describe("the accounts someone of a platform group of some tenants changes", () => {
    /** Nina manages the accounts of the platform with a platform group that reaches tenant A. She works in the home tenant, where she runs jobs. */
    const NINA: TestViewer = { ...ADMIN, id: "nina", name: "Nina", permissions: [PERMISSIONS.PLATFORM.ACCOUNTS_READ, PERMISSIONS.PLATFORM.ACCOUNTS_WRITE, PERMISSIONS.JOBS.READ] };
    const BEYOND = "This account works in a tenant your platform group does not reach. Only someone who reaches all of its tenants can change it.";
    const NEW_USER = { name: "Sara Nguyen", email: "sara@example.ch", password: "correct horse", groupId: "g-view" };

    beforeEach(() => {
        vi.clearAllMocks();
        mocks.allowed = true;
        mocks.mayChangeSettings = true;
        mocks.viewer = NINA;
        mocks.claimedEmail.mockResolvedValue(null);
        mocks.service.accountOf.mockImplementation(async (id: string) => ACCOUNTS[id] ?? { isPlatformAdmin: false, tenantIds: [HOME_TENANT_ID] });
        decideAccounts();
        mocks.reach = ["tenant-a"];
        mocks.tenants.switchable.mockResolvedValue([{ id: HOME_TENANT_ID, name: "Home" }, { id: "tenant-a", name: "A" }, { id: "tenant-b", name: "B" }]);
        mocks.service.deleteUser.mockResolvedValue({ name: "Someone", email: "someone@example.ch" });
        mocks.service.deleteUsers.mockImplementation(async (ids: string[]) => ({ succeeded: ids, failed: [] }));
        mocks.service.namesOf.mockImplementation(async (ids: string[]) => ids.map((id) => ({ id, name: id })));
        mocks.service.revokeSessions.mockResolvedValue(1);
        mocks.service.createUser.mockResolvedValue({ id: "u-new" });
        mocks.service.permissionsIn.mockResolvedValue([PERMISSIONS.JOBS.READ]);
        mocks.groups.find.mockImplementation(async (id: string) => [VIEWERS, FULL_ACCESS, DELETERS].find((group) => group.id === id) ?? null);
    });

    it("refuses the password, second factor, sessions, name and delete of an account of a tenant beyond her platform group", async () => {
        expect(await setUserPassword("globex-user", { password: "a new password", signOut: true })).toEqual({ success: false, error: BEYOND });
        expect(await resetUserTwoFactor("globex-user")).toEqual({ success: false, error: BEYOND });
        expect(await revokeUserSessions("globex-user")).toEqual({ success: false, error: BEYOND });
        expect(await updateUser("globex-user", { name: "Renamed" })).toEqual({ success: false, error: BEYOND });
        expect(await deleteUser("globex-user")).toEqual({ success: false, error: BEYOND });
        // One tenant beyond her platform group is enough, the account belongs to all of them.
        expect(await setUserPassword("tech", { password: "a new password", signOut: true })).toEqual({ success: false, error: BEYOND });
        expect(mocks.setPassword).not.toHaveBeenCalled();
        expect(mocks.service.resetTwoFactor).not.toHaveBeenCalled();
        expect(mocks.service.revokeSessions).not.toHaveBeenCalled();
        expect(mocks.service.deleteUser).not.toHaveBeenCalled();
    });

    it("never gives an account of tenant A an email the provider of the tenant she works in claims", async () => {
        const CLAIMED = "The domain of this email signs in through the provider of another tenant. Only someone who manages the accounts of the platform can use it here.";
        // The provider of the home tenant claims home.example.
        mocks.claimedEmail.mockImplementation(async (email: unknown, tenantIds: unknown) =>
            String(email).endsWith("@home.example") && !(tenantIds as string[]).includes(HOME_TENANT_ID) ? CLAIMED : null);
        mocks.service.emailOf.mockResolvedValue("cust-user@customer.example");

        expect(await updateUser("cust-user", { email: "boss@home.example" })).toEqual({ success: false, error: CLAIMED });
        expect(mocks.claimedEmail).toHaveBeenCalledWith("boss@home.example", ["tenant-a", "tenant-a"], false);
        expect(mocks.service.updateUser).not.toHaveBeenCalled();

        // An account of the home tenant gets it, its own tenant claims it.
        mocks.reach = [HOME_TENANT_ID, "tenant-a"];
        mocks.service.emailOf.mockResolvedValue("lena@example.ch");
        expect(await updateUser("lena", { email: "lena@home.example" })).toEqual({ success: true });
    });

    it("refuses an account of no tenant unless her platform group reaches the home tenant", async () => {
        expect(await setUserPassword("fresh", { password: "a new password", signOut: true })).toEqual({ success: false, error: BEYOND });
        expect(await deleteUser("fresh")).toEqual({ success: false, error: BEYOND });

        mocks.reach = [HOME_TENANT_ID, "tenant-a"];
        expect(await deleteUser("fresh")).toEqual({ success: true });
    });

    it("changes an account of a tenant her platform group reaches", async () => {
        expect((await setUserPassword("cust-user", { password: "a new password", signOut: true })).success).toBe(true);
        expect(mocks.setPassword).toHaveBeenCalledWith("cust-user", "a new password");
        expect(await deleteUser("cust-user")).toEqual({ success: true });
    });

    it("reports an account beyond her platform group in a bulk delete instead of sending it", async () => {
        const result = await bulkDeleteUsers(["cust-user", "globex-user"]);

        expect(mocks.service.deleteUsers).toHaveBeenCalledWith(["cust-user"], { permanently: false, by: "nina" });
        expect(result).toEqual({ success: true, data: { succeeded: ["cust-user"], failed: [{ id: "globex-user", name: "globex-user", error: BEYOND }] } });
    });

    it("keeps what she may as the admin of her own tenant, an account of that tenant alone", async () => {
        mocks.viewer = { ...NINA, permissions: [...NINA.permissions, PERMISSIONS.USERS.WRITE] };

        expect(await deleteUser("lena")).toEqual({ success: true });
        expect(await deleteUser("tech")).toEqual({ success: false, error: BEYOND });
    });

    it("changes every account but a platform admin's for a platform group of all tenants and a platform admin, as before", async () => {
        mocks.reach = "all";
        for (const id of ["globex-user", "fresh", "tech", "cust-user"]) expect(await deleteUser(id)).toEqual({ success: true });
        expect(await deleteUser("root")).toEqual({ success: false, error: PLATFORM_ONLY });

        mocks.viewer = PLATFORM_ADMIN;
        expect(await setUserPassword("globex-user", { password: "a new password", signOut: false })).toEqual(expect.objectContaining({ success: true }));
    });

    it("makes a new account only in a tenant her platform group reaches, or one whose users she manages", async () => {
        const refused = { success: false, error: "Your platform group does not reach this tenant, and you may not manage its users." };
        expect(await createUser({ ...NEW_USER, tenantId: "tenant-b" })).toEqual(refused);
        expect(mocks.service.createUser).not.toHaveBeenCalled();

        expect(await createUser({ ...NEW_USER, tenantId: "tenant-a" })).toEqual({ success: true, data: { id: "u-new" } });

        // In tenant B she is a member whose group manages the users.
        mocks.service.permissionsIn.mockResolvedValue([PERMISSIONS.USERS.WRITE, PERMISSIONS.JOBS.READ]);
        expect(await createUser({ ...NEW_USER, tenantId: "tenant-b" })).toEqual({ success: true, data: { id: "u-new" } });
    });

    it("never changes an account whose group in its tenant may do more than she may there", async () => {
        expect(await setUserPassword("a-admin", { password: "a new password", signOut: true })).toEqual({ success: false, error: GROUP_BEYOND });
        expect(await deleteUser("a-admin")).toEqual({ success: false, error: GROUP_BEYOND });
        expect(mocks.service.permissionsIn).toHaveBeenCalledWith("nina", "tenant-a");
        // Her platform group of all tenants changes no such account either.
        mocks.reach = "all";
        expect(await resetUserTwoFactor("a-admin")).toEqual({ success: false, error: GROUP_BEYOND });

        expect(await deleteUser("a-viewer")).toEqual({ success: true });
    });

    it("answers every change of one account she may not see exactly like one that does not exist", async () => {
        // Globex is beyond her platform group, so she does not see Carla, who works there alone.
        mocks.seen = new Set(["cust-user", "lena"]);
        mocks.missing = new Set(["nobody"]);
        try {
            for (const id of ["globex-user", "nobody"]) {
                const gone = { success: false, error: "The user no longer exists." };
                expect(await setUserPassword(id, { password: "a new password", signOut: true })).toEqual(gone);
                expect(await resetUserTwoFactor(id)).toEqual(gone);
                expect(await revokeUserSessions(id)).toEqual(gone);
                expect(await revokeUserSession(id, "s-1")).toEqual(gone);
                expect(await updateUser(id, { name: "Renamed" })).toEqual(gone);
                expect(await deleteUser(id)).toEqual(gone);
                expect(await togglePasskeyTwoFactor(id, true)).toEqual(gone);
            }
            expect(mocks.setPassword).not.toHaveBeenCalled();
            expect(mocks.service.deleteUser).not.toHaveBeenCalled();
            expect(mocks.audit).not.toHaveBeenCalled();
        } finally {
            mocks.seen = null;
            mocks.missing = new Set();
        }
    });

    it("reports an account she may not see in a bulk delete like one that does not exist", async () => {
        mocks.seen = new Set(["cust-user"]);
        try {
            const result = await bulkDeleteUsers(["cust-user", "globex-user"]);

            expect(result).toEqual({ success: true, data: { succeeded: ["cust-user"], failed: [{ id: "globex-user", error: "User not found" }] } });
        } finally {
            mocks.seen = null;
        }
    });

    it("never deletes in bulk an account she may not see, even one whose rules would let her, and never asks those rules first", async () => {
        mocks.seen = new Set(["cust-user"]);
        // Without a target the rules pass, like an account the rules alone would let her change.
        mocks.service.accountRefusalFor.mockResolvedValueOnce(null);
        try {
            const result = await bulkDeleteUsers(["globex-user", "cust-user"]);

            expect(result).toEqual({ success: true, data: { succeeded: ["cust-user"], failed: [{ id: "globex-user", error: "User not found" }] } });
            expect(mocks.service.deleteUsers).toHaveBeenCalledWith(["cust-user"], { permanently: false, by: "nina" });
            expect(mocks.service.accountRefusalFor).not.toHaveBeenCalledWith(expect.anything(), "globex-user");
        } finally {
            mocks.seen = null;
        }
    });

    it("deletes an account permanently only with the right to change the settings where its entry would wait", async () => {
        const refused = "Deleting permanently needs the right to change the settings.";
        // She may change the settings of the home tenant she works in, not those of tenant A.
        mocks.viewer = { ...NINA, permissions: [...NINA.permissions, PERMISSIONS.TENANT_SETTINGS.WRITE] };
        mocks.service.permissionsIn.mockResolvedValue([PERMISSIONS.JOBS.READ]);

        expect(await deleteUser("cust-user", { permanently: true })).toEqual({ success: false, error: refused });
        expect(mocks.service.permissionsIn).toHaveBeenCalledWith("nina", "tenant-a");
        expect(await bulkDeleteUsers(["cust-user"], { permanently: true })).toEqual({ success: true, data: { succeeded: [], failed: [{ id: "cust-user", name: "cust-user", error: refused }] } });
        expect(mocks.service.deleteUser).not.toHaveBeenCalled();
        expect(mocks.service.deleteUsers).toHaveBeenCalledWith([], { permanently: true, by: "nina" });

        // Where she may change the settings of tenant A, the account goes for good.
        mocks.service.permissionsIn.mockResolvedValue([PERMISSIONS.TENANT_SETTINGS.WRITE]);
        expect(await deleteUser("cust-user", { permanently: true })).toEqual({ success: true });
        expect(await bulkDeleteUsers(["cust-user"], { permanently: true })).toEqual({ success: true, data: { succeeded: ["cust-user"], failed: [] } });
    });

    it("leaves the permanent delete of an account that would wait for a platform admin to a platform admin", async () => {
        const refused = "Deleting permanently needs the right to change the settings.";
        mocks.reach = "all";
        mocks.viewer = { ...NINA, permissions: [...NINA.permissions, PERMISSIONS.TENANT_SETTINGS.WRITE] };
        mocks.service.permissionsIn.mockResolvedValue([PERMISSIONS.TENANT_SETTINGS.WRITE, PERMISSIONS.JOBS.READ]);

        // Tom works in two tenants, so his entry would wait in the home tenant for a platform admin.
        expect(await deleteUser("tech", { permanently: true })).toEqual({ success: false, error: refused });
        expect(await deleteUser("fresh", { permanently: true })).toEqual({ success: false, error: refused });
        expect(mocks.service.deleteUser).not.toHaveBeenCalled();
        expect(await deleteUser("tech")).toEqual({ success: true });

        mocks.viewer = PLATFORM_ADMIN;
        expect(await deleteUser("tech", { permanently: true })).toEqual({ success: true });
        expect(mocks.service.deleteUser).toHaveBeenLastCalledWith("tech", { permanently: true, by: "root" });
    });

    it("makes a new account in any tenant for a platform group of all tenants, as before", async () => {
        mocks.reach = "all";
        expect(await createUser({ ...NEW_USER, tenantId: "tenant-b" })).toEqual({ success: true, data: { id: "u-new" } });
    });
});
