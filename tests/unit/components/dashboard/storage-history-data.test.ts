import { describe, it, expect } from "vitest";
import { byteTicks, dayTicks, plotPoints, signedBytes } from "@/components/dashboard/widgets/storage-history-data";
import type { StorageSnapshotEntry } from "@/services/dashboard-service";

const GB = 1024 ** 3;
const HOUR = 60 * 60 * 1000;
const START = Date.parse("2026-09-01T00:30:00.000Z");
const utcDay = (at: number) => new Date(at).toISOString().slice(0, 10);

/** One measurement per hour, growing by a gigabyte each day. */
function hourly(hours: number): StorageSnapshotEntry[] {
    return Array.from({ length: hours }, (_, hour) => ({
        date: new Date(START + hour * HOUR).toISOString(),
        size: Math.floor(hour / 24) * GB,
        count: hour,
    }));
}

describe("byteTicks", () => {
    it("steps a 24 GB destination in round 5 GB steps", () => {
        const y = byteTicks(24.21 * GB);

        expect(y.ticks.map(y.format)).toEqual(["0", "5 GB", "10 GB", "15 GB", "20 GB", "25 GB"]);
        expect(y.top).toBe(25 * GB);
    });

    it("uses half gigabytes for a destination under 2 GB", () => {
        const y = byteTicks(1.8 * GB);

        expect(y.ticks.map(y.format)).toEqual(["0", "0.5 GB", "1 GB", "1.5 GB", "2 GB"]);
    });

    it("keeps an empty destination on a zero line", () => {
        expect(byteTicks(0)).toMatchObject({ ticks: [0], top: 1 });
    });
});

describe("signedBytes", () => {
    it("shows a shrinking destination with a minus sign", () => {
        expect(signedBytes(-17.16 * GB)).toBe("-17.16 GB");
        expect(signedBytes(512 * 1024 ** 2)).toBe("+512 MB");
    });
});

describe("plotPoints", () => {
    it("draws one point a day from the last measurement of that day, and drops what is before the range", () => {
        const { points, daily } = plotPoints(hourly(24 * 20), START + 24 * 10 * HOUR, utcDay);

        expect(daily).toBe(true);
        expect(points).toHaveLength(10);
        expect(points[0]).toEqual({ at: START + (24 * 10 + 23) * HOUR, size: 10 * GB, count: 24 * 10 + 23 });
    });

    it("keeps a day without a measurement in the row, so a pause stays a pause", () => {
        const entries = [
            { date: new Date(START).toISOString(), size: GB, count: 1 },
            { date: new Date(START + 3 * 24 * HOUR).toISOString(), size: 2 * GB, count: 2 },
        ];

        const { points } = plotPoints(entries, START, utcDay);

        expect(points.map((point) => point.size)).toEqual([GB, null, null, 2 * GB]);
    });

    // A day is a single bar, which would say nothing about a destination added this morning.
    it("keeps every measurement of a destination that was measured on one day only", () => {
        const { points, daily } = plotPoints(hourly(6), START, utcDay);

        expect(daily).toBe(false);
        expect(points).toHaveLength(6);
        expect(points[0].at).toBe(START);
    });
});

describe("dayTicks", () => {
    it("labels each date once when a day holds many measurements", () => {
        // Raw measurements, as a destination that was only measured today gets them.
        const points = hourly(48).map((entry) => ({ at: Date.parse(entry.date), size: entry.size, count: entry.count }));

        expect(dayTicks(points, utcDay)).toEqual([START, START + 24 * HOUR]);
    });
});
