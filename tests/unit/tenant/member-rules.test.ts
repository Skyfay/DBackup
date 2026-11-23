// @vitest-environment node
/**
 * Who gives a group of a tenant to someone from inside that tenant. An account the caller may not
 * see answers like one that does not exist, and an account of no tenant whose email the provider of
 * another tenant claims counts as one of that tenant, so the home tenant does not pull it in.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { HOME_TENANT_ID } from "@/lib/tenant/home";

const mocks = vi.hoisted(() => ({
    /** The accounts that exist, with the tenants they count as ones of, see `userService.accountOf`. */
    accounts: {} as Record<string, string[]>,
    /** The people of each tenant, see `membershipService.isPersonOf`. */
    people: {} as Record<string, string[]>,
    /** The accounts that work in a tenant, the others are of no tenant. */
    members: new Set<string>(),
    /** What each account may do on the platform, read from the home tenant. */
    platform: {} as Record<string, string[]>,
    /** The tenants the platform group of each account reaches. */
    reach: {} as Record<string, string[] | "all">,
}));

vi.mock("@/services/user/user-service", () => ({
    userService: {
        accountOf: async (id: string) => {
            const tenantIds = mocks.accounts[id];
            if (!tenantIds) return null;
            return { isPlatformAdmin: false, tenantIds, groups: mocks.members.has(id) ? tenantIds.map((tenantId) => ({ tenantId, group: { permissions: "[]", fullAccess: false } })) : [] };
        },
        permissionsIn: async (id: string) => mocks.platform[id] ?? [],
    },
}));
vi.mock("@/services/user/platform-group-service", () => ({ platformGroupService: { reachOf: async (id: string) => mocks.reach[id] ?? [] } }));
vi.mock("@/services/tenant/membership-service", () => ({
    membershipService: {
        isPersonOf: async (id: string, tenantId: string) => (mocks.people[tenantId] ?? []).includes(id),
        isPlatformAdmin: async () => false,
        roleOf: async () => null,
    },
}));
// Like the service: the people of the tenant of the viewer, and nobody else, for a viewer without rights of the platform.
vi.mock("@/services/user/account-visibility", () => ({
    ACCOUNT_UNKNOWN: "The user no longer exists.",
    shownAccountName: async (viewer: { tenantId: string | null }, id: string) =>
        (mocks.accounts[id] && viewer.tenantId && (mocks.people[viewer.tenantId] ?? []).includes(id) ? id : null),
}));
vi.mock("@/services/user/group-service", () => ({ groupService: { find: async (id: string) => ({ id, name: "Viewers", permissions: "[]", fullAccess: false }) } }));
vi.mock("@/services/tenant/membership-end", () => ({ membershipEndRefusal: async () => null }));

const { OUTSIDER, placementRefusal, tenantGroupRefusal } = await import("@/services/tenant/member-rules");

const HANK = { id: "hank", isPlatformAdmin: false, tenantId: HOME_TENANT_ID, permissions: ["users:read", "users:write"] };

describe("the admin of the home tenant giving a group", () => {
    beforeEach(() => {
        // Sara works in no tenant with a free email, Lena in no tenant with an email tenant B claims, Gina in tenant B.
        mocks.accounts = { sara: [], lena: ["tenant-b"], gina: ["tenant-b"] };
        mocks.people = { [HOME_TENANT_ID]: ["sara", "lena"], "tenant-b": ["gina"] };
        mocks.members = new Set(["gina"]);
        mocks.platform = {};
        mocks.reach = {};
    });

    it("gives one to such an account when their rights of the platform reach the tenant that claims it", async () => {
        mocks.platform = { hank: ["platform-accounts:write"] };
        mocks.reach = { hank: [HOME_TENANT_ID, "tenant-b"] };
        expect(await tenantGroupRefusal(HANK, "lena", "g-view")).toBeNull();

        // A platform group that reaches the tenant without a right of the platform is not enough.
        mocks.platform = {};
        expect(await tenantGroupRefusal(HANK, "lena", "g-view")).toBe(OUTSIDER);
    });

    it("gives one to an account of no tenant, which counts as one of the home tenant", async () => {
        expect(await tenantGroupRefusal(HANK, "sara", "g-view")).toBeNull();
    });

    it("gives none to an account of no tenant whose email the provider of another tenant claims", async () => {
        expect(await tenantGroupRefusal(HANK, "lena", "g-view")).toBe(OUTSIDER);
    });

    it("answers an account it may not see like one that does not exist", async () => {
        const unseen = await tenantGroupRefusal(HANK, "gina", "g-view");
        expect(unseen).toBe("The user no longer exists.");
        expect(await tenantGroupRefusal(HANK, "nobody", "g-view")).toBe(unseen);
    });
});

describe("who places an account of no tenant in another tenant", () => {
    const TOM = { id: "tom", isPlatformAdmin: false };

    beforeEach(() => {
        // Sara works in no tenant with a free email, Lena in no tenant with an email tenant B claims, Gina in tenant B.
        mocks.accounts = { sara: [], lena: ["tenant-b"], gina: ["tenant-b"] };
        mocks.members = new Set(["gina"]);
        mocks.platform = { tom: ["platform-tenants:write"] };
        mocks.reach = { tom: [HOME_TENANT_ID, "tenant-a"] };
    });

    it("keeps an account whose email tenant B claims out of tenant A for someone who does not reach tenant B", async () => {
        expect(await placementRefusal(TOM, "lena", "tenant-a")).toBe(OUTSIDER);
        expect(await placementRefusal(TOM, "lena", HOME_TENANT_ID)).toBe(OUTSIDER);
    });

    it("places it in the tenant that claims it, and anywhere for whoever reaches that tenant or a platform admin", async () => {
        expect(await placementRefusal(TOM, "lena", "tenant-b")).toBeNull();
        mocks.reach = { tom: [HOME_TENANT_ID, "tenant-a", "tenant-b"] };
        expect(await placementRefusal(TOM, "lena", "tenant-a")).toBeNull();
        expect(await placementRefusal({ id: "root", isPlatformAdmin: true }, "lena", "tenant-a")).toBeNull();
    });

    it("places an account of the home tenant for someone whose rights reach the home tenant", async () => {
        expect(await placementRefusal(TOM, "sara", "tenant-a")).toBeNull();
        mocks.reach = { tom: ["tenant-a"] };
        expect(await placementRefusal(TOM, "sara", "tenant-a")).toBe(OUTSIDER);
    });

    it("counts the rights an API key holds, not those of its owner", async () => {
        mocks.reach = { tom: [HOME_TENANT_ID, "tenant-a", "tenant-b"] };
        // The owner may manage the accounts, the key was made with the right to manage users alone.
        const key = { ...TOM, authMethod: "apikey" as const, permissions: ["users:read", "users:write"] };
        expect(await placementRefusal(TOM, "lena", "tenant-a")).toBeNull();
        expect(await placementRefusal(key, "lena", "tenant-a")).toBe(OUTSIDER);
        expect(await placementRefusal({ ...key, permissions: undefined }, "lena", "tenant-a")).toBe(OUTSIDER);
        expect(await placementRefusal({ ...key, permissions: ["platform-accounts:write"] }, "lena", "tenant-a")).toBeNull();
        // A key with the right still reaches only what its owner reaches.
        mocks.reach = { tom: [HOME_TENANT_ID, "tenant-a"] };
        expect(await placementRefusal({ ...key, permissions: ["platform-accounts:write"] }, "lena", "tenant-a")).toBe(OUTSIDER);
        expect(await tenantGroupRefusal({ ...HANK, id: "tom", authMethod: "apikey" }, "lena", "g-view")).toBe(OUTSIDER);
    });

    it("leaves an account with a membership and one that is gone to the other rules", async () => {
        mocks.reach = {};
        expect(await placementRefusal(TOM, "gina", "tenant-a")).toBeNull();
        expect(await placementRefusal(TOM, "nobody", "tenant-a")).toBeNull();
    });
});
