import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { prismaMock } from "@/lib/testing/prisma-mock";
import { ValidationError } from "@/lib/logging/errors";

const mocks = vi.hoisted(() => ({
    logFor: vi.fn(),
    updateJob: vi.fn(),
    restore: vi.fn(),
}));

const ctx = { userId: "u1", permissions: [], isSuperAdmin: true, authMethod: "apikey", apiKeyId: "key-1" };

vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
vi.mock("@/lib/auth/access-control", () => ({
    getAuthContext: async () => ctx,
    checkPermissionWithContext: () => undefined,
}));
vi.mock("@/services/audit-service", () => ({ auditService: { log: vi.fn(), logFor: mocks.logFor } }));
vi.mock("@/services/jobs/job-service", () => ({ jobService: { updateJob: mocks.updateJob } }));
vi.mock("@/services/restore/restore-service", () => ({ restoreService: { restore: mocks.restore } }));

const { PUT } = await import("@/app/api/jobs/[id]/route");
const { POST: RESTORE } = await import("@/app/api/storage/[id]/restore/route");

/** A job as the audit snapshot reads it. */
const jobRow = (overrides: Record<string, unknown> = {}) => ({
    name: "Shop nightly",
    schedule: "0 3 * * *",
    enabled: true,
    databases: "[]",
    compression: "NONE",
    pgCompression: "",
    notificationEvents: "ALWAYS",
    skipVerification: false,
    backupMode: "FULL",
    fullEveryDays: 7,
    verifyByHash: false,
    source: { name: "Shop DB", adapterId: "mysql" },
    schedulePreset: null,
    encryptionProfile: null,
    namingTemplate: null,
    destinations: [{ retention: "{}", retentionPolicy: null, config: { name: "NAS" } }],
    sources: [],
    notifications: [],
    notificationTemplates: [],
    ...overrides,
});

const saveJob = (body: unknown) => PUT(
    new NextRequest("http://localhost/api/jobs/job-1", { method: "PUT", body: JSON.stringify(body) }),
    { params: Promise.resolve({ id: "job-1" }) }
);

const startRestore = (body: unknown) => RESTORE(
    new NextRequest("http://localhost/api/storage/nas/restore", { method: "POST", body: JSON.stringify(body) }),
    { params: Promise.resolve({ id: "nas" }) }
);

describe("saving a job through the API", () => {
    beforeEach(() => {
        mocks.updateJob.mockResolvedValue({ id: "job-1", name: "Shop hourly" });
    });

    it("notes the changed settings of the job, with the name it had before the rename", async () => {
        prismaMock.job.findUnique
            .mockResolvedValueOnce(jobRow() as never)
            .mockResolvedValueOnce(jobRow({ name: "Shop hourly", schedule: "0 * * * *", compression: "GZIP" }) as never);

        const response = await saveJob({ name: "Shop hourly", schedule: "0 * * * *", compression: "GZIP" });

        expect(response.status).toBe(200);
        expect(mocks.logFor).toHaveBeenCalledWith(
            ctx,
            "UPDATE",
            "JOB",
            {
                name: "Shop hourly",
                renamedFrom: "Shop nightly",
                changes: [
                    { field: "When it runs", from: "0 3 * * *", to: "0 * * * *" },
                    { field: "Compression", from: "None", to: "Gzip" },
                ],
            },
            "job-1"
        );
    });

    it("notes nothing when the save is refused", async () => {
        prismaMock.job.findUnique.mockResolvedValueOnce(jobRow() as never);
        mocks.updateJob.mockRejectedValue(new Error('A job with the name "Shop" already exists.'));

        const response = await saveJob({ name: "Shop" });

        expect(response.status).toBe(409);
        expect(mocks.logFor).not.toHaveBeenCalled();
    });
});

describe("starting a restore through the API", () => {
    beforeEach(() => {
        prismaMock.user.findUnique.mockResolvedValue({ name: "Lena Graf" } as never);
        prismaMock.adapterConfig.findMany.mockResolvedValue([
            { id: "nas", name: "NAS" },
            { id: "pg-prod", name: "Prod PostgreSQL" },
        ] as never);
        prismaMock.job.findFirst.mockResolvedValue({ name: "Shop" } as never);
        mocks.restore.mockResolvedValue({ success: true, executionId: "exec-9", message: "Restore started" });
    });

    it("notes a restore of the backup with where it went and the databases it picked", async () => {
        const response = await startRestore({
            file: "Shop/shop_2026-09-28.tar.gz",
            targetSourceId: "pg-prod",
            databaseMapping: [
                { originalName: "shop", targetName: "shop_copy", selected: true },
                { originalName: "crm", targetName: "crm", selected: false },
            ],
        });

        expect(response.status).toBe(202);
        expect(mocks.logFor).toHaveBeenCalledWith(
            ctx,
            "RESTORE",
            "BACKUP",
            {
                action: "restore",
                file: "Shop/shop_2026-09-28.tar.gz",
                destination: "NAS",
                job: "Shop",
                target: "Prod PostgreSQL",
                databases: ["shop as shop_copy"],
                executionId: "exec-9",
            },
            "nas"
        );
    });

    it("notes nothing when the restore is refused before it starts", async () => {
        mocks.restore.mockRejectedValue(new ValidationError("databaseMapping[0] needs an originalName"));

        const response = await startRestore({ file: "Shop/shop_2026-09-28.tar.gz", targetSourceId: "pg-prod", databaseMapping: [{}] });

        expect(response.status).toBe(400);
        expect(mocks.logFor).not.toHaveBeenCalled();
    });
});
