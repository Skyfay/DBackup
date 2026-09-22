import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { PermissionError } from "@/lib/logging/errors";

const mocks = vi.hoisted(() => ({
    getAuthContext: vi.fn(),
    getAdapterTypes: vi.fn(),
    getHealthHistory: vi.fn(),
}));

vi.mock("next/headers", () => ({ headers: async () => new Headers() }));

// The real checks, reduced to the permission list of the context.
vi.mock("@/lib/auth/access-control", () => ({
    getAuthContext: (...args: unknown[]) => mocks.getAuthContext(...args),
    checkPermissionWithContext: (ctx: { permissions: string[] }, permission: string) => {
        if (!ctx.permissions.includes(permission)) throw new PermissionError(permission);
    },
}));

vi.mock("@/services/adapters/adapter-service", () => ({ getAdapterTypes: (...args: unknown[]) => mocks.getAdapterTypes(...args) }));
vi.mock("@/services/adapters/health-history", () => ({ getHealthHistory: (...args: unknown[]) => mocks.getHealthHistory(...args) }));

import { GET } from "@/app/api/adapters/[id]/health-history/route";

const call = (id = "pg", query = "") =>
    GET(new NextRequest(`http://localhost/api/adapters/${id}/health-history${query}`), { params: Promise.resolve({ id }) });
const signedIn = (...permissions: string[]) => mocks.getAuthContext.mockResolvedValue({ userId: "u1", permissions, isSuperAdmin: false });

describe("GET /api/adapters/[id]/health-history", () => {
    beforeEach(() => {
        mocks.getAdapterTypes.mockResolvedValue(["database"]);
        mocks.getHealthHistory.mockResolvedValue({ history: [], stats: {}, since: null, lastPassedAt: null });
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

    // Reading destinations used to be enough for the checks of a database source.
    it("needs the read permission of the connection's own kind", async () => {
        signedIn(PERMISSIONS.DESTINATIONS.READ);
        expect((await call()).status).toBe(403);
        expect(mocks.getHealthHistory).not.toHaveBeenCalled();

        mocks.getAdapterTypes.mockResolvedValue(["notification"]);
        signedIn(PERMISSIONS.NOTIFICATIONS.READ);
        expect((await call("mail")).status).toBe(200);
    });

    it("passes a sane limit and a valid start on to the service", async () => {
        signedIn(PERMISSIONS.SOURCES.VIEW);

        await call("pg", "?limit=abc");
        expect(mocks.getHealthHistory).toHaveBeenLastCalledWith("pg", { limit: 100, from: undefined });

        await call("pg", "?limit=999999&from=2026-09-22T12:00:00.000Z");
        expect(mocks.getHealthHistory).toHaveBeenLastCalledWith("pg", { limit: 10_080, from: new Date("2026-09-22T12:00:00.000Z") });

        expect((await call("pg", "?from=yesterday")).status).toBe(400);
    });
});
