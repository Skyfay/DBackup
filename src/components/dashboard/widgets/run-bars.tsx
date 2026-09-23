"use client";

import { formatDistanceToNowStrict } from "date-fns";
import { cn } from "@/lib/utils";
import type { RunSummary } from "@/services/dashboard/types";
import { getStatusStyle } from "./execution-status";

export const RUN_SLOTS = 12;

/** One bar per recent run, the newest on the right. Empty slots fill up the row for new jobs. */
export function RunBars({ runs, className }: { runs: RunSummary[]; className?: string }) {
    const shown = runs.slice(-RUN_SLOTS);
    const empty = Math.max(0, RUN_SLOTS - shown.length);
    return (
        // Above a row link, so the per-run tooltips still show.
        <div className={cn("relative z-10 flex h-4 items-stretch gap-0.5", className)} aria-label={`Last ${shown.length} runs`}>
            {Array.from({ length: empty }, (_, i) => (
                <span key={`empty-${i}`} className="w-1 rounded-full bg-muted" aria-hidden="true" />
            ))}
            {shown.map((run) => {
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
