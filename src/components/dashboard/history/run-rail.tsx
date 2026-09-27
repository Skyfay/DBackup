"use client";

import Link from "next/link";
import { ArrowDown, ArrowUpRight, CalendarClock, CircleCheck, CircleX, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DateDisplay } from "@/components/utils/date-display";
import { cn, formatBytes, formatDuration } from "@/lib/utils";
import type { RunDetail, RunProblem, RunProblemAction } from "@/services/history/run-types";
import { RunTile } from "./run-cells";
import { bytesPerSecond, LivePill, LiveSummary, RecentBars, SpeedChart } from "./run-live";
import { Mono } from "./run-log-lines";
import type { SpeedSample } from "./use-run";

export interface RunAccess {
    canExecute: boolean;
    canOpenJobs: boolean;
    canOpenBackups: boolean;
    canOpenConnections: boolean;
}

const CONNECTION_TABS: Record<Exclude<RunProblemAction["kind"], "job">, string> = {
    destination: "destinations",
    source: "databases",
    channel: "notifications",
};

function RailCard({ title, aside, children, className }: { title: string; aside?: React.ReactNode; children: React.ReactNode; className?: string }) {
    return (
        <div className={cn("min-w-0 rounded-xl border bg-card p-4 text-card-foreground shadow-sm", className)}>
            <div className="mb-3 flex items-center gap-2">
                <h3 className="text-sm font-semibold">{title}</h3>
                {aside && <span className="ml-auto text-xs text-muted-foreground">{aside}</span>}
            </div>
            {children}
        </div>
    );
}

function actionHref(action: RunProblemAction, run: RunDetail): string | null {
    if (action.kind === "job") return run.jobId ? `/dashboard/jobs?job=${encodeURIComponent(run.jobId)}` : null;
    return `/dashboard/connections?tab=${CONNECTION_TABS[action.kind]}`;
}

/** One thing to look at: what happened in plain words, the raw message, where, how often, and what to do. */
export function ProblemCard({ problem, run, access, onShow }: { problem: RunProblem; run: RunDetail; access: RunAccess; onShow: () => void }) {
    const error = problem.tone === "error";
    const actions = problem.actions.filter((action) => (action.kind === "job" ? access.canOpenJobs : access.canOpenConnections));
    return (
        <div className={cn("relative overflow-hidden rounded-xl border p-4 pl-5", error ? "border-destructive/30 bg-destructive/5" : "border-warning/30 bg-warning/5")}>
            <span className={cn("absolute inset-y-0 left-0 w-1", error ? "bg-destructive" : "bg-warning")} aria-hidden="true" />
            <div className="flex gap-2.5">
                {error ? <CircleX className="mt-0.5 size-4 shrink-0 text-destructive" aria-hidden="true" /> : <TriangleAlert className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden="true" />}
                <div className="min-w-0 flex-1 space-y-2">
                    <div>
                        <p className="text-sm font-semibold">{problem.title}</p>
                        <p className="text-xs text-muted-foreground">
                            {[problem.step, problem.subject].filter(Boolean).join(" · ")}{problem.at && <> · <DateDisplay date={problem.at} format="p" /></>}
                        </p>
                    </div>
                    <p><Mono tone={problem.tone}>{problem.raw}</Mono></p>
                    {problem.tries.length > 1 && <p className="text-xs text-muted-foreground">Tried {problem.tries.length} times, the tries are folded into this one</p>}
                    {problem.help && <p className="text-sm">{problem.help}</p>}
                    <div className="flex flex-wrap gap-2 pt-0.5">
                        {actions.map((action) => {
                            const href = actionHref(action, run);
                            return href && (
                                <Button key={`${action.kind}-${action.label}`} variant="outline" size="sm" asChild>
                                    <Link href={href}>{action.kind === "job" ? <CalendarClock /> : <ArrowUpRight />}{action.label}</Link>
                                </Button>
                            );
                        })}
                        <Button variant="ghost" size="sm" onClick={onShow}><ArrowDown />Show in log</Button>
                    </div>
                </div>
            </div>
        </div>
    );
}

interface RunRailProps {
    run: RunDetail;
    now: number;
    speed: SpeedSample[];
    access: RunAccess;
    onShowProblem: (problem: RunProblem) => void;
    className?: string;
}

/** Beside the log: while a run is live how long it still takes and how fast it uploads, after it what to look at. */
export function RunRail({ run, now, speed, access, onShowProblem, className }: RunRailProps) {
    const live = run.status === "Running" || run.status === "Pending";
    const uploading = run.uploads.find((upload) => upload.state === "uploading");
    const rate = bytesPerSecond(speed);
    const errors = run.problems.filter((problem) => problem.tone === "error").length;
    const warnings = run.problems.length - errors;
    return (
        <div className={cn("flex min-w-0 flex-col gap-4", className)}>
            {live && (
                <RailCard title="Live" aside={<LivePill />}>
                    <LiveSummary run={run} now={now} />
                </RailCard>
            )}
            {live && uploading && (
                <RailCard title="Upload speed" aside={uploading.name}>
                    <SpeedChart speed={speed} />
                    <p className="mt-2 text-xs text-muted-foreground tabular-nums">{rate ? `now ${formatBytes(rate)}/s` : "measuring"}</p>
                </RailCard>
            )}
            {live && run.queue.length > 0 && (
                <RailCard title="Waits for this run">
                    <ul className="space-y-2">
                        {run.queue.map((entry) => (
                            <li key={entry.id} className="text-sm">
                                <p className="truncate font-medium">{entry.name}</p>
                                <p className="truncate text-xs text-muted-foreground">started by {entry.starter.label}, it starts when a slot is free</p>
                            </li>
                        ))}
                    </ul>
                </RailCard>
            )}
            {!live && (run.problems.length > 0 ? (
                <div className="space-y-3">
                    <div className="flex items-baseline px-0.5">
                        <h3 className="text-sm font-semibold">To look at</h3>
                        <span className="ml-auto text-xs text-muted-foreground">
                            {[errors > 0 && `${errors} ${errors === 1 ? "error" : "errors"}`, warnings > 0 && `${warnings} ${warnings === 1 ? "warning" : "warnings"}`].filter(Boolean).join(", ")}
                        </span>
                    </div>
                    {run.problems.map((problem) => <ProblemCard key={problem.id} problem={problem} run={run} access={access} onShow={() => onShowProblem(problem)} />)}
                </div>
            ) : (
                <RailCard title="To look at">
                    <p className="flex items-center gap-2 text-sm">
                        <CircleCheck className="size-4 text-success" aria-hidden="true" />
                        {run.status === "Cancelled" ? "It was cancelled, nothing went wrong before." : "Nothing, every step went through."}
                    </p>
                </RailCard>
            ))}
            {run.job && run.recent.length > 1 && (
                <RailCard title={`${run.job.name}, the last ${Math.min(run.recent.length, 10)} runs`}>
                    <RecentBars runs={run.recent} current={run.id} />
                    <p className="mt-2 text-xs text-muted-foreground">
                        {run.usualMs !== null ? `usual ${formatDuration(run.usualMs)}` : "no successful run to compare with"}
                        {run.recent.slice(0, 10).some((entry) => entry.status === "Failed") && `, ${run.recent.slice(0, 10).filter((entry) => entry.status === "Failed").length} failed`}
                    </p>
                </RailCard>
            )}
            {!run.job && run.type !== "Backup" && (
                <RailCard title="What it was">
                    <div className="flex items-center gap-3">
                        <RunTile row={run} />
                        <p className="min-w-0 text-sm">{run.sub}</p>
                    </div>
                </RailCard>
            )}
        </div>
    );
}
