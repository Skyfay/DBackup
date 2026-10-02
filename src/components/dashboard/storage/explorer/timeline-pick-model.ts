import type { BackupRun, ExplorerJob } from "@/services/storage/explorer-types";
import { copiesIn, failedCheck } from "./backup-filters";
import type { DayKey, TimelinePick, TimelineRow } from "./timeline-model";

/**
 * What the list a click on the timeline opens holds: the backups of a day, of a job in view or of a
 * job on a day, with the ones that need a look first. Plain functions without React, so the rules
 * can be tested.
 */

/** What is wrong with a backup: a failed check, or copies the destinations of its job lack. */
export type PickProblem = { kind: "failed" } | { kind: "missing"; destinationIds: string[] };

export type PickItem =
    | { kind: "backup"; job: ExplorerJob; day: DayKey; at: string; run: BackupRun; problem: PickProblem | null }
    | { kind: "missed"; job: ExplorerJob; day: DayKey; at: string; runs: number };

export interface PickItems {
    /** A failed check, a missing copy and a run that did not start. */
    look: PickItem[];
    /** The backups without a problem. */
    rest: PickItem[];
    backups: number;
    /** The jobs with a backup among them. */
    jobs: number;
}

/** The problem of a backup within the destinations of the filter, a failed check before a missing copy. */
export function problemOf(run: BackupRun, at: string[]): PickProblem | null {
    if (failedCheck(run, at)) return { kind: "failed" };
    const missing = copiesIn(run, at).filter((copy) => copy.state === "missing").map((copy) => copy.destinationId);
    return missing.length > 0 ? { kind: "missing", destinationIds: missing } : null;
}

/** The list of a pick, out of the rows the timeline shows. A day reads by the time of day, the days of a job newest first. */
export function itemsOfPick(rows: TimelineRow[], days: DayKey[], pick: TimelinePick, at: string[]): PickItems {
    const items: PickItem[] = [];
    for (const row of rows) {
        if (pick.jobKey && row.job.key !== pick.jobKey) continue;
        row.cells.forEach((cell, index) => {
            const day = days[index];
            if (!cell || day < pick.from || day > pick.to) return;
            for (const run of cell.runs) items.push({ kind: "backup", job: row.job, day, at: run.createdAt, run, problem: problemOf(run, at) });
            if (cell.missed) items.push({ kind: "missed", job: row.job, day, at: cell.missed.at, runs: cell.missed.runs });
        });
    }
    const direction = pick.from === pick.to ? 1 : -1;
    items.sort((a, b) => direction * (Date.parse(a.at) - Date.parse(b.at)));
    const backups = items.filter((item) => item.kind === "backup");
    return {
        look: items.filter((item) => item.kind === "missed" || item.problem !== null),
        rest: items.filter((item) => item.kind === "backup" && item.problem === null),
        backups: backups.length,
        jobs: new Set(backups.map((item) => item.job.key)).size,
    };
}
