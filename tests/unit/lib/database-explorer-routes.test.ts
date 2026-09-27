import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { PermissionError } from "@/lib/logging/errors";

const mocks = vi.hoisted(() => ({
    getAuthContext: vi.fn(),
    getOverview: vi.fn(),
    getRuns: vi.fn(),
    readSources: vi.fn(),
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

vi.mock("@/services/databases/database-explorer-service", () => ({
    databaseExplorerService: {
        getOverview: (...args: unknown[]) => mocks.getOverview(...args),
        getRuns: (...args: unknown[]) => mocks.getRuns(...args),
    },
}));
vi.mock("@/services/databases/database-list-service", () => ({
    databaseListService: { readSources: (...args: unknown[]) => mocks.readSources(...args) },
}));

import { GET as getOverview } from "@/app/api/databases/route";
import { POST as readNow } from "@/app/api/databases/read/route";
import { GET as getRuns } from "@/app/api/databases/runs/route";

const signedIn = (...permissions: string[]) => mocks.getAuthContext.mockResolvedValue({ userId: "u1", permissions, isSuperAdmin: false });
const read = (body: unknown) => readNow(new NextRequest("http://localhost/api/databases/read", { method: "POST", body: JSON.stringify(body), headers: { "Content-Type": "application/json" } }));
const runs = (query = "from=2026-09-20T00:00:00Z&until=2026-09-28T00:00:00Z") => getRuns(new NextRequest(`http://localhost/api/databases/runs?${query}`));

describe("Database Explorer API", () => {
    beforeEach(() => {
        mocks.getOverview.mockResolvedValue({ servers: [], databases: [], jobs: [], coverage: false });
        mocks.getRuns.mockResolvedValue({ runs: [], versionChanges: [], planned: [] });
        mocks.readSources.mockResolvedValue(undefined);
    });

    it("turns away a request without a session", async () => {
        mocks.getAuthContext.mockResolvedValue(null);

        expect((await getOverview()).status).toBe(401);
        expect((await read({})).status).toBe(401);
        expect((await runs()).status).toBe(401);
    });

    it("needs the permission to view sources before it reads or loads anything", async () => {
        signedIn(PERMISSIONS.JOBS.READ);

        expect((await getOverview()).status).toBe(403);
        expect((await read({})).status).toBe(403);
        expect((await runs()).status).toBe(403);
        expect(mocks.getOverview).not.toHaveBeenCalled();
        expect(mocks.readSources).not.toHaveBeenCalled();
        expect(mocks.getRuns).not.toHaveBeenCalled();
    });

    it("hands out the jobs of the databases only to a viewer who may see jobs", async () => {
        signedIn(PERMISSIONS.SOURCES.VIEW);
        await getOverview();
        expect(mocks.getOverview).toHaveBeenLastCalledWith({ withJobs: false });

        signedIn(PERMISSIONS.SOURCES.VIEW, PERMISSIONS.JOBS.READ);
        await getOverview();
        expect(mocks.getOverview).toHaveBeenLastCalledWith({ withJobs: true });
    });

    it("keeps the runs of the timeline to a viewer who may see jobs", async () => {
        signedIn(PERMISSIONS.SOURCES.VIEW);
        expect((await runs()).status).toBe(403);

        signedIn(PERMISSIONS.SOURCES.VIEW, PERMISSIONS.JOBS.READ);
        expect((await runs()).status).toBe(200);
        expect(mocks.getRuns).toHaveBeenCalledWith(new Date("2026-09-20T00:00:00Z"), new Date("2026-09-28T00:00:00Z"), expect.any(Date), { withErrors: false });

        await runs("from=2026-09-20T00:00:00Z&until=2026-09-28T00:00:00Z&errors=1");
        expect(mocks.getRuns).toHaveBeenLastCalledWith(expect.any(Date), expect.any(Date), expect.any(Date), { withErrors: true });
    });

    it("refuses a time span that ends before it starts or is no date", async () => {
        signedIn(PERMISSIONS.SOURCES.VIEW, PERMISSIONS.JOBS.READ);
        expect((await runs("from=2026-09-28T00:00:00Z&until=2026-09-20T00:00:00Z")).status).toBe(400);
        expect((await runs("from=yesterday&until=today")).status).toBe(400);
    });

    it("reads the given servers now, or all of them, and answers with the fresh list", async () => {
        signedIn(PERMISSIONS.SOURCES.VIEW);

        expect((await read({ serverIds: ["s1"] })).status).toBe(200);
        expect(mocks.readSources).toHaveBeenLastCalledWith(["s1"]);
        await read({});
        expect(mocks.readSources).toHaveBeenLastCalledWith(undefined);
        expect((await read({ serverIds: "s1" })).status).toBe(400);
    });
});
