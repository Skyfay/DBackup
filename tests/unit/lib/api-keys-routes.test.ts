import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { PermissionError } from "@/lib/logging/errors";

const mocks = vi.hoisted(() => ({
    getAuthContext: vi.fn(),
    getApiKeysModel: vi.fn(),
    getApiKeyDetails: vi.fn(),
}));

vi.mock("next/headers", () => ({ headers: async () => new Headers() }));

// The real check, reduced to the permission list of the context.
vi.mock("@/lib/auth/access-control", () => ({
    getAuthContext: (...args: unknown[]) => mocks.getAuthContext(...args),
    checkPermissionWithContext: (ctx: { permissions: string[] }, permission: string) => {
        if (!ctx.permissions.includes(permission)) throw new PermissionError(permission);
    },
}));
vi.mock("@/services/auth/api-keys-model", () => ({ getApiKeysModel: (...args: unknown[]) => mocks.getApiKeysModel(...args) }));
vi.mock("@/services/auth/api-key-details", () => ({ getApiKeyDetails: (...args: unknown[]) => mocks.getApiKeyDetails(...args) }));

import { GET as getKeys } from "@/app/api/api-keys/route";
import { GET as getKey } from "@/app/api/api-keys/[id]/route";

const signedIn = (...permissions: string[]) => mocks.getAuthContext.mockResolvedValue({ userId: "lena", permissions, isSuperAdmin: false });
const openKey = (id: string) => getKey(new NextRequest(`http://localhost/api/api-keys/${id}`), { params: Promise.resolve({ id }) });

describe("GET /api/api-keys", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.getApiKeysModel.mockResolvedValue({ keys: [], stats: {}, viewer: {} });
    });

    it("turns away a request without a session or a key", async () => {
        mocks.getAuthContext.mockResolvedValue(null);
        expect((await getKeys()).status).toBe(401);
        expect(mocks.getApiKeysModel).not.toHaveBeenCalled();
    });

    it("needs the right to see the API keys before it loads them", async () => {
        signedIn(PERMISSIONS.USERS.READ);
        expect((await getKeys()).status).toBe(403);
        expect(mocks.getApiKeysModel).not.toHaveBeenCalled();
    });

    it("answers with the tab for the viewer, who decides the most a new key may get", async () => {
        signedIn(PERMISSIONS.API_KEYS.READ, PERMISSIONS.JOBS.EXECUTE);
        const response = await getKeys();

        expect(response.status).toBe(200);
        expect(await response.json()).toEqual({ success: true, data: { keys: [], stats: {}, viewer: {} } });
        expect(mocks.getApiKeysModel).toHaveBeenCalledWith({ id: "lena", superAdmin: false, permissions: [PERMISSIONS.API_KEYS.READ, PERMISSIONS.JOBS.EXECUTE] });
    });
});

describe("GET /api/api-keys/[id]", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.getApiKeyDetails.mockResolvedValue({ id: "key-1", runs: [], made: null, rotated: null, auditDays: 90 });
    });

    it("needs the right to see the API keys before it loads one", async () => {
        signedIn(PERMISSIONS.HISTORY.READ);
        expect((await openKey("key-1")).status).toBe(403);
        expect(mocks.getApiKeyDetails).not.toHaveBeenCalled();
    });

    it("answers with the panel of a key, and 404 once it is gone", async () => {
        signedIn(PERMISSIONS.API_KEYS.READ);
        expect(await (await openKey("key-1")).json()).toEqual({ success: true, data: { id: "key-1", runs: [], made: null, rotated: null, auditDays: 90 } });

        mocks.getApiKeyDetails.mockResolvedValue(null);
        expect((await openKey("key-gone")).status).toBe(404);
    });
});
