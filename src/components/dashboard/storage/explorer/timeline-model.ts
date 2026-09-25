import type { BackupRun, ExplorerJob, JobPlan, MissedDay, PlannedRun } from "@/services/storage/explorer-types";
import { failedCheck, hasMissing, isLocked } from "./backup-filters";

/**
 * The grid of the timeline of the Backups tab: a row per job and a column per day, with what each
 * day of a job holds, what its schedule plans for the days to come and what it missed. Plain
 * functions without React, so the rules can be tested.
 */

/** A day as `yyyy-MM-dd` in the viewer's time zone. */
export type DayKey = string;

export function shiftDay(day: DayKey, by: number): DayKey {
    const [year, month, date] = day.split("-").map(Number);
    return new Date(Date.UTC(year, month - 1, date + by)).toISOString().slice(0, 10);
}

/** The days of a view: `count` days that end with `last`, oldest first. */
export function daysEnding(last: DayKey, count: number): DayKey[] {
    return Array.from({ length: count }, (_, index) => shiftDay(last, index - count + 1));
}

/** The day of the week, 0 for Monday, and the day of the month, without a time zone in between. */
export function partsOf(day: DayKey): { weekday: number; date: number; month: number } {
    const [year, month, date] = day.split("-").map(Number);
    const weekday = (new Date(Date.UTC(year, month - 1, date)).getUTCDay() + 6) % 7;
    return { weekday, date, month: month - 1 };
}

export type CellKind = "none" | "ok" | "full" | "incremental" | "locked" | "missing" | "failed" | "missed" | "planned";

export interface TimelineCell {
    day: DayKey;
    kind: CellKind;
    /** The backups of the day. */
    runs: BackupRun[];
    /** What the schedule plans for a day to come. */
    planned: PlannedRun[];
    missed?: MissedDay;
}

/** Days a row has nothing to show for: before its oldest backup, or after the last one of a deleted job. */
export interface TimelineSpan {
    kind: "aged" | "gone";
    start: number;
    end: number;
}

export interface TimelineRow {
    job: ExplorerJob;
    plan?: JobPlan;
    /** A cell per day, null where a span covers the day. */
    cells: (TimelineCell | null)[];
    spans: TimelineSpan[];
}

/** What the backups of a day show: a failed check first, then a missing copy, a lock, and the kind of backup. */
export function kindOf(runs: BackupRun[], at: string[]): CellKind {
    if (runs.some((run) => failedCheck(run, at))) return "failed";
    if (runs.some((run) => hasMissing(run, at))) return "missing";
    if (runs.some((run) => isLocked(run, at))) return "locked";
    const chained = runs.filter((run) => run.file.chain);
    if (chained.length > 0) return chained.some((run) => run.file.chain?.type === "full") ? "full" : "incremental";
    return "ok";
}

interface RowInput {
    job: ExplorerJob;
    plan?: JobPlan;
    /** The backups of the job the filters leave. */
    runs: BackupRun[];
    days: DayKey[];
    today: DayKey;
    at: string[];
    dayOf: (iso: string) => DayKey;
}

export function buildRow({ job, plan, runs, days, today, at, dayOf }: RowInput): TimelineRow {
    const byDay = new Map<DayKey, BackupRun[]>();
    for (const run of runs) {
        const day = dayOf(run.createdAt);
        const list = byDay.get(day);
        if (list) list.push(run);
        else byDay.set(day, [run]);
    }
    const plannedByDay = new Map<DayKey, PlannedRun[]>();
    for (const run of plan?.planned ?? []) {
        const day = dayOf(run.at);
        if (day <= today) continue;
        const list = plannedByDay.get(day);
        if (list) list.push(run);
        else plannedByDay.set(day, [run]);
    }
    const missedByDay = new Map((plan?.missed ?? []).map((missed) => [dayOf(missed.at), missed]));

    // Where the row has nothing to show: before its oldest backup, which aged out or never was,
    // and after the newest backup of a deleted job. Taken from all its backups, not the filtered ones.
    const oldest = job.oldest ? dayOf(job.oldest) : null;
    const newest = job.newest ? dayOf(job.newest) : null;
    const created = plan?.createdAt ? dayOf(plan.createdAt) : null;
    const spanOf = (day: DayKey): TimelineSpan["kind"] | null => {
        if (job.kind === "deleted" && newest && day > newest) return "gone";
        if (oldest && day < oldest && (!created || day >= created) && (job.kind === "job" || job.kind === "deleted")) return "aged";
        return null;
    };

    const cells: (TimelineCell | null)[] = [];
    const spans: TimelineSpan[] = [];
    days.forEach((day, index) => {
        const span = spanOf(day);
        if (span) {
            const last = spans[spans.length - 1];
            if (last && last.kind === span && last.end === index - 1) last.end = index;
            else spans.push({ kind: span, start: index, end: index });
            cells.push(null);
            return;
        }
        const dayRuns = byDay.get(day) ?? [];
        const planned = day > today ? plannedByDay.get(day) ?? [] : [];
        const missed = day <= today && dayRuns.length === 0 ? missedByDay.get(day) : undefined;
        const kind: CellKind = day > today
            ? planned.length > 0 ? "planned" : "none"
            : dayRuns.length > 0 ? kindOf(dayRuns, at) : missed ? "missed" : "none";
        cells.push({ day, kind, runs: dayRuns, planned, missed });
    });
    return { job, plan, cells, spans };
}

export interface DayTotal {
    day: DayKey;
    /** Backups of the day, or planned runs of a day to come. */
    count: number;
    worst: "ok" | "warning" | "destructive";
    planned: boolean;
}

/** The row of every job: how many backups each day holds and the worst of them. */
export function totalsOf(rows: TimelineRow[], days: DayKey[], today: DayKey): DayTotal[] {
    return days.map((day, index) => {
        let count = 0;
        let worst: DayTotal["worst"] = "ok";
        for (const row of rows) {
            const cell = row.cells[index];
            if (!cell) continue;
            count += day > today ? cell.planned.length : cell.runs.length;
            if (cell.kind === "failed" || cell.kind === "missed") worst = "destructive";
            else if (cell.kind === "missing" && worst === "ok") worst = "warning";
        }
        return { day, count, worst, planned: day > today };
    });
}

/** What the list below the timeline shows: the backups of a job, of a day, or of a job on a day. */
export interface TimelinePick {
    jobKey?: string;
    from: DayKey;
    to: DayKey;
}

export function isPicked(pick: TimelinePick | null, jobKey: string | undefined, from: DayKey, to: DayKey): boolean {
    return pick !== null && pick.jobKey === jobKey && pick.from === from && pick.to === to;
}

export function pickedRuns(runs: BackupRun[], pick: TimelinePick, dayOf: (iso: string) => DayKey): BackupRun[] {
    return runs.filter((run) => {
        if (pick.jobKey && run.jobKey !== pick.jobKey) return false;
        const day = dayOf(run.createdAt);
        return day >= pick.from && day <= pick.to;
    });
}
