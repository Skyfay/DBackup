"use client";

import { useEffect, useState } from "react";
import { getStatusStyle } from "@/components/dashboard/widgets/execution-status";
import { useDateFormatter } from "@/hooks/use-date-formatter";
import { wrapError } from "@/lib/logging/errors";
import { logger } from "@/lib/logging/logger";
import { cn, formatDuration } from "@/lib/utils";
import type { JobRunEntry, JobRunHistory } from "@/services/jobs/job-list-service";

const log = logger.child({ component: "JobRunChart" });

/** The runs of one job, loaded again whenever a new run shows up in the list. */
export function useJobRuns(jobId: string, latestRunId: string | undefined): JobRunHistory | null | undefined {
    const [state, setState] = useState<{ key: string; history: JobRunHistory | null } | null>(null);
    const key = `${jobId}:${latestRunId ?? ""}`;

    useEffect(() => {
        let active = true;
        fetch(`/api/jobs/${encodeURIComponent(jobId)}/runs`)
            .then((res) => res.json())
            .then((body) => {
                if (active) setState({ key, history: body?.success ? (body.data as JobRunHistory) : null });
            })
            .catch((error: unknown) => {
                log.warn("The runs of a job could not be loaded", { jobId }, wrapError(error));
                if (active) setState({ key, history: null });
            });
        return () => {
            active = false;
        };
    }, [jobId, key]);

    // Undefined while loading, null when it failed.
    return state?.key === key ? state.history : undefined;
}

export function runLength(run: Pick<JobRunEntry, "startedAt" | "endedAt">): number | null {
    return run.endedAt ? new Date(run.endedAt).getTime() - new Date(run.startedAt).getTime() : null;
}

/** The middle length of the finished runs, what a run usually takes. */
export function typicalLength(runs: JobRunEntry[]): number | null {
    const lengths = runs.map(runLength).filter((value): value is number => value !== null).sort((a, b) => a - b);
    if (lengths.length === 0) return null;
    return lengths[Math.floor(lengths.length / 2)];
}

const FILL: Record<string, string> = {
    Success: "bg-foreground/55",
    Failed: "bg-destructive",
    Partial: "bg-warning",
    Running: "bg-info",
};

/**
 * One bar per run, as tall as the run took, the newest on the right. Runs that went well stay
 * neutral, so the failed and partial ones stand out in their status color.
 */
export function JobRunChart({ runs }: { runs: JobRunEntry[] }) {
    const { formatDate } = useDateFormatter();
    const longest = Math.max(1, ...runs.map((run) => runLength(run) ?? 0));

    if (runs.length === 0) return <p className="text-sm text-muted-foreground">No runs yet.</p>;

    return (
        <div>
            <div className="flex h-20 items-end gap-0.75 border-b pb-px" role="img" aria-label={`The last ${runs.length} runs and how long each took`}>
                {runs.map((run) => {
                    const length = runLength(run);
                    const height = length === null ? 12 : Math.max(6, Math.round((length / longest) * 100));
                    const label = getStatusStyle(run.status).label;
                    return (
                        <span
                            key={run.id}
                            title={[label, length !== null ? formatDuration(length) : null, formatDate(run.startedAt, "Pp")].filter(Boolean).join(" · ")}
                            className={cn("min-w-0 flex-1 rounded-t-sm", FILL[run.status] ?? "bg-muted-foreground/40", run.status === "Running" && "animate-pulse")}
                            style={{ height: `${height}%` }}
                        />
                    );
                })}
            </div>
            <div className="mt-1.5 flex justify-between text-xs text-muted-foreground tabular-nums">
                <span>{formatDate(runs[0].startedAt, "P")}</span>
                <span>Latest</span>
            </div>
        </div>
    );
}
