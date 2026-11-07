// @vitest-environment node
/**
 * The routes of jobs, connections and destinations answer a failure inside them with a fixed
 * sentence, while a refusal written for the user, like a name in use or a job that is gone, keeps
 * its own sentence and status.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { ConflictError, NotFoundError, ValidationError } from "@/lib/logging/errors";

/** The detail a failure must never hand to the caller. */
const DETAIL = "SQLITE_IOERR at /srv/dbackup/data/dbackup.db, host 10.0.0.7";

const mocks = vi.hoisted(() => ({
    createJob: vi.fn(),
    updateJob: vi.fn(),
    cloneJob: vi.fn(),
    getConnectionDetails: vi.fn(),
    listFiles: vi.fn(),
    deleteFile: vi.fn(),
    getStorageHistory: vi.fn(),
    deleteJobs: vi.fn(),
}));

vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
vi.mock("@/lib/logging/logger", () => ({ logger: { child: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }) } }));
vi.mock("@/lib/adapters", () => ({ registerAdapters: vi.fn() }));
vi.mock("@/lib/auth/access-control", () => ({
    getAuthContext: async () => ({ userId: "ada", tenantId: "default", allTenants: false, isPlatformAdmin: true, permissions: [], authMethod: "session" }),
    checkPermissionWithContext: vi.fn(),
    checkAnyPermissionWithContext: vi.fn(),
    hasPermissionWithContext: () => true,
}));
vi.mock("@/services/audit-service", () => ({ auditService: { logFor: vi.fn(), log: vi.fn() } }));
vi.mock("@/services/jobs/job-service", () => ({
    jobService: { createJob: mocks.createJob, updateJob: mocks.updateJob, cloneJob: mocks.cloneJob, deleteJobs: mocks.deleteJobs, setJobsEnabled: vi.fn() },
}));
vi.mock("@/services/jobs/job-audit", () => ({ jobAuditName: async () => "Nightly", jobAuditSnapshot: async () => null, jobChangeDetails: () => ({}) }));
vi.mock("@/services/jobs/job-list-service", () => ({ getJobList: vi.fn() }));
vi.mock("@/services/adapters/adapter-service", () => ({ getAdapterTypes: async () => ["database"] }));
vi.mock("@/services/sharing/provided", () => ({ providedConnection: async () => null }));
vi.mock("@/services/adapters/connection-details", () => ({ getConnectionDetails: mocks.getConnectionDetails }));
vi.mock("@/services/storage/storage-service", () => ({ storageService: { listFilesWithMetadata: mocks.listFiles, deleteFile: mocks.deleteFile } }));
vi.mock("@/services/storage/backup-audit", () => ({ backupAuditDetails: async () => ({}) }));
vi.mock("@/services/storage/config-backup-access", () => ({ isConfigBackupFile: async () => false }));
vi.mock("@/services/dashboard-service", () => ({ getStorageHistory: mocks.getStorageHistory }));

const jobs = await import("@/app/api/jobs/route");
const job = await import("@/app/api/jobs/[id]/route");
const clone = await import("@/app/api/jobs/[id]/clone/route");
const details = await import("@/app/api/adapters/[id]/details/route");
const files = await import("@/app/api/storage/[id]/files/route");
const history = await import("@/app/api/storage/[id]/history/route");
const jobsBulk = await import("@/app/api/jobs/bulk/route");

const params = (id: string) => ({ params: Promise.resolve({ id }) });
const errorOf = async (response: Response) => ((await response.json()) as { error?: string }).error ?? "";
const JOB = { name: "Nightly", schedule: "0 2 * * *", destinations: [{ configId: "nas", priority: 0 }] };
const post = (url: string, body: unknown, method = "POST") => new NextRequest(`http://localhost${url}`, { method, body: JSON.stringify(body), headers: { "Content-Type": "application/json" } });

/** Every route of the test, broken by the same failure. */
const calls = () => [
    jobs.POST(post("/api/jobs", JOB)),
    job.PUT(post("/api/jobs/job-1", JOB, "PUT"), params("job-1")),
    clone.POST(post("/api/jobs/job-1/clone", {}), params("job-1")),
    details.GET(new NextRequest("http://localhost/api/adapters/pg/details"), params("pg")),
    files.GET(new NextRequest("http://localhost/api/storage/nas/files"), params("nas")),
    files.DELETE(post("/api/storage/nas/files", { path: "nightly/shop.tar" }, "DELETE"), params("nas")),
    history.GET(new NextRequest("http://localhost/api/storage/nas/history"), params("nas")),
    jobsBulk.POST(post("/api/jobs/bulk", { ids: ["job-1"], action: "delete" })),
];

beforeEach(() => {
    vi.clearAllMocks();
    const broken = new Error(DETAIL);
    for (const mock of Object.values(mocks)) mock.mockRejectedValue(broken);
});

describe("a failure inside a route of jobs, connections or destinations", () => {
    it("answers a fixed sentence and keeps the error for the log", async () => {
        const answers = await Promise.all(calls());

        for (const answer of answers) {
            expect(answer.status).toBe(500);
            const error = await errorOf(answer);
            expect(error.length).toBeGreaterThan(0);
            expect(error).not.toContain("SQLITE");
            expect(error).not.toContain("/srv/dbackup");
            expect(error).not.toContain("10.0.0.7");
        }
    });

    it("still says why a refusal written for the user refused", async () => {
        mocks.createJob.mockRejectedValue(new ConflictError('A job with the name "Nightly" already exists.'));
        mocks.updateJob.mockRejectedValue(new ValidationError("Job must have at least one source: a database source or one or more directory sources."));
        mocks.cloneJob.mockRejectedValue(new NotFoundError("Job", "job-1"));
        mocks.deleteFile.mockRejectedValue(new ConflictError("This backup is part of an incremental chain that 2 later backup(s) still build on."));
        mocks.listFiles.mockRejectedValue(new NotFoundError("Storage configuration", "nas"));

        const created = await jobs.POST(post("/api/jobs", JOB));
        expect([created.status, await errorOf(created)]).toEqual([409, 'A job with the name "Nightly" already exists.']);
        const saved = await job.PUT(post("/api/jobs/job-1", JOB, "PUT"), params("job-1"));
        expect(saved.status).toBe(400);
        expect(await errorOf(saved)).toContain("at least one source");
        expect((await clone.POST(post("/api/jobs/job-1/clone", {}), params("job-1"))).status).toBe(404);
        const deleted = await files.DELETE(post("/api/storage/nas/files", { path: "nightly/shop.tar" }, "DELETE"), params("nas"));
        expect(deleted.status).toBe(409);
        expect(await errorOf(deleted)).toContain("incremental chain");
        expect((await files.GET(new NextRequest("http://localhost/api/storage/nas/files"), params("nas"))).status).toBe(404);
    });
});
