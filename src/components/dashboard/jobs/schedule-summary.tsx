"use client";

import { Fragment } from "react";
import { CalendarClock, TriangleAlert } from "lucide-react";
import { formatInTimeZone } from "date-fns-tz";
import { DateDisplay } from "@/components/utils/date-display";
import type { ScheduleClash } from "@/lib/core/schedule-conflicts";

// Literal patterns on purpose: the times are the scheduler's and 24 hours, like the times the
// picker takes, and the strip has room for a short date only.
const DAY = "EEE d MMM";
const TIME = "HH:mm";

interface ScheduleSummaryProps {
    words: string | null;
    timezone: string | null;
    nextRuns: Date[];
    /** Every run starts at the same time of day, so the time is said once. */
    oneTime: boolean;
}

/** The schedule in words, the time zone its times are in and its next runs. */
export function ScheduleSummary({ words, timezone, nextRuns, oneTime }: ScheduleSummaryProps) {
    const dayOf = (date: Date) => (timezone ? formatInTimeZone(date, timezone, "yyyy-MM-dd") : "");
    return (
        <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1 border-t bg-muted/30 px-3 py-2.5 text-xs sm:px-4">
            <CalendarClock className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
            <span className="font-medium text-foreground">{words ?? "Does not run"}</span>
            {timezone && <span className="text-muted-foreground">{timezone}</span>}
            {timezone && nextRuns.length > 0 && (
                <span className="text-muted-foreground tabular-nums sm:ml-auto">
                    Next{" "}
                    {nextRuns.map((run, index) => {
                        const sameDay = index > 0 && dayOf(run) === dayOf(nextRuns[index - 1]);
                        const format = index === 0 ? `${DAY}, ${TIME}` : sameDay ? TIME : oneTime ? DAY : `${DAY}, ${TIME}`;
                        return (
                            <Fragment key={run.toISOString()}>
                                {index > 0 && " · "}
                                <DateDisplay date={run} timezone={timezone} format={format} />
                            </Fragment>
                        );
                    })}
                </span>
            )}
        </div>
    );
}

function names(list: string[]): string {
    if (list.length <= 2) return list.join(" and ");
    return `${list.slice(0, 2).join(", ")} and ${list.length - 2} more`;
}

function about(ms: number): string {
    const minutes = Math.max(1, Math.round(ms / 60_000));
    if (minutes < 60) return `${minutes} min`;
    const hours = Math.floor(minutes / 60);
    const rest = minutes % 60;
    return rest === 0 ? `${hours} h` : `${hours} h ${rest} min`;
}

interface ClashNoteProps {
    clash: ScheduleClash;
    slots: number;
    timezone: string;
    /** How many jobs start on this schedule together, all that follow a preset. */
    together: number;
    /** A job's own schedule, or a preset's. */
    subject: "job" | "preset";
    action?: React.ReactNode;
}

/**
 * A small amber note when runs on this schedule would wait for a free slot. The queue runs one
 * job after the other, so the run waits until the jobs ahead of it are done. It never shows while
 * the slots are enough.
 */
export function ClashNote({ clash, slots, timezone, together, subject, action }: ClashNoteProps) {
    const at = <DateDisplay date={clash.at} timezone={timezone} format={TIME} />;
    const when = clash.everyRun ? <>at {at}</> : <>on <DateDisplay date={clash.at} timezone={timezone} format={DAY} /> at {at}</>;
    const room = slots === 1 ? "only one job runs at a time" : `only ${slots} jobs run at a time`;
    const who = together > 1 ? "the jobs of this preset wait up to" : subject === "preset" ? "a job on this preset waits" : "this job waits";

    return (
        <div role="status" className="mx-3 mb-3 flex flex-wrap items-center gap-x-2.5 gap-y-2 rounded-lg border border-warning/40 bg-warning/10 px-3 py-2 text-xs sm:mx-4">
            <TriangleAlert className="size-4 shrink-0 text-warning" aria-hidden="true" />
            <span className="min-w-0 flex-1">
                {clash.others.length > 0 ? (
                    <>
                        {names(clash.others)} also {clash.others.length === 1 ? "runs" : "run"} {when}, and {room}, so {who} about {about(clash.waitMs)} for{" "}
                        {clash.others.length === 1 ? "it" : "them"}.
                    </>
                ) : (
                    <>
                        The {together} jobs of this preset start together {when}, and {room}, so they run one after another.
                    </>
                )}
            </span>
            {action}
        </div>
    );
}
