import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { PermissionError } from "@/lib/logging/errors";

const mocks = vi.hoisted(() => ({
    getAuthContext: vi.fn(),
    getIndex: vi.fn(),
    getBackups: vi.fn(),
    getExecution: vi.fn(),
    getDestinationView: vi.fn(),
    checkNow: vi.fn(),
}));

vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
vi.mock("@/lib/adapters", () => ({ registerAdapters: vi.fn() }));

// The real checks, reduced to the permission list of the context.
vi.mock("@/lib/auth/access-control", () => ({
    getAuthContext: (...args: unknown[]) => mocks.getAuthContext(...args),
    checkPermissionWithContext: (ctx: { permissions: string[] }, permission: string) => {
        if (!ctx.permissions.includes(permission)) throw new PermissionError(permission);
    },
}));

vi.mock("@/services/storage/explorer-service", () => ({
    storageExplorerService: {
        getIndex: (...args: unknown[]) => mocks.getIndex(...args),
        getBackups: (...args: unknown[]) => mocks.getBackups(...args),
        getExecution: (...args: unknown[]) => mocks.getExecution(...args),
        getDestinationView: (...args: unknown[]) => mocks.getDestinationView(...args),
        checkNow: (...args: unknown[]) => mocks.checkNow(...args),
    },
}));

import { GET as getIndex } from "@/app/api/storage/explorer/route";
import { GET as getBackups } from "@/app/api/storage/explorer/runs/route";
import { GET as getExecution } from "@/app/api/storage/explorer/execution/route";
import { GET as getDestination } from "@/app/api/storage/explorer/destinations/[id]/route";
import { POST as refresh } from "@/app/api/storage/explorer/refresh/route";

const signedIn = (...permissions: string[]) => mocks.getAuthContext.mockResolvedValue({ userId: "u1", permissions, isSuperAdmin: false });
const backups = () => getBackups(new NextRequest("http://localhost/api/storage/explorer/runs"));
const execution = (path?: string) =>
    getExecution(new NextRequest(`http://localhost/api/storage/explorer/execution${path === undefined ? "" : `?path=${encodeURIComponent(path)}`}`));
const check = (body: unknown) =>
    refresh(new NextRequest("http://localhost/api/storage/explorer/refresh", { method: "POST", body: JSON.stringify(body), headers: { "Content-Type": "application/json" } }));
const destination = (id: string) => getDestination(new NextRequest(`http://localhost/api/storage/explorer/destinations/${id}`), { params: Promise.resolve({ id }) });

describe("Storage Explorer API", () => {
    beforeEach(() => {
        mocks.getIndex.mockResolvedValue({ destinations: [], jobs: [] });
        mocks.getBackups.mockResolvedValue({ runs: [] });
        mocks.getExecution.mockResolvedValue(null);
        mocks.getDestinationView.mockResolvedValue({ destination: { id: "nas" }, backups: [] });
    });

    it("turns away a request without a session", async () => {
        mocks.getAuthContext.mockResolvedValue(null);

        expect((await getIndex()).status).toBe(401);
        expect((await backups()).status).toBe(401);
        expect((await execution("Shop/a.tar")).status).toBe(401);
        expect((await destination("nas")).status).toBe(401);
    });

    it("needs the permission to read storage before it loads anything", async () => {
        signedIn(PERMISSIONS.JOBS.READ);

        expect((await getIndex()).status).toBe(403);
        expect((await backups()).status).toBe(403);
        expect((await execution("Shop/a.tar")).status).toBe(403);
        expect((await destination("nas")).status).toBe(403);
        expect(mocks.getIndex).not.toHaveBeenCalled();
        expect(mocks.getBackups).not.toHaveBeenCalled();
        expect(mocks.getExecution).not.toHaveBeenCalled();
        expect(mocks.getDestinationView).not.toHaveBeenCalled();
    });

    it("answers with the index in the usual envelope", async () => {
        signedIn(PERMISSIONS.STORAGE.READ);

        const response = await getIndex();
        expect(response.status).toBe(200);
        expect(await response.json()).toEqual({ success: true, data: { destinations: [], jobs: [] } });
    });

    it("answers with every backup in the usual envelope", async () => {
        signedIn(PERMISSIONS.STORAGE.READ);

        const response = await backups();
        expect(response.status).toBe(200);
        expect(await response.json()).toEqual({ success: true, data: { runs: [] } });
    });

    it("looks up the run of one backup by its path and needs that path", async () => {
        signedIn(PERMISSIONS.STORAGE.READ);
        mocks.getExecution.mockResolvedValue({ id: "exec-1", status: "Partial", startedAt: "2026-09-24T03:00:00.000Z", endedAt: null });

        expect((await execution()).status).toBe(400);
        const response = await execution("Shop nightly/a b.tar");
        expect(mocks.getExecution).toHaveBeenCalledWith("Shop nightly/a b.tar");
        expect(await response.json()).toMatchObject({ success: true, data: { id: "exec-1", status: "Partial" } });
    });

    it("answers 404 for a destination without backups", async () => {
        signedIn(PERMISSIONS.STORAGE.READ);
        mocks.getDestinationView.mockResolvedValue(null);

        expect((await destination("missing")).status).toBe(404);
    });

    it("starts Check now for the named destinations and answers at once", async () => {
        mocks.checkNow.mockResolvedValue(["nas"]);

        mocks.getAuthContext.mockResolvedValue(null);
        expect((await check({ destinationIds: ["nas"] })).status).toBe(401);

        signedIn(PERMISSIONS.JOBS.READ);
        expect((await check({ destinationIds: ["nas"] })).status).toBe(403);

        signedIn(PERMISSIONS.STORAGE.READ);
        expect((await check({ destinationIds: [] })).status).toBe(400);
        expect(mocks.checkNow).not.toHaveBeenCalled();

        const response = await check({ destinationIds: ["nas", "r2"] });
        expect(await response.json()).toEqual({ success: true, data: { listing: ["nas"] } });
        expect(mocks.checkNow).toHaveBeenCalledWith(["nas", "r2"]);
    });
});
