import { beforeEach, describe, expect, it, vi } from "vitest";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { PermissionError } from "@/lib/logging/errors";

const mocks = vi.hoisted(() => ({
    getAuthContext: vi.fn(),
    getModel: vi.fn(),
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
}));
vi.mock("@/services/sso/sso-providers-model", () => ({ getSsoProvidersModel: (...args: unknown[]) => mocks.getModel(...args) }));

import { GET } from "@/app/api/sso-providers/route";

const signedIn = (...permissions: string[]) =>
    mocks.getAuthContext.mockResolvedValue({ userId: "lena", permissions, isPlatformAdmin: false, authMethod: "session", tenantId: "default" });
const signedInAsPlatformAdmin = () =>
    mocks.getAuthContext.mockResolvedValue({ userId: "root", permissions: [PERMISSIONS.SETTINGS.READ], isPlatformAdmin: true, authMethod: "session", tenantId: "default" });

describe("GET /api/sso-providers", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.getModel.mockResolvedValue({ providers: [] });
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

    it("hands every provider with the groups to whoever may see the sign-in providers, a platform group or a platform admin", async () => {
        signedIn(PERMISSIONS.PLATFORM.SIGN_IN_READ);
        expect((await GET()).status).toBe(200);
        expect(mocks.getModel).toHaveBeenLastCalledWith(true);

        signedInAsPlatformAdmin();
        expect((await GET()).status).toBe(200);
    });
});
