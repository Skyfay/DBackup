// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ providers: vi.fn() }));
vi.mock("@/lib/prisma", () => ({ default: { ssoProvider: { findMany: (...args: unknown[]) => mocks.providers(...args) } } }));

const { foreignSsoTarget, trustedOriginsFor } = await import("@/lib/auth/trusted-origins");

const request = (path: string, method = "POST") => new Request(`https://backup.example.ch/api/auth${path}`, { method });

describe("the origins better-auth trusts", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.stubEnv("BETTER_AUTH_URL", "https://backup.example.ch");
        vi.stubEnv("TRUSTED_ORIGINS", "https://10.0.0.5:3000, http://localhost:3000");
        // Pocket ID of a tenant on a path-less issuer, which better-auth would match as an origin.
        mocks.providers.mockResolvedValue([{ issuer: "https://id.acme.ch" }, { issuer: null }]);
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
        expect(mocks.providers).toHaveBeenCalledWith({ where: { enabled: true }, select: { issuer: true } });
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
