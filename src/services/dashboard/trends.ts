import { successShare } from "@/lib/core/success-share";
import type { ActivityDataPoint } from "@/services/dashboard-service";

/** Daily success rate over the activity window, null for days without finished runs. */
export function successRateTrend(activity: ActivityDataPoint[]): (number | null)[] {
    return activity.map((day) => successShare({ succeeded: day.completed, partial: day.partial, failed: day.failed }));
}

export function failedTrend(activity: ActivityDataPoint[]): number[] {
    return activity.map((day) => day.failed);
}

export interface SnapshotPoint {
    adapterConfigId: string;
    size: bigint | number;
    count: number;
    createdAt: Date;
}

/**
 * Totals across destinations for each day, from the hourly storage snapshots.
 *
 * A destination contributes its latest snapshot up to the end of each day, carried forward over
 * days without a new one, so a skipped refresh does not look like a drop. Days before the first
 * snapshot of any destination are null.
 *
 * @param snapshots Oldest first.
 * @param dayKeys Ascending yyyy-MM-dd keys, one per point of the result.
 * @param toDayKey Maps a snapshot time to its day key in the scheduler timezone.
 * @param destinationIds Only these destinations are summed. Deleted ones would inflate the totals.
 */
export function dailyStorageTotals(
    snapshots: SnapshotPoint[],
    dayKeys: string[],
    toDayKey: (date: Date) => string,
    destinationIds: Set<string>,
): { size: (number | null)[]; count: (number | null)[] } {
    const latest = new Map<string, { size: number; count: number }>();
    const size: (number | null)[] = [];
    const count: (number | null)[] = [];
    let cursor = 0;

    for (const day of dayKeys) {
        while (cursor < snapshots.length && toDayKey(snapshots[cursor].createdAt) <= day) {
            const snapshot = snapshots[cursor];
            if (destinationIds.has(snapshot.adapterConfigId)) {
                latest.set(snapshot.adapterConfigId, { size: Number(snapshot.size), count: snapshot.count });
            }
            cursor++;
        }

        if (latest.size === 0) {
            size.push(null);
            count.push(null);
            continue;
        }

        let daySize = 0;
        let dayCount = 0;
        for (const value of latest.values()) {
            daySize += value.size;
            dayCount += value.count;
        }
        size.push(daySize);
        count.push(dayCount);
    }

    return { size, count };
}

/** The key of the day after `day`, both yyyy-MM-dd. */
function nextDayKey(day: string): string {
    const [year, month, date] = day.split("-").map(Number);
    return new Date(Date.UTC(year, month - 1, date + 1)).toISOString().slice(0, 10);
}

/**
 * The span of time whose snapshots `dailyStorageTotals` takes up at each day key, as `[from, to)`
 * in epoch milliseconds. The first starts at `windowStart`, every other one where the one before
 * ends, and each ends where the day after its key starts. Only the newest snapshot of a destination
 * in a span counts, an earlier one of the same span is replaced before the day is summed.
 *
 * @param startOfDay When a yyyy-MM-dd day starts in the scheduler timezone, in epoch milliseconds.
 */
export function dayBuckets(dayKeys: string[], windowStart: number, startOfDay: (day: string) => number): [number, number][] {
    let from = windowStart;
    return dayKeys.map((day) => {
        const to = Math.max(from, startOfDay(nextDayKey(day)));
        const bucket: [number, number] = [from, to];
        from = to;
        return bucket;
    });
}

/** The value `days` points before the end of a daily series, or null when the series is shorter. */
export function valueDaysAgo(series: (number | null)[], days: number): number | null {
    const index = series.length - 1 - days;
    return index >= 0 ? series[index] : null;
}
