// @vitest-environment node
/**
 * A refused permission check answers 403. In these routes the check threw outside the try of the
 * route, or into a catch that only knew other errors, and the caller got a 500 as if DBackup broke.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { PermissionError } from "@/lib/logging/errors";

const mocks = vi.hoisted(() => ({
    touched: vi.fn(),
}));

vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
vi.mock("@/lib/server/request-headers", () => ({ requestHeaders: async () => new Headers() }));
vi.mock("@/lib/auth/access-control", () => ({
    getAuthContext: async () => ({ userId: "max", permissions: [], isPlatformAdmin: false, authMethod: "session", tenantId: "default", allTenants: false }),
    checkPermissionWithContext: (_ctx: unknown, permission: string) => {
        throw new PermissionError(permission);
    },
    hasPermissionWithContext: () => false,
}));
vi.mock("@/lib/adapters", () => ({ registerAdapters: vi.fn() }));
// Whatever a route would do once the check passed.
vi.mock("@/services/jobs/job-service", () => ({ jobService: { deleteJob: mocks.touched, updateJob: mocks.touched, cloneJob: mocks.touched } }));
vi.mock("@/services/adapters/adapter-list", async (importOriginal) => ({
    ...(await importOriginal<typeof import("@/services/adapters/adapter-list")>()),
    getSavedConnection: mocks.touched,
}));
vi.mock("@/services/system/system-task-settings", async (importOriginal) => ({
    ...(await importOriginal<typeof import("@/services/system/system-task-settings")>()),
    getSystemTaskRows: mocks.touched,
    saveSystemTask: mocks.touched,
    startSystemTask: mocks.touched,
}));
vi.mock("@/services/system/login-image-service", async (importOriginal) => ({
    ...(await importOriginal<typeof import("@/services/system/login-image-service")>()),
    readLoginImage: mocks.touched,
    saveLoginImage: mocks.touched,
    removeLoginImage: mocks.touched,
    getLoginImageInfo: mocks.touched,
}));
vi.mock("@/services/config/restore-flow", async (importOriginal) => ({
    ...(await importOriginal<typeof import("@/services/config/restore-flow")>()),
    applyCheckedRestore: mocks.touched,
    checkStoredBackup: mocks.touched,
    checkUploadedBackup: mocks.touched,
}));

const job = await import("@/app/api/jobs/[id]/route");
const clone = await import("@/app/api/jobs/[id]/clone/route");
const tasks = await import("@/app/api/settings/system-tasks/route");
const loginImage = await import("@/app/api/settings/login-image/route");
const browse = await import("@/app/api/adapters/[id]/browse/route");
const databases = await import("@/app/api/adapters/[id]/databases/route");
const restoreApply = await import("@/app/api/settings/config-backup/restore/apply/route");

const url = "http://localhost/api/x";
const params = { params: Promise.resolve({ id: "job-1" }) };
const json = (method: string, body: unknown = {}) => new NextRequest(url, { method, body: JSON.stringify(body), headers: { "Content-Type": "application/json" } });

const calls: [string, () => Promise<Response>][] = [
    ["DELETE /api/jobs/[id]", () => job.DELETE(new NextRequest(url, { method: "DELETE" }), params)],
    ["PUT /api/jobs/[id]", () => job.PUT(json("PUT", { name: "Shop" }), params)],
    ["POST /api/jobs/[id]/clone", () => clone.POST(json("POST"), params)],
    ["GET /api/settings/system-tasks", () => tasks.GET(new NextRequest(url))],
    ["POST /api/settings/system-tasks", () => tasks.POST(json("POST", { taskId: "HEALTH_CHECK", enabled: false }))],
    ["PUT /api/settings/system-tasks", () => tasks.PUT(json("PUT", { taskId: "HEALTH_CHECK" }))],
    ["GET /api/settings/login-image", () => loginImage.GET()],
    ["POST /api/settings/login-image", () => loginImage.POST(new NextRequest(url, { method: "POST", body: new FormData() }))],
    ["DELETE /api/settings/login-image", () => loginImage.DELETE()],
    ["GET /api/adapters/[id]/browse", () => browse.GET(new NextRequest(`${url}?path=`), params)],
    ["GET /api/adapters/[id]/databases", () => databases.GET(new NextRequest(url), params)],
    ["POST /api/settings/config-backup/restore/apply", () => restoreApply.POST(json("POST", { token: "t-1" }))],
];

describe.each(calls)("%s", (_name, call) => {
    beforeEach(() => mocks.touched.mockReset());

    it("answers 403 to a caller without the permission, and does nothing", async () => {
        const response = await call();

        expect(response.status).toBe(403);
        expect(await response.json()).toMatchObject({ success: false });
        expect(mocks.touched).not.toHaveBeenCalled();
    });
});
