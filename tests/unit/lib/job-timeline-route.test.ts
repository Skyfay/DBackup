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

const mockGetJobTimeline = vi.fn();
vi.mock("@/services/jobs/job-timeline-service", () => ({
    getJobTimeline: (...args: unknown[]) => mockGetJobTimeline(...args),
}));

const { GET } = await import("@/app/api/jobs/timeline/route");

function user(permissions: string[]): AuthContext {
    return { userId: "user-1", permissions, isSuperAdmin: false, authMethod: "session" } as AuthContext;
}

const TIMELINE = {
    now: "2026-10-02T03:12:00.000Z", from: "2026-09-25T03:12:00.000Z", to: "2026-10-09T03:12:00.000Z", slots: 1,
    estimates: { mail: 360_000 }, failing: [], runs: [], planned: [{ jobId: "mail", due: "2026-10-03T03:00:00.000Z", start: "2026-10-03T03:00:00.000Z", end: "2026-10-03T03:06:00.000Z", waitsFor: [] }], truncated: [],
};

describe("GET /api/jobs/timeline", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        // Same rule as the real guard, so the tests prove which permission the route asks for.
        mockCheckPermissionWithContext.mockImplementation((ctx: AuthContext, permission: string) => {
            if (!ctx.isSuperAdmin && !ctx.permissions.includes(permission)) throw new PermissionError(permission);
        });
        mockGetJobTimeline.mockResolvedValue(TIMELINE);
    });

    it("rejects a request without credentials before loading any run", async () => {
        mockGetAuthContext.mockResolvedValue(null);

        const response = await GET();

        expect(response.status).toBe(401);
        expect(mockGetJobTimeline).not.toHaveBeenCalled();
    });

    it("needs the right to read jobs, since it names every job with its runs", async () => {
        mockGetAuthContext.mockResolvedValue(user(["history:read"]));

        const response = await GET();

        expect(response.status).toBe(403);
        expect(mockGetJobTimeline).not.toHaveBeenCalled();
    });

    it("returns the runs a week back and the plan a week ahead", async () => {
        mockGetAuthContext.mockResolvedValue(user(["jobs:read"]));

        const response = await GET();

        expect(response.status).toBe(200);
        expect(await response.json()).toEqual({ success: true, data: TIMELINE });
    });
});
