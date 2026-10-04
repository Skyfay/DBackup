// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
    provider: vi.fn(),
    group: vi.fn(),
    updateUser: vi.fn(),
    log: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
    default: {
        ssoProvider: { findUnique: (...args: unknown[]) => mocks.provider(...args) },
        group: { findUnique: (...args: unknown[]) => mocks.group(...args) },
        user: { update: (...args: unknown[]) => mocks.updateUser(...args) },
    },
}));
vi.mock("@/services/audit-service", () => ({ auditService: { log: (...args: unknown[]) => mocks.log(...args) } }));

const { DISABLED_PROVIDER_URL, placeSsoUser, refuseDisabledProvider, refuseSsoSignUp, ssoProviderIdOf } = await import("@/lib/auth/sso-guard");

const CALLBACK = { path: "/sso/callback/:providerId", params: { providerId: "authentik-417" } };
const redirect = (url: string) => new Error(`redirect ${url}`);

describe("single sign-on as the saved providers decide it", () => {
    beforeEach(() => vi.clearAllMocks());

    it("finds the provider of the callbacks, and of nothing else", () => {
        expect(ssoProviderIdOf(CALLBACK)).toBe("authentik-417");
        expect(ssoProviderIdOf({ path: "/sso/saml2/callback/:providerId", params: { providerId: "saml-1" } })).toBe("saml-1");
        expect(ssoProviderIdOf({ path: "/sign-in/email", params: { providerId: "authentik-417" } })).toBeNull();
        expect(ssoProviderIdOf(null)).toBeNull();
    });

    it("refuses to start a sign-in through a provider that is off", async () => {
        mocks.provider.mockResolvedValue({ enabled: false });

        await expect(refuseDisabledProvider({ path: "/sign-in/sso", body: { providerId: "authentik-417", requestSignUp: true } }, redirect)).rejects.toMatchObject({
            body: { code: "SSO_PROVIDER_DISABLED" },
        });
        expect(mocks.provider).toHaveBeenCalledWith({ where: { providerId: "authentik-417" }, select: { enabled: true } });
    });

    it("sends a callback of a provider that is off back to the login page, for a sign-in that left before", async () => {
        mocks.provider.mockResolvedValue({ enabled: false });

        await expect(refuseDisabledProvider(CALLBACK, redirect)).rejects.toThrow(`redirect ${DISABLED_PROVIDER_URL}`);
    });

    it("lets a provider that is on, or one better-auth refuses itself, go on", async () => {
        mocks.provider.mockResolvedValueOnce({ enabled: true }).mockResolvedValueOnce(null);

        await expect(refuseDisabledProvider(CALLBACK, redirect)).resolves.toBeUndefined();
        await expect(refuseDisabledProvider({ path: "/sign-in/sso", body: { providerId: "gone" } }, redirect)).resolves.toBeUndefined();
        await expect(refuseDisabledProvider({ path: "/sign-in/email", body: {} }, redirect)).resolves.toBeUndefined();
        expect(mocks.provider).toHaveBeenCalledTimes(2);
    });

    it("adds someone new only through a provider that is on and adds new people, whatever the browser asked", async () => {
        mocks.provider.mockResolvedValueOnce({ enabled: true, allowProvisioning: false });
        await expect(refuseSsoSignUp(CALLBACK)).rejects.toMatchObject({ message: "signup disabled" });

        mocks.provider.mockResolvedValueOnce({ enabled: false, allowProvisioning: true });
        await expect(refuseSsoSignUp(CALLBACK)).rejects.toMatchObject({ message: "signup disabled" });

        mocks.provider.mockResolvedValueOnce({ enabled: true, allowProvisioning: true });
        await expect(refuseSsoSignUp(CALLBACK)).resolves.toBeUndefined();
    });

    it("leaves every other way of adding a user alone", async () => {
        await expect(refuseSsoSignUp({ path: "/sign-up/email" })).resolves.toBeUndefined();
        await expect(refuseSsoSignUp(null)).resolves.toBeUndefined();
        expect(mocks.provider).not.toHaveBeenCalled();
    });

    it("puts someone a provider added into its group and says so in the log", async () => {
        mocks.provider.mockResolvedValue({ name: "Authentik", defaultGroupId: "group-ops" });
        mocks.group.mockResolvedValue({ id: "group-ops", name: "Operators" });

        await placeSsoUser({ id: "tom", name: "Tom Weber", email: "tom@example.ch" }, CALLBACK);

        expect(mocks.updateUser).toHaveBeenCalledWith({ where: { id: "tom" }, data: { groupId: "group-ops" } });
        expect(mocks.log).toHaveBeenCalledWith(
            "tom",
            "CREATE",
            "USER",
            { name: "Tom Weber", email: "tom@example.ch", via: "sso", provider: "Authentik", providerId: "authentik-417", group: "Operators" },
            "tom"
        );
    });

    it("leaves someone without a group when the group of the provider is gone", async () => {
        mocks.provider.mockResolvedValue({ name: "Authentik", defaultGroupId: "group-gone" });
        mocks.group.mockResolvedValue(null);

        await placeSsoUser({ id: "tom", name: "Tom Weber", email: "tom@example.ch" }, CALLBACK);

        expect(mocks.updateUser).not.toHaveBeenCalled();
        expect(mocks.log.mock.calls[0][3]).not.toHaveProperty("group");
    });

    it("does nothing for a user added any other way", async () => {
        await placeSsoUser({ id: "lena", name: "Lena Graf", email: "lena@example.ch" }, { path: "/sign-up/email" });

        expect(mocks.provider).not.toHaveBeenCalled();
        expect(mocks.log).not.toHaveBeenCalled();
    });
});
