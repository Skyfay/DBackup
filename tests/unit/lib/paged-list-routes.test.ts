import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { PermissionError } from "@/lib/logging/errors";

const mocks = vi.hoisted(() => ({
    getAuthContext: vi.fn(),
    listJobPage: vi.fn(),
    listDatabasePage: vi.fn(),
}));

vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
vi.mock("@/lib/auth/access-control", () => ({
    getAuthContext: (...args: unknown[]) => mocks.getAuthContext(...args),
    checkPermissionWithContext: (ctx: { permissions: string[] }, permission: string) => {
        if (!ctx.permissions.includes(permission)) throw new PermissionError(permission);
    },
    hasPermissionWithContext: (ctx: { permissions: string[] }, permission: string) => ctx.permissions.includes(permission),
}));
vi.mock("@/services/jobs/job-page-service", () => ({
    JOB_MAX_PAGE_SIZE: 500,
    listJobPage: (...args: unknown[]) => mocks.listJobPage(...args),
}));
vi.mock("@/services/databases/database-page-service", () => ({
    listDatabasePage: (...args: unknown[]) => mocks.listDatabasePage(...args),
}));

import { GET as getJobs } from "@/app/api/jobs/list/route";
import { GET as getDatabases } from "@/app/api/databases/list/route";

const signedIn = (permissions: string[], extra: Record<string, unknown> = {}) =>
    mocks.getAuthContext.mockResolvedValue({ userId: "u1", permissions, isPlatformAdmin: false, tenantId: "acme", allTenants: false, ...extra });
const jobs = (query = "") => getJobs(new NextRequest(`http://localhost/api/jobs/list${query}`));
const databases = (query = "") => getDatabases(new NextRequest(`http://localhost/api/databases/list${query}`));

describe("the paged list of the Jobs page", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.listJobPage.mockResolvedValue({ rows: [], total: 0, counts: { all: 0, attention: 0, running: 0, paused: 0 }, stats: { total: 0 }, live: false });
    });

    it("turns away a visitor without a session or without the permission to read jobs", async () => {
        mocks.getAuthContext.mockResolvedValue(null);
        expect((await jobs()).status).toBe(401);
        signedIn([PERMISSIONS.HISTORY.READ]);
        expect((await jobs()).status).toBe(403);
        expect(mocks.listJobPage).not.toHaveBeenCalled();
    });

    it("passes the page, the quick filter, the search and the jobs a link names on, newest first", async () => {
        signedIn([PERMISSIONS.JOBS.READ]);
        const response = await jobs("?page=3&pageSize=50&filter=attention&search=shop&id=j1&id=j2&tenant=globex");
        expect(response.status).toBe(200);
        // Inside a tenant the Tenant filter is left out, every job is of that tenant anyway.
        expect(mocks.listJobPage).toHaveBeenCalledWith(
            { page: 3, pageSize: 50, filter: "attention", search: "shop", sort: "createdAt", desc: true, tenantIds: [], ids: ["j1", "j2"] },
            { byTenant: false },
        );
        expect((await response.json()).data.counts).toEqual({ all: 0, attention: 0, running: 0, paused: 0 });
    });

    it("sorts by name from A unless asked otherwise", async () => {
        signedIn([PERMISSIONS.JOBS.READ]);
        await jobs("?sort=name");
        expect(mocks.listJobPage.mock.calls[0][0]).toMatchObject({ sort: "name", desc: false });
        await jobs("?sort=createdAt&order=asc");
        expect(mocks.listJobPage.mock.calls[1][0]).toMatchObject({ sort: "createdAt", desc: false });
    });

    it("narrows to the tenants picked and counts them in All tenants", async () => {
        signedIn([PERMISSIONS.JOBS.READ], { tenantId: null, allTenants: true, isPlatformAdmin: true });
        await jobs("?tenant=acme&tenant=globex");
        expect(mocks.listJobPage).toHaveBeenCalledWith(expect.objectContaining({ tenantIds: ["acme", "globex"] }), { byTenant: true });
    });

    it("refuses a page size above the limit and a quick filter it does not know", async () => {
        signedIn([PERMISSIONS.JOBS.READ]);
        expect((await jobs("?pageSize=501")).status).toBe(400);
        expect((await jobs("?filter=broken")).status).toBe(400);
        expect(mocks.listJobPage).not.toHaveBeenCalled();
    });
});

describe("the paged list of the Databases tab", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.listDatabasePage.mockResolvedValue({ rows: [], total: 0 });
    });

    it("turns away a visitor without a session or without the permission to see the database connections", async () => {
        mocks.getAuthContext.mockResolvedValue(null);
        expect((await databases()).status).toBe(401);
        signedIn([PERMISSIONS.JOBS.READ]);
        expect((await databases()).status).toBe(403);
        expect(mocks.listDatabasePage).not.toHaveBeenCalled();
    });

    it("passes every repeated filter on, the biggest first, with the jobs for a viewer who may see them", async () => {
        signedIn([PERMISSIONS.SOURCES.VIEW, PERMISSIONS.JOBS.READ]);
        expect((await databases("?page=2&pageSize=100&search=shop&server=s1&server=s2&engine=postgres&job=none&state=never&tenant=acme")).status).toBe(200);
        expect(mocks.listDatabasePage).toHaveBeenCalledWith({
            page: 2, pageSize: 100, sort: "size", desc: true, search: "shop", serverIds: ["s1", "s2"], engines: ["postgres"], jobIds: ["none"], states: ["never"], tenantIds: [],
        }, { withJobs: true, byTenant: false });
    });

    it("leaves the jobs out for a viewer who may not see them and narrows by tenant in All tenants", async () => {
        signedIn([PERMISSIONS.SOURCES.VIEW], { tenantId: null, allTenants: true, isPlatformAdmin: true });
        await databases("?sort=last&order=asc&tenant=globex");
        expect(mocks.listDatabasePage).toHaveBeenCalledWith(expect.objectContaining({ sort: "last", desc: false, tenantIds: ["globex"] }), { withJobs: false, byTenant: true });
    });

    it("refuses an order, a state or a page size it does not know", async () => {
        signedIn([PERMISSIONS.SOURCES.VIEW]);
        expect((await databases("?sort=color")).status).toBe(400);
        expect((await databases("?state=lost")).status).toBe(400);
        expect((await databases("?pageSize=5000")).status).toBe(400);
        expect(mocks.listDatabasePage).not.toHaveBeenCalled();
    });
});
