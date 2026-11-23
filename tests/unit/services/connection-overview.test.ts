import { describe, it, expect, vi, beforeEach, type Mock } from "vitest";
import { prismaMock } from "@/lib/testing/prisma-mock";

vi.mock("@/services/dashboard-service", () => ({
    getStorageVolume: vi.fn(),
}));
// The destinations and channels other tenants share with a tenant, which the sharing module reads across tenants.
vi.mock("@/services/sharing/provided", () => ({
    providedTo: vi.fn(),
}));

import { getStorageVolume } from "@/services/dashboard-service";
import { invalidateDashboardCache } from "@/services/dashboard/cache";
import { getConnectionOverview, healthBuckets } from "@/services/adapters/connection-overview";
import { providedTo, type ProvidedConnection } from "@/services/sharing/provided";
import { runAsTenant } from "@/lib/tenant/context";

const NOW = new Date("2026-09-22T12:00:00.000Z");
const HOUR = 60 * 60 * 1000;
const at = (hoursAgo: number) => new Date(NOW.getTime() - hoursAgo * HOUR);
// Prisma's groupBy overloads are too deep for the mock types, so these two are driven as plain mocks.
const mocked = (fn: unknown) => fn as Mock;

/** What the raw queries answer: the counts of the health checks per hour, the newest passed check, and the newest backup of each job. */
interface RawAnswers {
    hours?: { id: string; hour: number; total: number; passed: number; offline: number }[];
    latency?: { id: string; latencyMs: number | null }[];
    newest?: { id: string }[];
}
function raw(answers: RawAnswers) {
    prismaMock.$queryRaw.mockImplementation(((strings: TemplateStringsArray) => {
        const sql = strings.join("?");
        if (sql.includes("GROUP BY h.adapterConfigId")) return Promise.resolve(answers.hours ?? []);
        if (sql.includes("h.latencyMs")) return Promise.resolve(answers.latency ?? []);
        return Promise.resolve(answers.newest ?? []);
    }) as never);
}

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
        raw({});
        prismaMock.execution.findMany.mockResolvedValue([]);
        mocked(prismaMock.notificationLog.groupBy).mockResolvedValue([]);
        prismaMock.notificationLog.findMany.mockResolvedValue([]);
        vi.mocked(providedTo).mockReset().mockResolvedValue([]);
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
        // A passed and a degraded check in the newest hour, counted by SQLite.
        raw({
            newest: [{ id: "run-1" }, { id: "run-2" }],
            hours: [{ id: "pg", hour: 23, total: 2, passed: 1, offline: 0 }],
            latency: [{ id: "pg", latencyMs: 9 }],
        });
        prismaMock.execution.findMany.mockResolvedValue([
            { id: "run-1", jobId: "nightly", status: "Success", startedAt: at(10) },
            { id: "run-2", jobId: "hourly", status: "Failed", startedAt: at(1) },
        ] as never);

        const overview = (await getConnectionOverview(["pg"])).get("pg");

        expect(overview?.usedBy.jobs).toBe(2);
        expect(overview?.lastBackup).toEqual({ id: "run-2", at: at(1).toISOString(), status: "Failed" });
        // The failed check has no meaningful response time, the newest passed one does.
        expect(overview?.latencyMs).toBe(9);
        expect(overview?.health[23]).toBe("failed");
        expect(overview?.checksPassed).toBe(50);
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

    describe("of a connection another tenant shares with this one", () => {
        const provided = (id: string, type: string): ProvidedConnection => ({
            id, name: id, type, adapterId: type === "storage" ? "s3" : "email", storageRole: "DESTINATION", metadata: null,
            lastStatus: "ONLINE", lastHealthCheck: at(0.1), createdAt: at(100), updatedAt: at(100),
            providerId: "msp", providerName: "MSP", allTenants: true, encryptedOnly: false, ownRecipients: true,
        });

        it("shows a provided destination with what this tenant does with it and nothing of its health", async () => {
            // The tenant filter keeps the destination of the MSP out of the tenant's own read.
            prismaMock.adapterConfig.findMany.mockResolvedValue([]);
            vi.mocked(providedTo).mockResolvedValue([provided("msp-s3", "storage")]);
            prismaMock.jobDestination.findMany.mockResolvedValue([{ configId: "msp-s3", jobId: "acme-nightly" }] as never);
            // A check of the destination is the MSP's, even should one reach the read.
            raw({
                newest: [{ id: "run-acme" }],
                hours: [{ id: "msp-s3", hour: 23, total: 1, passed: 0, offline: 0 }],
                latency: [{ id: "msp-s3", latencyMs: 4000 }],
            });
            prismaMock.execution.findMany.mockResolvedValue([{ id: "run-acme", jobId: "acme-nightly", status: "Success", startedAt: at(5) }] as never);
            // The storage numbers of the tenant are its own backups on the destination.
            vi.mocked(getStorageVolume).mockResolvedValue([{ configId: "msp-s3", tenantId: "acme", name: "msp-s3", adapterId: "s3", size: 220, count: 2 }]);

            const overview = await runAsTenant("acme", () => getConnectionOverview(["msp-s3"]));

            expect(providedTo).toHaveBeenCalledWith("acme", { ids: ["msp-s3"] });
            // The raw count of the checks reads only connections the client found in the tenant.
            const healthReads = prismaMock.$queryRaw.mock.calls.filter(([strings]) => (strings as unknown as string[]).join("?").includes("HealthCheckLog"));
            expect(healthReads).toHaveLength(0);
            expect(overview.get("msp-s3")).toEqual({
                usedBy: { jobs: 1, templates: 0 },
                lastBackup: { id: "run-acme", at: at(5).toISOString(), status: "Success" },
                health: Array.from({ length: 24 }, () => "none"),
                checksPassed: null,
                latencyMs: null,
                credentialName: null,
                retentionName: null,
                stored: { size: 220, count: 2 },
                lastSent: null,
            });
        });

        it("gives a provided channel its own templates and messages", async () => {
            vi.mocked(providedTo).mockResolvedValue([provided("msp-mail", "notification")]);
            prismaMock.notificationTemplateChannel.findMany.mockResolvedValue([{ configId: "msp-mail" }] as never);
            mocked(prismaMock.notificationLog.groupBy).mockResolvedValue([{ channelId: "msp-mail", _max: { sentAt: at(2) } }]);
            prismaMock.notificationLog.findMany.mockResolvedValue([{ channelId: "msp-mail", status: "Success", sentAt: at(2) }] as never);

            const overview = (await runAsTenant("acme", () => getConnectionOverview(["msp-mail"]))).get("msp-mail");

            expect(overview).toMatchObject({ usedBy: { jobs: 0, templates: 1 }, lastSent: { at: at(2).toISOString(), status: "Success" } });
            expect(getStorageVolume).not.toHaveBeenCalled();
        });

        it("asks for provided connections only for the ids the tenant does not own", async () => {
            prismaMock.adapterConfig.findMany.mockResolvedValue([
                { id: "own-nas", type: "storage", storageRole: "DESTINATION", primaryCredential: null, defaultRetentionPolicy: null },
            ] as never);

            const overview = await runAsTenant("acme", () => getConnectionOverview(["own-nas", "gone"]));

            expect(providedTo).toHaveBeenCalledWith("acme", { ids: ["gone"] });
            expect([...overview.keys()]).toEqual(["own-nas"]);
        });

        it("finds none outside a tenant", async () => {
            const overview = await getConnectionOverview(["msp-s3"]);

            expect(providedTo).not.toHaveBeenCalled();
            expect(overview.size).toBe(0);
        });
    });
});
