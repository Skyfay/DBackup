import { beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import { prismaMock } from "@/lib/testing/prisma-mock";
import { invalidateDashboardCache } from "@/services/dashboard/cache";
import { getJobOverviews, liveProgress, nextRunOf } from "@/services/jobs/job-overview";

const NOW = new Date("2026-09-23T12:00:01.000Z");
const at = (iso: string) => new Date(iso);
const run = (id: string, status: string, startedAt: string, endedAt: string | null = null) => ({ id, status, startedAt: at(startedAt), endedAt: endedAt ? at(endedAt) : null });

const history: Record<string, ReturnType<typeof run>[]> = {
    shop: [run("shop-2", "Success", "2026-09-23T03:00:00Z", "2026-09-23T03:04:12Z"), run("shop-1", "Failed", "2026-09-22T03:00:00Z", "2026-09-22T03:00:03Z")],
    cache: [run("cache-2", "Failed", "2026-09-23T06:00:00Z", "2026-09-23T06:00:03Z"), run("cache-1", "Success", "2026-09-23T00:00:00Z", "2026-09-23T00:00:03Z")],
};

describe("job overview", () => {
    beforeEach(() => {
        vi.useFakeTimers({ now: NOW, toFake: ["Date"] });
        invalidateDashboardCache();
        prismaMock.job.findMany.mockResolvedValue([{ id: "shop" }, { id: "cache" }] as never);
        prismaMock.systemSetting.findUnique.mockResolvedValue({ key: "system.timezone", value: "Europe/Zurich" } as never);
        (prismaMock.execution.findMany as Mock).mockImplementation((args: { where: { status?: unknown; jobId?: unknown } }) => {
            if (args.where.status) {
                return Promise.resolve([
                    { ...run("shop-3", "Running", "2026-09-23T11:59:00Z"), jobId: "shop", metadata: JSON.stringify({ stage: "Uploading", progress: 61.6 }) },
                ]);
            }
            return Promise.resolve(history[args.where.jobId as string] ?? []);
        });
        prismaMock.execution.findUnique.mockResolvedValue({
            logs: JSON.stringify([{ level: "info", message: "Dumping" }, { level: "error", message: "Connection refused by cache01:6379" }]),
        } as never);
    });

    it("puts a live run ahead of the finished ones, with its stage and how far it got", async () => {
        const overview = (await getJobOverviews([{ id: "shop", enabled: true, schedule: "0 3 * * *" }])).get("shop");

        expect(overview?.status).toBe("Running");
        expect(overview?.live).toMatchObject({ executionId: "shop-3", stage: "Uploading", progress: 62 });
        expect(overview?.runs.map((entry) => entry.id)).toEqual(["shop-1", "shop-2", "shop-3"]);
        // The last finished run went well, so there is nothing to report.
        expect(overview?.error).toBeNull();
    });

    it("names what went wrong in a failed last run, read from its log", async () => {
        const overview = (await getJobOverviews([{ id: "cache", enabled: true, schedule: "0 */6 * * *" }])).get("cache");

        expect(overview?.status).toBe("Failed");
        expect(overview?.error).toBe("Connection refused by cache01:6379");
        expect(overview?.live).toBeNull();
        expect(overview?.nextRunAt).toBe("2026-09-23T16:00:00.000Z");
    });

    it("reads a schedule in the scheduler's time zone, prefers a preset and has no next run while paused", () => {
        expect(nextRunOf({ id: "a", enabled: true, schedule: "0 3 * * *" }, "Europe/Zurich", NOW)).toBe("2026-09-24T01:00:00.000Z");
        expect(nextRunOf({ id: "a", enabled: true, schedule: "0 3 * * *", schedulePreset: { schedule: "0 5 * * *" } }, "UTC", NOW)).toBe("2026-09-24T05:00:00.000Z");
        expect(nextRunOf({ id: "a", enabled: false, schedule: "0 3 * * *" }, "UTC", NOW)).toBeNull();
        expect(nextRunOf({ id: "a", enabled: true, schedule: "every night" }, "UTC", NOW)).toBeNull();
    });

    it("leaves out stage and progress a run has not reported", () => {
        expect(liveProgress(null)).toEqual({ stage: null, progress: null });
        expect(liveProgress("not json")).toEqual({ stage: null, progress: null });
        expect(liveProgress(JSON.stringify({ stage: "Queued", progress: 140 }))).toEqual({ stage: "Queued", progress: 100 });
    });
});
