"use client";

import Link from "next/link";
import { useId, useState } from "react";
import { CheckCircle2, ChevronDown, CircleAlert, Loader2, Play, Plus, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DateDisplay } from "@/components/utils/date-display";
import { cn } from "@/lib/utils";
import type { DashboardHealth, UnhealthyJob } from "@/services/dashboard/types";
import { RelativeTime } from "./relative-time";
import { useRunJob } from "./use-run-job";

const DAY_MS = 24 * 60 * 60 * 1000;
/** Matches the number of jobs the service fills with error details. */
const LISTED_JOBS = 3;

const TONES = {
    healthy: { bar: "bg-success", icon: "bg-success/12 text-success", frame: "bg-card", Icon: CheckCircle2 },
    failing: { bar: "bg-destructive", icon: "bg-destructive/12 text-destructive", frame: "border-destructive/30 bg-destructive/5", Icon: CircleAlert },
    degraded: { bar: "bg-warning", icon: "bg-warning/12 text-warning", frame: "border-warning/30 bg-warning/5", Icon: TriangleAlert },
    empty: { bar: "bg-muted-foreground/40", icon: "bg-muted text-muted-foreground", frame: "bg-card", Icon: Plus },
} as const;

type Unhealthy = "failing" | "degraded";

interface StatusBannerProps {
    health: DashboardHealth;
    canExecute: boolean;
    canViewHistory: boolean;
    canManageJobs: boolean;
}

/** "has failed 2 of its last 12 runs", or the partial equivalent. */
function outcomeText(state: Unhealthy, job: UnhealthyJob): string {
    if (state === "degraded") {
        return job.badRuns > 1 ? `finished partially in ${job.badRuns} of its last ${job.recentRuns} runs` : "finished partially";
    }
    return job.badRuns > 1 ? `has failed ${job.badRuns} of its last ${job.recentRuns} runs` : "failed its last run";
}

function LastClean({ job }: { job: UnhealthyJob }) {
    return job.lastSuccessAt ? <>Last clean run <RelativeTime date={job.lastSuccessAt} />.</> : <>No clean run on record.</>;
}

/** The job names on the folded banner, like "postgres-nightly, files and 2 more". */
function namesList(jobs: UnhealthyJob[]): string {
    const names = jobs.map((job) => job.jobName);
    if (names.length <= LISTED_JOBS) return names.join(", ");
    return `${names.slice(0, LISTED_JOBS).join(", ")} and ${names.length - LISTED_JOBS} more`;
}

interface JobActionsProps {
    job: UnhealthyJob;
    canViewHistory: boolean;
    canExecute: boolean;
    runJob: (jobId: string, jobName: string) => void;
    startingJobId: string | null;
    /** The single-job banner has one prominent run button. In a list of jobs every button stays quiet. */
    primary: boolean;
}

function JobActions({ job, canViewHistory, canExecute, runJob, startingJobId, primary }: JobActionsProps) {
    if (!canViewHistory && !canExecute) return null;
    return (
        <div className="flex shrink-0 gap-2">
            {canViewHistory && (
                <Button asChild variant="outline" size="sm" className="flex-1 sm:flex-none">
                    <Link href={`/dashboard/history?executionId=${job.executionId}`}>View logs</Link>
                </Button>
            )}
            {canExecute && (
                <Button
                    variant={primary ? "default" : "outline"}
                    size="sm"
                    className="flex-1 sm:flex-none"
                    disabled={startingJobId !== null}
                    onClick={() => runJob(job.jobId, job.jobName)}
                >
                    {startingJobId === job.jobId ? <Loader2 className="animate-spin" /> : <Play />}
                    Run now
                </Button>
            )}
        </div>
    );
}

/** The banner at the top of the dashboard: all good, or which jobs need attention and why. */
export function StatusBanner({ health, canExecute, canViewHistory, canManageJobs }: StatusBannerProps) {
    const { runJob, startingJobId } = useRunJob();
    // A problem banner starts folded to two lines, the errors and actions sit behind the toggle.
    // It stays open through auto refreshes while the page is open, but every visit starts folded.
    const [expanded, setExpanded] = useState(false);
    const detailsId = useId();
    const tone = TONES[health.state];
    const actionProps = { canViewHistory, canExecute, runJob, startingJobId };

    let title: string;
    let body: React.ReactNode = null;
    let actions: React.ReactNode = null;
    // Sits below the header at full width, so the buttons of a job line up with the toggle.
    let details: React.ReactNode = null;

    if (health.state === "empty") {
        title = "No backup jobs yet";
        body = <p className="text-sm text-muted-foreground">Create a job to start backing up your databases.</p>;
        if (canManageJobs) {
            actions = (
                <Button asChild size="sm">
                    <Link href="/dashboard/jobs">Create job</Link>
                </Button>
            );
        }
    } else if (health.state === "healthy") {
        title = "All backups healthy";
        const { lastRunAt, nextRun } = health;
        const nextIsToday = nextRun && new Date(nextRun.at).getTime() - Date.now() < DAY_MS;
        body = (
            <p className="text-sm text-muted-foreground">
                {lastRunAt ? <>Last run <RelativeTime date={lastRunAt} />. </> : "No finished runs yet. "}
                {nextRun ? (
                    <>
                        Next scheduled run is <span className="font-medium text-foreground">{nextRun.jobName}</span> at{" "}
                        <DateDisplay date={nextRun.at} format={nextIsToday ? "p" : "Pp"} />.
                    </>
                ) : (
                    "Nothing is scheduled."
                )}
            </p>
        );
    } else {
        const state = health.state;
        actions = (
            <Button
                variant="outline"
                size="sm"
                className="w-full sm:w-auto"
                onClick={() => setExpanded((open) => !open)}
                aria-expanded={expanded}
                aria-controls={detailsId}
            >
                {expanded ? "Hide details" : "Show details"}
                <ChevronDown className={cn("transition-transform", expanded && "rotate-180")} />
            </Button>
        );

        if (health.jobs.length === 1) {
            const [job] = health.jobs;
            title = `${job.jobName} ${outcomeText(state, job)}`;
            body = <p className="text-sm text-muted-foreground"><LastClean job={job} /></p>;
            if (expanded) {
                details = (
                    <div className="flex flex-col gap-2 border-t border-border/60 pt-2.5 sm:flex-row sm:items-center sm:gap-4">
                        <p className="min-w-0 flex-1 text-sm wrap-anywhere text-muted-foreground">
                            {job.error ?? "No error message was recorded for this run."}
                        </p>
                        <JobActions job={job} {...actionProps} primary />
                    </div>
                );
            }
        } else {
            const listed = health.jobs.slice(0, LISTED_JOBS);
            const more = health.jobs.length - listed.length;
            title = state === "failing" ? `${health.jobs.length} jobs are failing` : `${health.jobs.length} jobs finished partially`;
            body = <p className="truncate text-sm text-muted-foreground">{namesList(health.jobs)}</p>;
            if (expanded) {
                details = (
                    <>
                        <ul className="divide-y divide-border/60 border-t border-border/60">
                            {listed.map((job) => (
                                <li key={job.jobId} className="flex flex-col gap-2 py-2.5 last:pb-0 sm:flex-row sm:items-center sm:gap-4">
                                    <div className="min-w-0 flex-1 space-y-0.5">
                                        <p className="text-sm">
                                            <span className="font-medium">{job.jobName}</span>{" "}
                                            <span className="text-muted-foreground">{outcomeText(state, job)}</span>
                                        </p>
                                        {job.error && <p className="line-clamp-1 text-xs wrap-anywhere text-muted-foreground">{job.error}</p>}
                                        <p className="text-xs text-muted-foreground"><LastClean job={job} /></p>
                                    </div>
                                    <JobActions job={job} {...actionProps} primary={false} />
                                </li>
                            ))}
                        </ul>
                        {more > 0 && (
                            <p className="pt-2.5 text-sm text-muted-foreground">
                                And {more} more
                                {canViewHistory && (
                                    <>
                                        {" in "}
                                        <Link href="/dashboard/history" className="underline underline-offset-4 hover:text-foreground">History</Link>
                                    </>
                                )}
                                .
                            </p>
                        )}
                    </>
                );
            }
        }
    }

    return (
        <div className={cn("relative overflow-hidden rounded-xl border p-4 pl-5 shadow-sm md:pl-6", tone.frame)}>
            <span className={cn("absolute inset-y-0 left-0 w-1", tone.bar)} aria-hidden="true" />
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:gap-4">
                <div className="flex min-w-0 flex-1 items-start gap-3">
                    <div className={cn("flex size-9 shrink-0 items-center justify-center rounded-lg", tone.icon)}>
                        <tone.Icon className="size-5" aria-hidden="true" />
                    </div>
                    <div className="min-w-0 flex-1 space-y-0.5">
                        <p className="font-semibold leading-snug">{title}</p>
                        {body}
                    </div>
                </div>
                {actions && <div className="flex shrink-0 sm:ml-auto">{actions}</div>}
            </div>
            {/* Indented to the text column, the width of the icon plus its gap. */}
            {details && <div id={detailsId} className="mt-3 sm:pl-12">{details}</div>}
        </div>
    );
}
