import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { prismaMock } from "@/lib/testing/prisma-mock";

vi.mock("@/services/dashboard/aggregates", async () => {
    const actual = await vi.importActual<typeof import("@/services/dashboard/aggregates")>("@/services/dashboard/aggregates");
    return { ...actual, getAggregates: vi.fn() };
});

vi.mock("@/services/dashboard-service", () => ({
    getLatestJobs: vi.fn().mockResolvedValue([]),
}));

import { getAggregates, type Aggregates } from "@/services/dashboard/aggregates";
import { invalidateDashboardCache } from "@/services/dashboard/cache";
import { getDashboardOverview } from "@/services/dashboard/overview-service";

const NOW = new Date("2026-09-21T10:00:00.000Z");

function aggregates(overrides: Partial<Aggregates> = {}): Aggregates {
    return {
        timezone: "UTC",
        maxConcurrentJobs: 1,
        activity: [
            { date: "Sep 20", completed: 4, failed: 0, partial: 0, running: 0, pending: 0, cancelled: 0 },
            // Five runs were live when the cache was filled. They have finished since.
            { date: "Sep 21", completed: 2, failed: 1, partial: 0, running: 5, pending: 0, cancelled: 0 },
        ],
        calendar: { days: [], today: "2026-09-21" },
        successRate: { value: 97.5, previous: 96 },
        succeeded24h: 6,
        failed24h: 1,
        total24h: 8,
        backedUp24h: 5_000_000,
        lastFailureAt: "2026-09-21T01:00:00.000Z",
        avgDurationMs: 192_000,
        storage: {
            entries: [{ configId: "s3", name: "S3 Archive", adapterId: "s3", size: 5000, count: 12 }],
            updatedAt: "2026-09-21T09:00:00.000Z",
            size: [4000, 4100, 4200, 4300, 4400, 4500, 4600, 4700, 5000],
            count: [8, 8, 9, 9, 10, 10, 11, 11, 12],
        },
        runsByJob: {
            nightly: [{ id: "n1", status: "Success", startedAt: "2026-09-21T02:00:00.000Z", endedAt: "2026-09-21T02:04:00.000Z" }],
            files: [
                { id: "f2", status: "Failed", startedAt: "2026-09-21T01:00:00.000Z", endedAt: "2026-09-21T01:00:12.000Z" },
                { id: "f1", status: "Success", startedAt: "2026-09-20T01:00:00.000Z", endedAt: "2026-09-20T01:09:00.000Z" },
            ],
            manual: [],
        },
        ...overrides,
    };
}

const jobs = [
    {
        id: "nightly",
        name: "postgres-nightly",
        enabled: true,
        schedule: "0 2 * * *",
        encryptionProfileId: "enc-1",
        schedulePreset: null,
        source: { adapterId: "postgres" },
        sources: [],
        destinations: [{ config: { name: "S3 Archive" } }],
    },
    {
        id: "files",
        name: "files-uploads",
        enabled: true,
        schedule: "",
        encryptionProfileId: null,
        schedulePreset: { schedule: "0 1 * * *" },
        source: null,
        sources: [{ id: "src-1" }],
        destinations: [{ config: { name: "Local disk" } }, { config: { name: "S3 Archive" } }],
    },
    {
        id: "manual",
        name: "adhoc-export",
        enabled: false,
        schedule: "",
        encryptionProfileId: null,
        schedulePreset: null,
        source: { adapterId: "mysql" },
        sources: [],
        destinations: [],
    },
];

describe("getDashboardOverview", () => {
    beforeEach(() => {
        vi.useFakeTimers();
        vi.setSystemTime(NOW);
        invalidateDashboardCache();
        vi.mocked(getAggregates).mockResolvedValue(aggregates());
        prismaMock.job.findMany.mockResolvedValue(jobs as never);
        prismaMock.execution.findMany.mockResolvedValue([
            { id: "live-1", jobId: "manual", status: "Running", startedAt: new Date("2026-09-21T09:58:00.000Z"), endedAt: null },
        ] as never);
        // 13 watched connections, 2 of them offline.
        prismaMock.adapterConfig.count.mockImplementation(((args: { where?: { lastStatus?: string } }) =>
            Promise.resolve(args?.where?.lastStatus === "OFFLINE" ? 2 : 13)) as never);
        prismaMock.execution.findUnique.mockResolvedValue({
            logs: JSON.stringify([{ level: "error", message: "connect ECONNREFUSED 10.0.4.41:5432" }]),
        } as never);
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it("lists live jobs first, then by next scheduled run, with readable source and destination labels", async () => {
        const { jobs: { rows, total } } = await getDashboardOverview();

        expect(total).toBe(3);
        expect(rows.map((row) => row.id)).toEqual(["manual", "files", "nightly"]);
        expect(rows[0]).toMatchObject({ status: "Running", sourceLabel: "MySQL", destinationLabel: "No destination", nextRunAt: null });
        expect(rows[0].runs.map((run) => run.id)).toEqual(["live-1"]);
        expect(rows[1]).toMatchObject({
            status: "Failed",
            sourceLabel: "Directory",
            destinationLabel: "Local disk +1",
            nextRunAt: "2026-09-22T01:00:00.000Z",
        });
        expect(rows[2]).toMatchObject({ status: "Success", sourceLabel: "PostgreSQL", nextRunAt: "2026-09-22T02:00:00.000Z" });
    });

    it("features the failing job in the banner with the error from its log", async () => {
        const { health } = await getDashboardOverview();

        expect(health.state).toBe("failing");
        if (health.state !== "failing") return;
        expect(health.jobs[0]).toMatchObject({
            jobId: "files",
            executionId: "f2",
            error: "connect ECONNREFUSED 10.0.4.41:5432",
            lastSuccessAt: "2026-09-20T01:00:00.000Z",
        });
    });

    it("counts live runs from the database instead of the cached activity", async () => {
        const overview = await getDashboardOverview();

        expect(overview.activity[1]).toMatchObject({ date: "Sep 21", running: 1, failed: 1 });
        expect(overview.strip).toEqual({
            totalJobs: 3,
            activeSchedules: 2,
            encryptedJobs: 1,
            connections: 13,
            offlineConnections: 2,
            runningNow: 1,
            queuedNow: 0,
            succeeded24h: 6,
            backedUp24h: 5_000_000,
            avgDurationMs: 192_000,
        });
    });

    it("only counts database and storage connections, the ones the health check watches", async () => {
        await getDashboardOverview();

        expect(prismaMock.adapterConfig.count).toHaveBeenCalledWith({
            where: { type: { in: ["database", "storage"] }, lastStatus: "OFFLINE" },
        });
    });

    it("builds the upcoming runs from the enabled schedules only", async () => {
        const { upcoming } = await getDashboardOverview();

        expect(upcoming.windowStart).toBe(NOW.toISOString());
        expect(upcoming.slots).toBe(1);
        // The paused job is left out. The other two run at 01:00 and 02:00, twice within 48 hours.
        expect(upcoming.jobs.map((job) => job.id).sort()).toEqual(["files", "nightly"]);
        expect(upcoming.runs.map((run) => run.at)).toEqual([
            "2026-09-22T01:00:00.000Z",
            "2026-09-22T02:00:00.000Z",
            "2026-09-23T01:00:00.000Z",
            "2026-09-23T02:00:00.000Z",
        ]);
        // files failed its last run.
        expect(upcoming.jobs.find((job) => job.id === "files")?.likelyToFail).toBe(true);
    });

    it("compares stored backups and storage with the same day a week earlier", async () => {
        const { kpis } = await getDashboardOverview();

        expect(kpis.storageUsed).toMatchObject({ value: 5000, weekAgo: 4100 });
        expect(kpis.backupsStored).toMatchObject({ value: 12, weekAgo: 8, destinations: 1 });
        expect(kpis.failedRuns24h).toMatchObject({ value: 1, total: 8, trend: [0, 1] });
        expect(kpis.successRate.trend).toEqual([100, 66.7]);
    });
});
