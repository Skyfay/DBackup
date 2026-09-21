"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { CheckCircle2, CircleAlert, Loader2, Play, Plus, TriangleAlert } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { DateDisplay } from "@/components/utils/date-display";
import { useUserPreferences } from "@/hooks/use-user-preferences";
import { logger } from "@/lib/logging/logger";
import { cn } from "@/lib/utils";
import type { DashboardHealth, UnhealthyJob } from "@/services/dashboard/types";
import { RelativeTime } from "./relative-time";

const log = logger.child({ component: "dashboard-status-banner" });

const DAY_MS = 24 * 60 * 60 * 1000;

const TONES = {
    healthy: { bar: "bg-success", icon: "bg-success/12 text-success", frame: "bg-card", Icon: CheckCircle2 },
    failing: { bar: "bg-destructive", icon: "bg-destructive/12 text-destructive", frame: "border-destructive/30 bg-destructive/5", Icon: CircleAlert },
    degraded: { bar: "bg-warning", icon: "bg-warning/12 text-warning", frame: "border-warning/30 bg-warning/5", Icon: TriangleAlert },
    empty: { bar: "bg-muted-foreground/40", icon: "bg-muted text-muted-foreground", frame: "bg-card", Icon: Plus },
} as const;

interface StatusBannerProps {
    health: DashboardHealth;
    canExecute: boolean;
    canViewHistory: boolean;
    canManageJobs: boolean;
}

function unhealthyTitle(state: "failing" | "degraded", jobs: UnhealthyJob[]): string {
    const [featured] = jobs;
    if (jobs.length > 1) {
        return state === "failing" ? `${jobs.length} jobs are failing` : `${jobs.length} jobs finished partially`;
    }
    if (state === "degraded") {
        return featured.badRuns > 1
            ? `${featured.jobName} finished partially in ${featured.badRuns} of its last ${featured.recentRuns} runs`
            : `${featured.jobName} finished partially`;
    }
    return featured.badRuns > 1
        ? `${featured.jobName} has failed ${featured.badRuns} of its last ${featured.recentRuns} runs`
        : `${featured.jobName} failed its last run`;
}

function othersList(jobs: UnhealthyJob[]): string {
    const names = jobs.map((job) => job.jobName);
    if (names.length <= 2) return names.join(" and ");
    return `${names.slice(0, 2).join(", ")} and ${names.length - 2} more`;
}

/** The banner at the top of the dashboard: all good, or which job needs attention and why. */
export function StatusBanner({ health, canExecute, canViewHistory, canManageJobs }: StatusBannerProps) {
    const router = useRouter();
    const { autoRedirectOnJobStart } = useUserPreferences();
    const [isStarting, setIsStarting] = useState(false);

    const runNow = async (job: UnhealthyJob) => {
        setIsStarting(true);
        try {
            const res = await fetch(`/api/jobs/${job.jobId}/run`, { method: "POST" });
            const data = await res.json();
            if (!data.success) {
                toast.error(`Could not start ${job.jobName}: ${data.error ?? "unknown error"}`);
                return;
            }
            toast.success(`${job.jobName} started`);
            if (data.executionId && autoRedirectOnJobStart) {
                router.push(`/dashboard/history?executionId=${data.executionId}`);
            } else {
                router.refresh();
            }
        } catch (error) {
            log.error("Starting a job from the dashboard failed", { jobId: job.jobId }, error instanceof Error ? error : undefined);
            toast.error("The run request failed");
        } finally {
            setIsStarting(false);
        }
    };

    let title: string;
    let detail: React.ReactNode;
    let error: string | null = null;
    let actions: React.ReactNode = null;

    if (health.state === "empty") {
        title = "No backup jobs yet";
        detail = "Create a job to start backing up your databases.";
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
        detail = (
            <>
                {lastRunAt ? <>Last run <RelativeTime date={lastRunAt} />. </> : "No finished runs yet. "}
                {nextRun ? (
                    <>
                        Next scheduled run is <span className="font-medium text-foreground">{nextRun.jobName}</span> at{" "}
                        <DateDisplay date={nextRun.at} format={nextIsToday ? "p" : "Pp"} />.
                    </>
                ) : (
                    "Nothing is scheduled."
                )}
            </>
        );
    } else {
        const [featured, ...others] = health.jobs;
        title = unhealthyTitle(health.state, health.jobs);
        error = featured.error;
        detail = (
            <>
                {health.jobs.length > 1 && <>Latest is <span className="font-medium text-foreground">{featured.jobName}</span>. </>}
                {featured.lastSuccessAt ? <>Last clean run <RelativeTime date={featured.lastSuccessAt} />.</> : "No clean run on record."}
                {others.length > 0 && <> Also affected: {othersList(others)}.</>}
            </>
        );
        actions = (
            <>
                {canViewHistory && (
                    <Button asChild variant="outline" size="sm" className="flex-1 sm:flex-none">
                        <Link href={`/dashboard/history?executionId=${featured.executionId}`}>View logs</Link>
                    </Button>
                )}
                {canExecute && (
                    <Button size="sm" className="flex-1 sm:flex-none" disabled={isStarting} onClick={() => runNow(featured)}>
                        {isStarting ? <Loader2 className="animate-spin" /> : <Play />}
                        Run now
                    </Button>
                )}
            </>
        );
    }

    const tone = TONES[health.state];

    return (
        <div
            className={cn(
                "relative flex flex-col gap-3 overflow-hidden rounded-xl border p-4 pl-5 shadow-sm sm:flex-row sm:items-center sm:gap-4 md:pl-6",
                tone.frame
            )}
        >
            <span className={cn("absolute inset-y-0 left-0 w-1", tone.bar)} aria-hidden="true" />
            <div className="flex min-w-0 flex-1 items-start gap-3">
                <div className={cn("flex size-9 shrink-0 items-center justify-center rounded-lg", tone.icon)}>
                    <tone.Icon className="size-5" aria-hidden="true" />
                </div>
                <div className="min-w-0 space-y-0.5">
                    <p className="font-semibold leading-snug">{title}</p>
                    {error && <p className="line-clamp-2 text-sm wrap-anywhere text-muted-foreground">{error}</p>}
                    <p className="text-sm text-muted-foreground">{detail}</p>
                </div>
            </div>
            {actions && <div className="flex shrink-0 gap-2 sm:ml-auto">{actions}</div>}
        </div>
    );
}
