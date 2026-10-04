"use client";

import { useMemo, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { useRouter } from "next/navigation";
import { Layers } from "lucide-react";
import { Popover, PopoverAnchor, PopoverContent } from "@/components/ui/popover";
import { Skeleton } from "@/components/ui/skeleton";
import type { BackupRun, ExplorerDestination, ExplorerJob, ExplorerPlan } from "@/services/storage/explorer-types";
import { failedCheck, runKey } from "./backup-filters";
import { TimelineLegend, TimelineTotal, useTimelineFormat } from "./timeline-cells";
import { TimelineAheadCaption, TimelineAxis, TimelineBands, gridTemplate, useColumns, useTimelineWindow } from "./timeline-frame";
import { buildRow, isPicked, totalsOf, type DayKey, type TimelinePick } from "./timeline-model";
import { AHEAD, TimelineNav, toDate } from "./timeline-nav";
import { TimelinePickList } from "./timeline-pick-list";
import { TimelineJobRow } from "./timeline-row";

interface JobsTimelineProps {
    /** The backups the filters leave. */
    runs: BackupRun[];
    /** The jobs to show a row for, in their order. */
    jobs: ExplorerJob[];
    /** What the schedules plan and missed, null while it loads. */
    plan: ExplorerPlan | null;
    destinations: Map<string, ExplorerDestination>;
    at: string[];
    /** Opens a backup in its details. `onClosed` runs once they are gone again. */
    onOpen: (run: BackupRun, onClosed?: () => void) => void;
    /** Shows what a list holds in the list view of the tab. */
    onShowInList: (pick: TimelinePick) => void;
}

/** The list open at the timeline: what it holds and the backup opened from it last. */
interface OpenList {
    pick: TimelinePick;
    value: string | null;
}

/**
 * The third view of the Backups tab: a row per job and a column per day, as many days as fit.
 * The arrows page through the days, the date button jumps to one, and at today the arrow to the
 * right adds the next days with the runs the schedules plan, while today stays in view. A click on
 * a day, a job or a day of a job lists its backups right there, and a day of a job with a single
 * backup opens it at once. Closing a backup brings its list back.
 */
export function JobsTimeline({ runs, jobs, plan, destinations, at, onOpen, onShowInList }: JobsTimelineProps) {
    const router = useRouter();
    const format = useTimelineFormat();
    const { ref, cols } = useColumns();
    const today = format.dayOf(new Date().toISOString());
    const { days, last, ahead, toToday, back, forward, center } = useTimelineWindow(cols, today);
    const plans = useMemo(() => new Map((plan?.jobs ?? []).map((entry) => [entry.jobKey, entry])), [plan]);
    const [list, setList] = useState<OpenList | null>(null);
    // Counts the lists opened, so a list that opens while the last one fades out still takes the focus.
    const [opened, setOpened] = useState(0);
    // What opened the list, which it hangs from and gives the focus back to after Escape.
    const anchorRef = useRef<HTMLElement | null>(null);
    const refocus = useRef(false);

    const rows = useMemo(() => {
        const byJob = new Map<string, BackupRun[]>();
        for (const run of runs) {
            const entries = byJob.get(run.jobKey);
            if (entries) entries.push(run);
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

    const show = (pick: TimelinePick, anchor: HTMLElement, value: string | null = null) => {
        anchorRef.current = anchor;
        refocus.current = false;
        setList({ pick, value });
        setOpened((count) => count + 1);
    };

    const toggle = (pick: TimelinePick, anchor: HTMLElement) => {
        if (list && isPicked(list.pick, pick.jobKey, pick.from, pick.to)) {
            setList(null);
            return;
        }
        // A day of a job with a single backup needs no list.
        const cell = pick.jobKey && pick.from === pick.to ? rows.find((row) => row.job.key === pick.jobKey)?.cells[days.indexOf(pick.from)] : null;
        if (cell && cell.runs.length === 1) {
            setList(null);
            onOpen(cell.runs[0], () => anchor.focus());
            return;
        }
        show(pick, anchor);
    };

    const openRun = (run: BackupRun) => {
        if (!list) return;
        const from = list.pick;
        const anchor = anchorRef.current;
        setList(null);
        // Back to the list once the details close, with the backup ticked, while what opened it is still there.
        onOpen(run, () => {
            if (anchor?.isConnected) show(from, anchor, runKey(run));
        });
    };

    const jump = (day: DayKey) => {
        // The day lands in the middle of the view, and its list opens under its date.
        flushSync(() => center(day));
        const anchor = ref.current?.querySelector<HTMLElement>(`[data-day="${day}"]`);
        if (!anchor) return false;
        show({ from: day, to: day }, anchor);
        return true;
    };

    const template = gridTemplate(cols);
    const sub = ahead
        ? `The last ${cols - AHEAD} days and the next ${AHEAD}, as the schedules plan them`
        : last === today
            ? `${format.short(days[0])} to today · a click lists the backups right there`
            : `${format.short(days[0])} to ${format.short(last)} · a click lists the backups right there`;
    const pick = list?.pick ?? null;
    const pickedDay = pick && !pick.jobKey && pick.from === pick.to ? pick.from : null;
    const range = { from: days[0], to: last > today ? today : last };

    return (
        <div ref={ref} className="min-w-0">
            <div className="flex flex-wrap items-center gap-3 px-5 pt-4 pb-3">
                <div className="min-w-0">
                    <p className="font-semibold">Timeline</p>
                    <p className="truncate text-sm text-muted-foreground">{cols > 0 ? sub : " "}</p>
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
                    <TimelineBands days={days} today={today} pickedDay={pickedDay} template={template} />
                    <TimelineAheadCaption days={days} today={today} template={template}>Next {AHEAD} days, as the schedules plan them</TimelineAheadCaption>
                    <TimelineAxis
                        days={days}
                        today={today}
                        pickedDay={pickedDay}
                        template={template}
                        format={format}
                        onPickDay={(day, anchor) => toggle({ from: day, to: day }, anchor)}
                    />

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
                                onPick={(anchor) => toggle({ from: total.day, to: total.day }, anchor)}
                                format={format}
                            />
                        ))}
                    </div>

                    {rows.map((row) => (
                        <TimelineJobRow
                            key={row.job.key}
                            row={row}
                            range={range}
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

            <Popover open={list !== null} onOpenChange={(open) => !open && setList(null)}>
                <PopoverAnchor virtualRef={anchorRef} />
                <PopoverContent
                    key={opened}
                    tone="pick"
                    align={pick?.jobKey && pick.from !== pick.to ? "start" : "center"}
                    collisionPadding={12}
                    className="w-104 overflow-hidden p-0"
                    onInteractOutside={(event) => {
                        // A second click on what opened the list closes it by its own click.
                        if (event.target instanceof Node && anchorRef.current?.contains(event.target)) event.preventDefault();
                    }}
                    onEscapeKeyDown={() => {
                        refocus.current = true;
                    }}
                    onCloseAutoFocus={(event) => {
                        // Only Escape hands the focus back. A click elsewhere, a backup or the next list keep it.
                        event.preventDefault();
                        if (refocus.current) anchorRef.current?.focus();
                        refocus.current = false;
                    }}
                >
                    {list && (
                        <TimelinePickList
                            pick={list.pick}
                            rows={rows}
                            days={days}
                            today={today}
                            destinations={destinations}
                            format={format}
                            at={at}
                            value={list.value}
                            onOpenRun={openRun}
                            onOpenJob={(job) => router.push(`/dashboard/jobs?job=${encodeURIComponent(job.jobId ?? job.key)}`)}
                            onShowInList={() => {
                                setList(null);
                                onShowInList(list.pick);
                            }}
                        />
                    )}
                </PopoverContent>
            </Popover>
        </div>
    );
}
