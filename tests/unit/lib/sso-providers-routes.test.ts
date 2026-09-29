import { beforeEach, describe, expect, it, vi } from "vitest";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { PermissionError } from "@/lib/logging/errors";

const mocks = vi.hoisted(() => ({
    getAuthContext: vi.fn(),
    getModel: vi.fn(),
}));

vi.mock("next/headers", () => ({ headers: async () => new Headers() }));

// The real checks, reduced to the permission list of the context.
vi.mock("@/lib/auth/access-control", () => ({
    getAuthContext: (...args: unknown[]) => mocks.getAuthContext(...args),
    checkPermissionWithContext: (ctx: { permissions: string[] }, permission: string) => {
        if (!ctx.permissions.includes(permission)) throw new PermissionError(permission);
    },
    hasPermissionWithContext: (ctx: { permissions: string[] }, permission: string) => ctx.permissions.includes(permission),
}));
vi.mock("@/services/sso/sso-providers-model", () => ({ getSsoProvidersModel: (...args: unknown[]) => mocks.getModel(...args) }));

import { GET } from "@/app/api/sso-providers/route";

const signedIn = (...permissions: string[]) => mocks.getAuthContext.mockResolvedValue({ userId: "lena", permissions, isSuperAdmin: false });

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

    it("needs the right to read the settings before it loads anything", async () => {
        signedIn(PERMISSIONS.USERS.READ);
        expect((await GET()).status).toBe(403);
        expect(mocks.getModel).not.toHaveBeenCalled();
    });

    it("hands the groups only to someone who may change the providers", async () => {
        signedIn(PERMISSIONS.SETTINGS.READ);
        expect((await GET()).status).toBe(200);
        expect(mocks.getModel).toHaveBeenLastCalledWith(null);

        signedIn(PERMISSIONS.SETTINGS.READ, PERMISSIONS.SETTINGS.WRITE);
        await GET();
        expect(mocks.getModel).toHaveBeenLastCalledWith({ superAdmin: false, permissions: [PERMISSIONS.SETTINGS.READ, PERMISSIONS.SETTINGS.WRITE] });
    });
});
