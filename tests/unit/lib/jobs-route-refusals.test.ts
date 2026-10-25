// @vitest-environment node
/**
 * A job that links a record of another tenant, which `assertOwnRecords` refuses with a
 * ValidationError, answers 400 over the API like the other routes, never 500 as if DBackup broke.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { ValidationError } from "@/lib/logging/errors";

const mocks = vi.hoisted(() => ({ createJob: vi.fn(), updateJob: vi.fn(), logFor: vi.fn() }));

vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
vi.mock("@/lib/auth/access-control", () => ({
    getAuthContext: async () => ({ userId: "u-1", tenantId: "acme", permissions: ["jobs:write"], isPlatformAdmin: false, authMethod: "apikey" }),
    checkPermissionWithContext: vi.fn(),
    hasPermissionWithContext: () => true,
}));
vi.mock("@/services/jobs/job-service", () => ({ jobService: { createJob: mocks.createJob, updateJob: mocks.updateJob } }));
vi.mock("@/services/jobs/job-list-service", () => ({ getJobList: vi.fn() }));
vi.mock("@/services/jobs/job-audit", () => ({ jobAuditSnapshot: vi.fn(async () => null), jobChangeDetails: vi.fn() }));
vi.mock("@/services/audit-service", () => ({ auditService: { logFor: mocks.logFor } }));

const jobs = await import("@/app/api/jobs/route");
const job = await import("@/app/api/jobs/[id]/route");

const request = (method: string, body: unknown) => new NextRequest("http://dbackup.test/api/jobs", { method, body: JSON.stringify(body) });
const JOB = { name: "Nightly", schedule: "0 2 * * *", destinations: [{ configId: "globex-nas" }] };
const FOREIGN = new ValidationError("A storage connection the job names is not one of this tenant.");

describe("a job that names a record of another tenant over the API", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.createJob.mockRejectedValue(FOREIGN);
        mocks.updateJob.mockRejectedValue(FOREIGN);
    });

    it("is refused with 400 and the sentence of the refusal on create", async () => {
        const response = await jobs.POST(request("POST", JOB));

        expect(response.status).toBe(400);
        expect((await response.json()).error).toBe(FOREIGN.message);
        expect(mocks.logFor).not.toHaveBeenCalled();
    });

    it("is refused with 400 and the sentence of the refusal on update", async () => {
        const response = await job.PUT(request("PUT", JOB), { params: Promise.resolve({ id: "job-1" }) });

        expect(response.status).toBe(400);
        expect((await response.json()).error).toBe(FOREIGN.message);
        expect(mocks.logFor).not.toHaveBeenCalled();
    });

    it("still answers 409 for a name that is taken", async () => {
        mocks.createJob.mockRejectedValue(new Error('A job with the name "Nightly" already exists.'));
        expect((await jobs.POST(request("POST", JOB))).status).toBe(409);
    });
});
