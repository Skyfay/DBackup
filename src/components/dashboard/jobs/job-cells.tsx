"use client";

import { FolderInput, Lock, LockOpen } from "lucide-react";
import { AdapterIcon } from "@/components/adapter/adapter-icon";
import { ExecutionStatusBadge } from "@/components/dashboard/widgets/execution-status";
import { RelativeTime } from "@/components/dashboard/widgets/relative-time";
import { DateDisplay } from "@/components/utils/date-display";
import { cn, formatDuration } from "@/lib/utils";
import type { JobListItem } from "@/services/jobs/job-list-service";
import { describeSchedule } from "./job-schedule";

const DAY_MS = 24 * 60 * 60 * 1000;
const COMPRESSION: Record<string, string> = { GZIP: "Gzip", BROTLI: "Brotli" };

/** The schedule in words, and the preset it follows. An expression without words stays code. */
export function ScheduleText({ job, className }: { job: JobListItem; className?: string }) {
    const schedule = describeSchedule(job.schedulePreset?.schedule ?? job.schedule);
    return (
        <span className={cn("truncate text-xs text-muted-foreground", className)}>
            <span className={cn(!schedule.described && "font-mono")}>{schedule.text}</span>
            {job.schedulePreset && ` · ${job.schedulePreset.name}`}
        </span>
    );
}

export function JobNameCell({ job, compact, onOpen }: { job: JobListItem; compact: boolean; onOpen?: () => void }) {
    return (
        // A cell grows with text that never wraps, so a long name is capped here and cut off.
        <div className={cn("min-w-0 max-w-72", compact && "flex items-baseline gap-2")}>
            {onOpen ? (
                <button
                    type="button"
                    onClick={onOpen}
                    title={job.name}
                    className={cn(
                        "block max-w-full truncate rounded-sm text-left font-medium outline-none hover:underline hover:underline-offset-4 focus-visible:ring-2 focus-visible:ring-ring/50",
                        !job.enabled && "text-muted-foreground"
                    )}
                >
                    {job.name}
                </button>
            ) : (
                <div className={cn("truncate font-medium", !job.enabled && "text-muted-foreground")} title={job.name}>{job.name}</div>
            )}
            <ScheduleText job={job} className="block" />
        </div>
    );
}

function duration(run: { startedAt: string; endedAt: string | null }): string | null {
    if (!run.endedAt) return null;
    return formatDuration(new Date(run.endedAt).getTime() - new Date(run.startedAt).getTime());
}

/** What the last run says in one line: how far a live one is, what went wrong, or when it ran and how long it took. */
export function RunLine({ job, className }: { job: JobListItem; className?: string }) {
    const { live, error, lastRun, status } = job.overview;
    if (live) {
        const text = live.status === "Pending" ? "Waiting for its turn" : [live.stage ?? "Starting", live.progress !== null ? `${live.progress}%` : null].filter(Boolean).join(" · ");
        return <span className={cn("block truncate text-xs text-muted-foreground tabular-nums", className)}>{text}</span>;
    }
    if (error) {
        return (
            <span className={cn("block truncate text-xs", status === "Failed" ? "text-destructive" : "text-warning", className)} title={error}>
                {error}
            </span>
        );
    }
    if (!lastRun) return null;
    const length = duration(lastRun);
    return (
        <span className={cn("block truncate text-xs text-muted-foreground tabular-nums", className)}>
            <RelativeTime date={lastRun.startedAt} />
            {length && ` · ${length}`}
        </span>
    );
}

export function LastRunCell({ job }: { job: JobListItem }) {
    return (
        <div className="grid min-w-0 max-w-64 justify-items-start gap-1">
            <ExecutionStatusBadge status={job.overview.status} label={job.overview.status ? undefined : "Never ran"} />
            <RunLine job={job} />
        </div>
    );
}

/** Where a job reads from: its database, or its first folder source. */
export function sourceOf(job: JobListItem): { name: string; adapterId: string | null; more: number } {
    if (job.source) return { name: job.source.name, adapterId: job.source.adapterId, more: job.sources.length };
    const [first, ...rest] = job.sources;
    return first ? { name: first.config.name, adapterId: null, more: rest.length } : { name: "No source", adapterId: null, more: 0 };
}

export function destinationsText(job: JobListItem): string {
    const names = job.destinations.map((destination) => destination.config.name);
    return names.length > 0 ? names.join(", ") : "No destination";
}

export function SourceIcon({ adapterId, className }: { adapterId: string | null; className?: string }) {
    return adapterId ? <AdapterIcon adapterId={adapterId} className={className} /> : <FolderInput className={cn("text-muted-foreground", className)} aria-hidden="true" />;
}

/** Encryption and compression, the two things every job decides about how it stores. */
export function StorageFacts({ job, className }: { job: JobListItem; className?: string }) {
    const Icon = job.encryptionProfile ? Lock : LockOpen;
    const compression = COMPRESSION[job.compression];
    return (
        <span className={cn("flex min-w-0 items-center gap-1 text-xs text-muted-foreground", className)}>
            <Icon className="size-3 shrink-0" aria-hidden="true" />
            <span className="truncate">
                {job.encryptionProfile ? job.encryptionProfile.name : "Not encrypted"}
                {compression && ` · ${compression}`}
                {job.backupMode === "INCREMENTAL" && " · incremental"}
            </span>
        </span>
    );
}

export function FlowCell({ job }: { job: JobListItem }) {
    const source = sourceOf(job);
    const text = `${source.name}${source.more > 0 ? ` +${source.more}` : ""} → ${destinationsText(job)}`;
    return (
        <div className="grid min-w-0 max-w-80 gap-1">
            <span className="flex min-w-0 items-center gap-1.5 text-sm">
                <SourceIcon adapterId={source.adapterId} className="size-3.5 shrink-0" />
                <span className="truncate" title={text}>{text}</span>
            </span>
            <StorageFacts job={job} />
        </div>
    );
}

/** The next run, as a time within a day and as a distance beyond. A paused job has none. */
export function NextRun({ job }: { job: JobListItem }) {
    if (!job.enabled) return <span className="text-muted-foreground">Paused</span>;
    const next = job.overview.nextRunAt;
    if (!next) return <span className="text-muted-foreground">Manual</span>;
    const soon = new Date(next).getTime() - Date.now() < DAY_MS;
    return soon ? <DateDisplay date={next} format="p" /> : <RelativeTime date={next} />;
}
