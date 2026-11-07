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
    /** The words of the refusal, like that All tenants only reads, or the permission when left out. */
    message: undefined as string | undefined,
}));

vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
vi.mock("@/lib/server/request-headers", () => ({ requestHeaders: async () => new Headers() }));
vi.mock("@/lib/auth/access-control", () => ({
    getAuthContext: async () => ({ userId: "max", permissions: [], isPlatformAdmin: false, authMethod: "session", tenantId: "default", allTenants: false }),
    checkPermissionWithContext: (_ctx: unknown, permission: string) => {
        throw new PermissionError(permission, mocks.message ? { message: mocks.message } : undefined);
    },
    hasPermissionWithContext: () => false,
}));
vi.mock("@/lib/adapters", () => ({ registerAdapters: vi.fn() }));
// Whatever a route would do once the check passed.
vi.mock("@/services/jobs/job-service", () => ({ jobService: { deleteJob: mocks.touched, updateJob: mocks.touched, cloneJob: mocks.touched } }));
vi.mock("@/services/adapters/adapter-list", async (importOriginal) => ({
    ...(await importOriginal<typeof import("@/services/adapters/adapter-list")>()),
    getSavedConnection: mocks.touched,
    listAdapters: mocks.touched,
    // The kind of a connection, which decides the permission its routes check.
    getAdapterType: async () => "database",
}));
vi.mock("@/services/adapters/adapter-create", () => ({ createAdapter: mocks.touched }));
vi.mock("@/services/adapters/adapter-service", () => ({ deleteAdapter: mocks.touched }));
vi.mock("@/services/adapters/adapter-update", () => ({ updateAdapter: mocks.touched, UnsupportedSettingError: class extends Error {} }));
vi.mock("@/services/adapters/adapter-clone", () => ({ cloneAdapter: mocks.touched }));
vi.mock("@/services/auth/credential-service", () => ({
    listCredentialProfiles: mocks.touched,
    listCredentialProfilesWithCounts: mocks.touched,
    getCredentialProfile: mocks.touched,
    getDecryptedCredentialData: mocks.touched,
    getCredentialUsage: mocks.touched,
    createCredentialProfile: mocks.touched,
    updateCredentialProfile: mocks.touched,
    deleteCredentialProfile: mocks.touched,
}));
vi.mock("@/services/backup/backup-service", () => ({ backupService: { executeJob: mocks.touched } }));
vi.mock("@/services/system/execution-history-service", () => ({
    listExecutionHistory: mocks.touched,
    getExecutionHistoryFacets: mocks.touched,
    getExecutionHistoryRow: mocks.touched,
}));
vi.mock("@/services/dashboard-service", () => ({ getCalendarData: mocks.touched, getCalendarDataForYear: mocks.touched }));
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
const adapters = await import("@/app/api/adapters/route");
const adapter = await import("@/app/api/adapters/[id]/route");
const adapterClone = await import("@/app/api/adapters/[id]/clone/route");
const credentials = await import("@/app/api/credentials/route");
const credential = await import("@/app/api/credentials/[id]/route");
const reveal = await import("@/app/api/credentials/[id]/reveal/route");
const usage = await import("@/app/api/credentials/[id]/usage/route");
const jobs = await import("@/app/api/jobs/route");
const run = await import("@/app/api/jobs/[id]/run/route");
const history = await import("@/app/api/history/route");
const historyRun = await import("@/app/api/history/[id]/route");
const calendar = await import("@/app/api/dashboard/calendar/route");
const { ALL_TENANTS_REFUSAL } = await vi.importActual<typeof import("@/lib/auth/access-control")>("@/lib/auth/access-control");

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
    ["GET /api/adapters", () => adapters.GET(new NextRequest(`${url}?type=database`))],
    ["POST /api/adapters", () => adapters.POST(json("POST", { name: "Shop", type: "database", adapterId: "mysql", config: {} }))],
    ["DELETE /api/adapters/[id]", () => adapter.DELETE(new NextRequest(url, { method: "DELETE" }), params)],
    ["PUT /api/adapters/[id]", () => adapter.PUT(json("PUT", { name: "Shop" }), params)],
    ["POST /api/adapters/[id]/clone", () => adapterClone.POST(json("POST"), params)],
    ["GET /api/credentials", () => credentials.GET(new NextRequest(url))],
    ["POST /api/credentials", () => credentials.POST(json("POST", { name: "Login", type: "USERNAME_PASSWORD", data: {} }))],
    ["GET /api/credentials/[id]", () => credential.GET(new NextRequest(url), params)],
    ["PUT /api/credentials/[id]", () => credential.PUT(json("PUT", { name: "Login" }), params)],
    ["DELETE /api/credentials/[id]", () => credential.DELETE(new NextRequest(url, { method: "DELETE" }), params)],
    ["GET /api/credentials/[id]/reveal", () => reveal.GET(new NextRequest(url), params)],
    ["GET /api/credentials/[id]/usage", () => usage.GET(new NextRequest(url), params)],
    ["POST /api/jobs", () => jobs.POST(json("POST", { name: "Nightly", schedule: "0 2 * * *", destinations: [{ configId: "d-1" }] }))],
    ["POST /api/jobs/[id]/run", () => run.POST(json("POST"), params)],
    ["GET /api/history", () => history.GET(new NextRequest(url))],
    ["GET /api/history/[id]", () => historyRun.GET(new NextRequest(url), params)],
    ["GET /api/dashboard/calendar", () => calendar.GET(new NextRequest(url))],
];

describe.each(calls)("%s", (_name, call) => {
    beforeEach(() => {
        mocks.touched.mockReset();
        mocks.message = undefined;
    });

    it("answers 403 to a caller without the permission, and does nothing", async () => {
        const response = await call();

        expect(response.status).toBe(403);
        expect(await response.json()).toMatchObject({ success: false });
        expect(mocks.touched).not.toHaveBeenCalled();
    });

    it("answers 403 with its reason to All tenants, which only reads, and does nothing", async () => {
        mocks.message = ALL_TENANTS_REFUSAL;

        const response = await call();

        expect(response.status).toBe(403);
        expect(await response.json()).toMatchObject({ error: ALL_TENANTS_REFUSAL });
        expect(mocks.touched).not.toHaveBeenCalled();
    });
});
