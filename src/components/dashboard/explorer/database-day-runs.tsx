"use client";

import Link from "next/link";
import { CalendarClock, ExternalLink, X } from "lucide-react";
import { AdapterIcon } from "@/components/adapter/adapter-icon";
import { count } from "@/components/dashboard/storage/explorer/explorer-format";
import { useTimelineFormat } from "@/components/dashboard/storage/explorer/timeline-cells";
import type { DayKey } from "@/components/dashboard/storage/explorer/timeline-model";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import { cn, formatBytes } from "@/lib/utils";
import type { DatabaseRuns, ExplorerDatabase, ExplorerDbJob } from "@/services/databases/database-explorer-types";
import { useDatabaseData } from "./database-data";

const STATUS: Record<string, { label: string; className: string }> = {
    Success: { label: "Backed up", className: "text-success" },
    Partial: { label: "A copy failed", className: "text-warning" },
    Failed: { label: "Failed", className: "text-destructive" },
    Running: { label: "Running", className: "text-muted-foreground" },
    Pending: { label: "Waiting", className: "text-muted-foreground" },
    Cancelled: { label: "Cancelled", className: "text-muted-foreground" },
};

interface DatabaseDayRunsProps {
    database: ExplorerDatabase;
    day: DayKey;
    jobsById: Map<string, ExplorerDbJob>;
    canViewHistory: boolean;
    onClear: () => void;
}

/** The runs of one day that backed up a database or an instance, picked on the timeline, each with where it went. */
export function DatabaseDayRuns({ database, day, jobsById, canViewHistory, onClear }: DatabaseDayRunsProps) {
    const format = useTimelineFormat();
    // A day on each side, since the day is the viewer's and the server counts in UTC.
    const from = new Date(Date.parse(`${day}T00:00:00Z`) - 86_400_000).toISOString();
    const until = new Date(Date.parse(`${day}T00:00:00Z`) + 2 * 86_400_000).toISOString();
    const runs = useDatabaseData<DatabaseRuns>(`/api/databases/runs?from=${encodeURIComponent(from)}&until=${encodeURIComponent(until)}`, "The runs could not be loaded.");
    const shown = (runs.data?.runs ?? [])
        // Every run of an instance backs it up whole.
        .filter((run) => run.serverId === database.serverId && (database.kind === "instance" || run.databases.includes(database.name)) && format.dayOf(run.startedAt) === day)
        .sort((a, b) => Date.parse(b.startedAt) - Date.parse(a.startedAt));

    return (
        <div className="rounded-xl border bg-card shadow-sm">
            <div className="flex flex-wrap items-center gap-2 px-4 pt-4 pb-3">
                <p className="font-semibold">Runs with {database.name}</p>
                <Button variant="outline" size="sm" className="h-7 gap-1.5 px-2 text-xs" onClick={onClear} aria-label="Show no day">
                    {format.date(day)}
                    <X className="size-3.5 text-muted-foreground" />
                </Button>
                {runs.data && <span className="ml-auto text-sm text-muted-foreground">{count(shown.length, "run")}</span>}
            </div>
            {runs.loading ? (
                <div className="space-y-2 px-4 pb-4"><Skeleton className="h-10 w-full" /><Skeleton className="h-10 w-full" /></div>
            ) : runs.error ? (
                <p className="px-4 pb-4 text-sm text-muted-foreground">{runs.error}</p>
            ) : shown.length === 0 ? (
                <p className="border-t px-4 py-6 text-center text-sm text-muted-foreground">No run backed up {database.name} that day.</p>
            ) : (
                // An hourly job has many runs a day, and the tables below keep their room.
                <ScrollArea className="border-t *:data-[slot=scroll-area-viewport]:max-h-60">
                    <ul className="divide-y">
                        {shown.map((run) => {
                            const status = STATUS[run.status] ?? STATUS.Success;
                            return (
                                <li key={run.id} className="flex flex-wrap items-center gap-x-4 gap-y-1.5 px-4 py-2.5 text-sm">
                                    <span className="w-16 shrink-0 font-medium tabular-nums">{format.time(run.startedAt)}</span>
                                    <span className="flex min-w-0 flex-1 items-center gap-2">
                                        <CalendarClock className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                                        <span className="truncate">{jobsById.get(run.jobId)?.name ?? "A deleted job"}</span>
                                    </span>
                                    <span className={cn("shrink-0 text-xs font-medium", status.className)}>{status.label}</span>
                                    <span className="w-20 shrink-0 text-right text-xs text-muted-foreground tabular-nums">{run.size !== null ? formatBytes(run.size) : "-"}</span>
                                    <span className="flex min-w-0 flex-wrap items-center gap-1.5">
                                        {run.destinations.map((destination) => (
                                            <span
                                                key={destination.name}
                                                className={cn("inline-flex items-center gap-1.5 rounded-md px-1.5 py-0.5 text-xs font-medium", destination.ok ? "bg-muted" : "border border-dashed border-warning/70 text-warning")}
                                                title={destination.ok ? undefined : "The upload failed"}
                                            >
                                                {destination.adapterId && <AdapterIcon adapterId={destination.adapterId} className="size-3" />}
                                                {destination.name}
                                            </span>
                                        ))}
                                    </span>
                                    {canViewHistory && (
                                        <Button variant="ghost" size="icon" className="size-8 shrink-0" asChild>
                                            <Link href={`/dashboard/history?executionId=${encodeURIComponent(run.id)}`} aria-label={`Open the run of ${format.time(run.startedAt)} in History`}>
                                                <ExternalLink />
                                            </Link>
                                        </Button>
                                    )}
                                </li>
                            );
                        })}
                    </ul>
                </ScrollArea>
            )}
        </div>
    );
}
