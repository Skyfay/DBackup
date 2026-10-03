"use client";

import { useCallback, useMemo, useState } from "react";
import { StorageHistoryChart } from "@/components/dashboard/widgets/storage-history-chart";
import { plotPoints, signedBytes } from "@/components/dashboard/widgets/storage-history-data";
import { useStorageHistory } from "@/components/dashboard/widgets/use-storage-history";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useDateFormatter } from "@/hooks/use-date-formatter";
import { formatBytes } from "@/lib/utils";
import type { ExplorerDestination } from "@/services/storage/explorer-types";

const DAY_MS = 24 * 60 * 60 * 1000;
const RANGES = [
    { days: 30, label: "30d" },
    { days: 90, label: "90d" },
    { days: 365, label: "1y" },
] as const;
type RangeDays = (typeof RANGES)[number]["days"];

/** What a destination stored over time, one bar per measured day, beside its alerts in its details. */
export function DestinationHistory({ destination }: { destination: ExplorerDestination }) {
    const [range, setRange] = useState<RangeDays>(30);
    const current = useStorageHistory(destination.id);
    const { formatDate } = useDateFormatter();
    const dayKey = useCallback((at: number) => formatDate(new Date(at), "yyyy-MM-dd"), [formatDate]);
    const history = current && "entries" in current ? current : null;
    const since = history ? history.loadedAt - range * DAY_MS : 0;
    const { points, daily } = useMemo(
        () => (history ? plotPoints(history.entries, since, dayKey) : { points: [], daily: false }),
        [history, since, dayKey]
    );
    const limit = destination.alerts.storageLimit.enabled ? destination.alerts.storageLimit.bytes : null;
    const sub = [
        limit ? `${formatBytes(destination.size)} of ${formatBytes(limit)}` : formatBytes(destination.size),
        destination.growth !== null ? `${signedBytes(destination.growth)} in 7 days` : null,
    ].filter(Boolean).join(" · ");

    return (
        <section className="min-w-0 rounded-xl border bg-card p-4 text-card-foreground shadow-sm md:p-5">
            <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                    <h3 className="font-semibold">Storage history</h3>
                    <p className="truncate text-sm text-muted-foreground">{sub}</p>
                </div>
                <Tabs value={String(range)} onValueChange={(next) => setRange(Number(next) as RangeDays)}>
                    <TabsList className="h-8" aria-label="Range">
                        {RANGES.map((option) => (
                            <TabsTrigger key={option.days} value={String(option.days)} className="px-2.5 text-xs">{option.label}</TabsTrigger>
                        ))}
                    </TabsList>
                </Tabs>
            </div>
            <div className="mt-4 h-44">
                {!current ? (
                    <Skeleton className="size-full" />
                ) : !history ? (
                    <p className="flex size-full items-center justify-center text-sm text-destructive">{"error" in current ? current.error : null}</p>
                ) : points.length < 2 ? (
                    <p className="flex size-full items-center justify-center px-6 text-center text-sm text-muted-foreground">
                        Not enough measurements yet. The size is measured with every storage refresh, hourly by default.
                    </p>
                ) : (
                    <StorageHistoryChart points={points} daily={daily} dayKey={dayKey} />
                )}
            </div>
        </section>
    );
}
