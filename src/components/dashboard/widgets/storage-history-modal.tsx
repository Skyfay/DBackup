"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { DateDisplay } from "@/components/utils/date-display";
import { useDateFormatter } from "@/hooks/use-date-formatter";
import { logger } from "@/lib/logging/logger";
import { cn, formatBytes } from "@/lib/utils";
import type { StorageSnapshotEntry } from "@/services/dashboard-service";
import { RelativeTime } from "./relative-time";
import { StorageHistoryChart } from "./storage-history-chart";
import { plotPoints, signedBytes } from "./storage-history-data";

const log = logger.child({ component: "storage-history-modal" });

const RANGES = [
    { days: 7, label: "7d", name: "7 days" },
    { days: 30, label: "30d", name: "30 days" },
    { days: 90, label: "90d", name: "90 days" },
    { days: 365, label: "1y", name: "year" },
] as const;
type RangeDays = (typeof RANGES)[number]["days"];

const DAY_MS = 24 * 60 * 60 * 1000;
/** The longest range and the most the API hands out. It loads once, the ranges are cut from it here. */
const LOADED_DAYS = 365;

type HistoryResult =
    | { configId: string; loadedAt: number; entries: StorageSnapshotEntry[] }
    | { configId: string; error: string };

interface StorageHistoryModalProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    configId: string;
    adapterName: string;
}

function Message({ children, className }: { children: React.ReactNode; className?: string }) {
    return (
        <div className={cn("flex size-full items-center justify-center px-6 text-center text-sm text-muted-foreground", className)}>
            {children}
        </div>
    );
}

/** Size and backup count of one destination over time, opened from the dashboard and the destinations page. */
export function StorageHistoryModal({ open, onOpenChange, configId, adapterName }: StorageHistoryModalProps) {
    const [range, setRange] = useState<RangeDays>(30);
    const [result, setResult] = useState<HistoryResult | null>(null);
    const { formatDate } = useDateFormatter();

    useEffect(() => {
        if (!open) return;
        let ignore = false;
        fetch(`/api/storage/${configId}/history?days=${LOADED_DAYS}`)
            .then((res) => res.json())
            .then((json) => {
                if (ignore) return;
                setResult(
                    json.success
                        ? { configId, loadedAt: Date.now(), entries: json.data }
                        : { configId, error: json.error || "Failed to load history" }
                );
            })
            .catch((error: unknown) => {
                if (ignore) return;
                log.error("Loading the storage history failed", { configId }, error instanceof Error ? error : undefined);
                setResult({ configId, error: "Failed to load history" });
            });
        return () => {
            ignore = true;
        };
    }, [configId, open]);

    const dayKey = useCallback((at: number) => formatDate(new Date(at), "yyyy-MM-dd"), [formatDate]);
    // A result for another destination counts as loading, so a new destination needs no reset.
    const current = result?.configId === configId ? result : null;
    const history = current && "entries" in current ? current : null;
    const since = history ? history.loadedAt - range * DAY_MS : 0;
    const { points, daily } = useMemo(
        () => (history ? plotPoints(history.entries, since, dayKey) : { points: [], daily: false }),
        [history, since, dayKey]
    );

    const rangeName = RANGES.find((option) => option.days === range)!.name;
    const latest = history && history.entries.length > 0 ? history.entries[history.entries.length - 1] : null;
    const [value, unit] = latest ? formatBytes(latest.size).split(" ") : ["", ""];
    const first = points[0];
    const change = points.length > 1 ? points[points.length - 1].size - first.size : null;

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="sm:max-w-2xl">
                <DialogHeader>
                    <DialogTitle>{adapterName}</DialogTitle>
                    <DialogDescription>
                        Storage history
                        {latest && <> · last scanned <RelativeTime date={latest.date} /></>}
                    </DialogDescription>
                </DialogHeader>

                {(!current || latest) && (
                    <div className="flex items-center justify-between gap-4">
                        {latest ? (
                            <div className="min-w-0">
                                <div className="flex items-baseline gap-1.5">
                                    <span className="text-3xl font-semibold tracking-tight tabular-nums">{value}</span>
                                    <span className="text-sm text-muted-foreground">{unit}</span>
                                </div>
                                <p className="mt-1 truncate text-xs text-muted-foreground tabular-nums">
                                    {change !== null && (
                                        <>
                                            {change === 0 ? "No change" : signedBytes(change)} since{" "}
                                            <DateDisplay date={new Date(first.at)} format="P" /> ·{" "}
                                        </>
                                    )}
                                    {latest.count.toLocaleString()} backup{latest.count === 1 ? "" : "s"}
                                </p>
                            </div>
                        ) : (
                            <div className="space-y-2">
                                <Skeleton className="h-8 w-28" />
                                <Skeleton className="h-3 w-44" />
                            </div>
                        )}
                        <Tabs value={String(range)} onValueChange={(next) => setRange(Number(next) as RangeDays)}>
                            <TabsList className="h-8">
                                {RANGES.map((option) => (
                                    <TabsTrigger key={option.days} value={String(option.days)} className="px-2.5 text-xs">
                                        {option.label}
                                    </TabsTrigger>
                                ))}
                            </TabsList>
                        </Tabs>
                    </div>
                )}

                <div className="h-56 sm:h-64">
                    {!current ? (
                        <Skeleton className="size-full" />
                    ) : !history ? (
                        <Message className="text-destructive">{"error" in current ? current.error : null}</Message>
                    ) : !latest ? (
                        <Message>No measurements yet. The size is measured with every storage refresh, hourly by default.</Message>
                    ) : points.length < 2 ? (
                        <Message>{points.length === 0 ? "No measurements" : "Only one measurement"} in the last {rangeName}.</Message>
                    ) : (
                        <StorageHistoryChart points={points} daily={daily} dayKey={dayKey} />
                    )}
                </div>
            </DialogContent>
        </Dialog>
    );
}
