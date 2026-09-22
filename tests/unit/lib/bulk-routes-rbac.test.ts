import { beforeEach, describe, expect, it, vi } from "vitest";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { PermissionError } from "@/lib/logging/errors";

const mocks = vi.hoisted(() => ({
    getAuthContext: vi.fn(),
    checkPermissionWithContext: vi.fn(),
    headers: vi.fn(),
    deleteJobs: vi.fn(),
    setJobsEnabled: vi.fn(),
    auditLog: vi.fn(),
    deleteAdapters: vi.fn(),
    updateAdapterFlags: vi.fn(),
    getAdapterTypes: vi.fn(),
    deleteBackupsBulk: vi.fn(),
    setBackupsLocked: vi.fn(),
}));

vi.mock("next/headers", () => ({
    headers: () => mocks.headers(),
}));

vi.mock("@/lib/auth/access-control", () => ({
    getAuthContext: (...args: unknown[]) => mocks.getAuthContext(...args),
    checkPermissionWithContext: (...args: unknown[]) => mocks.checkPermissionWithContext(...args),
}));

vi.mock("@/services/jobs/job-service", () => ({
    jobService: {
        deleteJobs: (...args: unknown[]) => mocks.deleteJobs(...args),
        setJobsEnabled: (...args: unknown[]) => mocks.setJobsEnabled(...args),
    },
}));

vi.mock("@/services/audit-service", () => ({
    auditService: { log: (...args: unknown[]) => mocks.auditLog(...args) },
}));

vi.mock("@/services/adapters/adapter-service", () => ({
    deleteAdapters: (...args: unknown[]) => mocks.deleteAdapters(...args),
    updateAdapterFlags: (...args: unknown[]) => mocks.updateAdapterFlags(...args),
    getAdapterTypes: (...args: unknown[]) => mocks.getAdapterTypes(...args),
}));

vi.mock("@/services/storage/bulk-delete", () => ({
    deleteBackupsBulk: (...args: unknown[]) => mocks.deleteBackupsBulk(...args),
    setBackupsLocked: (...args: unknown[]) => mocks.setBackupsLocked(...args),
}));

vi.mock("@/lib/logging/logger", () => ({
    logger: { child: () => ({ error: vi.fn(), warn: vi.fn(), info: vi.fn() }) },
}));

const { POST: bulkJobs } = await import("@/app/api/jobs/bulk/route");
const { POST: bulkAdapters } = await import("@/app/api/adapters/bulk/route");
const { POST: bulkFiles } = await import("@/app/api/storage/[id]/files/bulk/route");

const request = (body: unknown) =>
    ({ json: async () => body }) as unknown as Parameters<typeof bulkJobs>[0];

const storageParams = { params: Promise.resolve({ id: "dest-1" }) };

const authed = (permissions: string[] = []) => ({ userId: "u1", permissions, isSuperAdmin: false });

describe("POST /api/jobs/bulk", () => {
    beforeEach(() => {
        mocks.getAuthContext.mockReset();
        mocks.checkPermissionWithContext.mockReset();
        mocks.deleteJobs.mockReset();
        mocks.setJobsEnabled.mockReset();
        mocks.auditLog.mockReset().mockResolvedValue(undefined);
        mocks.headers.mockResolvedValue(new Headers());
        mocks.deleteJobs.mockResolvedValue({ succeeded: ["a"], failed: [] });
        mocks.setJobsEnabled.mockResolvedValue({ succeeded: ["a"], failed: [] });
    });

    it("rejects an unauthenticated request without touching the service", async () => {
        mocks.getAuthContext.mockResolvedValue(null);

        const res = await bulkJobs(request({ action: "delete", ids: ["a"] }));

        expect(res.status).toBe(401);
        expect(mocks.deleteJobs).not.toHaveBeenCalled();
    });

    it("rejects a caller without job write permission without touching the service", async () => {
        mocks.getAuthContext.mockResolvedValue({ userId: "u1", permissions: [], isSuperAdmin: false });
        mocks.checkPermissionWithContext.mockImplementation(() => {
            throw new PermissionError("jobs:write");
        });

        const res = await bulkJobs(request({ action: "delete", ids: ["a"] }));

        expect(res.status).toBe(403);
        expect(mocks.deleteJobs).not.toHaveBeenCalled();
    });

    it("checks job write permission before doing anything", async () => {
        mocks.getAuthContext.mockResolvedValue({ userId: "u1", permissions: ["jobs:write"], isSuperAdmin: false });

        await bulkJobs(request({ action: "delete", ids: ["a"] }));

        expect(mocks.checkPermissionWithContext).toHaveBeenCalledWith(
            expect.objectContaining({ userId: "u1" }),
            PERMISSIONS.JOBS.WRITE
        );
    });

    it.each([
        ["an unknown action", { action: "explode", ids: ["a"] }],
        ["an empty id list", { action: "delete", ids: [] }],
        ["a missing id list", { action: "delete" }],
        ["a batch over the limit", { action: "delete", ids: Array.from({ length: 201 }, (_, i) => `id-${i}`) }],
    ])("rejects %s", async (_label, body) => {
        mocks.getAuthContext.mockResolvedValue({ userId: "u1", permissions: ["jobs:write"], isSuperAdmin: false });

        const res = await bulkJobs(request(body));

        expect(res.status).toBe(400);
        expect(mocks.deleteJobs).not.toHaveBeenCalled();
        expect(mocks.setJobsEnabled).not.toHaveBeenCalled();
    });

    it("maps enable and disable onto an absolute enabled state", async () => {
        mocks.getAuthContext.mockResolvedValue({ userId: "u1", permissions: ["jobs:write"], isSuperAdmin: false });

        await bulkJobs(request({ action: "enable", ids: ["a"] }));
        expect(mocks.setJobsEnabled).toHaveBeenCalledWith(["a"], true);

        await bulkJobs(request({ action: "disable", ids: ["a"] }));
        expect(mocks.setJobsEnabled).toHaveBeenCalledWith(["a"], false);
    });

    // A row that could not be deleted is not a failed request. Answering 4xx here would
    // make the client discard the rows that did succeed.
    it("answers 200 with the per-row outcomes when only some rows failed", async () => {
        mocks.getAuthContext.mockResolvedValue({ userId: "u1", permissions: ["jobs:write"], isSuperAdmin: false });
        mocks.deleteJobs.mockResolvedValue({
            succeeded: ["a", "b"],
            failed: [{ id: "c", name: "Nightly", error: "still running" }],
        });

        const res = await bulkJobs(request({ action: "delete", ids: ["a", "b", "c"] }));
        const payload = await res.json();

        expect(res.status).toBe(200);
        expect(payload.success).toBe(true);
        expect(payload.data.succeeded).toEqual(["a", "b"]);
        expect(payload.data.failed).toHaveLength(1);
        expect(payload.message).toBe("2 of 3 jobs deleted");
    });

    it("writes one audit entry for the batch rather than one per job", async () => {
        mocks.getAuthContext.mockResolvedValue({ userId: "u1", permissions: ["jobs:write"], isSuperAdmin: false });
        mocks.deleteJobs.mockResolvedValue({ succeeded: ["a", "b", "c"], failed: [] });

        await bulkJobs(request({ action: "delete", ids: ["a", "b", "c"] }));

        expect(mocks.auditLog).toHaveBeenCalledTimes(1);
        expect(mocks.auditLog).toHaveBeenCalledWith(
            "u1",
            "DELETE",
            expect.any(String),
            expect.objectContaining({ bulk: true, requested: 3, succeeded: 3 })
        );
    });
});

describe("POST /api/adapters/bulk", () => {
    beforeEach(() => {
        mocks.getAuthContext.mockReset();
        mocks.checkPermissionWithContext.mockReset();
        mocks.deleteAdapters.mockReset().mockResolvedValue({ succeeded: ["a"], failed: [] });
        mocks.getAdapterTypes.mockReset().mockResolvedValue(["database"]);
        mocks.auditLog.mockReset().mockResolvedValue(undefined);
        mocks.headers.mockResolvedValue(new Headers());
    });

    it("rejects an unauthenticated request without touching the service", async () => {
        mocks.getAuthContext.mockResolvedValue(null);

        const res = await bulkAdapters(request({ action: "delete", ids: ["a"] }));

        expect(res.status).toBe(401);
        expect(mocks.deleteAdapters).not.toHaveBeenCalled();
    });

    it("rejects a caller without the matching write permission", async () => {
        mocks.getAuthContext.mockResolvedValue(authed());
        mocks.checkPermissionWithContext.mockImplementation(() => {
            throw new PermissionError("sources:write");
        });

        const res = await bulkAdapters(request({ action: "delete", ids: ["a"] }));

        expect(res.status).toBe(403);
        expect(mocks.deleteAdapters).not.toHaveBeenCalled();
    });

    // Connections are one table behind three permissions. Checking only the first type
    // would let a source:write holder delete destinations by mixing them into a batch.
    it("checks one permission per distinct type in a mixed selection", async () => {
        mocks.getAuthContext.mockResolvedValue(authed());
        mocks.getAdapterTypes.mockResolvedValue(["database", "storage", "notification"]);

        await bulkAdapters(request({ action: "delete", ids: ["a", "b", "c"] }));

        expect(mocks.checkPermissionWithContext).toHaveBeenCalledTimes(3);
        expect(mocks.checkPermissionWithContext).toHaveBeenCalledWith(expect.anything(), PERMISSIONS.SOURCES.WRITE);
        expect(mocks.checkPermissionWithContext).toHaveBeenCalledWith(expect.anything(), PERMISSIONS.DESTINATIONS.WRITE);
        expect(mocks.checkPermissionWithContext).toHaveBeenCalledWith(expect.anything(), PERMISSIONS.NOTIFICATIONS.WRITE);
    });

    it("refuses the batch when one type in it is not permitted", async () => {
        mocks.getAuthContext.mockResolvedValue(authed());
        mocks.getAdapterTypes.mockResolvedValue(["database", "storage"]);
        mocks.checkPermissionWithContext.mockImplementation((_ctx: unknown, permission: string) => {
            if (permission === PERMISSIONS.DESTINATIONS.WRITE) throw new PermissionError(permission);
        });

        const res = await bulkAdapters(request({ action: "delete", ids: ["a", "b"] }));

        expect(res.status).toBe(403);
        expect(mocks.deleteAdapters).not.toHaveBeenCalled();
    });

    it("answers 404 when none of the ids exist", async () => {
        mocks.getAuthContext.mockResolvedValue(authed());
        mocks.getAdapterTypes.mockResolvedValue([]);

        const res = await bulkAdapters(request({ action: "delete", ids: ["ghost"] }));

        expect(res.status).toBe(404);
        expect(mocks.deleteAdapters).not.toHaveBeenCalled();
    });

    it("rejects a malformed body", async () => {
        mocks.getAuthContext.mockResolvedValue(authed());

        const res = await bulkAdapters(request({ action: "archive", ids: ["a"] }));

        expect(res.status).toBe(400);
        expect(mocks.deleteAdapters).not.toHaveBeenCalled();
    });

    it("switches a setting instead of deleting, and logs it as an update", async () => {
        mocks.getAuthContext.mockResolvedValue(authed());
        mocks.updateAdapterFlags.mockReset().mockResolvedValue({ succeeded: ["a", "b"], failed: [] });

        const res = await bulkAdapters(request({ action: "exclude-from-restore", ids: ["a", "b"] }));

        expect(res.status).toBe(200);
        expect(mocks.updateAdapterFlags).toHaveBeenCalledWith(["a", "b"], { isRestoreExcluded: true });
        expect(mocks.deleteAdapters).not.toHaveBeenCalled();
        expect(mocks.auditLog).toHaveBeenCalledWith(
            "u1",
            "UPDATE",
            expect.any(String),
            expect.objectContaining({ bulk: true, change: "exclude-from-restore", succeeded: 2 })
        );
        expect(mocks.checkPermissionWithContext).toHaveBeenCalledWith(expect.anything(), PERMISSIONS.SOURCES.WRITE);
    });
});

describe("POST /api/storage/[id]/files/bulk", () => {
    beforeEach(() => {
        mocks.getAuthContext.mockReset();
        mocks.checkPermissionWithContext.mockReset();
        mocks.deleteBackupsBulk.mockReset().mockResolvedValue({ succeeded: ["a"], failed: [] });
        mocks.setBackupsLocked.mockReset().mockResolvedValue({ succeeded: ["a"], failed: [] });
        mocks.auditLog.mockReset().mockResolvedValue(undefined);
        mocks.headers.mockResolvedValue(new Headers());
    });

    it("rejects an unauthenticated request without touching the service", async () => {
        mocks.getAuthContext.mockResolvedValue(null);

        const res = await bulkFiles(request({ action: "delete", paths: ["a"] }), storageParams);

        expect(res.status).toBe(401);
        expect(mocks.deleteBackupsBulk).not.toHaveBeenCalled();
    });

    it("rejects a caller without storage delete permission", async () => {
        mocks.getAuthContext.mockResolvedValue(authed());
        mocks.checkPermissionWithContext.mockImplementation(() => {
            throw new PermissionError("storage:delete");
        });

        const res = await bulkFiles(request({ action: "delete", paths: ["a"] }), storageParams);

        expect(res.status).toBe(403);
        expect(mocks.deleteBackupsBulk).not.toHaveBeenCalled();
    });

    it("guards lock and unlock with the same permission as delete", async () => {
        mocks.getAuthContext.mockResolvedValue(authed());

        await bulkFiles(request({ action: "lock", paths: ["a"] }), storageParams);

        expect(mocks.checkPermissionWithContext).toHaveBeenCalledWith(expect.anything(), PERMISSIONS.STORAGE.DELETE);
    });

    it("maps lock and unlock onto an absolute state", async () => {
        mocks.getAuthContext.mockResolvedValue(authed());

        await bulkFiles(request({ action: "lock", paths: ["a"] }), storageParams);
        expect(mocks.setBackupsLocked).toHaveBeenCalledWith("dest-1", ["a"], true);

        await bulkFiles(request({ action: "unlock", paths: ["a"] }), storageParams);
        expect(mocks.setBackupsLocked).toHaveBeenCalledWith("dest-1", ["a"], false);
    });

    it.each([
        ["an unknown action", { action: "shred", paths: ["a"] }],
        ["an empty path list", { action: "delete", paths: [] }],
        ["a batch over the limit", { action: "delete", paths: Array.from({ length: 201 }, (_, i) => `p-${i}`) }],
    ])("rejects %s", async (_label, body) => {
        mocks.getAuthContext.mockResolvedValue(authed());

        const res = await bulkFiles(request(body), storageParams);

        expect(res.status).toBe(400);
        expect(mocks.deleteBackupsBulk).not.toHaveBeenCalled();
    });
});
