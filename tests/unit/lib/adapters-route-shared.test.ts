/**
 * `GET /api/adapters` asks for the servers of other tenants whose databases the tenant holds only for
 * `shared=true` on the list of databases, which only the Connections page sends, and only in an open
 * tenant. Whether the newest backups come along follows the rights to see, restore or download them.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
    ctx: { userId: "u-viewer", tenantId: "acme" as string | null, allTenants: false, isPlatformAdmin: false, permissions: [] as string[] },
    checked: [] as string[],
    list: vi.fn(),
}));

vi.mock("@/lib/logging/logger", () => ({ logger: { child: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }) } }));
vi.mock("@/lib/auth/access-control", () => ({
    getAuthContext: vi.fn(async () => mocks.ctx),
    checkPermissionWithContext: vi.fn((_ctx: unknown, permission: string) => mocks.checked.push(permission)),
    hasPermissionWithContext: vi.fn((ctx: { permissions: string[] }, permission: string) => ctx.permissions.includes(permission)),
}));
vi.mock("next/headers", () => ({ headers: vi.fn().mockResolvedValue({}) }));
vi.mock("@/lib/adapters", () => ({ registerAdapters: vi.fn() }));
vi.mock("@/services/audit-service", () => ({ auditService: { log: vi.fn(), logFor: vi.fn() } }));
vi.mock("@/services/adapters/adapter-create", () => ({ createAdapter: vi.fn() }));
vi.mock("@/services/adapters/adapter-list", () => ({ listAdapters: mocks.list }));

const { GET } = await import("@/app/api/adapters/route");

const get = (query: string) => GET(new NextRequest(`http://localhost/api/adapters?${query}`));
const sharedOption = () => mocks.list.mock.calls[0][1].sharedServers;

beforeEach(() => {
    vi.clearAllMocks();
    mocks.checked = [];
    mocks.list.mockResolvedValue([]);
    mocks.ctx = { userId: "u-viewer", tenantId: "acme", allTenants: false, isPlatformAdmin: false, permissions: ["sources:view", "storage:read"] };
});

describe("the provided servers of the list", () => {
    it("are asked for on the list of databases with the flag, after the permission to see sources", async () => {
        const response = await get("type=database&overview=true&shared=true");

        expect(response.status).toBe(200);
        expect(mocks.checked).toEqual(["sources:view"]);
        expect(sharedOption()).toEqual({ tenantId: "acme", backups: true });
    });

    it("are never asked for without the flag, like the pickers and the job form ask", async () => {
        await get("type=database");
        expect(sharedOption()).toBeUndefined();
    });

    it("are never asked for on destinations or channels", async () => {
        await get("type=storage&shared=true");
        expect(sharedOption()).toBeUndefined();
        vi.clearAllMocks();
        await get("type=notification&shared=true");
        expect(sharedOption()).toBeUndefined();
    });

    it("are left out in All tenants and for an account of no tenant", async () => {
        mocks.ctx = { ...mocks.ctx, tenantId: null, allTenants: true, isPlatformAdmin: true };
        await get("type=database&shared=true");
        expect(sharedOption()).toBeUndefined();

        vi.clearAllMocks();
        mocks.ctx = { ...mocks.ctx, tenantId: null, allTenants: false, isPlatformAdmin: false };
        await get("type=database&shared=true");
        expect(sharedOption()).toBeUndefined();
    });

    it("come without their newest backups for a viewer who may neither see, restore nor download backups", async () => {
        mocks.ctx = { ...mocks.ctx, permissions: ["sources:view"] };
        await get("type=database&shared=true");
        expect(sharedOption()).toEqual({ tenantId: "acme", backups: false });

        for (const right of ["storage:restore", "storage:download"]) {
            vi.clearAllMocks();
            mocks.ctx = { ...mocks.ctx, permissions: ["sources:view", right] };
            await get("type=database&shared=true");
            expect(sharedOption()).toEqual({ tenantId: "acme", backups: true });
        }
    });
});
