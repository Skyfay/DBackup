import { formatBytes } from "@/lib/utils";
import type { StorageSnapshotEntry } from "@/services/dashboard-service";

/** A measurement of a destination, placed on the chart by its time. A day without one has no size. */
export interface HistoryPoint {
    at: number;
    size: number | null;
    count: number;
}

const DAY_MS = 24 * 60 * 60 * 1000;
/** A gap longer than this is left as it is, rather than filling a year with empty days. */
const MAX_FILLED_DAYS = 400;

const UNITS = ["Bytes", "KB", "MB", "GB", "TB", "PB"];
const STEP_FACTORS = [1, 2, 2.5, 5, 10];
const MAX_INTERVALS = 5;

/**
 * The points of one range. The chart draws a bar a day, so the last measurement of a day stands
 * for it, and a day without one keeps its place without a bar. A destination measured on fewer
 * than two days keeps its raw measurements, which would otherwise collapse into a single bar.
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

    // The entries arrive oldest first, so the last point written for a day is its latest measurement.
    const byDay = new Map<string, HistoryPoint>();
    for (const point of inRange) byDay.set(dayKey(point.at), point);
    if (byDay.size < 2) return { points: inRange, daily: false };

    // Days nobody measured stay in the row, so a pause in the history reads as a pause.
    const measured = Array.from(byDay.values());
    const points: HistoryPoint[] = [];
    let filled = 0;
    for (const [index, point] of measured.entries()) {
        points.push(point);
        const next = measured[index + 1];
        if (!next) break;
        const gap = Math.max(0, Math.round((next.at - point.at) / DAY_MS) - 1);
        for (let day = 1; day <= gap && filled < MAX_FILLED_DAYS; day++, filled++) {
            points.push({ at: point.at + day * DAY_MS, size: null, count: 0 });
        }
    }

    return { points, daily: true };
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
