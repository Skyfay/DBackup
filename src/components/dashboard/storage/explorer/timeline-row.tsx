"use client";

import { describeSchedule } from "@/components/dashboard/jobs/job-schedule";
import { describeRetention } from "@/components/templates/retention-words";
import { cn } from "@/lib/utils";
import type { ExplorerDestination, ExplorerJob, JobPlan } from "@/services/storage/explorer-types";
import { JobTile } from "./explorer-cells";
import { count } from "./explorer-format";
import { TimelineCellButton, TimelineSpanBar, type TimelineFormat } from "./timeline-cells";
import { isPicked, type DayKey, type TimelinePick, type TimelineRow } from "./timeline-model";

function metaOf(job: ExplorerJob, plan: JobPlan | undefined): string {
    if (job.kind === "deleted") return `${count(job.runs, "backup")} kept`;
    if (job.kind !== "job") return "Not from a job";
    const parts = [
        plan?.schedule ? (plan.enabled ? describeSchedule(plan.schedule).text : "Paused") : null,
        plan?.retention ? describeRetention(plan.retention) : null,
    ].filter(Boolean);
    return parts.length > 0 ? parts.join(" · ") : count(job.runs, "backup");
}

interface TimelineJobRowProps {
    row: TimelineRow;
    /** The days in view up to today, which a click on the job lists. */
    range: { from: DayKey; to: DayKey };
    /** The columns of the timeline, the same in every row. */
    template: React.CSSProperties;
    destinations: Map<string, ExplorerDestination>;
    format: TimelineFormat;
    at: string[];
    pick: TimelinePick | null;
    onToggle: (pick: TimelinePick) => void;
}

/** A job of the timeline: its name with what it plans and keeps, which lists its backups in view, and a cell per day. */
export function TimelineJobRow({ row, range, template, destinations, format, at, pick, onToggle }: TimelineJobRowProps) {
    const { job, plan } = row;
    const lanePicked = isPicked(pick, job.key, range.from, range.to);
    return (
        <div className={cn("relative grid items-center border-b px-5 py-2 last:border-b-0", lanePicked && "bg-foreground/[0.045]")} style={template}>
            <button
                type="button"
                onClick={() => onToggle({ jobKey: job.key, ...range })}
                aria-pressed={lanePicked}
                className="flex min-w-0 items-center gap-2.5 rounded-md pr-3 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
            >
                <JobTile job={job} size="sm" />
                <span className="min-w-0">
                    <span className="flex min-w-0 items-center gap-2">
                        <span className={cn("truncate text-sm font-medium", job.kind === "deleted" && "text-muted-foreground")}>{job.name}</span>
                        {job.kind === "deleted" && (
                            <span className="shrink-0 rounded-md bg-muted px-1.5 py-0.5 text-[11px] font-medium text-muted-foreground">Job deleted</span>
                        )}
                    </span>
                    <span className="block truncate text-xs text-muted-foreground">{metaOf(job, plan)}</span>
                </span>
            </button>
            {row.cells.map((cell, index) => {
                if (cell) {
                    return (
                        <TimelineCellButton
                            key={cell.day}
                            cell={cell}
                            job={job}
                            destinations={destinations}
                            format={format}
                            at={at}
                            picked={isPicked(pick, job.key, cell.day, cell.day)}
                            onPick={() => onToggle({ jobKey: job.key, from: cell.day, to: cell.day })}
                        />
                    );
                }
                const span = row.spans.find((entry) => entry.start === index);
                return span ? (
                    <TimelineSpanBar key={`span-${index}`} span={span} job={job} retention={plan?.retention ? describeRetention(plan.retention) : null} />
                ) : null;
            })}
        </div>
    );
}
