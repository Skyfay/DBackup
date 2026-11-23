// @vitest-environment node
/**
 * Whoever manages the tenants adds an account to a tenant on Platform > Tenants and through
 * `/api/tenants/{id}/members`. An account of no tenant whose email the provider of another tenant
 * claims counts as one of that tenant, so only someone who reaches that tenant, or a platform admin,
 * adds it elsewhere. Otherwise the admins of the tenant it joins could set its password afterwards.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { HOME_TENANT_ID } from "@/lib/tenant/home";

const mocks = vi.hoisted(() => ({
    /** The accounts that exist, with the tenants they count as ones of, see `userService.accountOf`. */
    accounts: {} as Record<string, string[]>,
    /** The accounts that work in a tenant, the others are of no tenant. */
    members: new Set<string>(),
    /** What each account may do on the platform, read from the home tenant. */
    platform: {} as Record<string, string[]>,
    /** The tenants the platform group of each account reaches. */
    reach: {} as Record<string, string[] | "all">,
    setRole: vi.fn(),
    audit: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({ default: {} }));
vi.mock("@/services/user/user-service", () => ({
    userService: {
        accountOf: async (id: string) => {
            const tenantIds = mocks.accounts[id];
            if (!tenantIds) return null;
            return { isPlatformAdmin: false, tenantIds, groups: mocks.members.has(id) ? tenantIds.map((tenantId) => ({ tenantId, group: { permissions: "[]", fullAccess: false } })) : [] };
        },
        permissionsIn: async (id: string) => mocks.platform[id] ?? [],
        namesOf: async (ids: string[]) => ids.map((id) => ({ id, name: id })),
    },
}));
vi.mock("@/services/user/platform-group-service", () => ({
    platformGroupService: {
        reachOf: async (id: string) => mocks.reach[id] ?? [],
        reaches: async (id: string, tenantId: string) => {
            const reach = mocks.reach[id] ?? [];
            return reach === "all" || reach.includes(tenantId);
        },
        // Like `membersOfAny`: an account of no tenant counts as one of the home tenant.
        peopleReached: async (id: string) => {
            const reach = mocks.reach[id] ?? [];
            return Object.entries(mocks.accounts)
                .filter(([account, tenantIds]) => reach === "all" || (mocks.members.has(account) ? tenantIds.some((tenantId) => reach.includes(tenantId)) : reach.includes(HOME_TENANT_ID)))
                .map(([account]) => account);
        },
    },
}));
vi.mock("@/services/tenant/membership-service", () => ({
    membershipService: { isPlatformAdmin: async () => false, roleOf: async () => null, setRole: mocks.setRole },
}));
vi.mock("@/services/tenant/tenant-service", () => ({ tenantService: { find: async (id: string) => ({ id, name: id }) } }));
vi.mock("@/services/user/group-service", () => ({ groupService: { find: async (id: string) => ({ id, name: "Viewers", permissions: "[]", fullAccess: false }) } }));
vi.mock("@/services/user/users-model", () => ({ getUsersModel: vi.fn() }));
vi.mock("@/services/user/account-visibility", () => ({ ACCOUNT_UNKNOWN: "The user no longer exists.", shownAccountName: async () => null }));
vi.mock("@/services/tenant/membership-end", () => ({ membershipEndRefusal: async () => null }));
vi.mock("@/services/audit-service", () => ({ auditService: { log: mocks.audit } }));

const { setMemberAs } = await import("@/services/tenant/member-admin");
const { OUTSIDER } = await import("@/services/tenant/member-rules");

/** Manages the tenants of their platform group: the home tenant and tenant A. */
const TOM = { id: "tom", isPlatformAdmin: false, tenantId: HOME_TENANT_ID };

describe("adding an account of no tenant to a tenant on the platform", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        // Lena works in no tenant with an email tenant B claims, Sara in no tenant with a free email.
        mocks.accounts = { lena: ["tenant-b"], sara: [] };
        mocks.members = new Set();
        mocks.platform = { tom: ["platform-tenants:read", "platform-tenants:write"] };
        mocks.reach = { tom: [HOME_TENANT_ID, "tenant-a"] };
    });

    it("never adds an account whose email another tenant claims for someone who does not reach that tenant", async () => {
        await expect(setMemberAs(TOM, "tenant-a", "lena", "g-view")).rejects.toThrow(OUTSIDER);
        expect(mocks.setRole).not.toHaveBeenCalled();
        expect(mocks.audit).not.toHaveBeenCalled();
    });

    it("adds it for someone who reaches the tenant that claims it, and for a platform admin", async () => {
        mocks.reach = { tom: [HOME_TENANT_ID, "tenant-a", "tenant-b"] };
        await setMemberAs(TOM, "tenant-a", "lena", "g-view");
        expect(mocks.setRole).toHaveBeenCalledWith("lena", "tenant-a", "g-view", { platformAdmin: false });

        mocks.reach = {};
        await setMemberAs({ id: "root", isPlatformAdmin: true, tenantId: HOME_TENANT_ID }, "tenant-a", "lena", "g-view");
        expect(mocks.setRole).toHaveBeenLastCalledWith("lena", "tenant-a", "g-view", { platformAdmin: true });
    });

    it("still adds an account of the home tenant for someone who reaches the home tenant", async () => {
        await setMemberAs(TOM, "tenant-a", "sara", "g-view");
        expect(mocks.setRole).toHaveBeenCalledWith("sara", "tenant-a", "g-view", { platformAdmin: false });
    });
});
