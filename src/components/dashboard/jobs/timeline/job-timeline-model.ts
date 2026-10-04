import type { JobTimeline, TimelinePlannedRun, TimelineRun } from "@/services/jobs/job-timeline-types";

/**
 * What the Timeline and Upcoming views of the Jobs page draw from the runs of the server: the
 * range of a zoom, the runs of a job as bars, how many runs want a slot at a time, and the runs of
 * the next hours as an agenda. Plain functions without React, so the rules can be tested.
 */

export const HOUR_MS = 60 * 60 * 1000;
export const DAY_MS = 24 * HOUR_MS;

export type TimelineZoom = "day" | "days" | "week";

export const ZOOMS: { value: TimelineZoom; label: string; span: string }[] = [
    { value: "day", label: "24 h", span: "24 hours" },
    { value: "days", label: "3 days", span: "3 days" },
    { value: "week", label: "Week", span: "week" },
];

export interface TimeRange {
    from: number;
    to: number;
}

/**
 * The range of a zoom, moved by whole screens. A day shows the last 6 hours and the next 24, the
 * others start at midnight of today in the viewer's time zone, which `dayStart` works out.
 */
export function rangeOf(zoom: TimelineZoom, offset: number, now: number, dayStart: (time: number) => number): TimeRange {
    if (zoom === "day") {
        const from = now - 6 * HOUR_MS + offset * DAY_MS;
        return { from, to: from + 30 * HOUR_MS };
    }
    const span = zoom === "days" ? 3 * DAY_MS : 7 * DAY_MS;
    const from = dayStart(now) + offset * span;
    return { from, to: from + span };
}

/** How long the Upcoming view looks ahead for each zoom. */
export function horizonOf(zoom: TimelineZoom): number {
    return zoom === "day" ? DAY_MS : zoom === "days" ? 3 * DAY_MS : 7 * DAY_MS;
}

export type BarKind = "success" | "failed" | "partial" | "cancelled" | "running" | "pending" | "planned" | "likely";

export interface TimelineBar {
    key: string;
    kind: BarKind;
    /** When it ran or is expected to run. */
    start: number;
    end: number;
    /** For a run that waits for a slot: since when, the time it was due or queued. */
    waitFrom: number | null;
    run?: TimelineRun;
    planned?: TimelinePlannedRun;
}

const FINISHED: Record<string, BarKind> = { Success: "success", Failed: "failed", Partial: "partial", Cancelled: "cancelled" };

function barOfRun(run: TimelineRun, estimate: number, now: number): TimelineBar | null {
    const started = Date.parse(run.startedAt);
    if (run.status === "Running") {
        return { key: run.id, kind: "running", start: started, end: run.expectedEnd ? Date.parse(run.expectedEnd) : Math.max(started + estimate, now), waitFrom: null, run };
    }
    if (run.status === "Pending") {
        const start = run.expectedStart ? Date.parse(run.expectedStart) : now;
        return { key: run.id, kind: "pending", start, end: run.expectedEnd ? Date.parse(run.expectedEnd) : start + estimate, waitFrom: started, run };
    }
    const kind = FINISHED[run.status];
    if (!kind) return null;
    return { key: run.id, kind, start: started, end: run.endedAt ? Date.parse(run.endedAt) : started, waitFrom: null, run };
}

/** The runs of a job that reach into a range: what ran, runs and waits, then what is planned. */
export function barsOf(jobId: string, data: JobTimeline, range: TimeRange): TimelineBar[] {
    const now = Date.parse(data.now);
    const estimate = data.estimates[jobId] ?? 0;
    const likely = data.failing.includes(jobId);
    const bars: TimelineBar[] = [];
    for (const run of data.runs) {
        if (run.jobId !== jobId) continue;
        const bar = barOfRun(run, estimate, now);
        if (bar) bars.push(bar);
    }
    for (const planned of data.planned) {
        if (planned.jobId !== jobId) continue;
        const due = Date.parse(planned.due);
        const start = Date.parse(planned.start);
        bars.push({ key: `${jobId}@${planned.due}`, kind: likely ? "likely" : "planned", start, end: Date.parse(planned.end), waitFrom: start > due ? due : null, planned });
    }
    return bars.filter((bar) => (bar.waitFrom ?? bar.start) < range.to && Math.max(bar.end, bar.start) > range.from).sort((a, b) => a.start - b.start);
}

/** Bars too close to tell apart at the width of a range, folded into one with how many it holds. */
export type BarGroup = { bars: TimelineBar[]; start: number; end: number };

/**
 * Folds short bars of one kind that follow each other closer than `minGapMs`, like a job every five
 * minutes over a week. A bar that waits or differs in kind, like a failure among successes, stays apart.
 */
export function packBars(bars: TimelineBar[], minGapMs: number): BarGroup[] {
    const groups: BarGroup[] = [];
    const short = (bar: TimelineBar) => bar.waitFrom === null && bar.end - bar.start < minGapMs;
    for (const bar of bars) {
        const last = groups[groups.length - 1];
        if (last && short(bar) && last.bars.every((entry) => entry.kind === bar.kind && short(entry)) && bar.start - last.end < minGapMs) {
            last.bars.push(bar);
            last.end = Math.max(last.end, bar.end);
        } else {
            groups.push({ bars: [bar], start: bar.start, end: bar.end });
        }
    }
    return groups;
}

export interface DemandSegment {
    from: number;
    to: number;
    /** Runs that run or wait at the same time. */
    count: number;
}

/** How many runs run or wait at each moment of a range, as segments that keep one count. */
export function demandOf(bars: TimelineBar[], range: TimeRange): DemandSegment[] {
    const events: [number, number][] = [];
    for (const bar of bars) {
        const from = Math.max(bar.waitFrom ?? bar.start, range.from);
        const to = Math.min(Math.max(bar.end, bar.start + 1), range.to);
        if (to <= from) continue;
        events.push([from, 1], [to, -1]);
    }
    events.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    const segments: DemandSegment[] = [];
    let count = 0;
    let since = range.from;
    for (const [time, delta] of events) {
        if (time > since && count > 0) {
            const last = segments[segments.length - 1];
            if (last && last.count === count && last.to === since) last.to = time;
            else segments.push({ from: since, to: time, count });
        }
        count += delta;
        since = time;
    }
    return segments;
}

export interface AgendaRow {
    key: string;
    jobId: string;
    kind: "running" | "pending" | "planned" | "likely";
    /** When it is due or queued. */
    due: number;
    /** When it is expected to start and end. */
    start: number;
    end: number;
    waitsFor: string[];
    run?: TimelineRun;
}

export interface Agenda {
    /** Finished runs of the last 6 hours, newest first. */
    earlier: TimelineRun[];
    now: AgendaRow[];
    /** The planned runs by day of the viewer, soonest first. */
    days: { day: number; rows: AgendaRow[] }[];
    /** Jobs that run more often than every two hours, folded into one line each. */
    frequent: { jobId: string; runs: number; waits: number }[];
    /** Jobs among those shown that plan no run before the end. */
    quiet: string[];
}

/** The runs of the next hours for the jobs shown, as Upcoming lists them. */
export function agendaOf(data: JobTimeline, jobIds: string[], horizon: number, dayStart: (time: number) => number): Agenda {
    const now = Date.parse(data.now);
    const end = now + horizon;
    const shown = new Set(jobIds);
    const earlier = data.runs
        .filter((run) => shown.has(run.jobId) && FINISHED[run.status] && Date.parse(run.startedAt) >= now - 6 * HOUR_MS)
        .sort((a, b) => Date.parse(b.startedAt) - Date.parse(a.startedAt));

    const nowRows: AgendaRow[] = data.runs
        .filter((run) => shown.has(run.jobId) && (run.status === "Running" || run.status === "Pending"))
        .map((run) => {
            const started = Date.parse(run.startedAt);
            const start = run.expectedStart ? Date.parse(run.expectedStart) : started;
            return {
                key: run.id, jobId: run.jobId, kind: run.status === "Running" ? "running" : "pending", due: started, start,
                end: run.expectedEnd ? Date.parse(run.expectedEnd) : start + (data.estimates[run.jobId] ?? 0), waitsFor: run.waitsFor, run,
            };
        });

    const planned = data.planned.filter((run) => shown.has(run.jobId) && Date.parse(run.due) < end);
    const counts = new Map<string, number>();
    for (const run of planned) counts.set(run.jobId, (counts.get(run.jobId) ?? 0) + 1);
    const often = new Set([...counts].filter(([, runs]) => runs > horizon / (2 * HOUR_MS)).map(([jobId]) => jobId));

    const days = new Map<number, AgendaRow[]>();
    for (const run of planned) {
        if (often.has(run.jobId)) continue;
        const due = Date.parse(run.due);
        const row: AgendaRow = {
            key: `${run.jobId}@${run.due}`, jobId: run.jobId, kind: data.failing.includes(run.jobId) ? "likely" : "planned", due,
            start: Date.parse(run.start), end: Date.parse(run.end), waitsFor: run.waitsFor,
        };
        const day = dayStart(due);
        days.set(day, [...(days.get(day) ?? []), row]);
    }

    return {
        earlier,
        now: nowRows,
        days: [...days].sort((a, b) => a[0] - b[0]).map(([day, rows]) => ({ day, rows })),
        frequent: [...often].map((jobId) => ({
            jobId,
            runs: counts.get(jobId) ?? 0,
            waits: planned.filter((run) => run.jobId === jobId && Date.parse(run.start) > Date.parse(run.due)).length,
        })),
        quiet: jobIds.filter((jobId) => !counts.has(jobId) && !nowRows.some((row) => row.jobId === jobId)),
    };
}
