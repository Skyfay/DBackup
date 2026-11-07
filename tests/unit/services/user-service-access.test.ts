import { beforeEach, describe, expect, it, vi } from "vitest";
import { SHARED_ACCOUNT_REFUSAL } from "@/lib/auth/account-access";

const mocks = vi.hoisted(() => ({
    prisma: {
        group: { findUnique: vi.fn() },
        tenant: { findUnique: vi.fn() },
        user: { findUnique: vi.fn(), findMany: vi.fn(), update: vi.fn() },
        ssoProvider: { findMany: vi.fn(async () => [] as { domain: string; tenantId: string | null }[]) },
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
        const viewers = { permissions: '["jobs:read"]', fullAccess: false };
        const admins = { permissions: "[]", fullAccess: true };
        mocks.prisma.user.findUnique
            .mockResolvedValueOnce({ platformRole: null, memberships: [{ tenantId: "default", group: viewers }, { tenantId: "tenant-a", group: admins }] })
            .mockResolvedValueOnce({ platformRole: "ADMIN", memberships: [] })
            .mockResolvedValueOnce(null);

        expect(await userService.accountOf("tech")).toEqual({
            isPlatformAdmin: false,
            tenantIds: ["default", "tenant-a"],
            platformGroup: null,
            groups: [{ tenantId: "default", group: viewers }, { tenantId: "tenant-a", group: admins }],
        });
        expect(await userService.accountOf("root")).toEqual({ isPlatformAdmin: true, tenantIds: [], platformGroup: null, groups: [] });
        expect(await userService.accountOf("gone")).toBeNull();
    });

    it("counts an account of no tenant whose email the provider of another tenant claims as one of that tenant, so the admin of the home tenant never sets its password", async () => {
        mocks.prisma.ssoProvider.findMany.mockResolvedValue([{ domain: "acme.ch", tenantId: "tenant-a" }, { domain: "msp.ch", tenantId: null }]);
        const hank = { id: "hank", isPlatformAdmin: false, tenantId: "default", permissions: ["users:read", "users:write"] };
        const lena = { id: "lena", email: "lena@acme.ch", platformRole: null as string | null, platformGroupId: null as string | null, memberships: [] };
        mocks.prisma.user.findUnique.mockImplementation(async () => lena);

        expect(await userService.accountOf("lena")).toMatchObject({ tenantIds: ["tenant-a"] });
        expect(await userService.placelessTenantOf("lena")).toBe("tenant-a");
        expect(await userService.accountRefusalFor(hank, "lena")).toBe(SHARED_ACCOUNT_REFUSAL);
        // The admin of tenant A, whose people the email is of, may.
        expect(await userService.accountRefusalFor({ ...hank, tenantId: "tenant-a" }, "lena")).toBeNull();

        // A free domain, or one a provider of the platform claims, leaves it one of the home tenant.
        for (const email of ["lena@free.ch", "lena@msp.ch"]) {
            lena.email = email;
            expect(await userService.accountOf("lena"), email).toMatchObject({ tenantIds: [] });
            expect(await userService.placelessTenantOf("lena"), email).toBe("default");
            expect(await userService.accountRefusalFor(hank, "lena"), email).toBeNull();
        }

        // An account of a platform group counts as one of the platform whatever its email.
        lena.email = "lena@acme.ch";
        lena.platformRole = "ADMIN";
        expect(await userService.accountOf("lena")).toMatchObject({ tenantIds: [] });
    });

    it("judges an account by the tenants the caller's platform group reaches when they manage the accounts of the platform", async () => {
        const nina = { id: "nina", isPlatformAdmin: false, tenantId: "default", permissions: ["platform-accounts:write"] };
        const ofGlobex = { platformRole: null, platformGroupId: null, memberships: [{ tenantId: "tenant-b" }] };
        // Nina's platform group reaches tenant A.
        const support = { platformRole: null, platformGroup: { platformPermissions: "[]", tenantPermissions: "[]", allTenants: false, tenants: [{ tenantId: "tenant-a" }] } };
        mocks.prisma.user.findUnique.mockImplementation(async ({ where }: { where: { id: string } }) => (where.id === "nina" ? support : ofGlobex));

        expect(await userService.accountsReachOf(nina)).toEqual(["tenant-a"]);
        expect(await userService.accountRefusalFor(nina, "max")).toMatch(/does not reach/);

        // Of all tenants, she changes it as before.
        mocks.prisma.user.findUnique.mockImplementation(async ({ where }: { where: { id: string } }) =>
            (where.id === "nina" ? { ...support, platformGroup: { ...support.platformGroup, allTenants: true, tenants: [] } } : ofGlobex));
        expect(await userService.accountRefusalFor(nina, "max")).toBeNull();

        // Without the right to manage the accounts nothing of the platform counts, and a platform admin reaches every tenant.
        expect(await userService.accountsReachOf({ ...nina, permissions: ["users:write"] })).toEqual([]);
        expect(await userService.accountsReachOf({ ...nina, isPlatformAdmin: true })).toBe("all");
    });

    it("refuses an account whose group in another tenant may do more than the caller may there", async () => {
        const nina = { id: "nina", isPlatformAdmin: false, tenantId: "default", permissions: ["platform-accounts:write"] };
        // Max is the Admin of tenant A. Nina's platform group reaches it and lets her read the jobs there.
        const max = { platformRole: null, platformGroupId: null, memberships: [{ tenantId: "tenant-a", group: { permissions: "[]", fullAccess: true } }] };
        const support = {
            platformRole: null,
            memberships: [],
            platformGroup: { platformPermissions: '["platform-accounts:write"]', tenantPermissions: '["jobs:read"]', allTenants: false, tenants: [{ tenantId: "tenant-a" }] },
        };
        mocks.prisma.user.findUnique.mockImplementation(async ({ where }: { where: { id: string } }) => (where.id === "nina" ? support : max));

        expect(await userService.accountRefusalFor(nina, "max")).toBe("This user's group may do more than you may, so only someone who may do all of it can change their account.");

        // Of a group within hers, she changes it.
        max.memberships[0].group = { permissions: '["jobs:read"]', fullAccess: false };
        expect(await userService.accountRefusalFor(nina, "max")).toBeNull();
    });
});
