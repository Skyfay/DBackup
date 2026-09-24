import { beforeEach, describe, expect, it, vi } from "vitest";
import { PermissionError } from "@/lib/logging/errors";
import type { AuthContext } from "@/lib/auth/access-control";

vi.mock("@/lib/logging/logger", () => ({
    logger: { child: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }) },
}));

const mockGetAuthContext = vi.fn();
const mockCheckPermissionWithContext = vi.fn();
vi.mock("@/lib/auth/access-control", () => ({
    getAuthContext: (...args: unknown[]) => mockGetAuthContext(...args),
    checkPermissionWithContext: (...args: unknown[]) => mockCheckPermissionWithContext(...args),
}));

vi.mock("next/headers", () => ({ headers: () => new Headers() }));

const mockGetScheduleLoad = vi.fn();
vi.mock("@/services/jobs/schedule-load-service", () => ({
    getScheduleLoad: (...args: unknown[]) => mockGetScheduleLoad(...args),
}));

const { GET } = await import("@/app/api/jobs/schedules/route");

function user(permissions: string[]): AuthContext {
    return { userId: "user-1", permissions, isSuperAdmin: false, authMethod: "session" } as AuthContext;
}

const LOAD = { timezone: "Europe/Zurich", slots: 1, jobs: [{ id: "mail", name: "Mail archive", schedule: "0 3 * * *", presetId: null, estimatedMs: 360_000 }] };

describe("GET /api/jobs/schedules", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        // Same rule as the real guard, so the tests prove which permission the route asks for.
        mockCheckPermissionWithContext.mockImplementation((ctx: AuthContext, permission: string) => {
            if (!ctx.isSuperAdmin && !ctx.permissions.includes(permission)) throw new PermissionError(permission);
        });
        mockGetScheduleLoad.mockResolvedValue(LOAD);
    });

    it("rejects a request without credentials before loading any schedule", async () => {
        mockGetAuthContext.mockResolvedValue(null);

        const response = await GET();

        expect(response.status).toBe(401);
        expect(mockGetScheduleLoad).not.toHaveBeenCalled();
    });

    it("needs the right to read jobs, since it names every job and when it runs", async () => {
        mockGetAuthContext.mockResolvedValue(user(["templates:read"]));

        const response = await GET();

        expect(response.status).toBe(403);
        expect(mockGetScheduleLoad).not.toHaveBeenCalled();
    });

    it("returns the schedules, the slots of the queue and the scheduler's time zone", async () => {
        mockGetAuthContext.mockResolvedValue(user(["jobs:read"]));

        const response = await GET();

        expect(response.status).toBe(200);
        expect(await response.json()).toEqual({ success: true, data: LOAD });
    });
});
