"use client";

import Link from "next/link";
import { formatDistanceToNowStrict } from "date-fns";
import { DateDisplay } from "@/components/utils/date-display";
import { cn, formatDuration } from "@/lib/utils";
import type { DashboardJobRow, RunSummary } from "@/services/dashboard/types";
import { ExecutionStatusBadge, getStatusStyle } from "./execution-status";
import { RelativeTime } from "./relative-time";

interface JobsListProps {
    rows: DashboardJobRow[];
    canViewJobs: boolean;
}

const RUN_SLOTS = 12;
const DAY_MS = 24 * 60 * 60 * 1000;
const COLUMNS = "grid-cols-[minmax(0,1fr)_auto] md:grid-cols-[minmax(0,1fr)_6.5rem_5rem_6.5rem_5.5rem]";

function runDuration(run: RunSummary): string | null {
    if (!run.endedAt) return null;
    return formatDuration(new Date(run.endedAt).getTime() - new Date(run.startedAt).getTime());
}

/** One bar per recent run, the newest on the right. Empty slots fill up the row for new jobs. */
function RunBars({ runs, className }: { runs: RunSummary[]; className?: string }) {
    const empty = Math.max(0, RUN_SLOTS - runs.length);
    return (
        <div className={cn("flex h-4 items-stretch gap-0.5", className)} aria-label={`Last ${runs.length} runs`}>
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
            {duration && <span className="font-mono text-[11px] text-muted-foreground/80">{duration}</span>}
        </span>
    );
}

/** Jobs with their state, recent runs and next run, live runs first. */
export function JobsList({ rows, canViewJobs }: JobsListProps) {
    if (rows.length === 0) {
        return <p className="px-4 py-10 text-center text-sm text-muted-foreground md:px-5">No jobs configured yet.</p>;
    }

    return (
        <div>
            <div className={cn("hidden border-b bg-muted/40 px-5 py-2 font-mono text-[11px] tracking-wider text-muted-foreground uppercase md:grid md:gap-x-4", COLUMNS)}>
                <span>Job</span>
                <span>Status</span>
                <span>Last {RUN_SLOTS}</span>
                <span className="text-right">Last run</span>
                <span className="text-right">Next</span>
            </div>
            <ul className="divide-y">
                {rows.map((row) => {
                    const rowClassName = cn(
                        "grid items-center gap-x-4 gap-y-1 px-4 py-3 md:px-5",
                        COLUMNS,
                        row.status === "Running" && "bg-info/5"
                    );
                    const cells = (
                        <>
                            <div className="min-w-0">
                                <p className={cn("truncate font-mono text-sm font-medium", !row.enabled && "text-muted-foreground")}>{row.name}</p>
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
                            <div className="hidden text-right font-mono text-xs text-muted-foreground md:block">
                                <NextRun row={row} />
                            </div>
                        </>
                    );

                    return (
                        <li key={row.id}>
                            {canViewJobs ? (
                                <Link
                                    href="/dashboard/jobs"
                                    className={cn(rowClassName, "outline-none transition-colors hover:bg-muted/50 focus-visible:bg-muted/50")}
                                >
                                    {cells}
                                </Link>
                            ) : (
                                <div className={rowClassName}>{cells}</div>
                            )}
                        </li>
                    );
                })}
            </ul>
        </div>
    );
}
