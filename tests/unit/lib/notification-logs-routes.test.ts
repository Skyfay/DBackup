import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { PermissionError } from "@/lib/logging/errors";

const mocks = vi.hoisted(() => ({
    getAuthContext: vi.fn(),
    getNotificationLogs: vi.fn(),
    getNotificationLogById: vi.fn(),
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
    getNotificationLogFacets: vi.fn(),
    getNotificationStats: vi.fn(),
    getNotificationFilterOptions: vi.fn(),
}));

import { GET as list } from "@/app/api/notification-logs/route";
import { GET as single } from "@/app/api/notification-logs/[id]/route";

const signedIn = (...permissions: string[]) => mocks.getAuthContext.mockResolvedValue({ userId: "u1", permissions, isSuperAdmin: false });
const callList = () => list(new NextRequest("http://localhost/api/notification-logs"));
const callSingle = () => single(new NextRequest("http://localhost/api/notification-logs/n1"), { params: Promise.resolve({ id: "n1" }) });

describe("the notification log routes", () => {
    beforeEach(() => {
        mocks.getNotificationLogs.mockResolvedValue({ data: [], total: 0, page: 1, pageSize: 50 });
        mocks.getNotificationLogById.mockResolvedValue({ id: "n1" });
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
