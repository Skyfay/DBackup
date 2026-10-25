import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { PermissionError } from "@/lib/logging/errors";

const mocks = vi.hoisted(() => ({
    getAuthContext: vi.fn(),
    getNotificationLogs: vi.fn(),
    getNotificationLogById: vi.fn(),
    getNotificationLogFacets: vi.fn(),
    getNotificationStats: vi.fn(),
    getNotificationFilterOptions: vi.fn(),
    shapeOf: vi.fn(),
}));

vi.mock("next/headers", () => ({ headers: async () => new Headers() }));

// The real checks, reduced to the permission list of the context.
vi.mock("@/lib/auth/access-control", () => ({
    getAuthContext: (...args: unknown[]) => mocks.getAuthContext(...args),
    checkPermissionWithContext: (ctx: { permissions: string[] }, permission: string) => {
        if (!ctx.permissions.includes(permission)) throw new PermissionError(permission);
    },
}));

vi.mock("@/services/notifications/notification-log-service", () => ({
    getNotificationLogs: (...args: unknown[]) => mocks.getNotificationLogs(...args),
    getNotificationLogById: (...args: unknown[]) => mocks.getNotificationLogById(...args),
    getNotificationLogFacets: (...args: unknown[]) => mocks.getNotificationLogFacets(...args),
    getNotificationStats: (...args: unknown[]) => mocks.getNotificationStats(...args),
    getNotificationFilterOptions: (...args: unknown[]) => mocks.getNotificationFilterOptions(...args),
}));
// The platform group of the reader, which decides what they see of the log of the home tenant.
vi.mock("@/services/user/platform-group-service", () => ({ platformGroupService: { shapeOf: (...args: unknown[]) => mocks.shapeOf(...args) } }));
vi.mock("@/lib/prisma", () => ({ default: {} }));

import { GET as list } from "@/app/api/notification-logs/route";
import { GET as single } from "@/app/api/notification-logs/[id]/route";

const signedIn = (...permissions: string[]) => mocks.getAuthContext.mockResolvedValue({ userId: "u1", permissions, isPlatformAdmin: false });
const callList = (query = "") => list(new NextRequest(`http://localhost/api/notification-logs${query}`));
const asPlatformAdmin = (allTenants: boolean) => mocks.getAuthContext.mockResolvedValue({
    userId: "u1", permissions: [PERMISSIONS.HISTORY.READ], isPlatformAdmin: true, tenantId: allTenants ? null : "acme", allTenants,
});
const callSingle = () => single(new NextRequest("http://localhost/api/notification-logs/n1"), { params: Promise.resolve({ id: "n1" }) });

describe("the notification log routes", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.getNotificationLogs.mockResolvedValue({ data: [], total: 0, page: 1, pageSize: 50 });
        mocks.getNotificationLogById.mockResolvedValue({ id: "n1" });
        mocks.getNotificationLogFacets.mockResolvedValue({ adapterId: {}, status: {}, channelName: {}, eventType: {} });
        mocks.shapeOf.mockResolvedValue(null);
    });

    it("hands a reader of the log of the home tenant from a platform group of some tenants their reach", async () => {
        mocks.getAuthContext.mockResolvedValue({ userId: "nina", permissions: [PERMISSIONS.HISTORY.READ], isPlatformAdmin: false, tenantId: "default", allTenants: false });
        mocks.shapeOf.mockResolvedValue({ id: "pg-acme", shape: { allTenants: false, tenantIds: ["acme"], platformPermissions: [], tenantPermissions: [] } });
        const restricted = expect.objectContaining({ reach: ["acme"], viewerId: "nina" });

        expect((await callList("?facets=true&stats=true")).status).toBe(200);
        expect((await callSingle()).status).toBe(200);

        expect(mocks.getNotificationLogs).toHaveBeenCalledWith(expect.any(Object), restricted);
        expect(mocks.getNotificationLogFacets).toHaveBeenCalledWith(expect.any(Object), false, restricted);
        expect(mocks.getNotificationStats).toHaveBeenCalledWith(expect.any(Date), restricted);
        expect(mocks.getNotificationFilterOptions).toHaveBeenCalledWith(restricted);
        expect(mocks.getNotificationLogById).toHaveBeenCalledWith("n1", restricted);
    });

    it("narrows the notifications to the tenants picked in All tenants and counts the entries of each tenant", async () => {
        asPlatformAdmin(true);

        expect((await callList("?tenant=acme&tenant=globex&facets=true")).status).toBe(200);
        expect(mocks.getNotificationLogs).toHaveBeenCalledWith(expect.objectContaining({ tenantId: ["acme", "globex"] }), expect.objectContaining({ reach: null }));
        expect(mocks.getNotificationLogFacets).toHaveBeenCalledWith(expect.objectContaining({ tenantId: ["acme", "globex"] }), true, expect.objectContaining({ reach: null }));
    });

    it("ignores a Tenant filter inside a tenant, where every entry is of that tenant anyway", async () => {
        asPlatformAdmin(false);

        expect((await callList("?tenant=globex&facets=true")).status).toBe(200);
        expect(mocks.getNotificationLogs.mock.calls[0][0]).not.toHaveProperty("tenantId");
        expect(mocks.getNotificationLogFacets.mock.calls[0][1]).toBe(false);
    });

    it("refuses a tenant that is no tenant id", async () => {
        asPlatformAdmin(true);

        expect((await callList(`?tenant=${"x".repeat(201)}`)).status).toBe(400);
        expect(mocks.getNotificationLogs).not.toHaveBeenCalled();
    });

    it("refuses someone without history:read with 403 instead of a server error", async () => {
        signedIn(PERMISSIONS.JOBS.READ);

        expect((await callList()).status).toBe(403);
        expect((await callSingle()).status).toBe(403);
        expect(mocks.getNotificationLogs).not.toHaveBeenCalled();
        expect(mocks.getNotificationLogById).not.toHaveBeenCalled();
    });

    it("lists the notifications for someone who may read the history", async () => {
        signedIn(PERMISSIONS.HISTORY.READ);

        expect((await callList()).status).toBe(200);
        expect((await callSingle()).status).toBe(200);
    });

    it("still answers 500 when loading the notifications fails", async () => {
        signedIn(PERMISSIONS.HISTORY.READ);
        mocks.getNotificationLogs.mockRejectedValue(new Error("database is locked"));

        expect((await callList()).status).toBe(500);
    });
});
