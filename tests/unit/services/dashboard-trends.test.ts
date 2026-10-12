import { describe, it, expect } from "vitest";
import { subDays } from "date-fns";
import { formatInTimeZone, fromZonedTime } from "date-fns-tz";
import { dailyStorageTotals, dayBuckets, successRateTrend, valueDaysAgo, type SnapshotPoint } from "@/services/dashboard/trends";
import type { ActivityDataPoint } from "@/services/dashboard-service";

const toDayKey = (date: Date) => date.toISOString().slice(0, 10);

function snapshot(adapterConfigId: string, size: number, count: number, createdAt: string) {
    return { adapterConfigId, size: BigInt(size), count, createdAt: new Date(createdAt) };
}

describe("successRateTrend", () => {
    const day = (completed: number, failed: number, partial = 0, cancelled = 0): ActivityDataPoint => ({
        date: "Sep 1", completed, failed, partial, running: 0, pending: 0, cancelled,
    });

    it("computes one rate per day and leaves days without finished runs empty", () => {
        expect(successRateTrend([day(3, 1), day(0, 0), day(2, 0)])).toEqual([75, null, 100]);
    });

    it("counts a partial run against the day like every success share, and a cancelled one not at all", () => {
        expect(successRateTrend([day(3, 0, 1), day(2, 0, 0, 5)])).toEqual([75, 100]);
    });
});

describe("dailyStorageTotals", () => {
    const days = ["2026-09-18", "2026-09-19", "2026-09-20", "2026-09-21"];

    it("sums the latest snapshot per destination and day, carrying values over days without a refresh", () => {
        const snapshots = [
            snapshot("s3", 100, 1, "2026-09-18T01:00:00Z"),
            snapshot("s3", 150, 2, "2026-09-18T20:00:00Z"),
            snapshot("local", 50, 5, "2026-09-19T03:00:00Z"),
            snapshot("s3", 200, 3, "2026-09-21T03:00:00Z"),
        ];

        const totals = dailyStorageTotals(snapshots, days, toDayKey, new Set(["s3", "local"]));

        expect(totals.size).toEqual([150, 200, 200, 250]);
        expect(totals.count).toEqual([2, 7, 7, 8]);
    });

    it("leaves out destinations that no longer exist", () => {
        const snapshots = [
            snapshot("deleted", 999, 9, "2026-09-18T01:00:00Z"),
            snapshot("s3", 100, 1, "2026-09-18T02:00:00Z"),
        ];

        expect(dailyStorageTotals(snapshots, days, toDayKey, new Set(["s3"])).size).toEqual([100, 100, 100, 100]);
    });

    it("has no value for days before the first snapshot", () => {
        const snapshots = [snapshot("s3", 100, 1, "2026-09-20T02:00:00Z")];

        expect(dailyStorageTotals(snapshots, days, toDayKey, new Set(["s3"])).size).toEqual([null, null, 100, 100]);
    });
});

describe("dayBuckets", () => {
    const timezone = "Europe/Amsterdam";
    const dayKey = (date: Date) => formatInTimeZone(date, timezone, "yyyy-MM-dd");
    const startOfDay = (day: string) => fromZonedTime(`${day}T00:00:00`, timezone).getTime();

    it("ends each span where the day after its key starts, in the scheduler timezone", () => {
        const buckets = dayBuckets(["2026-10-24", "2026-10-25", "2026-10-26"], Date.parse("2026-10-23T12:00:00Z"), startOfDay);

        expect(buckets.map(([from, to]) => [new Date(from).toISOString(), new Date(to).toISOString()])).toEqual([
            ["2026-10-23T12:00:00.000Z", "2026-10-24T22:00:00.000Z"],
            // The night the clocks go back has 25 hours.
            ["2026-10-24T22:00:00.000Z", "2026-10-25T23:00:00.000Z"],
            ["2026-10-25T23:00:00.000Z", "2026-10-26T23:00:00.000Z"],
        ]);
    });

    it("gives the same totals from the newest snapshot of each span as from every snapshot", () => {
        // 30 days around the change to winter time, a snapshot of three destinations every 37 minutes.
        const now = new Date("2026-11-10T00:20:00Z");
        const windowStart = subDays(now, 30).getTime();
        const snapshots: SnapshotPoint[] = [];
        for (let at = windowStart; at <= now.getTime(); at += 37 * 60_000) {
            for (const id of ["s3", "nas", "ftp"]) {
                snapshots.push({ adapterConfigId: id, size: BigInt(at % 9973), count: at % 31, createdAt: new Date(at) });
            }
        }
        const dayKeys = Array.from({ length: 30 }, (_, i) => dayKey(subDays(now, 29 - i)));
        const ids = new Set(["s3", "nas"]);

        // What the query keeps: the newest snapshot of each destination in each span.
        const newest = new Map<string, SnapshotPoint>();
        dayBuckets(dayKeys, windowStart, startOfDay).forEach(([from, to], index) => {
            for (const entry of snapshots) {
                const at = entry.createdAt.getTime();
                if (at >= from && at < to) newest.set(`${index}:${entry.adapterConfigId}`, entry);
            }
        });
        const kept = [...newest.values()].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());

        expect(kept.length).toBeLessThan(snapshots.length / 10);
        expect(dailyStorageTotals(kept, dayKeys, dayKey, ids)).toEqual(dailyStorageTotals(snapshots, dayKeys, dayKey, ids));
    });
});

describe("valueDaysAgo", () => {
    it("reads back from the end of the series", () => {
        expect(valueDaysAgo([1, 2, 3, 4, 5, 6, 7, 8], 7)).toBe(1);
        expect(valueDaysAgo([1, 2, 3], 7)).toBeNull();
    });
});
