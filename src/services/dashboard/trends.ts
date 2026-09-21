import type { ActivityDataPoint } from "@/services/dashboard-service";

/** Share of successful runs among successful and failed ones, rounded to one decimal. */
export function successPercentage(succeeded: number, failed: number): number | null {
    const total = succeeded + failed;
    if (total === 0) return null;
    return Math.round((succeeded / total) * 1000) / 10;
}

/** Daily success rate over the activity window, null for days without finished runs. */
export function successRateTrend(activity: ActivityDataPoint[]): (number | null)[] {
    return activity.map((day) => successPercentage(day.completed, day.failed));
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

/** The value `days` points before the end of a daily series, or null when the series is shorter. */
export function valueDaysAgo(series: (number | null)[], days: number): number | null {
    const index = series.length - 1 - days;
    return index >= 0 ? series[index] : null;
}
