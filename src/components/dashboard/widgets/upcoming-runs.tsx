"use client";

import { useState } from "react";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { DateDisplay } from "@/components/utils/date-display";
import { cn } from "@/lib/utils";
import type { UpcomingJob, UpcomingRun, UpcomingSchedule } from "@/services/dashboard/types";

const RANGES = [12, 24, 48] as const;
type Range = (typeof RANGES)[number];
const HOUR_MS = 60 * 60 * 1000;
/** Twelve gridline steps whatever the range, so the lines stay evenly spaced. */
const GRID_STEPS = 12;
/** Conflict windows get a label only for the first few, the header counts all of them. */
const LABELED_CONFLICTS = 2;

interface MarkerGroup {
    at: string;
    jobs: UpcomingJob[];
}

/** Runs starting in the same minute share one marker. */
function groupByMinute(runs: UpcomingRun[], jobsById: Map<string, UpcomingJob>): MarkerGroup[] {
    const groups = new Map<string, MarkerGroup>();
    for (const run of runs) {
        const job = jobsById.get(run.jobId);
        if (!job) continue;
        const minute = run.at.slice(0, 16);
        const group = groups.get(minute) ?? { at: run.at, jobs: [] };
        group.jobs.push(job);
        groups.set(minute, group);
    }
    return Array.from(groups.values());
}

function namesList(jobs: UpcomingJob[]): string {
    const names = [...new Set(jobs.map((job) => job.name))];
    return names.length <= 4 ? names.join(", ") : `${names.slice(0, 4).join(", ")} and ${names.length - 4} more`;
}

/** A time, with the weekday in front once the range reaches past tomorrow's early hours. */
function When({ at, withDay }: { at: string; withDay: boolean }) {
    return (
        <>
            {/* "EEE" is a literal pattern on purpose: the weekday only disambiguates, the time keeps the user's format. */}
            {withDay && <><DateDisplay date={at} format="EEE" />{" "}</>}
            <DateDisplay date={at} format="p" />
        </>
    );
}

/**
 * The scheduled runs of the next 12, 24 or 48 hours on one line. Markers in amber fall into a
 * window where more runs want to be active than the queue has slots, red ones belong to a job
 * whose last outcome failed.
 */
export function UpcomingRuns({ schedule, className }: { schedule: UpcomingSchedule; className?: string }) {
    const [range, setRange] = useState<Range>(12);

    const start = Date.parse(schedule.windowStart);
    const span = range * HOUR_MS;
    const end = start + span;
    const withDay = range > 12;

    const jobsById = new Map(schedule.jobs.map((job) => [job.id, job]));
    const runs = schedule.runs.filter((run) => Date.parse(run.at) <= end);
    const conflicts = schedule.conflicts.filter((conflict) => Date.parse(conflict.from) < end);
    const groups = groupByMinute(runs, jobsById);
    const failingJobs = new Set(runs.filter((run) => jobsById.get(run.jobId)?.likelyToFail).map((run) => run.jobId)).size;
    const slotsLabel = `${schedule.slots} slot${schedule.slots === 1 ? "" : "s"}`;

    // Positions follow the run times and the chosen range, the one kind of value here that cannot be a class.
    const position = (iso: string) => Math.min(100, Math.max(0, ((Date.parse(iso) - start) / span) * 100));
    const inConflict = (iso: string) => {
        const time = Date.parse(iso);
        return conflicts.some((conflict) => time >= Date.parse(conflict.from) && time < Date.parse(conflict.to));
    };

    return (
        <div className={cn("min-w-0 rounded-xl border bg-card p-4 text-card-foreground shadow-sm md:p-5", className)}>
            <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
                <div className="flex items-center gap-2">
                    <h2 className="font-semibold">Next {range} hours</h2>
                    <span className="rounded-full border px-2 py-0.5 text-xs text-muted-foreground tabular-nums">
                        {runs.length} run{runs.length === 1 ? "" : "s"} due
                    </span>
                </div>
                <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
                    {conflicts.length > 0 && (
                        <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                            <span className="size-2 rounded-full bg-warning" aria-hidden="true" />
                            {conflicts.length} overlapping, {slotsLabel}
                        </span>
                    )}
                    {failingJobs > 0 && (
                        <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                            <span className="size-2 rounded-full bg-destructive" aria-hidden="true" />
                            {failingJobs} likely to fail again
                        </span>
                    )}
                    <Tabs value={String(range)} onValueChange={(value) => setRange(Number(value) as Range)}>
                        <TabsList className="h-8">
                            {RANGES.map((hours) => (
                                <TabsTrigger key={hours} value={String(hours)} className="px-2.5 text-xs">
                                    {hours}h
                                </TabsTrigger>
                            ))}
                        </TabsList>
                    </Tabs>
                </div>
            </div>

            {runs.length === 0 ? (
                <p className="mt-3 text-sm text-muted-foreground">Nothing is scheduled in the next {range} hours.</p>
            ) : (
                <>
                    <div className="relative mt-3 h-24" aria-hidden="true">
                        {Array.from({ length: GRID_STEPS + 1 }, (_, step) => (
                            <span key={step} className="absolute top-8 bottom-5 w-px bg-border" style={{ left: `${(step / GRID_STEPS) * 100}%` }} />
                        ))}
                        <span className="absolute top-7 bottom-5 left-0 w-0.5 rounded-full bg-foreground" />

                        {conflicts.map((conflict) => (
                            <span
                                key={conflict.from}
                                className="absolute top-8 bottom-5 rounded-sm border border-warning/50 bg-warning/10"
                                style={{
                                    left: `${position(conflict.from)}%`,
                                    width: `max(${position(conflict.to) - position(conflict.from)}%, 4px)`,
                                }}
                            />
                        ))}
                        {conflicts.slice(0, LABELED_CONFLICTS).map((conflict) => (
                            <span
                                key={`label-${conflict.from}`}
                                className="absolute top-0 flex items-center gap-1 rounded-md border border-warning/40 bg-warning/10 px-1.5 py-0.5 text-[11px] whitespace-nowrap text-warning tabular-nums"
                                style={{ left: `min(${position(conflict.from)}%, calc(100% - 15rem))` }}
                            >
                                <When at={conflict.from} withDay={withDay} /> - <DateDisplay date={conflict.to} format="p" />
                                <span className="text-muted-foreground">· {conflict.demand} runs want {slotsLabel}</span>
                            </span>
                        ))}

                        {groups.map((group) => {
                            const failing = group.jobs.some((job) => job.likelyToFail);
                            const color = failing ? "bg-destructive" : inConflict(group.at) ? "bg-warning" : "bg-foreground/60";
                            const height = group.jobs.length >= 3 ? "h-10" : group.jobs.length === 2 ? "h-8" : "h-6";
                            return (
                                <Tooltip key={group.at}>
                                    <TooltipTrigger asChild>
                                        <span
                                            className={cn("absolute bottom-5 w-[3px] -translate-x-1/2 rounded-full", color, height)}
                                            style={{ left: `${position(group.at)}%` }}
                                        />
                                    </TooltipTrigger>
                                    <TooltipContent side="top">
                                        <span className="block font-medium">
                                            <When at={group.at} withDay={withDay} />: {namesList(group.jobs)}
                                        </span>
                                        {failing && <span className="mt-0.5 block text-destructive">Its last run failed.</span>}
                                    </TooltipContent>
                                </Tooltip>
                            );
                        })}

                        {[0, 1, 2, 3].map((quarter) => {
                            const hours = (range / 4) * quarter;
                            return (
                                <span
                                    key={quarter}
                                    className="absolute bottom-0 text-[11px] text-muted-foreground"
                                    style={{ left: `${quarter * 25}%` }}
                                >
                                    {hours === 0 ? "now" : `+${hours}h`}
                                </span>
                            );
                        })}
                    </div>

                    <ul className="sr-only">
                        {runs.slice(0, 20).map((run) => {
                            const job = jobsById.get(run.jobId);
                            return (
                                <li key={`${run.jobId}-${run.at}`}>
                                    {job?.name} at <When at={run.at} withDay={withDay} />
                                    {job?.likelyToFail && ", its last run failed"}
                                </li>
                            );
                        })}
                    </ul>
                </>
            )}
        </div>
    );
}
