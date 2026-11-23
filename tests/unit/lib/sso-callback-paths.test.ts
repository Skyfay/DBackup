// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
    provider: vi.fn(),
    providers: vi.fn(),
    user: vi.fn(),
    account: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
    default: {
        ssoProvider: { findUnique: (...args: unknown[]) => mocks.provider(...args), findMany: (...args: unknown[]) => mocks.providers(...args) },
        user: { findUnique: (...args: unknown[]) => mocks.user(...args) },
        account: { findFirst: (...args: unknown[]) => mocks.account(...args) },
    },
}));
vi.mock("@/services/audit-service", () => ({ auditService: { log: vi.fn() } }));

const { DISABLED_PROVIDER_URL, TENANT_DOMAIN_SIGN_UP_REFUSED, isSsoCallback, refuseClaimedSsoSignUp, refuseDisabledProvider, ssoProviderIdOf } = await import("@/lib/auth/sso-guard");
const { NOT_LINKED_URL, refuseSsoSession } = await import("@/lib/auth/sso-tenant-guard");

const SHARED = { path: "/sso/callback", params: {} };
const CALLBACK = { path: "/sso/callback/:providerId", params: { providerId: "authentik" } };
const redirect = (url: string) => new Error(`redirect ${url}`);

describe("the callbacks of the providers", () => {
    beforeEach(() => vi.clearAllMocks());

    it("knows the callback of each provider and the shared one without a provider in its path", () => {
        expect(isSsoCallback("/sso/callback/:providerId")).toBe(true);
        expect(isSsoCallback("/sso/callback")).toBe(true);
        expect(isSsoCallback("/sso/saml2/callback/:providerId")).toBe(true);
        expect(isSsoCallback("/sso/saml2/sp/acs/:providerId")).toBe(true);
        expect(isSsoCallback("/sso/saml2/sp/metadata")).toBe(false);
        expect(isSsoCallback("/sign-in/sso")).toBe(false);
        expect(isSsoCallback(undefined)).toBe(false);

        expect(ssoProviderIdOf(CALLBACK)).toBe("authentik");
        expect(ssoProviderIdOf({ path: "/sso/callback", params: { providerId: "authentik" } })).toBe("authentik");
        expect(ssoProviderIdOf(SHARED)).toBeNull();
    });

    it("sends a callback that names no provider back to the login page before it signs anyone in", async () => {
        await expect(refuseDisabledProvider(SHARED, redirect)).rejects.toThrow(`redirect ${DISABLED_PROVIDER_URL}`);
        expect(mocks.provider).not.toHaveBeenCalled();
    });

    it("starts no session from a callback that names no provider", async () => {
        await expect(refuseSsoSession({ userId: "lena" }, SHARED, redirect)).rejects.toThrow(`redirect ${DISABLED_PROVIDER_URL}`);
    });

    it("starts a session from a callback only for an account linked to its provider", async () => {
        mocks.provider.mockResolvedValue({ providerId: "authentik", name: "Authentik", tenantId: null, domain: null, allowProvisioning: true, defaultGroupId: null });
        mocks.account.mockResolvedValueOnce({ id: "acc-1" }).mockResolvedValueOnce(null);

        await expect(refuseSsoSession({ userId: "lena" }, CALLBACK, redirect)).resolves.toBeUndefined();
        await expect(refuseSsoSession({ userId: "lena" }, CALLBACK, redirect)).rejects.toThrow(`redirect ${NOT_LINKED_URL}`);
        expect(mocks.account).toHaveBeenCalledWith({ where: { userId: "lena", providerId: "authentik" }, select: { id: true } });
    });

    it("leaves sessions outside a callback alone", async () => {
        await expect(refuseSsoSession({ userId: "lena" }, { path: "/sign-in/email" }, redirect)).resolves.toBeUndefined();
        await expect(refuseSsoSession({ userId: "lena" }, null, redirect)).resolves.toBeUndefined();
        expect(mocks.account).not.toHaveBeenCalled();
    });
});

describe("someone new through a provider of the platform", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.provider.mockResolvedValue({ tenantId: null });
        mocks.providers.mockResolvedValue([
            { domain: "acme.ch", tenantId: "acme" },
            { domain: "skyfay.ch", tenantId: null },
        ]);
    });

    it("is refused with an email whose domain the provider of a tenant claims, and pointed to that tenant's sign-in", async () => {
        await expect(refuseClaimedSsoSignUp(CALLBACK, { email: "mia@ACME.ch" })).rejects.toMatchObject({ message: TENANT_DOMAIN_SIGN_UP_REFUSED });
    });

    it("is added with a free email or one the platform claims itself", async () => {
        await expect(refuseClaimedSsoSignUp(CALLBACK, { email: "tom@example.ch" })).resolves.toBeUndefined();
        await expect(refuseClaimedSsoSignUp(CALLBACK, { email: "manu@skyfay.ch" })).resolves.toBeUndefined();
    });

    it("leaves a provider of a tenant and every other way of adding a user to the other checks", async () => {
        mocks.provider.mockResolvedValue({ tenantId: "acme" });
        await expect(refuseClaimedSsoSignUp({ path: "/sso/callback/:providerId", params: { providerId: "entra-acme" } }, { email: "mia@acme.ch" })).resolves.toBeUndefined();
        await expect(refuseClaimedSsoSignUp({ path: "/sign-up/email" }, { email: "mia@acme.ch" })).resolves.toBeUndefined();
        expect(mocks.providers).not.toHaveBeenCalled();
    });
});
