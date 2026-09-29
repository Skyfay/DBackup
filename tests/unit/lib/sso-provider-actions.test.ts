// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

const mocks = vi.hoisted(() => ({
    audit: vi.fn(),
    getProviderById: vi.fn(),
    updateProvider: vi.fn(),
    toggleProvider: vi.fn(),
    deleteProvider: vi.fn(),
}));

vi.mock("@/lib/auth/access-control", () => ({
    checkPermission: vi.fn(async () => ({ id: "admin" })),
    getUserPermissions: vi.fn(async () => []),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/services/audit-service", () => ({ auditService: { log: (...args: unknown[]) => mocks.audit(...args) } }));
vi.mock("@/services/sso/oidc-provider-service", () => ({
    OidcProviderService: {
        getProviderById: (...args: unknown[]) => mocks.getProviderById(...args),
        updateProvider: (...args: unknown[]) => mocks.updateProvider(...args),
        toggleProvider: (...args: unknown[]) => mocks.toggleProvider(...args),
        deleteProvider: (...args: unknown[]) => mocks.deleteProvider(...args),
    },
}));
// A provider type with a URL and a realm, whose endpoints need no discovery over the network.
vi.mock("@/services/sso/oidc-registry", () => ({
    getOIDCAdapter: () => ({
        id: "keycloak",
        name: "Keycloak",
        description: "",
        inputs: [
            { name: "baseUrl", label: "Keycloak URL", type: "url" },
            { name: "realm", label: "Realm Name", type: "text" },
        ],
        inputSchema: z.object({ baseUrl: z.string(), realm: z.string() }),
        getEndpoints: async () => ({
            issuer: "https://auth.example.com/realms/staff",
            authorizationEndpoint: "https://auth.example.com/auth",
            tokenEndpoint: "https://auth.example.com/token",
            userInfoEndpoint: "https://auth.example.com/userinfo",
        }),
    }),
}));

const { deleteSsoProvider, toggleSsoProvider, updateSsoProvider } = await import("@/app/actions/auth/oidc");

const PROVIDER = {
    id: "sso-1",
    name: "Company login",
    adapterId: "keycloak",
    adapterConfig: JSON.stringify({ baseUrl: "https://auth.example.com", realm: "staff" }),
    providerId: "keycloak-a1",
    domain: "example.com",
    clientId: "dbackup",
    clientSecret: "old-client-secret-value",
    allowProvisioning: true,
    enabled: true,
};

const edit = (changes: Partial<{ name: string; clientSecret: string; realm: string }>) => ({
    id: PROVIDER.id,
    name: changes.name ?? PROVIDER.name,
    adapterId: PROVIDER.adapterId,
    providerId: PROVIDER.providerId,
    domain: PROVIDER.domain,
    clientId: PROVIDER.clientId,
    clientSecret: changes.clientSecret ?? PROVIDER.clientSecret,
    allowProvisioning: true,
    adapterConfig: { baseUrl: "https://auth.example.com", realm: changes.realm ?? "staff" },
});

describe("the audit entries of sign-in providers", () => {
    beforeEach(() => vi.clearAllMocks());

    it("marks a new client secret as changed and never writes it", async () => {
        mocks.getProviderById
            .mockResolvedValueOnce(PROVIDER)
            .mockResolvedValueOnce({ ...PROVIDER, clientSecret: "new-client-secret-value", adapterConfig: JSON.stringify({ baseUrl: "https://auth.example.com", realm: "people" }) });

        expect(await updateSsoProvider(edit({ clientSecret: "new-client-secret-value", realm: "people" }))).toEqual({ success: true });

        expect(mocks.audit).toHaveBeenCalledWith("admin", "UPDATE", "SSO_PROVIDER", {
            name: "Company login",
            changes: [
                { field: "Client secret", from: null, to: null, secret: true },
                { field: "Realm Name", from: "staff", to: "people" },
            ],
        }, "sso-1");
        const written = JSON.stringify(mocks.audit.mock.calls);
        expect(written).not.toContain("old-client-secret-value");
        expect(written).not.toContain("new-client-secret-value");
    });

    it("leaves a client secret that stayed the same out of the changes, and keeps the old name", async () => {
        mocks.getProviderById.mockResolvedValueOnce(PROVIDER).mockResolvedValueOnce({ ...PROVIDER, name: "Staff login" });

        await updateSsoProvider(edit({ name: "Staff login" }));

        expect(mocks.audit).toHaveBeenCalledWith("admin", "UPDATE", "SSO_PROVIDER", { name: "Staff login", renamedFrom: "Company login", changes: [] }, "sso-1");
    });

    it("writes switching a provider off as that, with its name", async () => {
        mocks.toggleProvider.mockResolvedValue({ ...PROVIDER, enabled: false });

        await toggleSsoProvider("sso-1", false);

        expect(mocks.audit).toHaveBeenCalledWith("admin", "UPDATE", "SSO_PROVIDER", { name: "Company login", enabled: false }, "sso-1");
    });

    it("names a deleted provider", async () => {
        mocks.deleteProvider.mockResolvedValue(PROVIDER);

        await deleteSsoProvider("sso-1");

        expect(mocks.audit).toHaveBeenCalledWith("admin", "DELETE", "SSO_PROVIDER", { name: "Company login", providerId: "keycloak-a1" }, "sso-1");
    });
});
