"use client";

import { LoaderCircle } from "lucide-react";
import { AdapterIcon } from "@/components/adapter/adapter-icon";
import { useDateFormatter } from "@/hooks/use-date-formatter";
import { cn, formatBytes, formatDuration } from "@/lib/utils";
import type { RunDetail, RunNeighbour, RunUpload } from "@/services/history/run-types";
import { LiveBar } from "./run-cells";
import type { SpeedSample } from "./use-run";

/** The parts of the page of a run that show it live, in the color of a running run. */

export function LivePill() {
    return (
        <span className="inline-flex h-5 items-center gap-1.5 rounded-full bg-info/12 px-2 text-xs font-semibold text-info">
            <span className="size-1.5 animate-pulse rounded-full bg-info" aria-hidden="true" />
            Live
        </span>
    );
}

export function RunningIcon({ className }: { className?: string }) {
    return <LoaderCircle className={cn("size-4 shrink-0 animate-spin text-info", className)} aria-hidden="true" />;
}

export function bytesPerSecond(speed: SpeedSample[]): number | null {
    const recent = speed.slice(-3);
    return recent.length === 0 ? null : recent.reduce((sum, sample) => sum + sample.bytesPerSecond, 0) / recent.length;
}

function secondsLeft(upload: RunUpload, rate: number | null): number | null {
    if (!rate || rate <= 0 || upload.bytes === null || upload.total === null) return null;
    return Math.max(0, Math.round((upload.total - upload.bytes) / rate));
}

/** A destination the backup uploads to right now, as one row that fills up instead of a new line every few seconds. */
export function LiveUploadRow({ upload, speed }: { upload: RunUpload; speed: SpeedSample[] }) {
    const rate = bytesPerSecond(speed);
    const percent = upload.bytes !== null && upload.total ? Math.round((upload.bytes / upload.total) * 100) : null;
    const left = secondsLeft(upload, rate);
    return (
        <div className="my-1 flex flex-wrap items-center gap-x-3 gap-y-2 rounded-lg border border-info/30 bg-info/5 px-3 py-2.5 text-sm">
            <span className="w-16 shrink-0 text-xs font-medium text-info">now</span>
            <RunningIcon className="size-3.5" />
            <span className="flex min-w-0 items-center gap-2 font-medium">
                <AdapterIcon adapterId={upload.adapterId} className="size-3.5 shrink-0" />
                <span className="truncate">{upload.name}</span>
            </span>
            <LiveBar percent={percent} className="min-w-24 flex-1" />
            <span className="tabular-nums">
                {percent !== null ? `${percent} %` : "starting"}
                {upload.bytes !== null && upload.total ? ` · ${formatBytes(upload.bytes)} of ${formatBytes(upload.total)}` : ""}
                {rate ? ` · ${formatBytes(rate)}/s` : ""}
            </span>
            {left !== null && <span className="text-muted-foreground">about {formatDuration(left * 1000)} left</span>}
        </div>
    );
}

/** How long a live run still takes, against the usual time of its job. */
export function LiveSummary({ run, now }: { run: RunDetail; now: number }) {
    const { formatDate } = useDateFormatter();
    const elapsed = Math.max(0, now - Date.parse(run.startedAt));
    const left = run.usualMs !== null ? run.usualMs - elapsed : null;
    const doneAt = run.usualMs !== null ? new Date(Date.parse(run.startedAt) + run.usualMs) : null;
    return (
        <div>
            <div className="flex items-baseline gap-2">
                <span className="text-2xl font-semibold tracking-tight tabular-nums">
                    {run.status === "Pending" ? "Queued" : left === null ? formatDuration(elapsed) : left > 0 ? `about ${formatDuration(left)}` : "any moment"}
                </span>
                {run.status !== "Pending" && <span className="text-sm text-muted-foreground">{left === null ? "so far" : left > 0 ? "left" : "now"}</span>}
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
                {run.status === "Pending"
                    ? "It starts when a slot is free."
                    : run.usualMs !== null && doneAt
                        ? <>{formatDuration(elapsed)} of the usual {formatDuration(run.usualMs)}, done around {formatDate(doneAt, "p")}</>
                        : `${run.live?.stage ?? "Running"}, no earlier run to compare with`}
            </p>
            <LiveBar percent={run.live?.percent ?? null} className="mt-3" />
        </div>
    );
}

/** The upload speed over the last two minutes. */
export function SpeedChart({ speed }: { speed: SpeedSample[] }) {
    if (speed.length < 2) return <p className="text-xs text-muted-foreground">Measured while this page is open.</p>;
    const width = 300;
    const height = 56;
    const top = Math.max(...speed.map((sample) => sample.bytesPerSecond), 1);
    const step = width / (speed.length - 1);
    const points = speed.map((sample, index) => `${(index * step).toFixed(1)},${(height - (sample.bytesPerSecond / top) * (height - 6) - 2).toFixed(1)}`).join(" ");
    return (
        <svg viewBox={`0 0 ${width} ${height}`} className="h-14 w-full" preserveAspectRatio="none" role="img" aria-label="Upload speed">
            <polygon points={`0,${height} ${points} ${width},${height}`} className="fill-info/15" />
            <polyline points={points} fill="none" className="stroke-info" strokeWidth="2" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
        </svg>
    );
}

/** The last runs of the job as bars as long as they took, the failed ones red and this one marked. */
export function RecentBars({ runs, current }: { runs: RunNeighbour[]; current: string }) {
    const shown = runs.slice(0, 10).reverse();
    const top = Math.max(...shown.map((entry) => entry.durationMs ?? 0), 1);
    return (
        <div className="flex h-11 items-end gap-1" role="img" aria-label={`The last ${shown.length} runs of the job`}>
            {shown.map((entry) => (
                <span
                    key={entry.id}
                    title={entry.status}
                    className={cn(
                        "flex-1 rounded-sm",
                        entry.status === "Failed" ? "bg-destructive" : entry.status === "Partial" ? "bg-warning" : entry.status === "Running" || entry.status === "Pending" ? "bg-info" : "bg-foreground/30",
                        entry.id === current && "ring-2 ring-foreground/50 ring-offset-1 ring-offset-card",
                    )}
                    style={{ height: `${Math.max(((entry.durationMs ?? top * 0.5) / top) * 100, 12)}%` }}
                />
            ))}
        </div>
    );
}

