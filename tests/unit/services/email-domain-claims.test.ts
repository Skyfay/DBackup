import { beforeEach, describe, expect, it, vi } from "vitest";
import { HOME_TENANT_ID } from "@/lib/tenant/home";

const mocks = vi.hoisted(() => ({ providers: vi.fn(), users: vi.fn() }));

vi.mock("@/lib/prisma", () => ({
    default: {
        ssoProvider: { findMany: (...args: unknown[]) => mocks.providers(...args) },
        user: { findMany: (...args: unknown[]) => mocks.users(...args) },
    },
}));

const { CLAIMED_EMAIL, claimedEmailRefusal, tenantClaimingEmail, tenantlessClaimedBeyond } = await import("@/services/sso/email-domain-claims");

describe("the tenant an email belongs to by its domain", () => {
    beforeEach(() => {
        mocks.providers.mockResolvedValue([
            { domain: "beta.ch", tenantId: "beta" },
            // Saved before domains were kept in lowercase.
            { domain: "MSP.CH", tenantId: null },
        ]);
    });

    it("names the tenant of the provider that claims the domain, the home tenant for one of the platform", async () => {
        expect(await tenantClaimingEmail("bob@beta.ch")).toBe("beta");
        expect(await tenantClaimingEmail("new.hire@msp.ch")).toBe(HOME_TENANT_ID);
        expect(await tenantClaimingEmail("someone@free.ch")).toBeNull();
        // A domain below a claimed one is another domain.
        expect(await tenantClaimingEmail("bob@mail.beta.ch")).toBeNull();
    });

    it("refuses an email of another tenant's domain to the admin of a customer, never to the platform", async () => {
        expect(await claimedEmailRefusal("bob@beta.ch", ["acme"], false)).toBe(CLAIMED_EMAIL);
        expect(await claimedEmailRefusal("new.hire@msp.ch", ["acme"], false)).toBe(CLAIMED_EMAIL);
        expect(await claimedEmailRefusal("bob@beta.ch", ["beta"], false)).toBeNull();
        expect(await claimedEmailRefusal("someone@free.ch", ["acme"], false)).toBeNull();
        expect(await claimedEmailRefusal("bob@beta.ch", ["acme"], true)).toBeNull();
    });
});

describe("an account of no tenant whose email the provider of a tenant claims", () => {
    beforeEach(() => {
        mocks.providers.mockResolvedValue([{ domain: "beta.ch", tenantId: "beta" }, { domain: "msp.ch", tenantId: null }]);
        mocks.users.mockResolvedValue([{ email: "bob@beta.ch" }]);
    });

    it("reads only the accounts of no tenant among those asked about", async () => {
        await tenantlessClaimedBeyond(["bob", "eve"], ["acme"]);
        expect(mocks.users).toHaveBeenCalledWith({ where: { id: { in: ["bob", "eve"] }, memberships: { none: {} } }, select: { email: true } });
    });

    it("counts when the claim is of a tenant beyond those given, the home tenant for a provider of the platform", async () => {
        expect(await tenantlessClaimedBeyond(["bob"], ["default", "acme"])).toBe(true);
        expect(await tenantlessClaimedBeyond(["bob"], ["default", "beta"])).toBe(false);

        mocks.users.mockResolvedValue([{ email: "new.hire@msp.ch" }]);
        expect(await tenantlessClaimedBeyond(["hire"], ["acme"])).toBe(true);
        expect(await tenantlessClaimedBeyond(["hire"], ["default"])).toBe(false);
    });

    it("never counts a free domain, an account of a tenant or no account at all", async () => {
        mocks.users.mockResolvedValue([{ email: "someone@free.ch" }]);
        expect(await tenantlessClaimedBeyond(["someone"], ["acme"])).toBe(false);
        mocks.users.mockResolvedValue([]);
        expect(await tenantlessClaimedBeyond(["of-a-tenant"], ["acme"])).toBe(false);
        mocks.users.mockClear();
        expect(await tenantlessClaimedBeyond([], ["acme"])).toBe(false);
        expect(mocks.users).not.toHaveBeenCalled();
    });
});
