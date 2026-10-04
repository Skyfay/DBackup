"use client";

import { useMemo, useState } from "react";
import { ChevronDown, ChevronRight, Hourglass, Loader2, Repeat, TriangleAlert } from "lucide-react";
import { ExecutionStatusBadge } from "@/components/dashboard/widgets/execution-status";
import { RelativeTime } from "@/components/dashboard/widgets/relative-time";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { stageLabel } from "@/lib/core/logs";
import { cn } from "@/lib/utils";
import type { JobListItem } from "@/services/jobs/job-list-service";
import { FlowCell, ScheduleText, SourceIcon, sourceOf } from "../job-cells";
import { agendaOf, DAY_MS, horizonOf, ZOOMS, type AgendaRow, type TimelineZoom } from "./job-timeline-model";
import { aboutLength, useTimelineClock, type TimelineClock } from "./timeline-clock";
import { ZoomTabs } from "./timeline-controls";
import type { JobTimelineState } from "./use-job-timeline";

const ROW = "grid grid-cols-[5rem_minmax(0,1.4fr)_minmax(0,1.2fr)_6.5rem_minmax(0,1.3fr)_8.5rem] items-center gap-4 px-5";
const CHIP = "inline-flex h-5 items-center gap-1 rounded-md px-1.5 text-[11px] font-medium [&_svg]:size-3";

function JobLabel({ job }: { job: JobListItem }) {
    return (
        <span className="flex min-w-0 items-center gap-2.5">
            <span className="flex size-8 shrink-0 items-center justify-center rounded-lg border bg-muted/50" aria-hidden="true">
                <SourceIcon adapterId={sourceOf(job).adapterId} className="size-4" />
            </span>
            <span className="min-w-0">
                <span className="block truncate text-sm font-medium">{job.name}</span>
                <ScheduleText job={job} className="block" />
            </span>
        </span>
    );
}

/** The state of a run to come, with one line on why it waits, how far it got or what went wrong last. */
function RowState({ row, job, now, names }: { row: AgendaRow; job: JobListItem; now: number; names: Map<string, string> }) {
    const waits = row.waitsFor.map((id) => names.get(id) ?? "another job").join(", ");
    if (row.kind === "running") {
        const run = row.run;
        return (
            <span className="grid min-w-0 gap-1">
                <span className={cn(CHIP, "w-fit bg-info/10 text-info")}><Loader2 className="animate-spin" />Running</span>
                <span className="truncate text-xs text-muted-foreground">
                    {[run?.stage ? stageLabel(run.stage) : null, run?.progress != null ? `${run.progress}%` : null, `about ${aboutLength(Math.max(row.end - now, 1000))} left`].filter(Boolean).join(" · ")}
                </span>
            </span>
        );
    }
    if (row.kind === "pending") {
        return (
            <span className="grid min-w-0 gap-1">
                <span className={cn(CHIP, "w-fit bg-warning/10 text-warning")}><Hourglass />Waits</span>
                <span className="truncate text-xs text-muted-foreground">{waits ? `${waits} ${row.waitsFor.length === 1 ? "holds" : "hold"} the queue` : "The queue is full"}</span>
            </span>
        );
    }
    const waiting = row.start > row.due;
    return (
        <span className="grid min-w-0 gap-1">
            {row.kind === "likely"
                ? <span className={cn(CHIP, "w-fit bg-destructive/10 text-destructive-text")}><TriangleAlert />Last run failed</span>
                : <span className={cn(CHIP, "w-fit bg-muted text-muted-foreground")}>Planned</span>}
            {(waiting || (row.kind === "likely" && job.overview.error)) && (
                <span className={cn("truncate text-xs", waiting ? "text-warning" : "text-muted-foreground")} title={waiting ? undefined : job.overview.error ?? undefined}>
                    {waiting ? `Waits about ${aboutLength(row.start - row.due)} for ${waits || "a slot"}` : job.overview.error}
                </span>
            )}
        </span>
    );
}

function dayName(day: number, now: number, clock: TimelineClock): string {
    const today = clock.dayStart(now);
    if (day === today) return "Today";
    if (clock.dayStart(today + DAY_MS + 2 * 60 * 60 * 1000) === day) return "Tomorrow";
    return clock.longDay(day);
}

interface JobsUpcomingProps {
    jobs: JobListItem[];
    allJobs: JobListItem[];
    timeline: JobTimelineState;
    onOpenJob: (job: JobListItem) => void;
}

/**
 * The Upcoming view of the Jobs page: what runs and waits now, then every run the schedules plan
 * by day and time with its usual length and whether it will wait in the queue. A job that runs more
 * often than every two hours is one line on top, the runs of the last 6 hours fold into one line.
 */
export function JobsUpcoming({ jobs, allJobs, timeline, onOpenJob }: JobsUpcomingProps) {
    const clock = useTimelineClock();
    const [zoom, setZoom] = useState<TimelineZoom>("day");
    const [earlierOpen, setEarlierOpen] = useState(false);
    const { data, error, reload } = timeline;
    const horizon = horizonOf(zoom);
    const span = ZOOMS.find((entry) => entry.value === zoom)?.span ?? "24 hours";
    const byId = useMemo(() => new Map(allJobs.map((job) => [job.id, job])), [allJobs]);
    const names = useMemo(() => new Map(allJobs.map((job) => [job.id, job.name])), [allJobs]);
    const agenda = useMemo(() => (data ? agendaOf(data, jobs.map((job) => job.id), horizon, clock.dayStart) : null), [data, jobs, horizon, clock]);
    const now = data ? Date.parse(data.now) : 0;

    const row = (entry: AgendaRow) => {
        const job = byId.get(entry.jobId);
        if (!job) return null;
        return (
            <button key={entry.key} type="button" onClick={() => onOpenJob(job)} className={cn(ROW, "w-full border-b py-2.5 text-left outline-none hover:bg-muted/50 focus-visible:bg-muted/50")}>
                <span className="text-sm font-semibold tabular-nums">{clock.time(entry.due)}</span>
                <JobLabel job={job} />
                <FlowCell job={job} />
                <span className="text-sm tabular-nums">about {aboutLength(entry.end - entry.start)}</span>
                <RowState row={entry} job={job} now={now} names={names} />
                <span className="text-right text-sm text-muted-foreground tabular-nums">
                    {entry.kind === "running" ? `until about ${clock.time(entry.end)}` : entry.kind === "pending" ? `starts about ${clock.time(entry.start)}` : <RelativeTime date={new Date(entry.due).toISOString()} />}
                </span>
            </button>
        );
    };
    const heading = (title: string, note?: string) => (
        <div className="flex items-baseline gap-2 border-b bg-page/60 px-5 pt-3 pb-1.5">
            <span className="text-xs font-semibold tracking-wide uppercase">{title}</span>
            {note && <span className="text-xs text-muted-foreground">{note}</span>}
        </div>
    );

    const failed = agenda?.earlier.filter((run) => run.status === "Failed").length ?? 0;
    const partial = agenda?.earlier.filter((run) => run.status === "Partial").length ?? 0;
    const quiet = (agenda?.quiet ?? []).map((id) => byId.get(id)).filter((job): job is JobListItem => job !== undefined);
    const paused = quiet.filter((job) => !job.enabled);
    const later = quiet.filter((job) => job.enabled);

    return (
        <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-3 px-5 pt-4 pb-3">
                <div className="min-w-0">
                    <p className="font-semibold">Upcoming</p>
                    <p className="truncate text-sm text-muted-foreground">
                        {data ? `Every run the schedules plan until ${clock.dayAndTime(now + horizon)}, with how long it usually takes` : "Every run the schedules plan"}
                    </p>
                </div>
                <div className="ml-auto"><ZoomTabs value={zoom} onChange={setZoom} /></div>
            </div>

            {!agenda ? (
                error ? (
                    <p className="border-t px-5 py-10 text-center text-sm text-muted-foreground">
                        {error}{" "}
                        <Button variant="link" className="h-auto p-0" onClick={reload}>Try again</Button>
                    </p>
                ) : (
                    <div className="px-5 pb-4"><Skeleton className="h-48 w-full" /></div>
                )
            ) : jobs.length === 0 ? (
                <p className="border-t px-5 py-10 text-center text-sm text-muted-foreground">No jobs with these filters.</p>
            ) : (
                <div className="border-t">
                    {agenda.earlier.length > 0 && (
                        <>
                            <button type="button" onClick={() => setEarlierOpen((open) => !open)} aria-expanded={earlierOpen} className="flex w-full flex-wrap items-center gap-2 border-b px-5 py-2.5 text-left text-sm outline-none hover:bg-muted/50 focus-visible:bg-muted/50">
                                {earlierOpen ? <ChevronDown className="size-4 text-muted-foreground" /> : <ChevronRight className="size-4 text-muted-foreground" />}
                                <span className="font-medium">Earlier</span>
                                <span className="text-muted-foreground">{agenda.earlier.length === 1 ? "1 run" : `${agenda.earlier.length} runs`} in the last 6 hours</span>
                                {failed > 0 && <span className={cn(CHIP, "bg-destructive/10 text-destructive-text")}>{failed} failed</span>}
                                {partial > 0 && <span className={cn(CHIP, "bg-warning/10 text-warning")}>{partial} partial</span>}
                            </button>
                            {earlierOpen && agenda.earlier.map((run) => {
                                const job = byId.get(run.jobId);
                                if (!job) return null;
                                const took = run.endedAt ? Date.parse(run.endedAt) - Date.parse(run.startedAt) : null;
                                return (
                                    <div key={run.id} className={cn(ROW, "border-b bg-page/30 py-2")}>
                                        <span className="text-sm tabular-nums text-muted-foreground">{clock.time(Date.parse(run.startedAt))}</span>
                                        <JobLabel job={job} />
                                        <span />
                                        <span className="text-sm tabular-nums text-muted-foreground">{took !== null ? `took ${aboutLength(took)}` : ""}</span>
                                        <ExecutionStatusBadge status={run.status} still />
                                        <span />
                                    </div>
                                );
                            })}
                        </>
                    )}
                    {agenda.frequent.map((entry) => {
                        const job = byId.get(entry.jobId);
                        if (!job) return null;
                        return (
                            <button key={entry.jobId} type="button" onClick={() => onOpenJob(job)} className={cn("flex w-full flex-wrap items-center gap-2 border-b px-5 py-2.5 text-left text-sm outline-none hover:bg-muted/50 focus-visible:bg-muted/50", entry.waits > 0 && "bg-warning/5")}>
                                <Repeat className="size-4 text-muted-foreground" aria-hidden="true" />
                                <span className="font-medium">{job.name}</span>
                                <span className="text-muted-foreground">
                                    runs {entry.runs} times in the next {span}, about {aboutLength(data?.estimates[job.id] ?? 0)} each
                                    {entry.waits > 0 && `. It waits ${entry.waits === 1 ? "once" : `${entry.waits} times`}, when another job starts with it.`}
                                </span>
                            </button>
                        );
                    })}
                    {agenda.now.length > 0 && (
                        <>
                            {heading("Now", clock.dayAndTime(now))}
                            {agenda.now.map(row)}
                        </>
                    )}
                    {agenda.days.map((day) => (
                        <div key={day.day}>
                            {heading(dayName(day.day, now, clock))}
                            {day.rows.map(row)}
                        </div>
                    ))}
                    {agenda.now.length === 0 && agenda.days.length === 0 && (
                        <p className="border-b px-5 py-8 text-center text-sm text-muted-foreground">Nothing is planned in the next {span}.</p>
                    )}
                    {(later.length > 0 || paused.length > 0) && (
                        <div className="space-y-1 px-5 py-3 text-xs text-muted-foreground">
                            {later.length > 0 && (
                                <p>
                                    Not in the next {span}:{" "}
                                    {later.map((job) => `${job.name}${job.overview.nextRunAt ? ` (${clock.dayAndTime(Date.parse(job.overview.nextRunAt))})` : ""}`).join(", ")}
                                </p>
                            )}
                            {paused.length > 0 && <p>Paused: {paused.map((job) => job.name).join(", ")}</p>}
                        </div>
                    )}
                </div>
            )}
        </div>
    );
}
