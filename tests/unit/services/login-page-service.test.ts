import { beforeEach, describe, expect, it, vi } from "vitest";
import { prismaMock } from "@/lib/testing/prisma-mock";
import { ADAPTER_DEFINITIONS } from "@/lib/adapters/definitions";

const mocks = vi.hoisted(() => ({ redirect: vi.fn(), emailOff: vi.fn(), picture: vi.fn() }));

vi.mock("@/lib/auth/env-flags", () => ({
    getOidcAutoRedirectProviderId: () => mocks.redirect(),
    isEmailLoginDisabled: () => mocks.emailOff(),
}));
vi.mock("@/services/system/login-image-service", () => ({ getLoginPicture: () => mocks.picture() }));

const { getLoginPageModel, loginAdapters } = await import("@/services/auth/login-page-service");

const authentik = { id: "p1", providerId: "authentik", name: "Authentik", adapterId: "authentik", domain: "example.ch", allowProvisioning: false, issuer: "https://auth.example.ch/application/o/dbackup/" };

describe("what the login page shows", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        prismaMock.user.count.mockResolvedValue(2);
        prismaMock.ssoProvider.findMany.mockResolvedValue([authentik] as never);
        prismaMock.systemSetting.findUnique.mockResolvedValue(null);
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
});
