/**
 * A sign-in through the provider of a tenant that blocks the local network runs with the reach of
 * that tenant, so the fetches of the SSO plugin dial only checked addresses and a name of the
 * provider that answers another address at connect time reaches no blocked one.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
    providers: vi.fn(),
    reach: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({ default: { ssoProvider: { findMany: (...args: unknown[]) => mocks.providers(...args) } } }));
vi.mock("@/services/tenant/tenant-network", () => ({ tenantReach: (...args: unknown[]) => mocks.reach(...args) }));

const { ssoFetchReach, withSsoFetchReach } = await import("@/lib/auth/sso-fetch-reach");

const BLOCKED = { allowed: [] };
const seen = (request: Request) => withSsoFetchReach(request, async () => ssoFetchReach());
const post = (path: string, body: unknown) => new Request(`https://backup.example.test/api/auth${path}`, { method: "POST", body: JSON.stringify(body), headers: { "content-type": "application/json" } });

beforeEach(() => {
    vi.clearAllMocks();
    mocks.reach.mockImplementation(async (tenantId: string) => (tenantId === "acme" ? { blocks: true, policy: BLOCKED } : { blocks: false, policy: null }));
    mocks.providers.mockImplementation(async ({ where }: { where: { providerId?: string } }) => {
        const all = [{ providerId: "acme-idp", domain: "acme.ch", tenantId: "acme" }, { providerId: "home-idp", domain: "msp.ch", tenantId: null }];
        return where.providerId ? all.filter((provider) => provider.providerId === where.providerId) : all;
    });
});

describe("the reach of a sign-in through a provider", () => {
    it("is the reach of the tenant of the provider on its callback and its sign-in", async () => {
        expect(await seen(new Request("https://backup.example.test/api/auth/sso/callback/acme-idp?code=1&state=2"))).toEqual(BLOCKED);
        expect(await seen(post("/sign-in/sso", { providerId: "acme-idp", callbackURL: "/dashboard" }))).toEqual(BLOCKED);
        expect(await seen(post("/sign-in/sso", { email: "anna@acme.ch" }))).toEqual(BLOCKED);
    });

    it("is none for a provider of the platform, an unknown one and every other request", async () => {
        expect(await seen(new Request("https://backup.example.test/api/auth/sso/callback/home-idp?code=1"))).toBeNull();
        expect(await seen(new Request("https://backup.example.test/api/auth/sso/callback/gone?code=1"))).toBeNull();
        expect(await seen(post("/sign-in/email", { email: "anna@acme.ch", password: "x" }))).toBeNull();
    });

    it("leaves the body of the request for better-auth to read", async () => {
        const request = post("/sign-in/sso", { providerId: "acme-idp" });

        await withSsoFetchReach(request, async () => null);

        await expect(request.json()).resolves.toEqual({ providerId: "acme-idp" });
    });
});
