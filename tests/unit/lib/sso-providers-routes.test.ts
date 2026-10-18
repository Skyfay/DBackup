import { beforeEach, describe, expect, it, vi } from "vitest";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { PermissionError } from "@/lib/logging/errors";

const mocks = vi.hoisted(() => ({
    getAuthContext: vi.fn(),
    getModel: vi.fn(),
    reachOf: vi.fn(),
}));

vi.mock("next/headers", () => ({ headers: async () => new Headers() }));

// The real checks, reduced to the permission list of the context, which a platform admin passes.
vi.mock("@/lib/auth/access-control", () => ({
    getAuthContext: (...args: unknown[]) => mocks.getAuthContext(...args),
    checkPermissionWithContext: (ctx: { permissions: string[]; isPlatformAdmin: boolean }, permission: string) => {
        if (!ctx.isPlatformAdmin && !ctx.permissions.includes(permission)) throw new PermissionError(permission);
    },
    checkAnyPermissionWithContext: (ctx: { permissions: string[]; isPlatformAdmin: boolean }, permissions: string[]) => {
        if (!ctx.isPlatformAdmin && !permissions.some((permission) => ctx.permissions.includes(permission))) throw new PermissionError(permissions.join(" or "));
    },
    hasPermissionWithContext: (ctx: { permissions: string[]; isPlatformAdmin: boolean }, permission: string) => ctx.isPlatformAdmin || ctx.permissions.includes(permission),
}));
vi.mock("@/services/sso/sso-providers-model", () => ({ getSsoProvidersModel: (...args: unknown[]) => mocks.getModel(...args) }));
// The tenants the platform group of the viewer reaches.
vi.mock("@/services/user/platform-group-service", () => ({ platformGroupService: { reachOf: (...args: unknown[]) => mocks.reachOf(...args) } }));

import { GET } from "@/app/api/sso-providers/route";

const signedIn = (...permissions: string[]) =>
    mocks.getAuthContext.mockResolvedValue({ userId: "lena", permissions, isPlatformAdmin: false, authMethod: "session", tenantId: "default" });
const signedInAsPlatformAdmin = () =>
    mocks.getAuthContext.mockResolvedValue({ userId: "root", permissions: [PERMISSIONS.SETTINGS.READ], isPlatformAdmin: true, authMethod: "session", tenantId: "default" });

describe("GET /api/sso-providers", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.getModel.mockResolvedValue({ providers: [] });
        mocks.reachOf.mockResolvedValue("all");
    });

    it("turns away a request without a session or a key", async () => {
        mocks.getAuthContext.mockResolvedValue(null);
        expect((await GET()).status).toBe(401);
        expect(mocks.getModel).not.toHaveBeenCalled();
    });

    it("needs the right to see the sign-in providers or the settings before it loads anything", async () => {
        signedIn(PERMISSIONS.USERS.READ);
        expect((await GET()).status).toBe(403);
        expect(mocks.getModel).not.toHaveBeenCalled();
        // On an install of one tenant the settings of the home tenant show the providers, as before.
        signedIn(PERMISSIONS.SETTINGS.READ);
        expect((await GET()).status).toBe(200);
    });

    it("hands every provider with the groups to whoever may see the sign-in providers, a platform group of all tenants or a platform admin", async () => {
        signedIn(PERMISSIONS.PLATFORM.SIGN_IN_READ);
        expect((await GET()).status).toBe(200);
        expect(mocks.getModel).toHaveBeenLastCalledWith(true, { reach: "all", viewerId: "lena" });

        signedInAsPlatformAdmin();
        expect((await GET()).status).toBe(200);
        expect(mocks.getModel).toHaveBeenLastCalledWith(true, { reach: "all", viewerId: "root" });
    });

    it("shows a platform group of some tenants the providers of the platform and of those tenants only", async () => {
        mocks.reachOf.mockResolvedValue(["acme"]);
        signedIn(PERMISSIONS.PLATFORM.SIGN_IN_READ);

        expect((await GET()).status).toBe(200);
        expect(mocks.reachOf).toHaveBeenCalledWith("lena");
        expect(mocks.getModel).toHaveBeenLastCalledWith(true, { reach: ["acme"], viewerId: "lena" });
    });

    it("keeps every provider for whoever reads the settings through the home tenant without a platform group, as before platform groups", async () => {
        mocks.reachOf.mockResolvedValue([]);
        signedIn(PERMISSIONS.SETTINGS.READ);

        expect((await GET()).status).toBe(200);
        expect(mocks.getModel).toHaveBeenLastCalledWith(true, { reach: "all", viewerId: "lena" });
    });

    it("keeps someone of a platform group of some tenants to its tenants, the settings read through the home tenant too", async () => {
        mocks.reachOf.mockResolvedValue(["acme"]);
        mocks.getAuthContext.mockResolvedValue({
            userId: "lena",
            permissions: [PERMISSIONS.PLATFORM.SIGN_IN_READ, PERMISSIONS.SETTINGS.READ],
            isPlatformAdmin: false,
            authMethod: "session",
            tenantId: "default",
            platformGroup: { id: "pg-acme", name: "Support Acme", allTenants: false },
        });

        expect((await GET()).status).toBe(200);
        expect(mocks.getModel).toHaveBeenLastCalledWith(true, { reach: ["acme"], viewerId: "lena" });
    });

    it("answers no API key, which gets the settings of its owner's group in the home tenant, since the list spans every tenant", async () => {
        mocks.getAuthContext.mockResolvedValue({ userId: "lena", permissions: [PERMISSIONS.SETTINGS.READ], isPlatformAdmin: false, authMethod: "apikey", apiKeyId: "key-1", tenantId: "default" });

        expect((await GET()).status).toBe(403);
        expect(mocks.getModel).not.toHaveBeenCalled();
    });
});
