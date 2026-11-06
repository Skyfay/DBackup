import { describe, it, expect, vi, beforeEach } from "vitest";
import { prismaMock } from "@/lib/testing/prisma-mock";
import { JobService } from "@/services/jobs/job-service";
import { ValidationError } from "@/lib/logging/errors";
import { assertSourceFolder } from "@/lib/archive/remote-paths";

/**
 * SFTP, FTP and SMB join the folder of a directory source onto the folder their connection is set
 * to, so a folder like `../customer-b` would read beside it. A save refuses it, and so does a copy
 * of a job saved before the rule.
 */

vi.mock("@/lib/server/scheduler", () => ({ scheduler: { refresh: vi.fn().mockResolvedValue(undefined) } }));
vi.mock("@/services/dashboard/cache", async (importOriginal) => ({
    ...(await importOriginal<typeof import("@/services/dashboard/cache")>()),
    invalidateDashboardCache: vi.fn(),
}));
vi.mock("@/services/trash/trash-snapshot", () => ({ keepInTrash: vi.fn(async () => "trash-1") }));

const LEAVING = ["..", "../customer-b", "/data/../../customer-b", "data\\..\\..\\customer-b", "%2e%2e/customer-b", "%2e%2e%2fcustomer-b", "data/.. /x", "..."];
const INSIDE = ["", "/", "data", "/data/app", "./data", "release..notes", "data/v1.2"];

function linksAreOwn() {
    for (const model of ["adapterConfig", "job", "encryptionProfile", "namingTemplate", "schedulePreset", "notificationTemplate", "retentionPolicy", "excludePatternPreset"] as const) {
        (prismaMock[model].count as unknown as ReturnType<typeof vi.fn>).mockImplementation(async (args?: { where?: { id?: { in?: string[] } } }) => args?.where?.id?.in?.length ?? 0);
    }
}

const job = (path: unknown) => ({
    name: "Files",
    schedule: "0 0 * * *",
    destinations: [{ configId: "dest-1", priority: 0, retention: "{}" }],
    sources: [{ configId: "files-1", priority: 0, path: path as string, excludePatterns: [] }],
});

describe("the folder of a directory source", () => {
    it.each(LEAVING)("refuses %s, which leaves the folder of its connection", (folder) => {
        expect(() => assertSourceFolder(folder)).toThrow(ValidationError);
    });

    it.each(INSIDE)("takes %s, which stays inside its connection", (folder) => {
        expect(() => assertSourceFolder(folder)).not.toThrow();
    });

    it("refuses a folder that is no text", () => {
        expect(() => assertSourceFolder(undefined)).toThrow(ValidationError);
        expect(() => assertSourceFolder(42)).toThrow(ValidationError);
    });
});

describe("a job whose directory source leaves the folder of its connection", () => {
    let service: JobService;

    beforeEach(() => {
        service = new JobService();
        vi.clearAllMocks();
        linksAreOwn();
        prismaMock.adapterConfig.findMany.mockResolvedValue([
            { id: "files-1", name: "File server", type: "storage", storageRole: "SOURCE" },
            { id: "dest-1", name: "Backup NAS", type: "storage", storageRole: "DESTINATION" },
        ] as never);
        prismaMock.$transaction.mockImplementation(async (callback: any) => callback(prismaMock));
    });

    it("is not created", async () => {
        await expect(service.createJob(job("../customer-b"))).rejects.toThrow("leaves the folder of its connection");
        expect(prismaMock.job.create).not.toHaveBeenCalled();
    });

    it("is created with a folder inside the connection, and with the whole connection", async () => {
        prismaMock.job.create.mockResolvedValue({ id: "job-1" } as never);
        await expect(service.createJob(job("/data/app"))).resolves.toEqual({ id: "job-1" });
        await expect(service.createJob(job("/"))).resolves.toEqual({ id: "job-1" });
    });

    it("is not saved by an update", async () => {
        prismaMock.job.findUnique.mockResolvedValue({ id: "job-1", sourceId: null, sources: [{ id: "jsrc-1" }] } as never);

        await expect(service.updateJob("job-1", { sources: job("data\\..\\..\\customer-b").sources } as never)).rejects.toThrow("leaves the folder of its connection");
        expect(prismaMock.jobSource.update).not.toHaveBeenCalled();
        expect(prismaMock.jobSource.create).not.toHaveBeenCalled();
    });

    it("is not copied when it was saved before the rule", async () => {
        prismaMock.job.findUnique.mockResolvedValue({
            id: "job-1", name: "Old", schedule: "0 0 * * *", sourceId: null, databases: "[]", encryptionProfileId: null,
            compression: "NONE", pgCompression: "", notificationEvents: "ALWAYS", schedulePresetId: null, namingTemplateId: null,
            skipVerification: false, backupMode: "FULL", fullEveryDays: 7, verifyByHash: false,
            notifications: [], notificationTemplates: [],
            destinations: [{ configId: "dest-1", priority: 0, retention: "{}", retentionPolicyId: null }],
            sources: [{ configId: "files-1", priority: 0, path: "%2e%2e/customer-b", excludePatterns: "[]", stopContainers: true, useStagingCache: false, excludePatternPresets: [] }],
        } as never);

        await expect(service.cloneJob("job-1", "Old copy")).rejects.toThrow("leaves the folder of its connection");
        expect(prismaMock.job.create).not.toHaveBeenCalled();
    });
});
