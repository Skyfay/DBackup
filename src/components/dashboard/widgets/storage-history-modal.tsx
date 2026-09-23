"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ArrowRight, HardDrive } from "lucide-react";
import { adapterTypeIcon } from "@/components/adapter/connection-type-icon";
import { Button } from "@/components/ui/button";
import { DIALOG_FOOTER, DIALOG_SURFACE, DialogHead } from "@/components/ui/confirm-dialog";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
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
    /** The kind of destination, for the icon beside the name. */
    adapterId?: string;
}

/** One number of the strip above the chart. */
function Stat({ label, value, unit }: { label: string; value: string; unit?: React.ReactNode }) {
    return (
        <div className="min-w-0 bg-card px-4 py-2.5">
            <div className="truncate text-xs text-muted-foreground">{label}</div>
            <div className="mt-0.5 flex items-baseline gap-1.5">
                <span className="truncate text-lg font-semibold tabular-nums">{value}</span>
                {unit && <span className="truncate text-xs text-muted-foreground">{unit}</span>}
            </div>
        </div>
    );
}

function Message({ children, className }: { children: React.ReactNode; className?: string }) {
    return (
        <div className={cn("flex size-full items-center justify-center px-6 text-center text-sm text-muted-foreground", className)}>
            {children}
        </div>
    );
}

/** Size and backup count of one destination over time, opened from the dashboard and the destinations page. */
export function StorageHistoryModal({ open, onOpenChange, configId, adapterName, adapterId }: StorageHistoryModalProps) {
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
    // Only days with a measurement carry a size, the empty ones in between hold the row open.
    const measured = points.filter((point) => point.size !== null);
    const first = measured[0];
    const change = measured.length > 1 ? measured[measured.length - 1].size! - first.size! : null;

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent showCloseButton={false} className={cn(DIALOG_SURFACE, "sm:max-w-2xl")}>
                <DialogHead tone="neutral" icon={adapterId ? adapterTypeIcon(adapterId) : HardDrive}>
                    <DialogTitle className="text-base">{adapterName}</DialogTitle>
                    <DialogDescription className="text-xs">
                        Storage history
                        {latest && <> · last scanned <RelativeTime date={latest.date} /></>}
                    </DialogDescription>
                </DialogHead>

                <div className="grid min-w-0 gap-4 px-5 py-4">
                    {latest ? (
                        // The middle cell takes the width its text needs, the other two share what is
                        // left in equal halves and give way when the change is a long one.
                        <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,auto)_minmax(0,1fr)] gap-px overflow-hidden rounded-xl border bg-border">
                            <Stat label="Stored" value={value} unit={unit} />
                            <Stat
                                label={`Change in ${rangeName}`}
                                value={change === null ? "-" : change === 0 ? "No change" : signedBytes(change)}
                                unit={change ? <>since <DateDisplay date={new Date(first.at)} format="P" /></> : undefined}
                            />
                            <Stat label="Backups" value={latest.count.toLocaleString()} unit={latest.count === 1 ? "file" : "files"} />
                        </div>
                    ) : (
                        <Skeleton className="h-16 w-full rounded-xl" />
                    )}

                    <div className="flex items-center justify-between gap-3">
                        <span className="truncate text-xs text-muted-foreground">Size per day, last {rangeName}</span>
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
                </div>

                <div className={cn(DIALOG_FOOTER, "flex flex-wrap items-center justify-end gap-2")}>
                    <span className="mr-auto text-xs text-muted-foreground">Measured with every storage refresh, hourly by default.</span>
                    <Button variant="ghost" size="sm" asChild>
                        <Link href={`/dashboard/storage?destination=${configId}`}>
                            Open in Storage Explorer
                            <ArrowRight />
                        </Link>
                    </Button>
                    <DialogClose asChild>
                        <Button variant="outline" size="sm">Close</Button>
                    </DialogClose>
                </div>
            </DialogContent>
        </Dialog>
    );
}
