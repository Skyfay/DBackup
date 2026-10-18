import { beforeEach, describe, expect, it, vi } from "vitest";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { HOME_TENANT_ID } from "@/lib/tenant/home";

/**
 * Whose log keeps a change of an account. Nina of the platform works in the tenant of Acme and
 * changes the accounts of Acme and of Globex from Platform > Users & Groups. Acme must never read
 * what she did to the account of Globex, nor the new email she gave it.
 */

interface TestViewer {
    id: string;
    name: string;
    email: string;
    isPlatformAdmin: boolean;
    tenantId: string | null;
    allTenants: boolean;
    permissions: string[];
}

const mocks = vi.hoisted(() => ({
    viewer: null as unknown as TestViewer,
    /** The people of each tenant, as `membershipService.isPersonOf` reads them. */
    people: new Map<string, Set<string>>(),
    service: {
        accountRefusalFor: vi.fn(async () => null),
        accountsReachOf: vi.fn(async () => "all"),
        deleteUser: vi.fn(),
        deleteUsers: vi.fn(),
        togglePasskeyTwoFactor: vi.fn(),
        updateUser: vi.fn(),
        resetTwoFactor: vi.fn(),
        revokeSession: vi.fn(async () => true),
        revokeSessions: vi.fn(async () => 2),
        namesOf: vi.fn(async () => []),
        emailOf: vi.fn(async (id: string) => `${id}@example.ch`),
    },
    audit: vi.fn(),
}));

vi.mock("@/lib/auth/access-control", () => ({
    checkPermission: vi.fn(async () => mocks.viewer),
    getViewer: vi.fn(async () => mocks.viewer),
    hasPermission: vi.fn(async () => true),
    hasPermissionWithContext: (viewer: TestViewer, permission: string) => viewer.isPlatformAdmin || viewer.permissions.includes(permission),
    currentSessionId: vi.fn(async () => "s-nina"),
}));
vi.mock("@/lib/auth", () => ({ auth: { api: {} } }));
vi.mock("next/headers", () => ({ headers: vi.fn(async () => new Headers()) }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/prisma", () => ({ default: {} }));
vi.mock("@/services/user/user-service", () => ({ userService: mocks.service }));
vi.mock("@/services/user/group-service", () => ({ groupService: { find: vi.fn() } }));
vi.mock("@/services/tenant/membership-service", () => ({
    membershipService: { isPersonOf: vi.fn(async (userId: string, tenantId: string) => mocks.people.get(tenantId)?.has(userId) ?? false) },
}));
vi.mock("@/services/tenant/tenant-service", () => ({ tenantService: { switchable: vi.fn(async () => []) } }));
vi.mock("@/services/auth/auth-service", () => ({ authService: { setPassword: vi.fn() } }));
vi.mock("@/services/audit-service", () => ({ auditService: { log: mocks.audit } }));
vi.mock("@/services/notifications/system-notification-service", () => ({ notify: vi.fn(async () => undefined) }));
vi.mock("@/services/sso/email-domain-claims", () => ({ claimedEmailRefusal: vi.fn(async () => null) }));

const { bulkDeleteUsers, deleteUser, togglePasskeyTwoFactor, updateUser } = await import("@/app/actions/auth/user");
const { resetUserTwoFactor, revokeUserSession, revokeUserSessions, setUserPassword } = await import("@/app/actions/auth/user-security");

const NINA: TestViewer = {
    id: "nina",
    name: "Nina",
    email: "nina@msp.ch",
    isPlatformAdmin: false,
    tenantId: "acme",
    allTenants: false,
    permissions: [PERMISSIONS.USERS.WRITE, PERMISSIONS.PLATFORM.ACCOUNTS_WRITE],
};
const ACME_LOG = { tenantId: "acme" };
const PLATFORM_LOG = { tenantId: HOME_TENANT_ID };

/** The origin the last entry was written with. */
const lastOrigin = () => mocks.audit.mock.calls.at(-1)?.[5];

describe("the log of a change of an account", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.viewer = NINA;
        mocks.people = new Map([["acme", new Set(["anna"])], ["globex", new Set(["bob"])]]);
        mocks.service.deleteUser.mockImplementation(async (id: string) => {
            // The delete ends the memberships of the account.
            for (const people of mocks.people.values()) people.delete(id);
            return { name: id, email: `${id}@example.ch` };
        });
        mocks.service.deleteUsers.mockResolvedValue({ succeeded: [], failed: [] });
        mocks.service.togglePasskeyTwoFactor.mockImplementation(async (id: string) => ({ name: id }));
    });

    it("is the log of the platform for the password, second factor and sessions of an account of another tenant", async () => {
        await setUserPassword("bob", { password: "a new password", signOut: false });
        expect(lastOrigin()).toEqual(PLATFORM_LOG);
        await resetUserTwoFactor("bob");
        expect(lastOrigin()).toEqual(PLATFORM_LOG);
        await revokeUserSession("bob", "s-bob");
        expect(lastOrigin()).toEqual(PLATFORM_LOG);
        await revokeUserSessions("bob");
        expect(lastOrigin()).toEqual(PLATFORM_LOG);
        expect(mocks.audit).toHaveBeenCalledTimes(4);
    });

    it("is the log of the tenant for an account of its people", async () => {
        await setUserPassword("anna", { password: "a new password", signOut: false });
        expect(lastOrigin()).toEqual(ACME_LOG);
        await revokeUserSessions("anna");
        expect(lastOrigin()).toEqual(ACME_LOG);
    });

    it("keeps the new name and email of an account of another tenant out of the tenant's log", async () => {
        await updateUser("bob", { name: "Bob Meier", email: "bob@globex.ch" });

        expect(mocks.audit).toHaveBeenCalledWith("nina", "UPDATE", "USER", { name: "Bob Meier", email: "bob@globex.ch" }, "bob", PLATFORM_LOG);
    });

    it("writes a delete into the log of the tenant the account worked in, read before the delete", async () => {
        await deleteUser("anna");
        expect(lastOrigin()).toEqual(ACME_LOG);

        await deleteUser("bob");
        expect(lastOrigin()).toEqual(PLATFORM_LOG);
    });

    it("writes a bulk delete into the log of the platform once one account belongs to another tenant", async () => {
        await bulkDeleteUsers(["anna"]);
        expect(lastOrigin()).toEqual(ACME_LOG);

        await bulkDeleteUsers(["anna", "bob"]);
        expect(lastOrigin()).toEqual(PLATFORM_LOG);
    });

    it("is the log of the platform for every change made from All tenants", async () => {
        mocks.viewer = { ...NINA, tenantId: null, allTenants: true };

        await setUserPassword("anna", { password: "a new password", signOut: false });
        expect(lastOrigin()).toEqual(PLATFORM_LOG);
        await updateUser("anna", { name: "Anna Keller" });
        expect(lastOrigin()).toEqual(PLATFORM_LOG);
    });
});

describe("the passkey as the second factor", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.viewer = NINA;
        mocks.people = new Map([["acme", new Set(["anna", "nina"])], ["globex", new Set(["bob"])]]);
        mocks.service.togglePasskeyTwoFactor.mockImplementation(async (id: string) => ({ name: id }));
    });

    it("writes the change of another account's second factor to the audit log, of the platform for another tenant", async () => {
        expect(await togglePasskeyTwoFactor("bob", false)).toEqual({ success: true });

        expect(mocks.audit).toHaveBeenCalledWith(
            "nina",
            "UPDATE",
            "USER",
            { name: "bob", changes: [{ field: "Passkey as second factor", from: "On", to: "Off" }] },
            "bob",
            PLATFORM_LOG
        );
    });

    it("writes it for an account of the tenant and for the own account into the tenant's log", async () => {
        await togglePasskeyTwoFactor("anna", true);
        expect(mocks.audit).toHaveBeenLastCalledWith("nina", "UPDATE", "USER", expect.objectContaining({ name: "anna" }), "anna", ACME_LOG);

        await togglePasskeyTwoFactor("nina", true);
        expect(mocks.audit).toHaveBeenLastCalledWith("nina", "UPDATE", "USER", expect.objectContaining({ name: "nina" }), "nina", ACME_LOG);
    });

    it("writes nothing when the change is refused", async () => {
        mocks.service.accountRefusalFor.mockResolvedValueOnce("Only a platform admin changes this account." as never);

        expect(await togglePasskeyTwoFactor("bob", false)).toEqual({ success: false, error: "Only a platform admin changes this account." });
        expect(mocks.audit).not.toHaveBeenCalled();
    });
});

describe("the name of another account", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.viewer = NINA;
        mocks.people = new Map([["acme", new Set(["anna"])], ["globex", new Set(["bob"])]]);
    });

    it("changes with its own email sent along, which no claimed domain refuses since it stays", async () => {
        const { claimedEmailRefusal } = await import("@/services/sso/email-domain-claims");
        vi.mocked(claimedEmailRefusal).mockResolvedValue("The domain of this email signs in through the provider of another tenant.");

        // The form sends Bob's email as it is, which is not Nina's own.
        expect(await updateUser("bob", { name: "Bob Meier", email: "bob@example.ch" })).toEqual({ success: true });
        expect(claimedEmailRefusal).not.toHaveBeenCalled();

        // A new email is still checked.
        expect(await updateUser("bob", { name: "Bob Meier", email: "bob@claimed.example" })).toEqual({ success: false, error: expect.stringContaining("provider of another tenant") });
        vi.mocked(claimedEmailRefusal).mockResolvedValue(null);
    });
});
