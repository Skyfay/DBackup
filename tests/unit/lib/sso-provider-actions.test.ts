// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

const mocks = vi.hoisted(() => ({
    audit: vi.fn(),
    caller: vi.fn(),
    getAuditState: vi.fn(),
    getGroup: vi.fn(),
    createProvider: vi.fn(),
    updateProvider: vi.fn(),
    toggleProvider: vi.fn(),
    deleteProvider: vi.fn(),
    discover: vi.fn(),
}));

vi.mock("@/lib/auth/access-control", () => ({
    checkPermission: vi.fn(async () => mocks.caller()),
    getUserPermissions: vi.fn(async () => []),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/services/audit-service", () => ({ auditService: { log: (...args: unknown[]) => mocks.audit(...args) } }));
vi.mock("@/services/sso/oidc-discovery", () => ({ discoverEndpoints: (...args: unknown[]) => mocks.discover(...args) }));
vi.mock("@/services/sso/oidc-provider-service", () => ({
    OidcProviderService: {
        getAuditState: (...args: unknown[]) => mocks.getAuditState(...args),
        getGroup: (...args: unknown[]) => mocks.getGroup(...args),
        createProvider: (...args: unknown[]) => mocks.createProvider(...args),
        updateProvider: (...args: unknown[]) => mocks.updateProvider(...args),
        toggleProvider: (...args: unknown[]) => mocks.toggleProvider(...args),
        deleteProvider: (...args: unknown[]) => mocks.deleteProvider(...args),
    },
}));
// A provider type with a URL and a realm, for the labels of what changed.
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
        getEndpoints: async () => ({}),
    }),
}));

const { checkSsoConnection, createSsoProvider, deleteSsoProvider, toggleSsoProvider, updateSsoProvider } = await import("@/app/actions/auth/oidc");

const OPERATOR = { id: "admin", group: { name: "Operators", permissions: JSON.stringify(["settings:read", "settings:write", "jobs:read"]) } };
const SUPER_ADMIN = { id: "root", group: { name: "SuperAdmin", permissions: "[]" } };

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
    defaultGroupId: null,
    groupName: null,
    enabled: true,
};

const ENDPOINTS = {
    issuer: "https://auth.example.com/realms/staff",
    authorizationEndpoint: "https://auth.example.com/auth",
    tokenEndpoint: "https://auth.example.com/token",
    userInfoEndpoint: "https://auth.example.com/userinfo",
};

const edit = (changes: Partial<{ name: string; clientSecret: string; realm: string; defaultGroupId: string | null }> = {}) => ({
    id: PROVIDER.id,
    name: changes.name ?? PROVIDER.name,
    domain: PROVIDER.domain,
    clientId: PROVIDER.clientId,
    clientSecret: changes.clientSecret,
    allowProvisioning: true,
    defaultGroupId: changes.defaultGroupId,
    adapterConfig: { baseUrl: "https://auth.example.com", realm: changes.realm ?? "staff" },
});

const create = (defaultGroupId: string | null) => ({
    name: "Pocket ID",
    adapterId: "pocket-id",
    providerId: "pocket-id",
    clientId: "client",
    clientSecret: "secret",
    allowProvisioning: true,
    defaultGroupId,
    adapterConfig: { baseUrl: "https://id.example.com" },
});

describe("the actions of sign-in providers", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.caller.mockReturnValue(OPERATOR);
        mocks.discover.mockImplementation(async (_adapterId: string, config: Record<string, unknown>) => ({ ok: true, endpoints: ENDPOINTS, config }));
    });

    it("marks a new client secret as changed and never writes it", async () => {
        mocks.getAuditState
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

    it("keeps the saved secret when the field stays empty, and never changes the ID or the type", async () => {
        mocks.getAuditState.mockResolvedValue(PROVIDER);

        await updateSsoProvider({ ...edit({ clientSecret: "" }), providerId: "other-id", adapterId: "generic" } as never);

        const [id, fields] = mocks.updateProvider.mock.calls[0];
        expect(id).toBe("sso-1");
        expect(fields.clientSecret).toBeUndefined();
        expect(fields).not.toHaveProperty("providerId");
        expect(fields).not.toHaveProperty("adapterId");
        // The endpoints come from the type the provider was saved with.
        expect(mocks.discover).toHaveBeenCalledWith("keycloak", { baseUrl: "https://auth.example.com", realm: "staff" });
    });

    it("leaves a client secret that stayed the same out of the changes, and keeps the old name", async () => {
        mocks.getAuditState.mockResolvedValueOnce(PROVIDER).mockResolvedValueOnce({ ...PROVIDER, name: "Staff login" });

        await updateSsoProvider(edit({ name: "Staff login" }));

        expect(mocks.audit).toHaveBeenCalledWith("admin", "UPDATE", "SSO_PROVIDER", { name: "Staff login", renamedFrom: "Company login", changes: [] }, "sso-1");
    });

    it("writes the group of new people into the changes by its name", async () => {
        mocks.getGroup.mockResolvedValue({ id: "group-1", name: "Viewers", permissions: JSON.stringify(["jobs:read"]) });
        mocks.getAuditState.mockResolvedValueOnce(PROVIDER).mockResolvedValueOnce({ ...PROVIDER, defaultGroupId: "group-1", groupName: "Viewers" });

        expect(await updateSsoProvider(edit({ defaultGroupId: "group-1" }))).toEqual({ success: true });

        expect(mocks.updateProvider.mock.calls[0][1].defaultGroupId).toBe("group-1");
        expect(mocks.audit.mock.calls[0][3].changes).toEqual([{ field: "Group of new people", from: null, to: "Viewers" }]);
    });

    it("refuses a group that may do more than the group of the caller", async () => {
        mocks.getAuditState.mockResolvedValue(PROVIDER);
        mocks.getGroup.mockResolvedValue({ id: "group-2", name: "Admins", permissions: JSON.stringify(["jobs:read", "users:write"]) });

        const result = await updateSsoProvider(edit({ defaultGroupId: "group-2" }));

        expect(result.success).toBe(false);
        expect(result.error).toContain("more than your group");
        expect(mocks.updateProvider).not.toHaveBeenCalled();
    });

    it("lets only a SuperAdmin send new people into the SuperAdmin group", async () => {
        mocks.getGroup.mockResolvedValue({ id: "group-0", name: "SuperAdmin", permissions: "[]" });

        const refused = await createSsoProvider(create("group-0"));
        expect(refused).toEqual({ success: false, error: "Only a SuperAdmin may send new people into the SuperAdmin group." });
        expect(mocks.createProvider).not.toHaveBeenCalled();

        mocks.caller.mockReturnValue(SUPER_ADMIN);
        mocks.createProvider.mockResolvedValue({ id: "sso-2", name: "Pocket ID", adapterId: "pocket-id", providerId: "pocket-id" });
        mocks.getAuditState.mockResolvedValue({ groupName: "SuperAdmin" });

        expect(await createSsoProvider(create("group-0"))).toEqual({ success: true, data: { id: "sso-2" } });
        expect(mocks.audit).toHaveBeenCalledWith("root", "CREATE", "SSO_PROVIDER", { name: "Pocket ID", adapterId: "pocket-id", providerId: "pocket-id", group: "SuperAdmin" }, "sso-2");
    });

    it("keeps a group that stays as it was, even one beyond the caller", async () => {
        mocks.getAuditState.mockResolvedValue({ ...PROVIDER, defaultGroupId: "group-2", groupName: "Admins" });

        expect(await updateSsoProvider(edit({ defaultGroupId: "group-2", name: "Staff login" }))).toEqual({ success: true });
        expect(mocks.getGroup).not.toHaveBeenCalled();
    });

    it("refuses to save a provider that cannot be reached", async () => {
        mocks.discover.mockResolvedValue({ ok: false, error: "The provider could not be reached. Status: 404" });

        expect(await createSsoProvider(create(null))).toEqual({ success: false, error: "The provider could not be reached. Status: 404" });
        expect(mocks.createProvider).not.toHaveBeenCalled();
    });

    it("hands back the endpoints a check finds, and nothing else", async () => {
        const result = await checkSsoConnection({ adapterId: "keycloak", adapterConfig: { baseUrl: "https://auth.example.com", realm: "staff" } });

        expect(result).toEqual({
            success: true,
            data: { issuer: ENDPOINTS.issuer, authorization: ENDPOINTS.authorizationEndpoint, token: ENDPOINTS.tokenEndpoint, userInfo: ENDPOINTS.userInfoEndpoint, jwks: null },
        });
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
