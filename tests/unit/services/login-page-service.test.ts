import { beforeEach, describe, expect, it, vi } from "vitest";
import { prismaMock } from "@/lib/testing/prisma-mock";
import { ADAPTER_DEFINITIONS } from "@/lib/adapters/definitions";

const mocks = vi.hoisted(() => ({ redirect: vi.fn(), emailOff: vi.fn(), picture: vi.fn() }));

vi.mock("@/lib/auth/env-flags", () => ({
    getOidcAutoRedirectProviderId: () => mocks.redirect(),
    isEmailLoginDisabled: () => mocks.emailOff(),
}));
vi.mock("@/services/system/login-image-service", () => ({ getLoginPicture: () => mocks.picture() }));

const { findDomainProvider, getLoginPageModel, loginAdapters } = await import("@/services/auth/login-page-service");

const authentik = { id: "p1", providerId: "authentik", name: "Authentik", adapterId: "authentik", domain: "example.ch", allowProvisioning: false, issuer: "https://auth.example.ch/application/o/dbackup/" };

describe("what the login page shows", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        prismaMock.user.count.mockResolvedValue(2);
        prismaMock.ssoProvider.findMany.mockResolvedValue([authentik] as never);
        prismaMock.ssoProvider.count.mockResolvedValue(0);
        prismaMock.systemSetting.findUnique.mockResolvedValue(null);
        prismaMock.systemSetting.findMany.mockResolvedValue([]);
        mocks.redirect.mockReturnValue(undefined);
        mocks.emailOff.mockReturnValue(false);
        mocks.picture.mockResolvedValue(null);
    });

    it("lists the providers with where they live, and never reads a secret of them", async () => {
        const model = await getLoginPageModel();

        const select = (prismaMock.ssoProvider.findMany.mock.calls[0][0] as { select: Record<string, boolean> }).select;
        expect(Object.keys(select)).not.toEqual(expect.arrayContaining(["clientId"]));
        expect(select).not.toHaveProperty("clientSecret");
        expect(select).not.toHaveProperty("oidcConfig");
        expect(model.providers).toEqual([{ id: "p1", providerId: "authentik", name: "Authentik", adapterId: "authentik", domain: "example.ch", allowProvisioning: false, host: "auth.example.ch" }]);
    });

    it("starts the first start while nobody has an account", async () => {
        prismaMock.user.count.mockResolvedValue(0);

        expect((await getLoginPageModel()).firstStart).toBe(true);
    });

    it("tells the rules of a password only to whoever creates the first account", async () => {
        expect((await getLoginPageModel()).passwordRules).toBeNull();
        expect(prismaMock.systemSetting.findMany).not.toHaveBeenCalled();

        prismaMock.user.count.mockResolvedValue(0);
        expect((await getLoginPageModel()).passwordRules).toMatchObject({ level: "standard", minLength: 12, digits: true });
    });

    it("goes straight to a provider only when OIDC_AUTO_REDIRECT names one that is on", async () => {
        mocks.redirect.mockReturnValue("authentik");
        expect((await getLoginPageModel()).autoRedirectProviderId).toBe("authentik");

        mocks.redirect.mockReturnValue("deleted-provider");
        expect((await getLoginPageModel()).autoRedirectProviderId).toBeNull();
    });

    it("names the instance from General and follows the switches of passkeys and passwords", async () => {
        prismaMock.systemSetting.findUnique.mockImplementation((async ({ where }: { where: { key: string } }) => (
            where.key === "general.instanceName" ? { value: " Production " } : where.key === "auth.disablePasskeyLogin" ? { value: "true" } : null
        )) as never);
        mocks.emailOff.mockReturnValue(true);

        const model = await getLoginPageModel();

        expect(model.instanceName).toBe("Production");
        expect(model.passkeyLogin).toBe(false);
        expect(model.emailLogin).toBe(false);
    });

    it("shows every adapter by its kind, never only the ones this instance uses", () => {
        const adapters = loginAdapters();

        expect([...adapters.databases, ...adapters.storage, ...adapters.notifications]).toHaveLength(ADAPTER_DEFINITIONS.length);
        expect(adapters.databases).toContain("postgres");
        expect(adapters.storage).toContain("s3-aws");
        expect(adapters.notifications).toContain("discord");
        expect(prismaMock.adapterConfig.findMany).not.toHaveBeenCalled();
    });

    describe("providers of tenants", () => {
        const entra = { providerId: "entra-acme", name: "Acme Entra ID", adapterId: "generic", domain: "Acme.CH", allowProvisioning: true };

        it("shows only the providers of the platform as buttons, and of tenants only whether one claims a domain", async () => {
            prismaMock.ssoProvider.count.mockResolvedValue(2);

            const model = await getLoginPageModel();

            const query = prismaMock.ssoProvider.findMany.mock.calls[0][0] as { where: Record<string, unknown> };
            expect(query.where).toEqual({ enabled: true, tenantId: null });
            expect(prismaMock.ssoProvider.count).toHaveBeenCalledWith({ where: { enabled: true, tenantId: { not: null }, domain: { not: null } } });
            expect(model.domainRouting).toBe(true);
            // Nothing of a tenant reaches the public page, neither its name nor its domain.
            expect(JSON.stringify(model)).not.toContain("acme");
        });

        it("routes the domain of an email to the provider of its tenant, without naming the tenant", async () => {
            prismaMock.ssoProvider.findMany.mockResolvedValue([entra] as never);

            expect(await findDomainProvider(" ACME.ch ")).toEqual({ providerId: "entra-acme", name: "Acme Entra ID", adapterId: "generic", domain: "acme.ch", allowProvisioning: true });

            const query = prismaMock.ssoProvider.findMany.mock.calls[0][0] as { where: Record<string, unknown>; select: Record<string, boolean> };
            expect(query.where).toEqual({ enabled: true, domain: { not: null } });
            expect(Object.keys(query.select).sort()).toEqual(["adapterId", "allowProvisioning", "domain", "name", "providerId"]);
        });

        it("answers nothing for a domain no provider claims, and does not look for one that is no domain", async () => {
            prismaMock.ssoProvider.findMany.mockResolvedValue([entra] as never);
            expect(await findDomainProvider("globex.ch")).toBeNull();
            expect(await findDomainProvider("acme.ch.evil")).toBeNull();

            prismaMock.ssoProvider.findMany.mockClear();
            expect(await findDomainProvider("lena@acme.ch")).toBeNull();
            expect(await findDomainProvider("")).toBeNull();
            expect(prismaMock.ssoProvider.findMany).not.toHaveBeenCalled();
        });
    });
});
