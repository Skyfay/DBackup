import { beforeEach, describe, expect, it, vi } from "vitest";
import { ALL_TENANTS_PERMISSIONS } from "@/lib/auth/owner-permissions";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { PermissionError } from "@/lib/logging/errors";
import { HOME_TENANT_ID } from "@/lib/tenant/home";

const mocks = vi.hoisted(() => ({
    getAuthContext: vi.fn(),
    getUsersModel: vi.fn(),
    getAllUsersModel: vi.fn(),
    getGroupsModel: vi.fn(),
    getPlatformGroupsModel: vi.fn(),
}));

vi.mock("next/headers", () => ({ headers: async () => new Headers() }));

// The real checks, reduced to the permission list and the tenant of the context.
vi.mock("@/lib/auth/access-control", () => ({
    getAuthContext: (...args: unknown[]) => mocks.getAuthContext(...args),
    checkPermissionWithContext: (ctx: { permissions: string[] }, permission: string) => {
        if (!ctx.permissions.includes(permission)) throw new PermissionError(permission);
    },
    // A platform admin passes everything inside a tenant, like the real check.
    hasPermissionWithContext: (ctx: { permissions: string[]; isPlatformAdmin?: boolean; allTenants?: boolean }, permission: string) =>
        (ctx.isPlatformAdmin === true && !ctx.allTenants) || ctx.permissions.includes(permission),
    tenantOf: (ctx: { tenantId: string | null }) => {
        if (!ctx.tenantId) throw new PermissionError("a tenant");
        return ctx.tenantId;
    },
}));
vi.mock("@/services/user/users-model", () => ({ getUsersModel: (...args: unknown[]) => mocks.getUsersModel(...args) }));
vi.mock("@/services/user/users-all-model", () => ({ getAllUsersModel: (...args: unknown[]) => mocks.getAllUsersModel(...args) }));
vi.mock("@/services/user/groups-model", () => ({
    getGroupsModel: (...args: unknown[]) => mocks.getGroupsModel(...args),
    getPlatformGroupsModel: (...args: unknown[]) => mocks.getPlatformGroupsModel(...args),
}));
// Every tenant for a platform admin, Acme for Nina's platform group.
vi.mock("@/services/user/account-visibility", () => ({
    accountsSeenReach: vi.fn(async (ctx: { isPlatformAdmin: boolean }) => (ctx.isPlatformAdmin ? "all" : ["t-acme"])),
}));

import { GET as getUsers } from "@/app/api/users/route";
import { GET as getGroups } from "@/app/api/groups/route";
import { GET as getPlatformUsers } from "@/app/api/platform/users/route";
import { GET as getPlatformGroups } from "@/app/api/platform/groups/route";

/** A platform admin in All tenants, with what that view allows. */
const inAllTenants = () => mocks.getAuthContext.mockResolvedValue({
    userId: "root",
    permissions: [...ALL_TENANTS_PERMISSIONS],
    isPlatformAdmin: true,
    authMethod: "session",
    tenantId: null,
    allTenants: true,
});
const inTenant = (tenantId: string | null, ...permissions: string[]) => mocks.getAuthContext.mockResolvedValue({
    userId: "lena",
    permissions,
    isPlatformAdmin: false,
    authMethod: "session",
    tenantId,
    allTenants: false,
});

describe("the Users tab in All tenants and in a tenant", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.getUsersModel.mockResolvedValue({ users: [], allTenants: false });
        mocks.getAllUsersModel.mockResolvedValue({ users: [], allTenants: true });
    });

    it("lists every account of the instance once in All tenants, instead of failing for want of a tenant", async () => {
        inAllTenants();
        const response = await getUsers();

        expect(response.status).toBe(200);
        expect(await response.json()).toEqual({ success: true, data: { users: [], allTenants: true } });
        expect(mocks.getAllUsersModel).toHaveBeenCalledWith("root", true);
        expect(mocks.getUsersModel).not.toHaveBeenCalled();
    });

    it("lists the members of the open tenant inside a tenant", async () => {
        inTenant("tenant-a", PERMISSIONS.USERS.READ);
        const response = await getUsers();

        expect(response.status).toBe(200);
        expect(mocks.getUsersModel).toHaveBeenCalledWith("lena", false, "tenant-a");
        expect(mocks.getAllUsersModel).not.toHaveBeenCalled();
    });

    it("refuses an account of no tenant, which is no All tenants", async () => {
        inTenant(null, PERMISSIONS.USERS.READ);
        expect((await getUsers()).status).toBe(403);
        expect(mocks.getUsersModel).not.toHaveBeenCalled();
        expect(mocks.getAllUsersModel).not.toHaveBeenCalled();
    });

    it("needs the right to see the users in All tenants too", async () => {
        mocks.getAuthContext.mockResolvedValue({ userId: "root", permissions: [], isPlatformAdmin: true, authMethod: "session", tenantId: null, allTenants: true });
        expect((await getUsers()).status).toBe(403);
        expect(mocks.getAllUsersModel).not.toHaveBeenCalled();
    });
});

describe("the Groups tab in All tenants and in a tenant", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.getGroupsModel.mockResolvedValue({ groups: [], allTenants: false });
        mocks.getPlatformGroupsModel.mockResolvedValue({ groups: [], allTenants: true });
    });

    it("lists the groups of every tenant in All tenants, read only", async () => {
        inAllTenants();
        const response = await getGroups();

        expect(response.status).toBe(200);
        expect(await response.json()).toEqual({ success: true, data: { groups: [], allTenants: true } });
        expect(mocks.getPlatformGroupsModel).toHaveBeenCalledWith("root");
        expect(mocks.getGroupsModel).not.toHaveBeenCalled();
    });

    it("counts the members of the open tenant inside a tenant, without the people for a viewer who may not see the users", async () => {
        inTenant(HOME_TENANT_ID, PERMISSIONS.GROUPS.READ);
        const response = await getGroups();

        expect(response.status).toBe(200);
        expect(mocks.getGroupsModel).toHaveBeenCalledWith("lena", false, false, HOME_TENANT_ID);
        expect(mocks.getPlatformGroupsModel).not.toHaveBeenCalled();
    });

    it("refuses an account of no tenant", async () => {
        inTenant(null, PERMISSIONS.GROUPS.READ);
        expect((await getGroups()).status).toBe(403);
        expect(mocks.getGroupsModel).not.toHaveBeenCalled();
    });
});

describe("Users & Groups of the Platform", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.getAllUsersModel.mockResolvedValue({ users: [], allTenants: true });
        mocks.getPlatformGroupsModel.mockResolvedValue({ groups: [], allTenants: true });
    });

    it("lists every account and the groups of every tenant for a platform admin inside a customer tenant", async () => {
        mocks.getAuthContext.mockResolvedValue({ userId: "root", permissions: [], isPlatformAdmin: true, authMethod: "session", tenantId: "t-acme", allTenants: false });

        expect((await getPlatformUsers()).status).toBe(200);
        expect((await getPlatformGroups()).status).toBe(200);
        expect(mocks.getAllUsersModel).toHaveBeenCalledWith("root", true);
        expect(mocks.getPlatformGroupsModel).toHaveBeenCalledWith("root", "all");
    });

    it("lists them for someone of a platform group who may see the accounts of the platform, in any tenant, for the tenants it reaches", async () => {
        mocks.getAuthContext.mockResolvedValue({ userId: "nina", permissions: [PERMISSIONS.PLATFORM.ACCOUNTS_READ], isPlatformAdmin: false, authMethod: "session", tenantId: "t-acme", allTenants: false });

        expect((await getPlatformUsers()).status).toBe(200);
        expect((await getPlatformGroups()).status).toBe(200);
        expect(mocks.getAllUsersModel).toHaveBeenCalledWith("nina", false);
        expect(mocks.getPlatformGroupsModel).toHaveBeenCalledWith("nina", ["t-acme"]);
    });

    it("refuses anyone who may not see the accounts of the platform, the admin of the home tenant and every API key included", async () => {
        inTenant(HOME_TENANT_ID, PERMISSIONS.USERS.READ, PERMISSIONS.GROUPS.READ, PERMISSIONS.SETTINGS.READ);
        expect((await getPlatformUsers()).status).toBe(403);
        expect((await getPlatformGroups()).status).toBe(403);

        mocks.getAuthContext.mockResolvedValue({ userId: "root", permissions: [PERMISSIONS.USERS.READ, PERMISSIONS.PLATFORM.ACCOUNTS_READ], isPlatformAdmin: false, authMethod: "apikey", tenantId: HOME_TENANT_ID, allTenants: false });
        expect((await getPlatformUsers()).status).toBe(403);
        expect(mocks.getAllUsersModel).not.toHaveBeenCalled();
        expect(mocks.getPlatformGroupsModel).not.toHaveBeenCalled();
    });

    it("answers no one without a sign-in", async () => {
        mocks.getAuthContext.mockResolvedValue(null);
        expect((await getPlatformUsers()).status).toBe(401);
        expect((await getPlatformGroups()).status).toBe(401);
    });
});
