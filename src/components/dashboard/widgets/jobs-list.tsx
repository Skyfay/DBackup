"use client";

import Link from "next/link";
import { formatDistanceToNowStrict } from "date-fns";
import { Loader2, Play } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DateDisplay } from "@/components/utils/date-display";
import { cn, formatDuration } from "@/lib/utils";
import type { DashboardJobRow, RunSummary } from "@/services/dashboard/types";
import { ExecutionStatusBadge, getStatusStyle } from "./execution-status";
import { RelativeTime } from "./relative-time";
import { useRunJob } from "./use-run-job";

interface JobsListProps {
    rows: DashboardJobRow[];
    canViewHistory: boolean;
    canViewJobs: boolean;
    canExecute: boolean;
}

const RUN_SLOTS = 12;
const DAY_MS = 24 * 60 * 60 * 1000;
const COLUMNS = "grid-cols-[minmax(0,1fr)_auto_2rem] md:grid-cols-[minmax(0,1fr)_6.5rem_5rem_6.5rem_5.5rem_2rem]";

function runDuration(run: RunSummary): string | null {
    if (!run.endedAt) return null;
    return formatDuration(new Date(run.endedAt).getTime() - new Date(run.startedAt).getTime());
}

/** One bar per recent run, the newest on the right. Empty slots fill up the row for new jobs. */
function RunBars({ runs, className }: { runs: RunSummary[]; className?: string }) {
    const empty = Math.max(0, RUN_SLOTS - runs.length);
    return (
        // Above the row link, so the per-run tooltips still show.
        <div className={cn("relative z-10 flex h-4 items-stretch gap-0.5", className)} aria-label={`Last ${runs.length} runs`}>
            {Array.from({ length: empty }, (_, i) => (
                <span key={`empty-${i}`} className="w-1 rounded-full bg-muted" aria-hidden="true" />
            ))}
            {runs.map((run) => {
                const style = getStatusStyle(run.status);
                return (
                    <span
                        key={run.id}
                        title={`${style.label}, ${formatDistanceToNowStrict(new Date(run.startedAt), { addSuffix: true })}`}
                        className={cn("w-1 rounded-full", style.fill, run.status === "Running" && "animate-pulse")}
                        suppressHydrationWarning
                    />
                );
            })}
        </div>
    );
}

function NextRun({ row }: { row: DashboardJobRow }) {
    if (!row.enabled) return <span>Paused</span>;
    if (!row.nextRunAt) return <span>Manual</span>;
    const soon = new Date(row.nextRunAt).getTime() - Date.now() < DAY_MS;
    return soon ? <DateDisplay date={row.nextRunAt} format="p" /> : <RelativeTime date={row.nextRunAt} />;
}

function LastRun({ run }: { run: RunSummary | null }) {
    if (!run) return <span>Never</span>;
    const duration = runDuration(run);
    return (
        <span className="flex flex-col items-end">
            <RelativeTime date={run.startedAt} />
            {duration && <span className="text-[11px] text-muted-foreground/80 tabular-nums">{duration}</span>}
        </span>
    );
}

/** Where a click on the row goes: the job's latest run, or the job list for a job that never ran. */
function rowHref(row: DashboardJobRow, canViewHistory: boolean, canViewJobs: boolean): string | null {
    if (row.lastRun && canViewHistory) return `/dashboard/history?executionId=${row.lastRun.id}`;
    return canViewJobs ? "/dashboard/jobs" : null;
}

/** Jobs with their state, recent runs and next run, live runs first. */
export function JobsList({ rows, canViewHistory, canViewJobs, canExecute }: JobsListProps) {
    const { runJob, startingJobId } = useRunJob();

    if (rows.length === 0) {
        return <p className="px-4 py-10 text-center text-sm text-muted-foreground md:px-5">No jobs configured yet.</p>;
    }

    return (
        <div>
            <div className={cn("hidden border-b px-5 pb-2 text-xs text-muted-foreground md:grid md:gap-x-4", COLUMNS)}>
                <span>Job</span>
                <span>Status</span>
                <span>Last {RUN_SLOTS} runs</span>
                <span className="text-right">Last run</span>
                <span className="text-right">Next</span>
                <span className="sr-only">Actions</span>
            </div>
            <ul className="divide-y">
                {rows.map((row) => {
                    const href = rowHref(row, canViewHistory, canViewJobs);
                    const isLive = row.status === "Running" || row.status === "Pending";
                    const isStarting = startingJobId === row.id;

                    return (
                        <li
                            key={row.id}
                            className={cn(
                                // The name link stretches over the whole row, the run button sits above it.
                                "group relative grid items-center gap-x-4 gap-y-1 px-4 py-3 transition-colors md:px-5",
                                COLUMNS,
                                row.status === "Running" && "bg-info/5",
                                href && "hover:bg-muted/50 has-[a:focus-visible]:bg-muted/50"
                            )}
                        >
                            <div className="min-w-0">
                                <p className={cn("truncate text-sm font-medium", !row.enabled && "text-muted-foreground")}>
                                    {href ? (
                                        <Link href={href} className="outline-none after:absolute after:inset-0">
                                            {row.name}
                                        </Link>
                                    ) : (
                                        row.name
                                    )}
                                </p>
                                <p className="truncate text-xs text-muted-foreground">
                                    {row.sourceLabel} → {row.destinationLabel}
                                </p>
                                <p className="truncate text-xs text-muted-foreground md:hidden">
                                    {row.enabled && row.nextRunAt ? <>Next <NextRun row={row} /></> : <NextRun row={row} />}
                                </p>
                            </div>
                            <div className="flex flex-col items-end gap-1.5 md:items-start">
                                <ExecutionStatusBadge status={row.status} label={row.status ? undefined : "Never ran"} />
                                <RunBars runs={row.runs} className="md:hidden" />
                            </div>
                            <RunBars runs={row.runs} className="hidden md:flex" />
                            <div className="hidden text-right text-xs text-muted-foreground md:block">
                                <LastRun run={row.lastRun} />
                            </div>
                            <div className="hidden text-right text-xs text-muted-foreground tabular-nums md:block">
                                <NextRun row={row} />
                            </div>
                            <div className="relative z-10 flex justify-end">
                                {canExecute && !isLive && (
                                    <Button
                                        variant="ghost"
                                        size="icon"
                                        className={cn(
                                            "size-8 text-muted-foreground hover:text-foreground",
                                            // Touch screens have no hover, so the button stays visible on small screens.
                                            !isStarting && "md:opacity-0 md:group-hover:opacity-100 md:focus-visible:opacity-100"
                                        )}
                                        disabled={startingJobId !== null}
                                        onClick={() => runJob(row.id, row.name)}
                                        aria-label={`Run ${row.name} now`}
                                        title="Run now"
                                    >
                                        {isStarting ? <Loader2 className="animate-spin" /> : <Play />}
                                    </Button>
                                )}
                            </div>
                        </li>
                    );
                })}
            </ul>
        </div>
    );
}
