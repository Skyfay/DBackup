import { beforeEach, describe, expect, it, vi } from "vitest";
import { HOME_TENANT_ID } from "@/lib/tenant/home";

const mocks = vi.hoisted(() => ({ providers: vi.fn() }));

vi.mock("@/lib/prisma", () => ({ default: { ssoProvider: { findMany: (...args: unknown[]) => mocks.providers(...args) } } }));

const { CLAIMED_EMAIL, claimedEmailRefusal, tenantClaimingEmail } = await import("@/services/sso/email-domain-claims");

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
