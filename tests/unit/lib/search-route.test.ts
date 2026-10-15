// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

type Ctx = { permissions: string[]; isPlatformAdmin: boolean; tenantId: string | null; allTenants?: boolean };
const mocks = vi.hoisted(() => ({ ctx: null as null | Ctx, search: vi.fn() }));

vi.mock("next/headers", () => ({ headers: vi.fn().mockResolvedValue(new Headers()) }));
vi.mock("@/lib/auth/access-control", () => ({
    getAuthContext: vi.fn(async () => mocks.ctx),
    // Like the real check, a platform admin in All tenants holds only the permissions of that view.
    hasPermissionWithContext: (ctx: Ctx, permission: string) => (ctx.isPlatformAdmin && !ctx.allTenants) || ctx.permissions.includes(permission),
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
        mocks.ctx = { permissions: ["jobs:read", "history:read", "notifications:read", "groups:read", "vault:read"], isPlatformAdmin: false, tenantId: "tenant-a" };

        const response = await GET(request("mysql"));

        expect(mocks.search).toHaveBeenCalledWith("mysql", {
            jobs: true,
            backups: false,
            runs: true,
            databases: false,
            connections: ["notification"],
            users: false,
            groups: true,
            apiKeys: false,
            templates: false,
            keys: true,
            credentials: false,
        }, "tenant-a");
        expect(await response.json()).toEqual({ success: true, data: { hits: [] } });
    });

    it("finds the saved logins only with the credentials as well as the Vault", async () => {
        mocks.ctx = { permissions: ["vault:read", "credentials:read"], isPlatformAdmin: false, tenantId: "default" };

        await GET(request("prod"));

        expect(mocks.search).toHaveBeenCalledWith("prod", expect.objectContaining({ keys: true, credentials: true }), "default");
    });

    it("searches everything for a platform admin, in the tenant they work in", async () => {
        mocks.ctx = { permissions: [], isPlatformAdmin: true, tenantId: "tenant-b" };

        await GET(request("prod"));

        expect(mocks.search).toHaveBeenCalledWith("prod", {
            jobs: true,
            backups: true,
            runs: true,
            databases: true,
            connections: ["database", "storage", "notification"],
            users: true,
            groups: true,
            apiKeys: true,
            templates: true,
            keys: true,
            credentials: true,
        }, "tenant-b");
    });

    it("searches every tenant for a platform admin in All tenants, with what that view may read", async () => {
        mocks.ctx = { permissions: ["jobs:read", "storage:read", "sources:view"], isPlatformAdmin: true, tenantId: null, allTenants: true };

        const response = await GET(request("prod"));

        expect(mocks.search).toHaveBeenCalledWith("prod", expect.objectContaining({ jobs: true, backups: true, databases: true, connections: ["database"], users: false }), null);
        expect(response.status).toBe(200);
    });

    it("finds nothing for an account that works in no tenant", async () => {
        mocks.ctx = { permissions: ["jobs:read"], isPlatformAdmin: false, tenantId: null };

        const response = await GET(request("prod"));

        expect(mocks.search).not.toHaveBeenCalled();
        expect(await response.json()).toEqual({ success: true, data: { hits: [] } });
    });
});
