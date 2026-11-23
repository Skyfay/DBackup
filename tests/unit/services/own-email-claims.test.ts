import { beforeEach, describe, expect, it, vi } from "vitest";
import { HOME_TENANT_ID } from "@/lib/tenant/home";

/**
 * Someone who sets their own email to one whose domain the sign-in provider of another tenant
 * claims: refused, unless they may give such an email to others, a platform admin or someone with
 * `platform-accounts:write` whose platform group reaches the tenant that claims it.
 */

const mocks = vi.hoisted(() => ({
    /** The account, as `ownEmailRefusal` reads it. */
    account: null as null | { platformRole: string | null; platformGroupId: string | null; memberships: { tenantId: string }[] },
    /** What the platform group of the account gives, as `permissionsIn` reads it. */
    platformGroup: null as null | { platformPermissions: string; tenantPermissions: string; allTenants: boolean; tenants: { tenantId: string }[] },
    reach: [] as string[] | "all",
}));

vi.mock("@/lib/prisma", () => ({
    default: {
        user: {
            findUnique: vi.fn(async ({ select }: { select: Record<string, unknown> }) => {
                if (!mocks.account) return null;
                // The read of `permissionsIn` asks for the platform group.
                return "platformGroup" in select ? { ...mocks.account, memberships: [], platformGroup: mocks.platformGroup } : mocks.account;
            }),
        },
        // Globex claims globex.ch.
        ssoProvider: { findMany: vi.fn(async () => [{ domain: "globex.ch", tenantId: "globex" }]) },
    },
}));
vi.mock("@/services/user/platform-group-service", () => ({ platformGroupService: { reachOf: vi.fn(async () => mocks.reach) } }));
vi.mock("@/services/trash/trash-snapshot", () => ({ keepInTrash: vi.fn() }));

const { userService } = await import("@/services/user/user-service");
const { CLAIMED_EMAIL } = await import("@/services/sso/email-domain-claims");

const group = (platformPermissions: string[], tenantIds: string[]) => ({
    platformPermissions: JSON.stringify(platformPermissions),
    tenantPermissions: "[]",
    allTenants: false,
    tenants: tenantIds.map((tenantId) => ({ tenantId })),
});

describe("setting one's own email to one another tenant claims", () => {
    beforeEach(() => {
        // Nina runs the platform in no tenant, with a platform group.
        mocks.account = { platformRole: null, platformGroupId: "pg-support", memberships: [] };
        mocks.platformGroup = group(["platform-accounts:read", "platform-accounts:write"], ["globex"]);
        mocks.reach = ["globex"];
    });

    it("is refused to someone of a tenant without the right to manage the accounts of the platform", async () => {
        mocks.account = { platformRole: null, platformGroupId: null, memberships: [{ tenantId: "acme" }] };
        mocks.platformGroup = null;
        mocks.reach = [];
        expect(await userService.ownEmailRefusal("lena", "lena@globex.ch")).toBe(CLAIMED_EMAIL);
        expect(await userService.ownEmailRefusal("lena", "lena@acme.ch")).toBeNull();
    });

    it("lets someone whose platform group reaches the tenant that claims it, with the right to manage the accounts, set it", async () => {
        expect(await userService.ownEmailRefusal("nina", "nina@globex.ch")).toBeNull();
    });

    it("is refused when the platform group does not reach that tenant, or gives no right to manage the accounts", async () => {
        mocks.reach = ["acme"];
        mocks.platformGroup = group(["platform-accounts:write"], ["acme"]);
        expect(await userService.ownEmailRefusal("nina", "nina@globex.ch")).toBe(CLAIMED_EMAIL);

        mocks.reach = ["globex"];
        mocks.platformGroup = group(["platform-accounts:read"], ["globex"]);
        expect(await userService.ownEmailRefusal("nina", "nina@globex.ch")).toBe(CLAIMED_EMAIL);
    });

    it("lets a platform admin and a platform group of all tenants set any email", async () => {
        mocks.reach = "all";
        expect(await userService.ownEmailRefusal("nina", "nina@globex.ch")).toBeNull();

        mocks.account = { platformRole: "ADMIN", platformGroupId: null, memberships: [{ tenantId: HOME_TENANT_ID }] };
        mocks.reach = [];
        expect(await userService.ownEmailRefusal("root", "root@globex.ch")).toBeNull();
    });
});
