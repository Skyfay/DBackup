// @vitest-environment node
/**
 * Ending a membership never hands an account to whoever ends it: an account works for every tenant
 * it is in, and the admin of a tenant changes, and so signs in as, an account of their tenant alone.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { HOME_TENANT_ID } from "@/lib/tenant/home";

const mocks = vi.hoisted(() => ({
    /** The tenants each account works in. */
    accounts: {} as Record<string, string[]>,
    /** What each caller may do by tenant, the rights of the platform under the home tenant. */
    permissions: {} as Record<string, Record<string, string[]>>,
    /** The tenants the platform group of each caller reaches. */
    reach: {} as Record<string, "all" | string[]>,
    /** The tenant whose provider claims the email of an account, when it is not the home tenant. */
    claims: {} as Record<string, string>,
}));

vi.mock("@/services/user/user-service", async () => {
    const { accountRefusal } = await vi.importActual<typeof import("@/lib/auth/account-access")>("@/lib/auth/account-access");
    const { PERMISSIONS: P } = await vi.importActual<typeof import("@/lib/auth/permissions")>("@/lib/auth/permissions");
    const accountOf = async (id: string) => (mocks.accounts[id] ? { isPlatformAdmin: false, tenantIds: mocks.accounts[id] } : null);
    const accountsReachOf = async (caller: { id: string; permissions: readonly string[] }) =>
        caller.permissions.includes(P.PLATFORM.ACCOUNTS_WRITE) ? mocks.reach[caller.id] ?? [] : [];
    return {
        userService: {
            accountOf,
            accountsReachOf,
            permissionsIn: async (id: string, tenantId: string) => mocks.permissions[id]?.[tenantId] ?? [],
            placelessTenantOf: async (id: string) => mocks.claims[id] ?? "default",
            // Like the service, with the real rule.
            accountRefusalFor: async (caller: { id: string; isPlatformAdmin: boolean; tenantId: string | null; permissions: readonly string[] }, id: string) => {
                const target = await accountOf(id);
                return target ? accountRefusal({ ...caller, reach: await accountsReachOf(caller) }, target) : null;
            },
        },
    };
});

const { MEMBERSHIP_END_HANDS_OVER, MEMBERSHIP_END_MOVES_ACCOUNT, membershipEndRefusal } = await import("@/services/tenant/membership-end");

const USERS_WRITE = [PERMISSIONS.USERS.READ, PERMISSIONS.USERS.WRITE];

describe("ending a membership of an account that works in tenants T and Z", () => {
    beforeEach(() => {
        mocks.accounts = { yara: ["t", "z"], tess: ["t"] };
        mocks.permissions = {
            // Manages the tenants of the platform, reaching T and Z, and the users of Z.
            pat: { [HOME_TENANT_ID]: [PERMISSIONS.PLATFORM.TENANTS_WRITE], z: USERS_WRITE },
            // Manages the users of T and of Z, without any right of the platform.
            uma: { t: USERS_WRITE, z: USERS_WRITE },
            // Manages the users of T alone.
            tom: { t: USERS_WRITE },
            // Manages the accounts of the platform in T and Z.
            nina: { [HOME_TENANT_ID]: [PERMISSIONS.PLATFORM.ACCOUNTS_WRITE] },
            // Manages the accounts of the platform in Z, and the users of T.
            zack: { [HOME_TENANT_ID]: [PERMISSIONS.PLATFORM.ACCOUNTS_WRITE], t: USERS_WRITE },
            // Manages the tenants and the users of the home tenant.
            hank: { [HOME_TENANT_ID]: [PERMISSIONS.PLATFORM.TENANTS_WRITE, ...USERS_WRITE] },
        };
        mocks.reach = { pat: ["t", "z"], nina: ["t", "z"], zack: ["z"], hank: ["t"] };
        mocks.claims = {};
    });

    it("refuses someone who manages the tenants and the users of Z, who would then own the account", async () => {
        expect(await membershipEndRefusal({ id: "pat", isPlatformAdmin: false, tenantId: HOME_TENANT_ID }, "yara", "t")).toBe(MEMBERSHIP_END_HANDS_OVER);
    });

    it("refuses someone who manages the users of every tenant of the account, from either side", async () => {
        const uma = { id: "uma", isPlatformAdmin: false, tenantId: "t", permissions: USERS_WRITE };
        expect(await membershipEndRefusal(uma, "yara", "t")).toBe(MEMBERSHIP_END_HANDS_OVER);
        expect(await membershipEndRefusal(uma, "yara", "z")).toBe(MEMBERSHIP_END_HANDS_OVER);
    });

    it("refuses someone whose right to manage the accounts of the platform reaches the tenant left", async () => {
        expect(await membershipEndRefusal({ id: "zack", isPlatformAdmin: false, tenantId: "t", permissions: USERS_WRITE }, "yara", "t")).toBe(MEMBERSHIP_END_HANDS_OVER);
    });

    it("refuses taking out the last membership when the account would then count as one of the home tenant the caller manages", async () => {
        expect(await membershipEndRefusal({ id: "hank", isPlatformAdmin: false, tenantId: HOME_TENANT_ID }, "tess", "t")).toBe(MEMBERSHIP_END_HANDS_OVER);
    });

    it("lets someone who manages the users of the home tenant take out the last membership when the provider of T claims the email, since the account then stays one of T", async () => {
        mocks.claims = { tess: "t" };
        expect(await membershipEndRefusal({ id: "hank", isPlatformAdmin: false, tenantId: HOME_TENANT_ID }, "tess", "t")).toBeNull();
        // Whoever manages the users of T as well would then own it.
        mocks.permissions.hank = { ...mocks.permissions.hank, t: USERS_WRITE };
        expect(await membershipEndRefusal({ id: "hank", isPlatformAdmin: false, tenantId: HOME_TENANT_ID }, "tess", "t")).toBe(MEMBERSHIP_END_HANDS_OVER);
    });

    it("lets the admin of T take the account out of T, since they do not manage the users of Z", async () => {
        expect(await membershipEndRefusal({ id: "tom", isPlatformAdmin: false, tenantId: "t", permissions: USERS_WRITE }, "yara", "t")).toBeNull();
    });

    it("refuses the admin of T who takes Tess out of her only tenant, which would make her an account of the home tenant", async () => {
        // The admin of T changes Tess, who works in T alone, but chose her password too.
        const tom = { id: "tom", isPlatformAdmin: false, tenantId: "t", permissions: USERS_WRITE };
        expect(await membershipEndRefusal(tom, "tess", "t")).toBe(MEMBERSHIP_END_MOVES_ACCOUNT);
        // Someone who manages the accounts of T alone cannot move her to the home tenant either.
        expect(await membershipEndRefusal({ id: "zack", isPlatformAdmin: false, tenantId: "t", permissions: [] }, "tess", "t")).toBe(MEMBERSHIP_END_MOVES_ACCOUNT);
    });

    it("lets the admin of T end the last membership when Tess stays an account of T, whose provider claims her email", async () => {
        mocks.claims = { tess: "t" };
        expect(await membershipEndRefusal({ id: "tom", isPlatformAdmin: false, tenantId: "t", permissions: USERS_WRITE }, "tess", "t")).toBeNull();
    });

    it("lets whoever may change the account already end any of its memberships", async () => {
        // Someone who manages the accounts of every tenant of the account, wherever they work.
        expect(await membershipEndRefusal({ id: "nina", isPlatformAdmin: false, tenantId: "t", permissions: [] }, "yara", "t")).toBeNull();
        expect(await membershipEndRefusal({ id: "root", isPlatformAdmin: true, tenantId: HOME_TENANT_ID }, "yara", "t")).toBeNull();
        expect(await membershipEndRefusal({ id: "root", isPlatformAdmin: true, tenantId: HOME_TENANT_ID }, "tess", "t")).toBeNull();
        // Someone who manages the accounts of T and of the home tenant, where Tess would go.
        mocks.reach.nina = ["t", "z", HOME_TENANT_ID];
        expect(await membershipEndRefusal({ id: "nina", isPlatformAdmin: false, tenantId: "t", permissions: [] }, "tess", "t")).toBeNull();
    });

    it("passes an account that is gone or no member of the tenant", async () => {
        const uma = { id: "uma", isPlatformAdmin: false, tenantId: "t", permissions: USERS_WRITE };
        expect(await membershipEndRefusal(uma, "gone", "t")).toBeNull();
        expect(await membershipEndRefusal(uma, "tess", "z")).toBeNull();
    });
});
