// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
    provider: vi.fn(),
    user: vi.fn(),
    membership: vi.fn(),
    group: vi.fn(),
    createMembership: vi.fn(),
    log: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
    default: {
        ssoProvider: { findUnique: (...args: unknown[]) => mocks.provider(...args) },
        user: { findUnique: (...args: unknown[]) => mocks.user(...args) },
        tenantMembership: {
            findUnique: (...args: unknown[]) => mocks.membership(...args),
            create: (...args: unknown[]) => mocks.createMembership(...args),
        },
        group: { findUnique: (...args: unknown[]) => mocks.group(...args) },
    },
}));
vi.mock("@/services/audit-service", () => ({ auditService: { log: (...args: unknown[]) => mocks.log(...args) } }));

const { refuseSsoSignUp } = await import("@/lib/auth/sso-guard");
const { allowTenantSsoLink, joinSsoTenant, refuseTenantSsoSession, tenantSignInRefusal, TENANT_NOT_MEMBER_URL, TENANT_REFUSED_URL } = await import("@/lib/auth/sso-tenant-guard");

const CALLBACK = { path: "/sso/callback/:providerId", params: { providerId: "entra-acme" } };
const ACME = { providerId: "entra-acme", name: "Acme Entra ID", tenantId: "acme", domain: "acme.ch", allowProvisioning: true, defaultGroupId: "group-acme", enabled: true };
const AUTHENTIK = { ...ACME, providerId: "authentik", name: "Authentik", tenantId: null, domain: "skyfay.ch", defaultGroupId: "group-ops" };
const LENA = { name: "Lena Graf", email: "lena.graf@acme.ch", platformRole: null };
const MANU = { name: "Manu", email: "manu@acme.ch", platformRole: "ADMIN" };
const redirect = (url: string) => new Error(`redirect ${url}`);

describe("sign-ins through the provider of a tenant", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.provider.mockResolvedValue(ACME);
        mocks.user.mockResolvedValue(LENA);
        mocks.membership.mockResolvedValue(null);
        mocks.group.mockResolvedValue({ id: "group-acme", name: "Viewer" });
    });

    it("takes the word of a tenant's provider only for emails of its domain, and never for a platform admin", () => {
        expect(tenantSignInRefusal(ACME, LENA)).toBeNull();
        expect(tenantSignInRefusal(ACME, { email: "Lena.Graf@ACME.CH" })).toBeNull();
        expect(tenantSignInRefusal(ACME, { email: "manu@skyfay.ch" })).toBe("other-domain");
        expect(tenantSignInRefusal(ACME, { email: "lena@mail.acme.ch" })).toBe("other-domain");
        expect(tenantSignInRefusal(ACME, MANU)).toBe("platform-admin");
        // A provider of the platform signs in anyone, as before there were tenants.
        expect(tenantSignInRefusal(AUTHENTIK, MANU)).toBeNull();
        expect(tenantSignInRefusal(AUTHENTIK, { email: "tom@example.ch" })).toBeNull();
    });

    it("adds someone new through a tenant's provider only with an email of its domain", async () => {
        await expect(refuseSsoSignUp(CALLBACK, { email: "lena.graf@acme.ch" })).resolves.toBeUndefined();
        await expect(refuseSsoSignUp(CALLBACK, { email: "mallory@skyfay.ch" })).rejects.toMatchObject({ message: "tenant sign-in refused" });

        mocks.provider.mockResolvedValue(AUTHENTIK);
        await expect(refuseSsoSignUp(CALLBACK, { email: "mallory@other.ch" })).resolves.toBeUndefined();
    });

    it("links no account of another domain and no platform admin to a tenant's provider", async () => {
        expect(await allowTenantSsoLink({ userId: "lena" }, CALLBACK)).toBe(true);

        mocks.user.mockResolvedValue(MANU);
        expect(await allowTenantSsoLink({ userId: "manu" }, CALLBACK)).toBe(false);

        mocks.user.mockResolvedValue({ ...LENA, email: "lena@globex.ch" });
        expect(await allowTenantSsoLink({ userId: "lena" }, CALLBACK)).toBe(false);
    });

    it("leaves links outside a sign-in through a provider of a tenant alone", async () => {
        expect(await allowTenantSsoLink({ userId: "lena" }, { path: "/sign-up/email" })).toBe(true);
        expect(await allowTenantSsoLink({ userId: "lena" }, null)).toBe(true);
        expect(mocks.provider).not.toHaveBeenCalled();

        mocks.provider.mockResolvedValue(AUTHENTIK);
        mocks.user.mockResolvedValue(MANU);
        expect(await allowTenantSsoLink({ userId: "manu" }, CALLBACK)).toBe(true);
    });

    it("sends a refused sign-in back to the login page with the reason, also for a link made before", async () => {
        await expect(refuseTenantSsoSession({ userId: "lena" }, CALLBACK, redirect)).resolves.toBeUndefined();

        mocks.user.mockResolvedValue(MANU);
        await expect(refuseTenantSsoSession({ userId: "manu" }, CALLBACK, redirect)).rejects.toThrow(`redirect ${TENANT_REFUSED_URL}`);

        mocks.user.mockResolvedValue(null);
        await expect(refuseTenantSsoSession({ userId: "gone" }, CALLBACK, redirect)).rejects.toThrow(`redirect ${TENANT_REFUSED_URL}`);
    });

    describe("a provider of a tenant that adds nobody", () => {
        const QUIET = { ...ACME, allowProvisioning: false };

        it("signs in only the members of its tenant", () => {
            expect(tenantSignInRefusal(QUIET, { ...LENA, memberships: [{ tenantId: "acme" }] })).toBeNull();
            expect(tenantSignInRefusal(QUIET, { ...LENA, memberships: [{ tenantId: "globex" }] })).toBe("not-member");
            // One that adds people lets the account join its tenant instead.
            expect(tenantSignInRefusal(ACME, { ...LENA, memberships: [] })).toBeNull();
        });

        it("refuses someone who is no member there with a reason of its own, and links nothing", async () => {
            mocks.provider.mockResolvedValue(QUIET);
            mocks.user.mockResolvedValue({ ...LENA, memberships: [{ tenantId: "default" }] });

            await expect(refuseTenantSsoSession({ userId: "lena" }, CALLBACK, redirect)).rejects.toThrow(`redirect ${TENANT_NOT_MEMBER_URL}`);
            expect(await allowTenantSsoLink({ userId: "lena" }, CALLBACK)).toBe(false);
        });

        it("signs in a member of its tenant", async () => {
            mocks.provider.mockResolvedValue(QUIET);
            mocks.user.mockResolvedValue({ ...LENA, memberships: [{ tenantId: "default" }, { tenantId: "acme" }] });

            await expect(refuseTenantSsoSession({ userId: "lena" }, CALLBACK, redirect)).resolves.toBeUndefined();
            expect(await allowTenantSsoLink({ userId: "lena" }, CALLBACK)).toBe(true);
        });

        it("keeps the reason of a platform admin or another domain before the membership", async () => {
            mocks.provider.mockResolvedValue(QUIET);
            mocks.user.mockResolvedValue({ ...MANU, memberships: [] });

            await expect(refuseTenantSsoSession({ userId: "manu" }, CALLBACK, redirect)).rejects.toThrow(`redirect ${TENANT_REFUSED_URL}`);
        });
    });

    it("lets a provider that adds people sign in someone who is no member yet, who joins on the link", async () => {
        mocks.user.mockResolvedValue({ ...LENA, memberships: [] });

        await expect(refuseTenantSsoSession({ userId: "lena" }, CALLBACK, redirect)).resolves.toBeUndefined();
        expect(await allowTenantSsoLink({ userId: "lena" }, CALLBACK)).toBe(true);
    });

    it("lets every other sign-in start its session", async () => {
        await expect(refuseTenantSsoSession({ userId: "manu" }, { path: "/sign-in/email" }, redirect)).resolves.toBeUndefined();
        mocks.provider.mockResolvedValue(AUTHENTIK);
        mocks.user.mockResolvedValue(MANU);
        await expect(refuseTenantSsoSession({ userId: "manu" }, CALLBACK, redirect)).resolves.toBeUndefined();
    });
});

describe("an account that signs in through the provider of a tenant for the first time", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.provider.mockResolvedValue(ACME);
        mocks.user.mockResolvedValue(LENA);
        mocks.membership.mockResolvedValue(null);
        mocks.group.mockResolvedValue({ id: "group-acme", name: "Viewer" });
    });

    it("joins that tenant with the provider's group, and the log of the tenant says so", async () => {
        await joinSsoTenant({ userId: "lena" }, CALLBACK);

        expect(mocks.createMembership).toHaveBeenCalledWith({ data: { userId: "lena", tenantId: "acme", groupId: "group-acme" } });
        expect(mocks.log).toHaveBeenCalledWith(
            "lena",
            "UPDATE",
            "USER",
            { name: "Lena Graf", email: "lena.graf@acme.ch", via: "sso", change: "Joined through single sign-on", provider: "Acme Entra ID", providerId: "entra-acme", group: "Viewer" },
            "lena",
            { tenantId: "acme" }
        );
    });

    it("keeps the group of someone who is a member there already", async () => {
        mocks.membership.mockResolvedValue({ groupId: "group-admin" });

        await joinSsoTenant({ userId: "lena" }, CALLBACK);

        expect(mocks.createMembership).not.toHaveBeenCalled();
        expect(mocks.log).not.toHaveBeenCalled();
    });

    it("joins nothing through a provider that adds nobody, or whose group is gone", async () => {
        mocks.provider.mockResolvedValue({ ...ACME, allowProvisioning: false });
        await joinSsoTenant({ userId: "lena" }, CALLBACK);

        mocks.provider.mockResolvedValue(ACME);
        mocks.group.mockResolvedValue(null);
        await joinSsoTenant({ userId: "lena" }, CALLBACK);

        expect(mocks.createMembership).not.toHaveBeenCalled();
    });

    it("never adds a platform admin or an account of another domain to the tenant", async () => {
        mocks.user.mockResolvedValue(MANU);
        await joinSsoTenant({ userId: "manu" }, CALLBACK);

        mocks.user.mockResolvedValue({ ...LENA, email: "lena@globex.ch" });
        await joinSsoTenant({ userId: "lena" }, CALLBACK);

        expect(mocks.createMembership).not.toHaveBeenCalled();
    });

    it("leaves a provider of the platform as it was, whose new people placeSsoUser places", async () => {
        mocks.provider.mockResolvedValue(AUTHENTIK);

        await joinSsoTenant({ userId: "lena" }, CALLBACK);

        expect(mocks.membership).not.toHaveBeenCalled();
        expect(mocks.createMembership).not.toHaveBeenCalled();
    });
});
