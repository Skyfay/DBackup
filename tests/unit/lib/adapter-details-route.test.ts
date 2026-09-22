import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { PermissionError } from "@/lib/logging/errors";

const mocks = vi.hoisted(() => ({
    getAuthContext: vi.fn(),
    getAdapterTypes: vi.fn(),
    getConnectionDetails: vi.fn(),
}));

vi.mock("next/headers", () => ({ headers: async () => new Headers() }));

// The real checks, reduced to the permission list of the context.
vi.mock("@/lib/auth/access-control", () => ({
    getAuthContext: (...args: unknown[]) => mocks.getAuthContext(...args),
    hasPermissionWithContext: (ctx: { permissions: string[] }, permission: string) => ctx.permissions.includes(permission),
    checkPermissionWithContext: (ctx: { permissions: string[] }, permission: string) => {
        if (!ctx.permissions.includes(permission)) throw new PermissionError(permission);
    },
}));

vi.mock("@/services/adapters/adapter-service", () => ({ getAdapterTypes: (...args: unknown[]) => mocks.getAdapterTypes(...args) }));
vi.mock("@/services/adapters/connection-details", () => ({ getConnectionDetails: (...args: unknown[]) => mocks.getConnectionDetails(...args) }));

import { GET } from "@/app/api/adapters/[id]/details/route";

const call = (id = "pg") => GET(new NextRequest(`http://localhost/api/adapters/${id}/details`), { params: Promise.resolve({ id }) });
const signedIn = (...permissions: string[]) => mocks.getAuthContext.mockResolvedValue({ userId: "u1", permissions, isSuperAdmin: false });

describe("GET /api/adapters/[id]/details", () => {
    beforeEach(() => {
        mocks.getAdapterTypes.mockResolvedValue(["database"]);
        mocks.getConnectionDetails.mockResolvedValue({ usage: null, lastPassedAt: null, averageLatencyMs: null, versions: [] });
    });

    it("turns away a request without a session", async () => {
        mocks.getAuthContext.mockResolvedValue(null);

        expect((await call()).status).toBe(401);
    });

    it("answers 404 for a connection that does not exist", async () => {
        signedIn(PERMISSIONS.SOURCES.VIEW);
        mocks.getAdapterTypes.mockResolvedValue([]);

        expect((await call("missing")).status).toBe(404);
    });

    it("refuses a user who may not read this kind of connection", async () => {
        signedIn(PERMISSIONS.DESTINATIONS.READ);

        const response = await call();

        expect(response.status).toBe(403);
        expect(mocks.getConnectionDetails).not.toHaveBeenCalled();
    });

    it("shows the jobs only to a user who may view jobs", async () => {
        signedIn(PERMISSIONS.SOURCES.VIEW);
        await call();
        expect(mocks.getConnectionDetails).toHaveBeenLastCalledWith("pg", { includeUsage: false });

        signedIn(PERMISSIONS.SOURCES.VIEW, PERMISSIONS.JOBS.READ);
        await call();
        expect(mocks.getConnectionDetails).toHaveBeenLastCalledWith("pg", { includeUsage: true });
    });
});
