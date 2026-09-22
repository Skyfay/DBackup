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
    it("keeps every measurement of a short range and drops the ones before it", () => {
        const { points, daily } = plotPoints(hourly(72), START + 48 * HOUR, utcDay);

        expect(daily).toBe(false);
        expect(points).toHaveLength(24);
        expect(points[0].at).toBe(START + 48 * HOUR);
    });

    it("reduces a long range to the last measurement of each day", () => {
        const { points, daily } = plotPoints(hourly(24 * 20), START, utcDay);

        expect(daily).toBe(true);
        expect(points).toHaveLength(20);
        expect(points[0]).toEqual({ at: START + 23 * HOUR, size: 0, count: 23 });
    });
});

describe("dayTicks", () => {
    it("labels each date once when a day holds many measurements", () => {
        const { points } = plotPoints(hourly(48), START, utcDay);

        expect(dayTicks(points, utcDay)).toEqual([START, START + 24 * HOUR]);
    });
});
