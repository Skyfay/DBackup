"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { CirclePause, Layers } from "lucide-react";
import { runHref } from "@/components/dashboard/history/run-links";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Tooltip, TooltipContent, TooltipHead, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import type { JobListItem } from "@/services/jobs/job-list-service";
import { ScheduleText, SourceIcon, sourceOf } from "../job-cells";
import { barsOf, demandOf, HOUR_MS, packBars, rangeOf, type TimelineBar, type TimelineZoom } from "./job-timeline-model";
import { percentOf, TimelineBarGroup, TimelineLegend } from "./timeline-bars";
import { useTimelineClock } from "./timeline-clock";
import { RangeNav, useWidth, ZoomTabs } from "./timeline-controls";
import type { JobTimelineState } from "./use-job-timeline";

/** The columns of every row: the job, then its track of time. */
const ROW = "grid grid-cols-[15rem_minmax(0,1fr)] px-5";
/** Hours between two labels of the axis, the first that leaves room for them. */
const STEPS = [1, 2, 3, 4, 6, 12, 24];
/** The runs whose page a click opens: the ones that ran or run now. */
const OPENS_RUN = new Set(["success", "failed", "partial", "cancelled", "running"]);

interface JobsTimelineProps {
    /** The jobs the search and the filters leave, in their order. */
    jobs: JobListItem[];
    /** Every job, for the names of the ones a run waits for. */
    allJobs: JobListItem[];
    timeline: JobTimelineState;
    canViewHistory: boolean;
    onOpenJob: (job: JobListItem) => void;
}

/**
 * The Timeline view of the Jobs page: a row per job over the hours, the last 6 and the next 24 or
 * whole days. What ran shows its outcome and length, what is planned its usual length dashed, and
 * where the queue makes a run wait the wait is hatched amber. Every job on top marks each moment
 * more runs want a slot than the queue has. A run that ran opens its page, any other the job.
 */
export function JobsTimeline({ jobs, allJobs, timeline, canViewHistory, onOpenJob }: JobsTimelineProps) {
    const router = useRouter();
    const clock = useTimelineClock();
    const [zoom, setZoom] = useState<TimelineZoom>("day");
    const [offset, setOffset] = useState(0);
    const { ref, width } = useWidth<HTMLDivElement>();
    const { data, error, reload } = timeline;
    const now = data ? Date.parse(data.now) : 0;
    const range = useMemo(() => rangeOf(zoom, offset, now, clock.dayStart), [zoom, offset, now, clock]);
    const names = useMemo(() => new Map(allJobs.map((job) => [job.id, job.name])), [allJobs]);
    const rows = useMemo(() => (data ? jobs.map((job) => ({ job, bars: barsOf(job.id, data, range) })) : []), [data, jobs, range]);
    const segments = useMemo(() => demandOf(rows.flatMap((row) => row.bars), range), [rows, range]);

    const hours = (range.to - range.from) / HOUR_MS;
    const perHour = width > 0 ? width / hours : 0;
    const step = STEPS.find((entry) => entry * perHour >= (clock.twelve ? 44 : 26)) ?? 24;
    const ticks = useMemo(() => {
        const list: number[] = [];
        for (let time = clock.hourStart(range.from); time <= range.to; time += HOUR_MS) if (time >= range.from) list.push(time);
        return list;
    }, [clock, range]);
    const nowIn = now >= range.from && now <= range.to;
    const span = range.to - range.from;
    const shift = (by: number) => (data ? rangeOf(zoom, offset + by, now, clock.dayStart) : range);

    const openBar = (job: JobListItem, bar: TimelineBar) => {
        if (bar.run && OPENS_RUN.has(bar.kind) && canViewHistory) router.push(runHref(bar.run.id, "jobs"));
        else onOpenJob(job);
    };

    const sub = zoom === "day" && offset === 0
        ? "The last 6 hours and the next 24, with how long each run takes"
        : `${zoom === "day" ? clock.dayAndTime(range.from) : clock.day(range.from)} to ${zoom === "day" ? clock.dayAndTime(range.to) : clock.day(range.to - 1)}`;

    return (
        <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-3 px-5 pt-4 pb-3">
                <div className="min-w-0">
                    <p className="font-semibold">Timeline</p>
                    <p className="truncate text-sm text-muted-foreground">{sub}</p>
                </div>
                <div className="ml-auto flex flex-wrap items-center gap-2">
                    <ZoomTabs value={zoom} onChange={(next) => { setZoom(next); setOffset(0); }} />
                    <RangeNav
                        canBack={data !== null && shift(-1).to > Date.parse(data.from)}
                        canForward={data !== null && shift(1).from < Date.parse(data.to)}
                        atNow={offset === 0}
                        onBack={() => setOffset((current) => current - 1)}
                        onNow={() => setOffset(0)}
                        onForward={() => setOffset((current) => current + 1)}
                    />
                </div>
            </div>

            {!data ? (
                error ? (
                    <p className="border-t px-5 py-10 text-center text-sm text-muted-foreground">
                        {error}{" "}
                        <Button variant="link" className="h-auto p-0" onClick={reload}>Try again</Button>
                    </p>
                ) : (
                    <div className="px-5 pb-4"><Skeleton className="h-48 w-full" /></div>
                )
            ) : rows.length === 0 ? (
                <p className="border-t px-5 py-10 text-center text-sm text-muted-foreground">No jobs with these filters.</p>
            ) : (
                <div className="relative">
                    {/* The hour lines, the past a shade darker and the line of now, behind every row. */}
                    <div aria-hidden="true" className={cn(ROW, "pointer-events-none absolute inset-0")}>
                        <span />
                        <div className="relative">
                            {now > range.from && <span className="absolute inset-y-0 left-0 bg-foreground/[0.035]" style={{ width: `${Math.min(percentOf(now, range), 100)}%` }} />}
                            {ticks.filter((time) => perHour >= 6 || clock.hourOfDay(time) % step === 0).map((time) => (
                                <span key={time} className={cn("absolute inset-y-0 w-px", clock.isMidnight(time) ? "bg-foreground/20" : "bg-foreground/[0.06]")} style={{ left: `${percentOf(time, range)}%` }} />
                            ))}
                            {nowIn && <span className="absolute inset-y-0 w-0.5 -translate-x-1/2 bg-foreground/70" style={{ left: `${percentOf(now, range)}%` }} />}
                        </div>
                    </div>

                    <div className={cn(ROW, "relative border-b")}>
                        <span />
                        <div ref={ref} className="relative h-11">
                            {ticks.filter((time) => clock.hourOfDay(time) % step === 0).map((time) => (
                                <span key={time} className={cn("absolute top-5 -translate-x-1/2 text-[11px] tabular-nums", clock.isMidnight(time) ? "font-semibold text-foreground" : "text-muted-foreground")} style={{ left: `${percentOf(time, range)}%` }}>
                                    {clock.hour(time)}
                                </span>
                            ))}
                            {[range.from, ...ticks.filter((time) => clock.isMidnight(time) && time > range.from && time < range.to)].map((time) => (
                                <span key={`day-${time}`} className="absolute top-1 text-[11px] font-semibold whitespace-nowrap" style={{ left: `${percentOf(time, range)}%` }}>
                                    {clock.day(time)}
                                </span>
                            ))}
                            {nowIn && (
                                <span className="absolute top-4.5 -translate-x-1/2 rounded-md bg-foreground px-1.5 text-[11px] font-semibold text-background tabular-nums" style={{ left: `${percentOf(now, range)}%` }}>
                                    {clock.time(now)}
                                </span>
                            )}
                        </div>
                    </div>

                    <div className={cn(ROW, "relative items-center border-b py-1.5")}>
                        <div className="flex min-w-0 items-center gap-2.5 pr-3">
                            <span className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-muted" aria-hidden="true">
                                <Layers className="size-4 text-muted-foreground" />
                            </span>
                            <div className="min-w-0">
                                <p className="truncate text-sm font-semibold">Every job</p>
                                <p className="truncate text-xs text-muted-foreground">{data.slots === 1 ? "1 run" : `${data.slots} runs`} at a time, amber waits</p>
                            </div>
                        </div>
                        <div className="relative h-10">
                            {segments.map((segment) => {
                                const over = segment.count > data.slots;
                                const style = { left: `${percentOf(segment.from, range)}%`, width: `${((segment.to - segment.from) / span) * 100}%` };
                                if (!over) return <span key={segment.from} className="absolute bottom-1.5 h-2.5 min-w-[2px] rounded-[2px] bg-foreground/35" style={style} />;
                                return (
                                    <Tooltip key={segment.from}>
                                        <TooltipTrigger asChild>
                                            <span tabIndex={0} className="absolute bottom-1.5 h-6 min-w-[2px] rounded-[2px] bg-warning outline-none focus-visible:ring-2 focus-visible:ring-ring/50" style={style} />
                                        </TooltipTrigger>
                                        <TooltipContent className="max-w-xs">
                                            <TooltipHead tone="warning">Runs wait</TooltipHead>
                                            <p className="text-muted-foreground">
                                                From {clock.time(segment.from)} to {clock.time(segment.to)}, {segment.count} runs want {data.slots === 1 ? "the one slot" : `${data.slots} slots`} of the queue.
                                            </p>
                                        </TooltipContent>
                                    </Tooltip>
                                );
                            })}
                        </div>
                    </div>

                    {rows.map(({ job, bars }) => {
                        const paused = !job.enabled;
                        const next = job.overview.nextRunAt ? Date.parse(job.overview.nextRunAt) : null;
                        const later = !paused && next !== null && next >= range.to && !bars.some((bar) => bar.planned);
                        return (
                            <div key={job.id} className={cn(ROW, "relative items-center border-b py-2 last:border-b-0")}>
                                <button
                                    type="button"
                                    onClick={() => onOpenJob(job)}
                                    className="flex min-w-0 items-center gap-2.5 rounded-md pr-3 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
                                >
                                    <span className="flex size-7 shrink-0 items-center justify-center rounded-lg border bg-muted/50" aria-hidden="true">
                                        <SourceIcon adapterId={sourceOf(job).adapterId} className="size-4" />
                                    </span>
                                    <span className="min-w-0">
                                        <span className={cn("block truncate text-sm font-medium", paused && "text-muted-foreground")}>{job.name}</span>
                                        <ScheduleText job={job} className="block" />
                                    </span>
                                </button>
                                <div className="relative h-7">
                                    {paused && now < range.to && (
                                        <span
                                            className="absolute inset-y-1 right-0 flex items-center justify-center gap-1.5 overflow-hidden rounded-md border border-dashed border-input bg-[repeating-linear-gradient(135deg,var(--color-muted)_0_6px,transparent_6px_12px)] text-xs whitespace-nowrap text-muted-foreground"
                                            style={{ left: `${Math.max(percentOf(now, range), 0)}%` }}
                                        >
                                            <CirclePause className="size-3.5 shrink-0" aria-hidden="true" />
                                            Paused
                                        </span>
                                    )}
                                    {packBars(bars, (span / Math.max(width, 400)) * 3).map((group) => (
                                        <TimelineBarGroup
                                            key={group.bars[0].key}
                                            group={group}
                                            jobName={job.name}
                                            range={range}
                                            now={now}
                                            clock={clock}
                                            names={names}
                                            estimate={data.estimates[job.id] ?? 0}
                                            opensRuns={canViewHistory}
                                            onOpen={(bar) => openBar(job, bar)}
                                        />
                                    ))}
                                    {later && next !== null && (
                                        <span className="absolute top-1/2 right-0 -translate-y-1/2 rounded-md bg-muted px-2 py-0.5 text-xs whitespace-nowrap text-muted-foreground">
                                            Next run {clock.dayAndTime(next)}
                                        </span>
                                    )}
                                </div>
                            </div>
                        );
                    })}
                </div>
            )}

            <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 border-t bg-page/60 px-5 py-2.5 text-xs text-muted-foreground">
                <TimelineLegend />
                <span className="ml-auto">Planned runs take as long as their last runs did</span>
            </div>
        </div>
    );
}
