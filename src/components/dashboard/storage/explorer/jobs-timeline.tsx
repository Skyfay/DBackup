"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Layers } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import type { BackupRun, ExplorerDestination, ExplorerJob, ExplorerPlan } from "@/services/storage/explorer-types";
import { failedCheck } from "./backup-filters";
import { TimelineLegend, TimelineTotal, useTimelineFormat } from "./timeline-cells";
import { buildRow, daysEnding, isPicked, partsOf, shiftDay, totalsOf, type DayKey, type TimelinePick } from "./timeline-model";
import { AHEAD, TimelineNav, toDate } from "./timeline-nav";
import { TimelineJobRow } from "./timeline-row";
const LABEL_W = 240;
const MIN_COL = 40;
const GAP = 4;
/** The padding of the rows on both sides. */
const PAD = 40;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const WEEKDAYS = ["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"];

/** As many day columns as the width has room for, measured whenever it changes. Zero until it is measured. */
function useColumns() {
    const ref = useRef<HTMLDivElement>(null);
    const [cols, setCols] = useState(0);
    useEffect(() => {
        const element = ref.current;
        if (!element) return;
        // The observer reports the size once it starts, so the first count needs no call of its own.
        const observer = new ResizeObserver(([entry]) => {
            const room = entry.contentRect.width - PAD - LABEL_W;
            setCols(Math.max(7, Math.min(62, Math.floor((room + GAP) / (MIN_COL + GAP)))));
        });
        observer.observe(element);
        return () => observer.disconnect();
    }, []);
    return { ref, cols };
}

interface JobsTimelineProps {
    /** The backups the filters leave. */
    runs: BackupRun[];
    /** The jobs to show a row for, in their order. */
    jobs: ExplorerJob[];
    /** What the schedules plan and missed, null while it loads. */
    plan: ExplorerPlan | null;
    destinations: Map<string, ExplorerDestination>;
    at: string[];
    pick: TimelinePick | null;
    onPick: (pick: TimelinePick | null) => void;
}

/**
 * The third view of the Backups tab: a row per job and a column per day, as many days as fit.
 * The arrows page through the days, the date button jumps to one, and at today the arrow to the
 * right adds the next days with the runs the schedules plan, while today stays in view. A day of a
 * job, a date or a job picks what the list below shows.
 */
export function JobsTimeline({ runs, jobs, plan, destinations, at, pick, onPick }: JobsTimelineProps) {
    const format = useTimelineFormat();
    const { ref, cols } = useColumns();
    const [end, setEnd] = useState<DayKey | null>(null);
    const [ahead, setAhead] = useState(false);

    const today = format.dayOf(new Date().toISOString());
    const last = ahead ? shiftDay(today, AHEAD) : end && end < today ? end : today;
    const days = useMemo(() => daysEnding(last, Math.max(cols, 1)), [last, cols]);
    const plans = useMemo(() => new Map((plan?.jobs ?? []).map((entry) => [entry.jobKey, entry])), [plan]);

    const rows = useMemo(() => {
        const byJob = new Map<string, BackupRun[]>();
        for (const run of runs) {
            const list = byJob.get(run.jobKey);
            if (list) list.push(run);
            else byJob.set(run.jobKey, [run]);
        }
        return jobs.map((job) => buildRow({ job, plan: plans.get(job.key), runs: byJob.get(job.key) ?? [], days, today, at, dayOf: format.dayOf }));
    }, [runs, jobs, plans, days, today, at, format]);
    const totals = useMemo(() => totalsOf(rows, days, today), [rows, days, today]);
    const peak = Math.max(...totals.map((total) => total.count), 1);

    // The days the calendar marks: a failed check or a run that did not start.
    const problems = useMemo(() => {
        const shown = new Set(jobs.map((job) => job.key));
        const marked = new Set<DayKey>();
        for (const run of runs) if (failedCheck(run, at)) marked.add(format.dayOf(run.createdAt));
        for (const entry of plan?.jobs ?? []) {
            if (shown.has(entry.jobKey)) for (const missed of entry.missed) marked.add(format.dayOf(missed.at));
        }
        return [...marked].map(toDate);
    }, [runs, jobs, plan, at, format]);

    const toToday = () => {
        setEnd(null);
        setAhead(false);
    };
    const back = () => {
        if (ahead) return toToday();
        setEnd(shiftDay(last, -cols));
    };
    const forward = () => {
        if (ahead) return;
        if (last < today) {
            const next = shiftDay(last, cols);
            setEnd(next >= today ? null : next);
        } else {
            setAhead(true);
        }
    };
    const jump = (day: DayKey) => {
        // The day lands in the middle of the view, and its backups show below.
        setAhead(false);
        const next = shiftDay(day, Math.floor(cols / 2));
        setEnd(next >= today ? null : next);
        onPick({ from: day, to: day });
    };
    const toggle = (next: TimelinePick) => onPick(isPicked(pick, next.jobKey, next.from, next.to) ? null : next);

    const template = { gridTemplateColumns: `${LABEL_W}px repeat(${Math.max(cols, 1)}, minmax(0, 1fr))`, columnGap: GAP };
    const firstAhead = days.findIndex((day) => day > today);
    const sub = ahead
        ? `The last ${cols - AHEAD} days and the next ${AHEAD}, as the schedules plan them`
        : last === today
            ? `${format.short(days[0])} to today · a day lists its backups below`
            : `${format.short(days[0])} to ${format.short(last)} · a day lists its backups below`;
    const pickedDay = pick && !pick.jobKey && pick.from === pick.to ? pick.from : null;

    return (
        <div ref={ref} className="min-w-0">
            <div className="flex flex-wrap items-center gap-3 px-5 pt-4 pb-3">
                <div className="min-w-0">
                    <p className="font-semibold">Timeline</p>
                    <p className="truncate text-sm text-muted-foreground">{cols > 0 ? sub : " "}</p>
                </div>
                <TimelineNav
                    days={days}
                    today={today}
                    last={last}
                    ahead={ahead}
                    ready={cols > 0}
                    pickedDay={pickedDay}
                    problems={problems}
                    onToday={toToday}
                    onBack={back}
                    onForward={forward}
                    onJump={jump}
                />
            </div>

            {cols === 0 ? (
                <div className="px-5 pb-4"><Skeleton className="h-48 w-full" /></div>
            ) : rows.length === 0 ? (
                <p className="border-t px-5 py-10 text-center text-sm text-muted-foreground">No backups with these filters.</p>
            ) : (
                <div className="relative">
                    {/* Today, the next days behind a line and a picked day, as bands behind the rows. */}
                    <div aria-hidden="true" className="pointer-events-none absolute inset-0 grid px-5" style={template}>
                        <span />
                        {days.map((day, index) => (
                            <span
                                key={day}
                                className={cn(
                                    day === today && "bg-foreground/5",
                                    day > today && "bg-foreground/[0.035]",
                                    index === firstAhead && "border-l border-foreground/35",
                                    day === pickedDay && "bg-foreground/10"
                                )}
                            />
                        ))}
                    </div>

                    {firstAhead >= 0 && (
                        <div className="relative grid px-5 pt-1" style={template}>
                            <span
                                className="text-center text-[11px] font-semibold tracking-wide text-muted-foreground uppercase"
                                style={{ gridColumn: `${firstAhead + 2} / -1` }}
                            >
                                Next {AHEAD} days, as the schedules plan them
                            </span>
                        </div>
                    )}

                    <div className="relative grid border-b px-5 pb-1.5" style={template}>
                        <span />
                        {days.map((day, index) => {
                            const { weekday, date, month } = partsOf(day);
                            const top = index === 0 || date === 1 ? MONTHS[month] : WEEKDAYS[weekday];
                            const isToday = day === today;
                            const future = day > today;
                            return (
                                <button
                                    key={day}
                                    type="button"
                                    onClick={future ? undefined : () => toggle({ from: day, to: day })}
                                    aria-disabled={future}
                                    aria-pressed={future ? undefined : day === pickedDay}
                                    aria-label={format.date(day)}
                                    className={cn(
                                        "flex h-10 min-w-0 flex-col items-center justify-end rounded-md pb-0.5 text-[11.5px] outline-none tabular-nums focus-visible:ring-2 focus-visible:ring-ring/50",
                                        future ? "cursor-default text-muted-foreground/70" : "cursor-pointer text-muted-foreground hover:text-foreground",
                                        isToday && "font-semibold text-foreground",
                                        day === pickedDay && "bg-foreground text-background hover:text-background"
                                    )}
                                >
                                    <span className="text-[10px] opacity-75">{top}</span>
                                    {isToday ? "Today" : date}
                                </button>
                            );
                        })}
                    </div>

                    <div className="relative grid items-end border-b px-5 py-1.5" style={template}>
                        <div className="flex min-w-0 items-center gap-2.5 self-center pr-3">
                            <span className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-muted" aria-hidden="true">
                                <Layers className="size-4 text-muted-foreground" />
                            </span>
                            <div className="min-w-0">
                                <p className="truncate text-sm font-semibold">Every job</p>
                                <p className="truncate text-xs text-muted-foreground">A click on a day lists its backups</p>
                            </div>
                        </div>
                        {totals.map((total) => (
                            <TimelineTotal
                                key={total.day}
                                total={total}
                                peak={peak}
                                picked={total.day === pickedDay}
                                onPick={() => toggle({ from: total.day, to: total.day })}
                                format={format}
                            />
                        ))}
                    </div>

                    {rows.map((row) => (
                        <TimelineJobRow
                            key={row.job.key}
                            row={row}
                            range={{ from: days[0], to: last > today ? today : last }}
                            template={template}
                            destinations={destinations}
                            format={format}
                            at={at}
                            pick={pick}
                            onToggle={toggle}
                        />
                    ))}
                </div>
            )}

            <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 border-t bg-page/60 px-5 py-2.5 text-xs text-muted-foreground">
                <TimelineLegend />
                <span className="ml-auto">Missed runs are looked for over the last 90 days</span>
            </div>
        </div>
    );
}
