import { beforeEach, describe, expect, it, vi } from "vitest";
import { prismaMock } from "@/lib/testing/prisma-mock";
import { runAsTenant } from "@/lib/tenant/context";
import { JobService, type CreateJobInput } from "@/services/jobs/job-service";
import { isConfigBackupFolderName } from "@/lib/core/config-backup-path";
import { isUnsafeJobFolderName } from "@/lib/core/job-folder";
import { isTenantsFolderName } from "@/lib/tenant/storage-view";

/**
 * A job writes into the folder its name gives. One called like the folder of the configuration
 * backup would write among its files on the destination of the configuration backup, so the name
 * is refused wherever a job gets one.
 */

vi.mock("@/lib/server/scheduler", () => ({ scheduler: { refresh: vi.fn().mockResolvedValue(undefined) } }));
vi.mock("@/services/dashboard/cache", async (importOriginal) => ({
    ...(await importOriginal<typeof import("@/services/dashboard/cache")>()),
    invalidateDashboardCache: vi.fn(),
}));
vi.mock("@/services/sharing/provided", () => ({ providedTo: vi.fn(async () => []) }));

const job = (overrides: Partial<CreateJobInput> = {}): CreateJobInput => ({
    name: "Nightly",
    schedule: "0 3 * * *",
    sourceId: "shop-db",
    destinations: [{ configId: "nas", priority: 0, retention: "{}" }],
    notificationIds: [],
    enabled: true,
    encryptionProfileId: "key-1",
    ...overrides,
} as CreateJobInput);

const original = (overrides: Record<string, unknown> = {}) => ({
    id: "job-1",
    name: "Nightly",
    schedule: "0 3 * * *",
    sourceId: "shop-db",
    databases: "[]",
    encryptionProfileId: "key-1",
    namingTemplateId: null,
    schedulePresetId: null,
    destinations: [{ configId: "nas", priority: 0, retention: "{}", retentionPolicyId: null }],
    sources: [],
    notifications: [],
    notificationTemplates: [],
    ...overrides,
});

const inHome = <T>(work: () => Promise<T>) => runAsTenant("default", work);

describe("a job called like the folder of the configuration backup", () => {
    let service: JobService;

    beforeEach(() => {
        service = new JobService();
        vi.clearAllMocks();
        for (const model of ["adapterConfig", "job", "encryptionProfile", "namingTemplate", "schedulePreset", "notificationTemplate", "retentionPolicy", "excludePatternPreset"] as const) {
            (prismaMock[model].count as unknown as ReturnType<typeof vi.fn>).mockImplementation(async (args?: { where?: { id?: { in?: string[] } } }) => args?.where?.id?.in?.length ?? 0);
        }
        prismaMock.adapterConfig.findMany.mockResolvedValue([
            { id: "shop-db", type: "database", adapterId: "mysql", storageRole: "DESTINATION" },
            { id: "nas", type: "storage", adapterId: "local-filesystem", storageRole: "DESTINATION" },
        ] as never);
        prismaMock.adapterConfig.findUnique.mockImplementation((async (args: { where: { id: string } }) =>
            args.where.id === "shop-db" ? { id: "shop-db", type: "database", adapterId: "mysql" } : { id: "nas", type: "storage", adapterId: "local-filesystem", storageRole: "DESTINATION" }) as never);
        prismaMock.job.findFirst.mockResolvedValue(null);
        prismaMock.job.create.mockResolvedValue({ id: "job-1", name: "Nightly" } as never);
        prismaMock.connectionShare.count.mockResolvedValue(0);
    });

    it("is refused when it is made, in every spelling a storage folds to that folder", async () => {
        for (const name of ["config-backups", "Config-Backups.", "CONFIG-BACKUPS ", "config-backups/nightly", " ./config-backups\\x"]) {
            await expect(inHome(() => service.createJob(job({ name })))).rejects.toThrow("cannot be called config-backups");
        }
        expect(prismaMock.job.create).not.toHaveBeenCalled();
    });

    it("is refused when a job is renamed to it", async () => {
        prismaMock.job.findUnique.mockResolvedValue(original() as never);
        await expect(inHome(() => service.updateJob("job-1", { name: "Config-Backups" }))).rejects.toThrow("cannot be called config-backups");
        expect(prismaMock.job.update).not.toHaveBeenCalled();
    });

    it("is refused when a job that has the name already is saved again", async () => {
        prismaMock.job.findUnique.mockResolvedValue(original({ name: "config-backups" }) as never);
        await expect(inHome(() => service.updateJob("job-1", { schedule: "0 4 * * *" }))).rejects.toThrow("cannot be called config-backups");
        expect(prismaMock.job.update).not.toHaveBeenCalled();
    });

    it("is refused for a copy that is given it", async () => {
        prismaMock.job.findUnique.mockResolvedValue(original() as never);
        await expect(inHome(() => service.cloneJob("job-1", "config-backups"))).rejects.toThrow("cannot be called config-backups");
        expect(prismaMock.job.create).not.toHaveBeenCalled();
    });

    it("leaves names alone that only start like it or hold it further in", () => {
        expect(isConfigBackupFolderName("config-backups (Copy)")).toBe(false);
        expect(isConfigBackupFolderName("nightly/config-backups")).toBe(false);
        expect(isConfigBackupFolderName("config_backup")).toBe(false);
    });
});

/**
 * A name with a `.` or `..` folder, or one of slashes alone, writes beside the folder of its own
 * name or into the root of every destination, where `x/../config-backups` reaches the files of the
 * configuration backup. The check of that folder read the first folder as written, `x`.
 */
describe("a job whose name leads out of its own folder", () => {
    let service: JobService;

    beforeEach(() => {
        service = new JobService();
        vi.clearAllMocks();
        prismaMock.job.findFirst.mockResolvedValue(null);
        prismaMock.connectionShare.count.mockResolvedValue(0);
    });

    it("is refused when it is made, renamed or copied", async () => {
        for (const name of ["x/..", "x/../nightly", "./nightly", "nightly/. ", "/", " // ", "x/%2e%2e", "x\\..\\y"]) {
            await expect(inHome(() => service.createJob(job({ name })))).rejects.toThrow("cannot hold a . or .. folder");
        }
        prismaMock.job.findUnique.mockResolvedValue(original() as never);
        await expect(inHome(() => service.updateJob("job-1", { name: "nightly/.." }))).rejects.toThrow("cannot hold a . or .. folder");
        await expect(inHome(() => service.cloneJob("job-1", "../nightly"))).rejects.toThrow("cannot hold a . or .. folder");
        expect(prismaMock.job.create).not.toHaveBeenCalled();
        expect(prismaMock.job.update).not.toHaveBeenCalled();
    });

    it("counts the folder a path resolves to as the first one, for the configuration backup and the customers", () => {
        expect(isConfigBackupFolderName("x/../config-backups")).toBe(true);
        expect(isConfigBackupFolderName("x/./../Config-Backups./nightly")).toBe(true);
        expect(isTenantsFolderName("x/../tenants")).toBe(true);
        expect(isTenantsFolderName("x/tenants")).toBe(false);
    });

    it("leaves names alone that only hold dots inside a folder name", () => {
        for (const name of ["Nightly", "shop.db backup", "v1.2/nightly", "a...b", "nightly."]) {
            expect(isUnsafeJobFolderName(name)).toBe(false);
        }
    });

    it("is refused with a semicolon, a double quote or a control character, which break the command of an SMB destination apart", async () => {
        const names = ["x;put /app/data/dbackup.db loot", "x\" \"/etc/cron.d/job", "x\ny", "x\ty", "x\u0000", "x\u007f"];
        for (const name of names) {
            expect(isUnsafeJobFolderName(name), JSON.stringify(name)).toBe(true);
            await expect(inHome(() => service.createJob(job({ name })))).rejects.toThrow("a semicolon, a double quote or a control character");
        }
        expect(prismaMock.job.create).not.toHaveBeenCalled();
        for (const name of ["Nightly (prod)", "shop's backup", "a, b & c", "x:y", "x\\y"]) {
            expect(isUnsafeJobFolderName(name), name).toBe(false);
        }
    });

    it("is refused with a folder that starts with a hyphen, which a command on the server of a destination reads as an option", async () => {
        for (const name of ["-nightly", "--delete", " -x", "shop/-old", "/-x", "%2dx"]) {
            expect(isUnsafeJobFolderName(name), name).toBe(true);
            await expect(inHome(() => service.createJob(job({ name })))).rejects.toThrow("a folder that starts with a hyphen");
        }
        prismaMock.job.findUnique.mockResolvedValue(original() as never);
        await expect(inHome(() => service.updateJob("job-1", { name: "-nightly" }))).rejects.toThrow("starts with a hyphen");
        expect(prismaMock.job.create).not.toHaveBeenCalled();
        expect(prismaMock.job.update).not.toHaveBeenCalled();
        for (const name of ["night-ly", "shop - nightly", "x/a-b", "x-"]) {
            expect(isUnsafeJobFolderName(name), name).toBe(false);
        }
    });
});
