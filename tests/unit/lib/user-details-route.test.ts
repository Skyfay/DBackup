// @vitest-environment node
/**
 * The panel of a user names the addresses of their sessions, their passkeys and how they sign in,
 * so it opens only an account the caller may see, and answers any other like one that is gone.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { prismaMock } from "@/lib/testing/prisma-mock";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { PermissionError } from "@/lib/logging/errors";

type Ctx = { userId: string; tenantId: string | null; allTenants: boolean; isPlatformAdmin: boolean; permissions: string[]; authMethod: "session" | "apikey" };

const mocks = vi.hoisted(() => ({
    ctx: null as null | Ctx,
    details: vi.fn(),
}));

vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
vi.mock("@/lib/auth", () => ({ auth: { api: { getSession: vi.fn(async () => ({ session: { id: "s-viewer" } })) } } }));
vi.mock("@/lib/auth/access-control", () => {
    const has = (ctx: Ctx, permission: string) => (ctx.isPlatformAdmin && !ctx.allTenants) || ctx.permissions.includes(permission);
    return {
        getAuthContext: async () => mocks.ctx,
        hasPermissionWithContext: has,
        checkPermissionWithContext: (ctx: Ctx, permission: string) => {
            if (!has(ctx, permission)) throw new PermissionError(permission);
        },
    };
});
vi.mock("@/services/user/user-details", () => ({ getUserDetails: (...args: unknown[]) => mocks.details(...args) }));

const { GET } = await import("@/app/api/users/[id]/route");

const open = (id: string) => GET(new NextRequest(`http://localhost/api/users/${id}`), { params: Promise.resolve({ id }) });
const viewer = (tenantId: string | null, ...permissions: string[]): Ctx => ({ userId: "lena", tenantId, allTenants: false, isPlatformAdmin: false, permissions: [PERMISSIONS.USERS.READ, ...permissions], authMethod: "session" });

describe("GET /api/users/[id]", () => {
    beforeEach(() => {
        mocks.details.mockResolvedValue({ id: "max", sessions: [{ ip: "203.0.113.7" }] });
        prismaMock.user.count.mockResolvedValue(0);
    });

    it("opens an account the tenant of the caller lists", async () => {
        mocks.ctx = viewer("t-acme");
        prismaMock.user.count.mockResolvedValue(1);

        const response = await open("max");

        expect(response.status).toBe(200);
        expect(mocks.details).toHaveBeenCalledWith("max", "s-viewer");
    });

    it("answers an account of another tenant like one that is gone, and reads nothing of it", async () => {
        mocks.ctx = viewer("t-acme");

        const response = await open("someone-of-globex");

        expect(response.status).toBe(404);
        expect(await response.json()).toEqual({ success: false, error: "The user no longer exists" });
        expect(mocks.details).not.toHaveBeenCalled();
    });

    it("opens any account for whoever may see the accounts of the platform, also in All tenants", async () => {
        mocks.ctx = { ...viewer(null, PERMISSIONS.PLATFORM.ACCOUNTS_READ), allTenants: true };
        expect((await open("someone-of-globex")).status).toBe(200);
        expect(prismaMock.user.count).not.toHaveBeenCalled();
    });

    it("still needs the right to see the users", async () => {
        mocks.ctx = { ...viewer("t-acme"), permissions: [] };
        expect((await open("lena")).status).toBe(403);
    });
});
