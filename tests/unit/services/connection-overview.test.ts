import { describe, it, expect, vi, beforeEach, type Mock } from "vitest";
import { prismaMock } from "@/lib/testing/prisma-mock";

vi.mock("@/services/dashboard-service", () => ({
    getStorageVolume: vi.fn(),
}));

import { getStorageVolume } from "@/services/dashboard-service";
import { invalidateDashboardCache } from "@/services/dashboard/cache";
import { getConnectionOverview, healthBuckets } from "@/services/adapters/connection-overview";

const NOW = new Date("2026-09-22T12:00:00.000Z");
const HOUR = 60 * 60 * 1000;
const at = (hoursAgo: number) => new Date(NOW.getTime() - hoursAgo * HOUR);
// Prisma's groupBy overloads are too deep for the mock types, so these two are driven as plain mocks.
const mocked = (fn: unknown) => fn as Mock;

describe("healthBuckets", () => {
    it("marks an hour as failed when one of its checks failed", () => {
        const { health } = healthBuckets([
            { status: "ONLINE", createdAt: at(0.5) },
            { status: "DEGRADED", createdAt: at(0.4) },
        ], NOW);

        expect(health[23]).toBe("failed");
    });

    it("lets an offline check outrank a failed one in the same hour", () => {
        const { health } = healthBuckets([
            { status: "OFFLINE", createdAt: at(2.5) },
            { status: "DEGRADED", createdAt: at(2.2) },
        ], NOW);

        expect(health[21]).toBe("offline");
    });

    it("reports the share of passed checks and leaves quiet hours empty", () => {
        const { health, checksPassed } = healthBuckets([
            { status: "ONLINE", createdAt: at(1.5) },
            { status: "ONLINE", createdAt: at(1.4) },
            { status: "ONLINE", createdAt: at(1.3) },
            { status: "DEGRADED", createdAt: at(1.2) },
        ], NOW);

        expect(checksPassed).toBe(75);
        expect(health.filter((bucket) => bucket === "none")).toHaveLength(23);
    });

    it("puts a check made at this moment into the newest hour", () => {
        expect(healthBuckets([{ status: "ONLINE", createdAt: NOW }], NOW).health[23]).toBe("ok");
    });

    it("has no share when no check ran", () => {
        expect(healthBuckets([], NOW).checksPassed).toBeNull();
    });
});

describe("getConnectionOverview", () => {
    beforeEach(() => {
        vi.useFakeTimers({ now: NOW, toFake: ["Date"] });
        invalidateDashboardCache();
        vi.mocked(getStorageVolume).mockResolvedValue([]);
        prismaMock.adapterConfig.findMany.mockResolvedValue([]);
        prismaMock.job.findMany.mockResolvedValue([]);
        prismaMock.jobDestination.findMany.mockResolvedValue([]);
        prismaMock.jobSource.findMany.mockResolvedValue([]);
        prismaMock.notificationTemplateChannel.findMany.mockResolvedValue([]);
        prismaMock.healthCheckLog.findMany.mockResolvedValue([]);
        mocked(prismaMock.execution.groupBy).mockResolvedValue([]);
        prismaMock.execution.findMany.mockResolvedValue([]);
        mocked(prismaMock.notificationLog.groupBy).mockResolvedValue([]);
        prismaMock.notificationLog.findMany.mockResolvedValue([]);
    });

    it("counts a job once when it reads several folders of the same source", async () => {
        prismaMock.adapterConfig.findMany.mockResolvedValue([
            { id: "nas", type: "storage", storageRole: "SOURCE", primaryCredential: null, defaultRetentionPolicy: null },
        ] as never);
        prismaMock.jobSource.findMany.mockResolvedValue([
            { configId: "nas", jobId: "files" },
            { configId: "nas", jobId: "files" },
        ] as never);

        const overview = await getConnectionOverview(["nas"]);

        expect(overview.get("nas")?.usedBy).toEqual({ jobs: 1, templates: 0 });
    });

    it("shows the newest finished backup across every job using a database", async () => {
        prismaMock.adapterConfig.findMany.mockResolvedValue([
            { id: "pg", type: "database", storageRole: "DESTINATION", primaryCredential: { name: "prod-db" }, defaultRetentionPolicy: null },
        ] as never);
        prismaMock.job.findMany.mockImplementation(((args: { where: { sourceId?: unknown } }) =>
            Promise.resolve(args.where.sourceId ? [{ id: "nightly", sourceId: "pg" }, { id: "hourly", sourceId: "pg" }] : [])) as never);
        mocked(prismaMock.execution.groupBy).mockResolvedValue([
            { jobId: "nightly", _max: { startedAt: at(10) } },
            { jobId: "hourly", _max: { startedAt: at(1) } },
        ]);
        prismaMock.execution.findMany.mockResolvedValue([
            { id: "run-1", jobId: "nightly", status: "Success", startedAt: at(10) },
            { id: "run-2", jobId: "hourly", status: "Failed", startedAt: at(1) },
        ] as never);
        prismaMock.healthCheckLog.findMany.mockResolvedValue([
            { adapterConfigId: "pg", status: "ONLINE", latencyMs: 9, createdAt: at(0.5) },
            { adapterConfigId: "pg", status: "DEGRADED", latencyMs: 5000, createdAt: at(0.2) },
        ] as never);

        const overview = (await getConnectionOverview(["pg"])).get("pg");

        expect(overview?.usedBy.jobs).toBe(2);
        expect(overview?.lastBackup).toEqual({ id: "run-2", at: at(1).toISOString(), status: "Failed" });
        // The failed check has no meaningful response time, the newest passed one does.
        expect(overview?.latencyMs).toBe(9);
        expect(overview?.credentialName).toBe("prod-db");
    });

    it("adds the stored size to a scanned destination only", async () => {
        prismaMock.adapterConfig.findMany.mockResolvedValue([
            { id: "s3", type: "storage", storageRole: "DESTINATION", primaryCredential: null, defaultRetentionPolicy: { name: "GFS" } },
            { id: "new", type: "storage", storageRole: "DESTINATION", primaryCredential: null, defaultRetentionPolicy: null },
        ] as never);
        vi.mocked(getStorageVolume).mockResolvedValue([
            { configId: "s3", name: "S3", adapterId: "s3-aws", size: 5000, count: 12 },
            // Never listed: the numbers are placeholders, not a measurement.
            { configId: "new", name: "New", adapterId: "dropbox", size: 0, count: 0, scanError: true, lastScanAt: null },
        ]);

        const overview = await getConnectionOverview(["s3", "new"]);

        expect(overview.get("s3")).toMatchObject({ stored: { size: 5000, count: 12 }, retentionName: "GFS" });
        expect(overview.get("new")?.stored).toBeNull();
    });

    it("gives a notification channel its newest message", async () => {
        prismaMock.adapterConfig.findMany.mockResolvedValue([
            { id: "discord", type: "notification", storageRole: "DESTINATION", primaryCredential: null, defaultRetentionPolicy: null },
        ] as never);
        prismaMock.notificationTemplateChannel.findMany.mockResolvedValue([{ configId: "discord" }] as never);
        mocked(prismaMock.notificationLog.groupBy).mockResolvedValue([{ channelId: "discord", _max: { sentAt: at(3) } }]);
        prismaMock.notificationLog.findMany.mockResolvedValue([{ channelId: "discord", status: "Success", sentAt: at(3) }] as never);

        const overview = (await getConnectionOverview(["discord"])).get("discord");

        expect(overview?.usedBy).toEqual({ jobs: 0, templates: 1 });
        expect(overview?.lastSent).toEqual({ at: at(3).toISOString(), status: "Success" });
        expect(getStorageVolume).not.toHaveBeenCalled();
    });
});
