// @vitest-environment node
/**
 * A job body names other records by their id. An object in place of an id, like `{ set: "<id>" }`,
 * is a write Prisma understands on a foreign key, and the check that refuses a record of another
 * tenant once left it out of its count. The routes refuse the shape, and the check does too.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { assertOwnRecords } from "@/lib/tenant/references";

const mocks = vi.hoisted(() => ({ createJob: vi.fn(), updateJob: vi.fn(), logFor: vi.fn() }));

vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
vi.mock("@/lib/auth/access-control", () => ({
    getAuthContext: async () => ({ userId: "u-1", tenantId: "acme", permissions: ["jobs:write"], isPlatformAdmin: false, authMethod: "apikey" }),
    checkPermissionWithContext: vi.fn(),
    hasPermissionWithContext: () => true,
}));
vi.mock("@/services/jobs/job-service", () => ({ jobService: { createJob: mocks.createJob, updateJob: mocks.updateJob, deleteJob: vi.fn() } }));
vi.mock("@/services/jobs/job-list-service", () => ({ getJobList: vi.fn() }));
vi.mock("@/services/jobs/job-audit", () => ({ jobAuditSnapshot: vi.fn(async () => null), jobChangeDetails: vi.fn() }));
vi.mock("@/services/audit-service", () => ({ auditService: { logFor: mocks.logFor } }));

const jobs = await import("@/app/api/jobs/route");
const job = await import("@/app/api/jobs/[id]/route");

const request = (method: string, body: unknown) => new NextRequest("http://dbackup.test/api/jobs", { method, body: JSON.stringify(body) });
const update = (body: unknown) => job.PUT(request("PUT", body), { params: Promise.resolve({ id: "job-1" }) });
const JOB = { name: "Nightly", schedule: "0 2 * * *", destinations: [{ configId: "acme-nas" }] };
const FOREIGN = { set: "globex-record" };

describe("a job body that holds an object where an id belongs", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.createJob.mockResolvedValue({ id: "job-1", name: "Nightly" });
        mocks.updateJob.mockResolvedValue({ id: "job-1", name: "Nightly" });
    });

    it.each(["sourceId", "encryptionProfileId", "namingTemplateId", "schedulePresetId"])("is refused on update for %s before the service runs", async (field) => {
        const response = await update({ [field]: FOREIGN });

        expect(response.status).toBe(400);
        expect(mocks.updateJob).not.toHaveBeenCalled();
        expect(mocks.logFor).not.toHaveBeenCalled();
    });

    it("is refused on update for a key cleared through an object", async () => {
        expect((await update({ encryptionProfileId: { set: null } })).status).toBe(400);
        expect(mocks.updateJob).not.toHaveBeenCalled();
    });

    it.each([
        ["a destination", { destinations: [{ configId: FOREIGN }] }],
        ["a retention policy", { destinations: [{ configId: "acme-nas", retentionPolicyId: FOREIGN }] }],
        ["a directory source", { sources: [{ configId: FOREIGN, path: "/data" }] }],
        ["an exclude preset", { sources: [{ configId: "acme-files", path: "/data", excludePatternPresetIds: [FOREIGN] }] }],
        ["a channel", { notificationIds: [FOREIGN] }],
        ["a notification template", { notificationTemplateIds: [FOREIGN] }],
    ])("is refused on update for %s", async (_what, body) => {
        expect((await update(body)).status).toBe(400);
        expect(mocks.updateJob).not.toHaveBeenCalled();
    });

    it("is refused on create", async () => {
        const response = await jobs.POST(request("POST", { ...JOB, sourceId: FOREIGN }));

        expect(response.status).toBe(400);
        expect(mocks.createJob).not.toHaveBeenCalled();
    });

    it("still saves a job whose ids are text and whose key and source are cleared with null", async () => {
        const response = await update({ ...JOB, sourceId: null, encryptionProfileId: null, namingTemplateId: null, schedulePresetId: "preset-1" });

        expect(response.status).toBe(200);
        expect(mocks.updateJob).toHaveBeenCalledWith("job-1", expect.objectContaining({ sourceId: "", encryptionProfileId: "", namingTemplateId: null, schedulePresetId: "preset-1" }));
    });
});

describe("the check of linked records", () => {
    const client = { adapterConfig: { count: vi.fn(async () => 1) }, encryptionProfile: { count: vi.fn(async () => 1) } };

    beforeEach(() => vi.clearAllMocks());

    it("refuses a value that is no id instead of leaving it out of the count", async () => {
        await expect(assertOwnRecords(client, { adapterConfig: [FOREIGN as unknown as string] })).rejects.toThrow("not named by its id");
        await expect(assertOwnRecords(client, { encryptionProfile: [{ set: null } as unknown as string] })).rejects.toThrow("not named by its id");
        expect(client.adapterConfig.count).not.toHaveBeenCalled();
    });

    it("still passes ids, null and undefined", async () => {
        await expect(assertOwnRecords(client, { adapterConfig: ["acme-db", null, undefined] })).resolves.toBeUndefined();
        expect(client.adapterConfig.count).toHaveBeenCalledWith({ where: { id: { in: ["acme-db"] } } });
    });
});
