// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ providers: vi.fn(), tenants: vi.fn(async (): Promise<{ id: string; allowedNetworks: string }[]> => []), lookup: vi.fn() }));
vi.mock("@/lib/prisma", () => ({
    default: {
        ssoProvider: { findMany: (...args: unknown[]) => mocks.providers(...args) },
        tenant: { findMany: (...args: unknown[]) => mocks.tenants(...(args as [])) },
    },
}));
// No test resolves a real name.
const lookup = (...args: unknown[]) => mocks.lookup(...args);
vi.mock("node:dns", () => ({ default: { promises: { lookup } }, promises: { lookup } }));

const { foreignSsoTarget, trustedOriginsFor } = await import("@/lib/auth/trusted-origins");

const request = (path: string, method = "POST") => new Request(`https://backup.example.ch/api/auth${path}`, { method });

describe("the origins better-auth trusts", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.stubEnv("BETTER_AUTH_URL", "https://backup.example.ch");
        vi.stubEnv("TRUSTED_ORIGINS", "https://10.0.0.5:3000, http://localhost:3000");
        // Pocket ID of a tenant on a path-less issuer, which better-auth would match as an origin.
        mocks.providers.mockResolvedValue([{ providerId: "pocket-acme", issuer: "https://id.acme.ch", tenantId: null }, { providerId: "saml", issuer: null, tenantId: null }]);
    });

    afterEach(() => {
        vi.unstubAllEnvs();
    });

    it("is the address of DBackup for every request that reads no endpoints of a provider", async () => {
        const own = ["https://backup.example.ch", "https://10.0.0.5:3000", "http://localhost:3000"];
        expect(await trustedOriginsFor(request("/sign-in/email"))).toEqual(own);
        expect(await trustedOriginsFor(request("/sign-out"))).toEqual(own);
        expect(await trustedOriginsFor(request("/change-password"))).toEqual(own);
        expect(await trustedOriginsFor(undefined)).toEqual(own);
        expect(mocks.providers).not.toHaveBeenCalled();
    });

    it("adds the issuers where the SSO plugin checks the endpoints of a provider", async () => {
        expect(await trustedOriginsFor(request("/sign-in/sso"))).toContain("https://id.acme.ch");
        expect(await trustedOriginsFor(request("/sso/callback/pocket-acme?code=1&state=2", "GET"))).toContain("https://id.acme.ch");
    });

    describe("for the provider of a customer whose tenant reaches no local network", () => {
        const sso = () => trustedOriginsFor(request("/sign-in/sso"));

        beforeEach(() => {
            mocks.tenants.mockResolvedValue([{ id: "acme", allowedNetworks: "[]" }]);
            mocks.lookup.mockImplementation(async (host: string) => {
                if (host === "id.acme.ch") return [{ address: "203.0.113.10", family: 4 }];
                if (host === "inside.acme.ch") return [{ address: "10.0.0.7", family: 4 }];
                throw new Error("ENOTFOUND");
            });
        });

        it("does not lift the private address check for an issuer on a loopback or private address", async () => {
            mocks.providers.mockResolvedValue([{ providerId: "acme-idp", issuer: "http://127.0.0.1:8099", tenantId: "acme" }]);
            expect(await sso()).not.toContain("http://127.0.0.1:8099");
            mocks.providers.mockResolvedValue([{ providerId: "acme-idp", issuer: "https://[::1]:8443", tenantId: "acme" }]);
            expect(await sso()).not.toContain("https://[::1]:8443");
        });

        it("does not lift it for a name that leads into the local network or nowhere", async () => {
            mocks.providers.mockResolvedValue([
                { providerId: "acme-inside", issuer: "https://inside.acme.ch", tenantId: "acme" },
                { providerId: "acme-gone", issuer: "https://gone.acme.ch", tenantId: "acme" },
            ]);
            const trusted = await sso();
            expect(trusted).not.toContain("https://inside.acme.ch");
            expect(trusted).not.toContain("https://gone.acme.ch");
        });

        it("keeps trusting a public issuer, and one inside a range the platform allows the tenant", async () => {
            mocks.providers.mockResolvedValue([
                { providerId: "acme-idp", issuer: "https://id.acme.ch", tenantId: "acme" },
                { providerId: "acme-inside", issuer: "https://inside.acme.ch", tenantId: "acme" },
            ]);
            expect(await sso()).toContain("https://id.acme.ch");
            mocks.tenants.mockResolvedValue([{ id: "acme", allowedNetworks: '["10.0.0.0/24"]' }]);
            expect(await sso()).toContain("https://inside.acme.ch");
        });

        it("keeps the internal provider of the platform, of the home tenant and of a tenant that reaches the local network", async () => {
            mocks.providers.mockResolvedValue([
                { providerId: "platform", issuer: "http://10.0.0.5:9000", tenantId: null },
                { providerId: "home", issuer: "http://10.0.0.6:9000", tenantId: "default" },
                { providerId: "open", issuer: "http://10.0.0.8:9000", tenantId: "open-tenant" },
            ]);
            expect(await sso()).toEqual(expect.arrayContaining(["http://10.0.0.5:9000", "http://10.0.0.6:9000", "http://10.0.0.8:9000"]));
            // Only the customers' tenants are asked whether they block, never the home tenant.
            expect(mocks.tenants).toHaveBeenCalledWith({ where: { id: { in: ["open-tenant"] }, blocksLocalNetwork: true }, select: { id: true, allowedNetworks: true } });
        });

        it("asks on a callback only about the provider of its path", async () => {
            mocks.providers.mockResolvedValue([
                { providerId: "acme-idp", issuer: "https://id.acme.ch", tenantId: "acme" },
                { providerId: "acme-gone", issuer: "https://gone.acme.ch", tenantId: "acme" },
            ]);
            const trusted = await trustedOriginsFor(request("/sso/callback/acme-idp?code=1&state=2", "GET"));
            expect(trusted).toContain("https://id.acme.ch");
            expect(mocks.lookup).toHaveBeenCalledTimes(1);
        });
    });

    it("refuses a target on /sign-in/sso that only the issuer of a provider lets pass", async () => {
        const headers = new Headers({ origin: "https://backup.example.ch" });
        expect(await foreignSsoTarget("/sign-in/sso", { callbackURL: "/dashboard", errorCallbackURL: "/?error=sso" }, headers)).toBeNull();
        expect(await foreignSsoTarget("/sign-in/sso", { callbackURL: "https://backup.example.ch/dashboard" }, headers)).toBeNull();

        expect(await foreignSsoTarget("/sign-in/sso", { callbackURL: "https://id.acme.ch/steal" }, headers)).toBe("https://id.acme.ch/steal");
        expect(await foreignSsoTarget("/sign-in/sso", { callbackURL: "/dashboard", newUserCallbackURL: "https://id.acme.ch/" }, headers)).toBe("https://id.acme.ch/");
        expect(await foreignSsoTarget("/sign-in/sso", { callbackURL: "/dashboard" }, new Headers({ origin: "https://id.acme.ch" }))).toBe("https://id.acme.ch");
    });

    it("leaves other paths and an issuer on the address of DBackup alone", async () => {
        expect(await foreignSsoTarget("/sign-in/email", { callbackURL: "https://id.acme.ch/" }, null)).toBeNull();

        mocks.providers.mockResolvedValue([{ issuer: "https://backup.example.ch" }]);
        expect(await foreignSsoTarget("/sign-in/sso", { callbackURL: "https://backup.example.ch/dashboard" }, null)).toBeNull();
    });
});
