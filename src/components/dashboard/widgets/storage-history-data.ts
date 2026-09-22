import { formatBytes } from "@/lib/utils";
import type { StorageSnapshotEntry } from "@/services/dashboard-service";

/** A measurement of a destination, placed on the chart by its time. */
export interface HistoryPoint {
    at: number;
    size: number;
    count: number;
}

/** Every measurement while the chart can still tell them apart. Above that, one point per day. */
const MAX_MEASUREMENTS = 400;
const UNITS = ["Bytes", "KB", "MB", "GB", "TB", "PB"];
const STEP_FACTORS = [1, 2, 2.5, 5, 10];
const MAX_INTERVALS = 5;

/**
 * The points of one range. Measurements run hourly, so a long range keeps the last one of each
 * day, while a short range or a young destination shows every measurement.
 *
 * @param dayKey The calendar day of a moment in the viewer's timezone.
 */
export function plotPoints(
    entries: StorageSnapshotEntry[],
    since: number,
    dayKey: (at: number) => string,
): { points: HistoryPoint[]; daily: boolean } {
    const inRange = entries
        .map((entry) => ({ at: Date.parse(entry.date), size: entry.size, count: entry.count }))
        .filter((point) => point.at >= since);
    if (inRange.length <= MAX_MEASUREMENTS) return { points: inRange, daily: false };

    // The entries arrive oldest first, so the last point written for a day is its latest measurement.
    const byDay = new Map<string, HistoryPoint>();
    for (const point of inRange) byDay.set(dayKey(point.at), point);
    return { points: Array.from(byDay.values()), daily: true };
}

/** A change in size with its sign, like "-17.16 GB" for a destination that shrank. */
export function signedBytes(bytes: number): string {
    return `${bytes < 0 ? "-" : "+"}${formatBytes(Math.abs(bytes))}`;
}

/** The first point of every day, so each date gets one label on the axis. */
export function dayTicks(points: HistoryPoint[], dayKey: (at: number) => string): number[] {
    const ticks: number[] = [];
    let previous: string | null = null;
    for (const point of points) {
        const day = dayKey(point.at);
        if (day !== previous) ticks.push(point.at);
        previous = day;
    }
    return ticks;
}

/** Round axis steps in the unit of the largest value, like 0, 5, 10, 15, 20 and 25 GB. */
export function byteTicks(max: number): { ticks: number[]; top: number; format: (bytes: number) => string } {
    if (max <= 0) return { ticks: [0], top: 1, format: () => "0" };

    // The small offset keeps an exact power of 1024 in its own unit despite floating point.
    const exponent = Math.min(UNITS.length - 1, Math.floor(Math.log(max) / Math.log(1024) + 1e-9));
    const unit = 1024 ** exponent;
    const scaled = max / unit;
    const magnitude = 10 ** Math.floor(Math.log10(scaled / MAX_INTERVALS));
    const step = STEP_FACTORS.map((factor) => factor * magnitude).find((candidate) => Math.ceil(scaled / candidate) <= MAX_INTERVALS)!;
    const ticks = Array.from({ length: Math.ceil(scaled / step) + 1 }, (_, index) => index * step * unit);

    return {
        ticks,
        top: ticks[ticks.length - 1],
        format: (bytes) => (bytes === 0 ? "0" : `${parseFloat((bytes / unit).toFixed(2))} ${UNITS[exponent]}`),
    };
}
