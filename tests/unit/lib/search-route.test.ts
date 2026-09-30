// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({ ctx: null as null | { permissions: string[]; isSuperAdmin: boolean }, search: vi.fn() }));

vi.mock("next/headers", () => ({ headers: vi.fn().mockResolvedValue(new Headers()) }));
vi.mock("@/lib/auth/access-control", () => ({
    getAuthContext: vi.fn(async () => mocks.ctx),
    hasPermissionWithContext: (ctx: { permissions: string[]; isSuperAdmin: boolean }, permission: string) => ctx.isSuperAdmin || ctx.permissions.includes(permission),
}));
vi.mock("@/services/search/search-service", () => ({ searchRecords: (...args: unknown[]) => mocks.search(...args) }));

const { GET } = await import("@/app/api/search/route");
const request = (q: string) => new NextRequest(`http://localhost/api/search?q=${encodeURIComponent(q)}`);

describe("the route of the global search", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.search.mockResolvedValue([]);
    });

    it("refuses someone who is not signed in", async () => {
        mocks.ctx = null;

        expect((await GET(request("mysql"))).status).toBe(401);
        expect(mocks.search).not.toHaveBeenCalled();
    });

    it("searches only the kinds the viewer may open", async () => {
        mocks.ctx = { permissions: ["jobs:read", "history:read", "notifications:read"], isSuperAdmin: false };

        const response = await GET(request("mysql"));

        expect(mocks.search).toHaveBeenCalledWith("mysql", { jobs: true, runs: true, databases: false, connections: ["notification"] });
        expect(await response.json()).toEqual({ success: true, data: { hits: [] } });
    });

    it("searches everything for a SuperAdmin", async () => {
        mocks.ctx = { permissions: [], isSuperAdmin: true };

        await GET(request("prod"));

        expect(mocks.search).toHaveBeenCalledWith("prod", { jobs: true, runs: true, databases: true, connections: ["database", "storage", "notification"] });
    });
});
