import { beforeEach, describe, expect, it, vi } from "vitest";
import { prismaMock } from "@/lib/testing/prisma-mock";
import { runAsTenant } from "@/lib/tenant/context";
import { JobService, type CreateJobInput } from "@/services/jobs/job-service";

vi.mock("@/lib/server/scheduler", () => ({ scheduler: { refresh: vi.fn().mockResolvedValue(undefined) } }));
vi.mock("@/services/dashboard/cache", async (importOriginal) => ({
    ...(await importOriginal<typeof import("@/services/dashboard/cache")>()),
    invalidateDashboardCache: vi.fn(),
}));

/** Acme Hosting shares its NAS with Globex and takes only encrypted backups there. */
const provided = vi.hoisted(() => ({
    providedTo: vi.fn(async (_tenantId: string, filter: { kind: string; ids?: readonly string[] }) => {
        const ids = filter.ids ?? [];
        if (filter.kind === "channel") return ids.includes("acme-mail") ? [{ id: "acme-mail", name: "Acme Mail", providerName: "Acme Hosting" }] : [];
        return ids.includes("acme-nas") ? [{ id: "acme-nas", name: "Acme NAS", encryptedOnly: true, providerName: "Acme Hosting" }] : [];
    }),
}));
vi.mock("@/services/sharing/provided", () => provided);

const job = (overrides: Partial<CreateJobInput> = {}): CreateJobInput => ({
    name: "Nightly",
    schedule: "0 3 * * *",
    sourceId: "globex-db",
    destinations: [{ configId: "acme-nas", priority: 0, retention: "{}" }],
    notificationIds: [],
    enabled: true,
    encryptionProfileId: "globex-key",
    ...overrides,
} as CreateJobInput);

describe("a job of a customer on a destination another tenant shares", () => {
    let service: JobService;

    beforeEach(() => {
        service = new JobService();
        vi.clearAllMocks();
        // Every record the job links to is the tenant's own, the shared NAS is no record of it.
        for (const model of ["adapterConfig", "job", "encryptionProfile", "namingTemplate", "schedulePreset", "notificationTemplate", "retentionPolicy", "excludePatternPreset"] as const) {
            (prismaMock[model].count as unknown as ReturnType<typeof vi.fn>).mockImplementation(async (args?: { where?: { id?: { in?: string[] } } }) => args?.where?.id?.in?.length ?? 0);
        }
        // The filtered client does not find the NAS of the other tenant.
        prismaMock.adapterConfig.findMany.mockResolvedValue([]);
        prismaMock.job.findFirst.mockResolvedValue(null);
        prismaMock.job.create.mockResolvedValue({ id: "globex-job", name: "Nightly" } as never);
    });

    it("writes to it with a key of the customer", async () => {
        await expect(runAsTenant("globex", () => service.createJob(job()))).resolves.toMatchObject({ id: "globex-job" });
        // Only the own records are counted, the shared destination is left out.
        const counted = prismaMock.adapterConfig.count.mock.calls.flatMap((call) => (call[0] as { where: { id: { in: string[] } } }).where.id.in);
        expect(counted).not.toContain("acme-nas");
    });

    it("is refused without a key, since the tenant that shares the destination takes only encrypted backups", async () => {
        await expect(runAsTenant("globex", () => service.createJob(job({ encryptionProfileId: undefined })))).rejects.toThrow(
            "Acme NAS takes only encrypted backups. Pick a key under Encryption.",
        );
        expect(prismaMock.job.create).not.toHaveBeenCalled();
    });

    it("cannot drop its key later while it still writes there", async () => {
        prismaMock.job.findUnique.mockResolvedValue({ encryptionProfileId: "globex-key", destinations: [{ configId: "acme-nas" }] } as never);
        await expect(runAsTenant("globex", () => service.updateJob("globex-job", { encryptionProfileId: "" }))).rejects.toThrow("takes only encrypted backups");
        expect(prismaMock.job.update).not.toHaveBeenCalled();
    });

    describe("copied", () => {
        /** A job of the customer as the copy reads it, saved before the NAS took only encrypted backups. */
        const original = (overrides: Record<string, unknown> = {}) => ({
            id: "globex-job",
            name: "Nightly",
            schedule: "0 3 * * *",
            sourceId: "globex-db",
            databases: "[]",
            encryptionProfileId: null,
            namingTemplateId: null,
            schedulePresetId: null,
            destinations: [{ configId: "acme-nas", priority: 0, retention: "{}", retentionPolicyId: null }],
            sources: [],
            notifications: [],
            notificationTemplates: [],
            ...overrides,
        });

        it("is refused without a key, like a new job, so the copy does not fail at its first run", async () => {
            prismaMock.job.findUnique.mockResolvedValue(original() as never);
            await expect(runAsTenant("globex", () => service.cloneJob("globex-job"))).rejects.toThrow(
                "Acme NAS takes only encrypted backups. Pick a key under Encryption.",
            );
            expect(prismaMock.job.create).not.toHaveBeenCalled();
        });

        it("keeps writing there with the key of the original, paused", async () => {
            prismaMock.job.findUnique.mockResolvedValue(original({ encryptionProfileId: "globex-key" }) as never);
            await runAsTenant("globex", () => service.cloneJob("globex-job"));
            expect(prismaMock.job.create).toHaveBeenCalledWith(expect.objectContaining({
                data: expect.objectContaining({ name: "Nightly (Copy)", enabled: false, encryptionProfileId: "globex-key" }),
            }));
        });

        it("cannot be called like the folder of the customers while it writes to a destination its tenant shares", async () => {
            prismaMock.job.findUnique.mockResolvedValue(original({
                encryptionProfileId: "globex-key",
                destinations: [{ configId: "globex-nas", priority: 0, retention: "{}", retentionPolicyId: null }],
            }) as never);
            prismaMock.connectionShare.count.mockResolvedValue(1);
            await expect(runAsTenant("globex", () => service.cloneJob("globex-job", "Tenants"))).rejects.toThrow("cannot be called tenants");
            expect(prismaMock.job.create).not.toHaveBeenCalled();
        });
    });

    it("names a channel another tenant shares with it", async () => {
        await expect(runAsTenant("globex", () => service.createJob(job({ notificationIds: ["acme-mail"] })))).resolves.toMatchObject({ id: "globex-job" });
        const counted = prismaMock.adapterConfig.count.mock.calls.flatMap((call) => (call[0] as { where: { id: { in: string[] } } }).where.id.in);
        expect(counted).not.toContain("acme-mail");
    });

    it("cannot name a channel of another tenant nobody shares with it", async () => {
        prismaMock.adapterConfig.count.mockResolvedValue(0);
        await expect(runAsTenant("globex", () => service.createJob(job({ notificationIds: ["initech-mail"] })))).rejects.toThrow("does not exist");
        expect(prismaMock.job.create).not.toHaveBeenCalled();
    });

    it("cannot name a destination nobody shares with it", async () => {
        await expect(runAsTenant("globex", () => service.createJob(job({ destinations: [{ configId: "initech-nas", priority: 0, retention: "{}" }] })))).rejects.toThrow(
            'Destination references unknown adapter "initech-nas".',
        );
    });
});
