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
    claimed: vi.fn(),
    tenant: vi.fn(),
}));

// What the checks of where a provider belongs read: the domains other providers claim and the tenants.
vi.mock("@/lib/prisma", () => ({
    default: {
        ssoProvider: { findMany: (...args: unknown[]) => mocks.claimed(...args) },
        tenant: { findUnique: (...args: unknown[]) => mocks.tenant(...args) },
    },
}));

// A platform admin passes every check, anyone else needs the permission, like the real check.
vi.mock("@/lib/auth/access-control", async () => {
    const { PermissionError } = await import("@/lib/logging/errors");
    return {
        checkPermission: vi.fn(async (permission: string) => {
            const caller = mocks.caller();
            if (!caller.isPlatformAdmin && !caller.permissions.includes(permission)) throw new PermissionError(permission);
            return caller;
        }),
        getUserPermissions: vi.fn(async () => []),
    };
});
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

const { AVAILABLE_PERMISSIONS, PERMISSIONS } = await import("@/lib/auth/permissions");
const { PermissionError } = await import("@/lib/logging/errors");
const { checkSsoConnection, createSsoProvider, deleteSsoProvider, toggleSsoProvider, updateSsoProvider } = await import("@/app/actions/auth/oidc");
const { ssoProviderChanges } = await import("@/services/sso/oidc-audit");

const PLATFORM_ADMIN = { id: "admin", isPlatformAdmin: true, tenantId: "default", permissions: [], role: null };
/** Only platform admins change providers, so every change goes to the log of the platform, wherever the admin works. */
const PLATFORM_LOG = { tenantId: "default" };
/** The full access role in the home tenant holds every permission, but is no platform admin. */
const SETTINGS_ADMIN = { id: "lena", isPlatformAdmin: false, tenantId: "default", permissions: AVAILABLE_PERMISSIONS.map((permission) => permission.id), role: { id: "group-0", name: "Admin" } };

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
    tenantId: null,
    tenantName: null,
    enabled: true,
};

const ENDPOINTS = {
    issuer: "https://auth.example.com/realms/staff",
    authorizationEndpoint: "https://auth.example.com/auth",
    tokenEndpoint: "https://auth.example.com/token",
    userInfoEndpoint: "https://auth.example.com/userinfo",
};

const edit = (changes: Partial<{ name: string; clientSecret: string; realm: string; defaultGroupId: string | null; tenantId: string | null; domain: string }> = {}) => ({
    id: PROVIDER.id,
    name: changes.name ?? PROVIDER.name,
    domain: changes.domain ?? PROVIDER.domain,
    ...("tenantId" in changes ? { tenantId: changes.tenantId } : {}),
    clientId: PROVIDER.clientId,
    clientSecret: changes.clientSecret,
    allowProvisioning: true,
    defaultGroupId: changes.defaultGroupId,
    adapterConfig: { baseUrl: "https://auth.example.com", realm: changes.realm ?? "staff" },
});

const create = (defaultGroupId: string | null, placement: { tenantId?: string | null; domain?: string } = {}) => ({
    ...placement,
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
        mocks.caller.mockReturnValue(PLATFORM_ADMIN);
        mocks.discover.mockImplementation(async (_adapterId: string, config: Record<string, unknown>) => ({ ok: true, endpoints: ENDPOINTS, config }));
        mocks.claimed.mockResolvedValue([]);
        mocks.tenant.mockImplementation(async ({ where }: { where: { id: string } }) => (where.id === "acme" ? { name: "Acme GmbH" } : null));
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
        }, "sso-1", PLATFORM_LOG);
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

        expect(mocks.audit).toHaveBeenCalledWith("admin", "UPDATE", "SSO_PROVIDER", { name: "Staff login", renamedFrom: "Company login", changes: [] }, "sso-1", PLATFORM_LOG);
    });

    it("writes the group of new people into the changes by its name", async () => {
        mocks.getGroup.mockResolvedValue({ id: "group-1", name: "Viewers", permissions: JSON.stringify(["jobs:read"]) });
        mocks.getAuditState.mockResolvedValueOnce(PROVIDER).mockResolvedValueOnce({ ...PROVIDER, defaultGroupId: "group-1", groupName: "Viewers" });

        expect(await updateSsoProvider(edit({ defaultGroupId: "group-1" }))).toEqual({ success: true });

        expect(mocks.updateProvider.mock.calls[0][1].defaultGroupId).toBe("group-1");
        expect(mocks.audit.mock.calls[0][3].changes).toEqual([{ field: "Group of new people", from: null, to: "Viewers" }]);
    });

    it("lets nobody add, change, check, switch or delete a provider without the right to manage the sign-in providers, whatever settings permission they have", async () => {
        mocks.caller.mockReturnValue(SETTINGS_ADMIN);

        await expect(createSsoProvider(create(null))).rejects.toBeInstanceOf(PermissionError);
        await expect(updateSsoProvider(edit({ name: "Staff login" }))).rejects.toBeInstanceOf(PermissionError);
        await expect(checkSsoConnection({ adapterId: "keycloak", adapterConfig: { baseUrl: "https://auth.example.com", realm: "staff" } })).rejects.toBeInstanceOf(PermissionError);
        await expect(toggleSsoProvider("sso-1", false)).rejects.toBeInstanceOf(PermissionError);
        await expect(deleteSsoProvider("sso-1")).rejects.toBeInstanceOf(PermissionError);

        for (const mock of [mocks.createProvider, mocks.updateProvider, mocks.toggleProvider, mocks.deleteProvider, mocks.discover, mocks.audit]) {
            expect(mock).not.toHaveBeenCalled();
        }
    });

    it("lets someone of a platform group that manages the sign-in providers switch one, written to the log of the platform", async () => {
        mocks.caller.mockReturnValue({ id: "nina", isPlatformAdmin: false, tenantId: "acme", permissions: [PERMISSIONS.PLATFORM.SIGN_IN_READ, PERMISSIONS.PLATFORM.SIGN_IN_WRITE], role: null });
        mocks.toggleProvider.mockResolvedValue({ ...PROVIDER, enabled: false });

        expect(await toggleSsoProvider("sso-1", false)).toEqual({ success: true });
        expect(mocks.audit).toHaveBeenCalledWith("nina", "UPDATE", "SSO_PROVIDER", { name: "Company login", enabled: false }, "sso-1", PLATFORM_LOG);
    });

    it("never lets a platform group that only sees the sign-in providers change one", async () => {
        mocks.caller.mockReturnValue({ id: "nina", isPlatformAdmin: false, tenantId: "acme", permissions: [PERMISSIONS.PLATFORM.SIGN_IN_READ], role: null });

        await expect(deleteSsoProvider("sso-1")).rejects.toBeInstanceOf(PermissionError);
        expect(mocks.deleteProvider).not.toHaveBeenCalled();
    });

    it("sends new people into any group a platform admin picks, the full access group too", async () => {
        mocks.getGroup.mockResolvedValue({ id: "group-0", name: "Admin", permissions: "[]" });
        mocks.createProvider.mockResolvedValue({ id: "sso-2", name: "Pocket ID", adapterId: "pocket-id", providerId: "pocket-id" });
        mocks.getAuditState.mockResolvedValue({ groupName: "Admin" });

        expect(await createSsoProvider(create("group-0"))).toEqual({ success: true, data: { id: "sso-2" } });
        expect(mocks.createProvider.mock.calls[0][0].defaultGroupId).toBe("group-0");
        expect(mocks.audit).toHaveBeenCalledWith("admin", "CREATE", "SSO_PROVIDER", { name: "Pocket ID", adapterId: "pocket-id", providerId: "pocket-id", group: "Admin" }, "sso-2", PLATFORM_LOG);
    });

    it("refuses a group that is gone, but keeps one that stays as it was", async () => {
        mocks.getGroup.mockResolvedValue(null);
        mocks.getAuditState.mockResolvedValue({ ...PROVIDER, defaultGroupId: "group-2", groupName: "Admins" });

        expect(await updateSsoProvider(edit({ defaultGroupId: "group-gone" }))).toEqual({ success: false, error: "The group no longer exists." });
        expect(mocks.updateProvider).not.toHaveBeenCalled();

        expect(await updateSsoProvider(edit({ defaultGroupId: "group-2", name: "Staff login" }))).toEqual({ success: true });
        expect(mocks.getGroup).toHaveBeenCalledTimes(1);
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

        expect(mocks.audit).toHaveBeenCalledWith("admin", "UPDATE", "SSO_PROVIDER", { name: "Company login", enabled: false }, "sso-1", PLATFORM_LOG);
    });

    it("names a deleted provider", async () => {
        mocks.deleteProvider.mockResolvedValue(PROVIDER);

        await deleteSsoProvider("sso-1");

        expect(mocks.audit).toHaveBeenCalledWith("admin", "DELETE", "SSO_PROVIDER", { name: "Company login", providerId: "keycloak-a1" }, "sso-1", PLATFORM_LOG);
    });

    describe("providers of a tenant", () => {
        const ACME_GROUP = { id: "group-acme", name: "Viewer", permissions: "[]" };

        it("adds a provider of a tenant with a domain and a group of that tenant, and logs it on the platform", async () => {
            mocks.getGroup.mockImplementation(async (id: string, tenantId: string) => (id === "group-acme" && tenantId === "acme" ? ACME_GROUP : null));
            mocks.createProvider.mockResolvedValue({ id: "sso-3", name: "Pocket ID", adapterId: "pocket-id", providerId: "pocket-id" });
            mocks.getAuditState.mockResolvedValue({ groupName: "Viewer", tenantName: "Acme GmbH" });

            expect(await createSsoProvider(create("group-acme", { tenantId: "acme", domain: " Acme.CH " }))).toEqual({ success: true, data: { id: "sso-3" } });

            expect(mocks.createProvider.mock.calls[0][0]).toMatchObject({ tenantId: "acme", domain: "acme.ch", defaultGroupId: "group-acme" });
            expect(mocks.getGroup).toHaveBeenCalledWith("group-acme", "acme");
            expect(mocks.audit).toHaveBeenCalledWith("admin", "CREATE", "SSO_PROVIDER", expect.objectContaining({ tenant: "Acme GmbH", group: "Viewer" }), "sso-3", PLATFORM_LOG);
        });

        it("refuses a provider of a tenant without a domain, since only the email reaches it", async () => {
            mocks.getGroup.mockResolvedValue(ACME_GROUP);

            expect(await createSsoProvider(create("group-acme", { tenantId: "acme" }))).toEqual({ success: false, error: "A provider of a tenant is reached by its email domain only, so it needs one." });
            expect(mocks.createProvider).not.toHaveBeenCalled();
        });

        it("refuses a group of another tenant, and no group at all while it adds people", async () => {
            mocks.getGroup.mockResolvedValue(null);
            expect(await createSsoProvider(create("group-0", { tenantId: "acme", domain: "acme.ch" }))).toEqual({ success: false, error: "The group is no group of Acme GmbH. Pick one of its groups." });

            expect(await createSsoProvider(create(null, { tenantId: "acme", domain: "acme.ch" }))).toEqual({
                success: false,
                error: "A provider of a tenant adds people to Acme GmbH, so it needs a group there for them.",
            });
            expect(mocks.createProvider).not.toHaveBeenCalled();
        });

        it("refuses a tenant that is gone, and a domain another provider claims", async () => {
            expect(await createSsoProvider(create("group-acme", { tenantId: "gone", domain: "gone.ch" }))).toEqual({ success: false, error: "The tenant no longer exists." });

            mocks.getGroup.mockResolvedValue(ACME_GROUP);
            mocks.claimed.mockResolvedValue([{ name: "Authentik", domain: "ACME.ch" }]);
            expect(await createSsoProvider(create("group-acme", { tenantId: "acme", domain: "acme.ch" }))).toEqual({ success: false, error: "Authentik signs in acme.ch already. A domain belongs to one provider." });
            expect(mocks.createProvider).not.toHaveBeenCalled();
        });

        it("refuses a domain that is no domain", async () => {
            expect(await createSsoProvider(create(null, { domain: "lena@acme.ch" }))).toEqual({ success: false, error: "The email domain is no domain. Type it like example.com, without the @." });
        });

        it("takes the home tenant for the platform, whose providers are buttons", async () => {
            mocks.getGroup.mockResolvedValue({ id: "group-0", name: "Admin", permissions: "[]" });
            mocks.createProvider.mockResolvedValue({ id: "sso-4", name: "Pocket ID", adapterId: "pocket-id", providerId: "pocket-id" });
            mocks.getAuditState.mockResolvedValue({ groupName: "Admin" });

            await createSsoProvider(create("group-0", { tenantId: "default" }));

            expect(mocks.createProvider.mock.calls[0][0]).toMatchObject({ tenantId: null, domain: null });
            expect(mocks.getGroup).toHaveBeenCalledWith("group-0", "default");
        });

        it("moves a provider to a tenant only with a group of that tenant picked again", async () => {
            mocks.getAuditState.mockResolvedValue({ ...PROVIDER, defaultGroupId: "group-ops", groupName: "Operators" });
            mocks.getGroup.mockImplementation(async (id: string, tenantId: string) => (id === "group-acme" && tenantId === "acme" ? ACME_GROUP : null));

            expect(await updateSsoProvider(edit({ tenantId: "acme", domain: "acme.ch", defaultGroupId: "group-ops" }))).toEqual({ success: false, error: "The group is no group of Acme GmbH. Pick one of its groups." });
            expect(mocks.updateProvider).not.toHaveBeenCalled();

            expect(await updateSsoProvider(edit({ tenantId: "acme", domain: "acme.ch", defaultGroupId: "group-acme" }))).toEqual({ success: true });
            expect(mocks.updateProvider.mock.calls[0][1]).toMatchObject({ tenantId: "acme", domain: "acme.ch", defaultGroupId: "group-acme" });
        });

        it("keeps where a provider belongs when the request leaves it out", async () => {
            mocks.getAuditState.mockResolvedValue({ ...PROVIDER, tenantId: "acme", tenantName: "Acme GmbH", domain: "acme.ch", defaultGroupId: "group-acme", groupName: "Viewer" });

            expect(await updateSsoProvider({ ...edit({ name: "Acme login", domain: "acme.ch" }), defaultGroupId: undefined })).toEqual({ success: true });

            expect(mocks.updateProvider.mock.calls[0][1]).toMatchObject({ tenantId: "acme", defaultGroupId: "group-acme" });
            // The group stays as it was in the same tenant, so it is not looked up again.
            expect(mocks.getGroup).not.toHaveBeenCalled();
        });

        it("writes a move between the platform and a tenant into the changes", () => {
            const before = { ...PROVIDER };
            const after = { ...PROVIDER, tenantName: "Acme GmbH" };

            expect(ssoProviderChanges(before, after)).toEqual([{ field: "Belongs to", from: "Platform", to: "Acme GmbH" }]);
        });
    });
});
