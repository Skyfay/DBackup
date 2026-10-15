import type { DayKey, DayTotal } from "@/components/dashboard/storage/explorer/timeline-model";
import type { SharedDatabase } from "@/services/tenant/shared-databases";
import { isFormer, sharedKey, type SharedRow } from "./shared-model";

/**
 * The grid of the timeline of the tab Shared with you: a row per database and a column per day,
 * with the backups of each day. Days the database was not the tenant's are a bar of their own.
 * Plain functions without React, so the rules can be tested.
 */

export type SharedCellKind = "none" | "ok" | "failed";

export interface SharedCell {
    day: DayKey;
    kind: SharedCellKind;
    rows: SharedRow[];
}

/** Days the row has nothing for: before the database was the tenant's, or after it stopped being. */
export interface SharedSpan {
    kind: "before" | "after";
    start: number;
    end: number;
}

export interface SharedTimelineRow {
    database: SharedDatabase;
    /** A cell per day, null where a span covers the day. */
    cells: (SharedCell | null)[];
    spans: SharedSpan[];
}

/** The databases the rows stand for: the current ones by name, then the former ones. */
export function timelineDatabases(databases: readonly SharedDatabase[], rows: readonly SharedRow[], narrowed: boolean): SharedDatabase[] {
    const withRows = new Set(rows.map((row) => sharedKey(row.database)));
    return databases
        .filter((database) => !narrowed || withRows.has(sharedKey(database)))
        .sort((a, b) => Number(isFormer(a)) - Number(isFormer(b)) || a.databaseName.localeCompare(b.databaseName) || a.serverName.localeCompare(b.serverName));
}

export function buildSharedRow(database: SharedDatabase, rows: readonly SharedRow[], days: readonly DayKey[], dayOf: (iso: string) => DayKey): SharedTimelineRow {
    const byDay = new Map<DayKey, SharedRow[]>();
    for (const row of rows) {
        if (sharedKey(row.database) !== sharedKey(database)) continue;
        const day = dayOf(row.createdAt);
        const list = byDay.get(day);
        if (list) list.push(row);
        else byDay.set(day, [row]);
    }
    const since = dayOf(database.since);
    const until = database.until ? dayOf(database.until) : null;

    const cells: (SharedCell | null)[] = [];
    const spans: SharedSpan[] = [];
    days.forEach((day, index) => {
        const dayRows = byDay.get(day) ?? [];
        const kind: SharedSpan["kind"] | null = dayRows.length > 0 ? null : day < since ? "before" : until && day > until ? "after" : null;
        if (kind) {
            const last = spans[spans.length - 1];
            if (last && last.kind === kind && last.end === index - 1) last.end = index;
            else spans.push({ kind, start: index, end: index });
            cells.push(null);
            return;
        }
        cells.push({ day, kind: dayRows.length === 0 ? "none" : dayRows.some((row) => row.verification?.passed === false) ? "failed" : "ok", rows: dayRows });
    });
    return { database, cells, spans };
}

/** The row of every database: how many backups each day holds, red where a check failed. */
export function sharedTotals(rows: readonly SharedTimelineRow[], days: readonly DayKey[]): DayTotal[] {
    return days.map((day, index) => {
        let count = 0;
        let worst: DayTotal["worst"] = "ok";
        for (const row of rows) {
            const cell = row.cells[index];
            if (!cell) continue;
            count += cell.rows.length;
            if (cell.kind === "failed") worst = "destructive";
        }
        return { day, count, worst, planned: false };
    });
}

/** What a click on the timeline lists: a day of every database, or a day of one. */
export interface SharedPick {
    key?: string;
    day: DayKey;
}

/** The backups of a pick, by the time of day. */
export function pickedRows(rows: readonly SharedTimelineRow[], days: readonly DayKey[], pick: SharedPick): SharedRow[] {
    const index = days.indexOf(pick.day);
    if (index < 0) return [];
    return rows
        .filter((row) => !pick.key || sharedKey(row.database) === pick.key)
        .flatMap((row) => row.cells[index]?.rows ?? [])
        .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}
