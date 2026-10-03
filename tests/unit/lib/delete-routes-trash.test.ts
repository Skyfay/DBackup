import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { prismaMock } from "@/lib/testing/prisma-mock";

const mocks = vi.hoisted(() => ({
    logFor: vi.fn(),
    deleteJob: vi.fn(),
    deleteJobs: vi.fn(),
    deleteAdapter: vi.fn(),
    deleteCredentialProfiles: vi.fn(),
}));

// An admin who may change the settings, unless a test takes that away.
const ADMIN = ["jobs:write", "destinations:write", "credentials:delete", "settings:write"];
const ctx = { userId: "u1", permissions: [...ADMIN], isSuperAdmin: false, authMethod: "session", apiKeyId: undefined };

vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
vi.mock("@/lib/auth/access-control", () => ({
    getAuthContext: async () => ctx,
    checkPermissionWithContext: () => undefined,
    hasPermissionWithContext: (context: typeof ctx, permission: string) => context.isSuperAdmin || context.permissions.includes(permission),
}));
vi.mock("@/services/audit-service", () => ({ auditService: { log: vi.fn(), logFor: mocks.logFor } }));
vi.mock("@/services/jobs/job-service", () => ({ jobService: { deleteJob: mocks.deleteJob, deleteJobs: mocks.deleteJobs } }));
vi.mock("@/services/adapters/adapter-service", () => ({ deleteAdapter: mocks.deleteAdapter }));
vi.mock("@/services/auth/credential-service", () => ({ deleteCredentialProfiles: mocks.deleteCredentialProfiles }));

const { DELETE: deleteJobRoute } = await import("@/app/api/jobs/[id]/route");
const { POST: bulkJobsRoute } = await import("@/app/api/jobs/bulk/route");
const { DELETE: deleteAdapterRoute } = await import("@/app/api/adapters/[id]/route");
const { POST: bulkCredentialsRoute } = await import("@/app/api/credentials/bulk/route");

const params = (id: string) => ({ params: Promise.resolve({ id }) });
const post = (url: string, body: unknown) => new NextRequest(url, { method: "POST", body: JSON.stringify(body) });

describe("the delete routes and Recently deleted", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        ctx.permissions = [...ADMIN];
        mocks.deleteJob.mockResolvedValue({ name: "Shop nightly" });
        mocks.deleteJobs.mockImplementation(async (ids: string[]) => ({ succeeded: ids, failed: [] }));
        mocks.deleteAdapter.mockResolvedValue({ name: "Old NAS" });
        mocks.deleteCredentialProfiles.mockImplementation(async (ids: string[]) => ({ succeeded: ids, failed: [] }));
        prismaMock.adapterConfig.findUnique.mockResolvedValue({ type: "storage" } as never);
    });

    it("moves a job to Recently deleted by default, naming who deleted it", async () => {
        await deleteJobRoute(new NextRequest("http://localhost/api/jobs/job-1", { method: "DELETE" }), params("job-1"));

        expect(mocks.deleteJob).toHaveBeenCalledWith("job-1", { permanently: false, by: "u1" });
        expect(mocks.logFor).toHaveBeenCalledWith(ctx, "DELETE", "JOB", { name: "Shop nightly" }, "job-1");
    });

    it("deletes at once with ?permanently=true and says so in the audit log", async () => {
        await deleteJobRoute(new NextRequest("http://localhost/api/jobs/job-1?permanently=true", { method: "DELETE" }), params("job-1"));
        await deleteAdapterRoute(new NextRequest("http://localhost/api/adapters/nas?permanently=true", { method: "DELETE" }), params("nas"));

        expect(mocks.deleteJob).toHaveBeenCalledWith("job-1", { permanently: true, by: "u1" });
        expect(mocks.logFor).toHaveBeenCalledWith(ctx, "DELETE", "JOB", { name: "Shop nightly", permanently: true }, "job-1");
        expect(mocks.deleteAdapter).toHaveBeenCalledWith("nas", { permanently: true, by: "u1" });
    });

    it("refuses a permanent delete, one or several, from someone who may not change the settings", async () => {
        ctx.permissions = ADMIN.filter((permission) => permission !== "settings:write");

        const single = await deleteJobRoute(new NextRequest("http://localhost/api/jobs/job-1?permanently=true", { method: "DELETE" }), params("job-1"));
        const connection = await deleteAdapterRoute(new NextRequest("http://localhost/api/adapters/nas?permanently=true", { method: "DELETE" }), params("nas"));
        const bulk = await bulkCredentialsRoute(post("http://localhost/api/credentials/bulk", { action: "delete", ids: ["c"], permanently: true }));

        expect([single.status, connection.status, bulk.status]).toEqual([403, 403, 403]);
        expect(await single.json()).toEqual({ success: false, error: "Deleting permanently needs the right to change the settings." });
        expect(mocks.deleteJob).not.toHaveBeenCalled();
        expect(mocks.deleteAdapter).not.toHaveBeenCalled();
        expect(mocks.deleteCredentialProfiles).not.toHaveBeenCalled();

        // Into Recently deleted it still goes.
        await deleteJobRoute(new NextRequest("http://localhost/api/jobs/job-1", { method: "DELETE" }), params("job-1"));
        expect(mocks.deleteJob).toHaveBeenCalledWith("job-1", { permanently: false, by: "u1" });
    });

    it("passes permanently of a bulk delete on, and refuses it when it is not a yes or no", async () => {
        await bulkJobsRoute(post("http://localhost/api/jobs/bulk", { action: "delete", ids: ["a", "b"], permanently: true }));
        await bulkCredentialsRoute(post("http://localhost/api/credentials/bulk", { action: "delete", ids: ["c"] }));
        const refused = await bulkJobsRoute(post("http://localhost/api/jobs/bulk", { action: "delete", ids: ["a"], permanently: "yes" }));

        expect(mocks.deleteJobs).toHaveBeenCalledTimes(1);
        expect(mocks.deleteJobs).toHaveBeenCalledWith(["a", "b"], { permanently: true, by: "u1" });
        expect(mocks.deleteCredentialProfiles).toHaveBeenCalledWith(["c"], { permanently: false, by: "u1" });
        expect(refused.status).toBe(400);
    });
});
