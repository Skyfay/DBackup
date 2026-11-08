import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { PermissionError } from "@/lib/logging/errors";

const mocks = vi.hoisted(() => ({
    getAuthContext: vi.fn(),
    listRuns: vi.fn(),
    getRunFacets: vi.fn(),
    getRunOptions: vi.fn(),
    getRunStats: vi.fn(),
    getRunDetail: vi.fn(),
}));

vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
vi.mock("@/lib/auth/access-control", () => ({
    getAuthContext: (...args: unknown[]) => mocks.getAuthContext(...args),
    checkPermissionWithContext: (ctx: { permissions: string[] }, permission: string) => {
        if (!ctx.permissions.includes(permission)) throw new PermissionError(permission);
    },
}));
vi.mock("@/services/history/run-list-service", () => ({
    RUN_MAX_PAGE_SIZE: 100,
    listRuns: (...args: unknown[]) => mocks.listRuns(...args),
    getRunFacets: (...args: unknown[]) => mocks.getRunFacets(...args),
    getRunOptions: (...args: unknown[]) => mocks.getRunOptions(...args),
    getRunStats: (...args: unknown[]) => mocks.getRunStats(...args),
}));
vi.mock("@/services/history/run-detail-service", () => ({ getRunDetail: (...args: unknown[]) => mocks.getRunDetail(...args) }));

import { GET as getRuns } from "@/app/api/history/runs/route";
import { GET as getRun } from "@/app/api/history/runs/[id]/route";
import { invalidateDashboardCache } from "@/services/dashboard/cache";

const signedIn = (...permissions: string[]) => mocks.getAuthContext.mockResolvedValue({ userId: "u1", permissions, isPlatformAdmin: false });
const runs = (query = "") => getRuns(new NextRequest(`http://localhost/api/history/runs${query}`));
const run = (id: string) => getRun(new NextRequest(`http://localhost/api/history/runs/${id}`), { params: Promise.resolve({ id }) });

describe("History runs API", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        invalidateDashboardCache();
        mocks.listRuns.mockResolvedValue({ rows: [], total: 0, page: 1, pageSize: 25 });
        mocks.getRunFacets.mockResolvedValue({ type: {}, status: {}, job: {}, starter: {} });
        mocks.getRunOptions.mockResolvedValue({ jobs: [], starters: [] });
        mocks.getRunStats.mockResolvedValue({ total: 0 });
        mocks.getRunDetail.mockResolvedValue({ id: "r1" });
    });

    it("turns away a visitor without a session or without the permission to read the history", async () => {
        mocks.getAuthContext.mockResolvedValue(null);
        expect((await runs()).status).toBe(401);
        expect((await run("r1")).status).toBe(401);

        signedIn(PERMISSIONS.JOBS.READ);
        expect((await runs()).status).toBe(403);
        expect((await run("r1")).status).toBe(403);
        expect(mocks.listRuns).not.toHaveBeenCalled();
        expect(mocks.getRunDetail).not.toHaveBeenCalled();
    });

    it("passes every repeated filter on and returns the page with its counts, options and numbers", async () => {
        signedIn(PERMISSIONS.HISTORY.READ);
        const response = await runs("?page=2&pageSize=50&type=Backup&type=Restore&status=Failed&job=j1&by=schedule&search=shop");
        expect(response.status).toBe(200);
        expect(mocks.listRuns).toHaveBeenCalledWith({
            page: 2, pageSize: 50, types: ["Backup", "Restore"], statuses: ["Failed"], jobIds: ["j1"], starters: ["schedule"], search: "shop",
        });
        const body = await response.json();
        expect(body.data).toEqual({ rows: [], total: 0, facets: { type: {}, status: {}, job: {}, starter: {} }, jobs: [], starters: [], stats: { total: 0 } });
    });

    it("refuses a page size above the limit", async () => {
        signedIn(PERMISSIONS.HISTORY.READ);
        expect((await runs("?pageSize=500")).status).toBe(400);
    });

    it("narrows the runs to the tenants picked in All tenants and counts the runs of each tenant", async () => {
        mocks.getAuthContext.mockResolvedValue({ userId: "u1", permissions: [PERMISSIONS.HISTORY.READ], isPlatformAdmin: true, tenantId: null, allTenants: true });
        expect((await runs("?tenant=acme&tenant=globex&status=Failed")).status).toBe(200);
        expect(mocks.listRuns).toHaveBeenCalledWith(expect.objectContaining({ statuses: ["Failed"], tenantIds: ["acme", "globex"] }));
        expect(mocks.getRunFacets).toHaveBeenCalledWith(expect.objectContaining({ tenantIds: ["acme", "globex"] }), true);
    });

    it("ignores a Tenant filter inside a tenant, where every run is of that tenant anyway", async () => {
        mocks.getAuthContext.mockResolvedValue({ userId: "u1", permissions: [PERMISSIONS.HISTORY.READ], isPlatformAdmin: true, tenantId: "acme", allTenants: false });
        expect((await runs("?tenant=globex")).status).toBe(200);
        expect(mocks.listRuns.mock.calls[0][0]).not.toHaveProperty("tenantIds");
        expect(mocks.getRunFacets).toHaveBeenCalledWith(expect.not.objectContaining({ tenantIds: expect.anything() }), false);
    });

    it("refuses a tenant that is no tenant id", async () => {
        mocks.getAuthContext.mockResolvedValue({ userId: "u1", permissions: [PERMISSIONS.HISTORY.READ], isPlatformAdmin: true, tenantId: null, allTenants: true });
        expect((await runs(`?tenant=${"x".repeat(201)}`)).status).toBe(400);
        expect((await runs("?tenant=")).status).toBe(400);
        expect(mocks.listRuns).not.toHaveBeenCalled();
    });

    it("returns one run, and says when it is gone", async () => {
        signedIn(PERMISSIONS.HISTORY.READ);
        expect(await (await run("r1")).json()).toEqual({ success: true, data: { id: "r1" } });
        mocks.getRunDetail.mockResolvedValue(null);
        expect((await run("gone")).status).toBe(404);
    });
});
