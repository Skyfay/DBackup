import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { PermissionError } from "@/lib/logging/errors";

const mocks = vi.hoisted(() => ({
    getAuthContext: vi.fn(),
    getServers: vi.fn(),
    getServer: vi.fn(),
    getVersions: vi.fn(),
}));

vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
vi.mock("@/lib/adapters", () => ({ registerAdapters: vi.fn() }));

// The real checks, reduced to the permission list of the context.
vi.mock("@/lib/auth/access-control", () => ({
    getAuthContext: (...args: unknown[]) => mocks.getAuthContext(...args),
    checkPermissionWithContext: (ctx: { permissions: string[] }, permission: string) => {
        if (!ctx.permissions.includes(permission)) throw new PermissionError(permission);
    },
    hasPermissionWithContext: (ctx: { permissions: string[] }, permission: string) => ctx.permissions.includes(permission),
}));

vi.mock("@/services/databases/server-explorer-service", () => ({
    serverExplorerService: {
        getServers: (...args: unknown[]) => mocks.getServers(...args),
        getServer: (...args: unknown[]) => mocks.getServer(...args),
        getVersions: (...args: unknown[]) => mocks.getVersions(...args),
    },
}));

import { GET as getServers } from "@/app/api/databases/servers/route";
import { GET as getServer } from "@/app/api/databases/servers/[id]/route";
import { GET as getVersions } from "@/app/api/databases/servers/[id]/versions/route";

const signedIn = (...permissions: string[]) => mocks.getAuthContext.mockResolvedValue({ userId: "u1", permissions, isSuperAdmin: false });
const params = (id: string) => ({ params: Promise.resolve({ id }) });
const versions = (query = "") => getVersions(new NextRequest(`http://localhost/api/databases/servers/shop/versions${query}`), params("shop"));

describe("Servers tab API", () => {
    beforeEach(() => {
        mocks.getServers.mockResolvedValue({ servers: [], newVersions: 0, backups: false });
        mocks.getServer.mockResolvedValue({ id: "shop" });
        mocks.getVersions.mockResolvedValue({ versions: [], total: 0, page: 1, size: 5 });
    });

    it("turns away a visitor without a session or without the permission to see sources", async () => {
        mocks.getAuthContext.mockResolvedValue(null);
        expect((await getServers()).status).toBe(401);

        signedIn(PERMISSIONS.JOBS.READ);
        expect((await getServers()).status).toBe(403);
        expect((await getServer(new Request("http://localhost"), params("shop"))).status).toBe(403);
        expect((await versions()).status).toBe(403);
        expect(mocks.getServers).not.toHaveBeenCalled();
    });

    it("adds the kept backups only for a viewer who may see backups", async () => {
        signedIn(PERMISSIONS.SOURCES.VIEW);
        await getServers();
        expect(mocks.getServers).toHaveBeenLastCalledWith({ withBackups: false });

        signedIn(PERMISSIONS.SOURCES.VIEW, PERMISSIONS.STORAGE.READ);
        await getServers();
        expect(mocks.getServers).toHaveBeenLastCalledWith({ withBackups: true });
    });

    it("answers 404 for a server that does not exist", async () => {
        signedIn(PERMISSIONS.SOURCES.VIEW);
        mocks.getServer.mockResolvedValue(null);
        mocks.getVersions.mockResolvedValue(null);

        expect((await getServer(new Request("http://localhost"), params("gone"))).status).toBe(404);
        expect((await versions()).status).toBe(404);
    });

    it("pages the versions, five by default, and counts what the viewer may see", async () => {
        signedIn(PERMISSIONS.SOURCES.VIEW, PERMISSIONS.JOBS.READ);
        await versions();
        expect(mocks.getVersions).toHaveBeenLastCalledWith("shop", 1, 5, { withJobs: true, withBackups: false });

        await versions("?page=2&size=10");
        expect(mocks.getVersions).toHaveBeenLastCalledWith("shop", 2, 10, { withJobs: true, withBackups: false });

        expect((await versions("?page=0")).status).toBe(400);
        expect((await versions("?size=500")).status).toBe(400);
    });
});
