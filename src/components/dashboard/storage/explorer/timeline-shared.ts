import { isFormer } from "@/components/dashboard/shared/shared-model";
import { buildSharedRow, timelineDatabases } from "@/components/dashboard/shared/shared-timeline-model";
import type { ExplorerJob } from "@/services/storage/explorer-types";
import type { SharedDatabase } from "@/services/tenant/shared-databases";
import { sharedJobKey, type ListRun, type QuickPick, type SharedRun } from "./shared-runs";
import type { DayKey, TimelineRow } from "./timeline-model";

/**
 * The rows of the databases another tenant's server gives to this one in the timeline of the
 * Backups tab, after the jobs: a cell per day with the backups of that day, and bars for the days
 * the database was not the tenant's. Plain functions without React, so the rules can be tested.
 */

/** A shared database in the shape of a job of the timeline, which names it and draws its logo in the list of a day. */
export function sharedJobOf(database: SharedDatabase): ExplorerJob {
    return {
        key: sharedJobKey(database),
        kind: "job",
        name: database.databaseName,
        jobId: null,
        sourceType: database.adapterId,
        sourceName: database.serverName,
        hasFolders: false,
        incremental: false,
        configuredDestinationIds: [],
        destinationIds: [],
        runs: 0,
        size: 0,
        newest: null,
        oldest: null,
        failedChecks: 0,
        missingCopies: 0,
        locked: 0,
        retention: {},
    };
}

/** The row of a shared database out of the backups the filters leave. */
export function buildSharedLine(database: SharedDatabase, runs: readonly SharedRun[], days: DayKey[], dayOf: (iso: string) => DayKey): TimelineRow {
    const line = buildSharedRow(database, runs.map((run) => run.shared), days, dayOf);
    const byId = new Map(runs.map((run) => [run.shared.id, run]));
    return {
        job: sharedJobOf(database),
        shared: database,
        cells: line.cells.map((cell) => (cell ? { day: cell.day, kind: cell.kind, runs: cell.rows.flatMap((row) => byId.get(row.id) ?? []), planned: [] } : null)),
        spans: line.spans,
    };
}

interface LineInput {
    /** Every database shared with the tenant. */
    databases: readonly SharedDatabase[];
    /** The backups the filters leave. */
    runs: readonly ListRun[];
    /** The keys of the Job filter, none for every job and database. */
    scopeJobs: readonly string[];
    /** Whether a filter other than the job narrows the backups, which leaves out the rows without any. */
    narrowed: boolean;
    quick: QuickPick;
}

/**
 * The shared databases the timeline shows a row for: the ones with backups the filters leave, and
 * every current one while nothing else narrows them, current ones first by name. None while the
 * quick filter shows only the own backups.
 */
export function sharedLineDatabases({ databases, runs, scopeJobs, narrowed, quick }: LineInput): SharedDatabase[] {
    if (quick === "own") return [];
    const withRuns = new Set(runs.map((run) => run.jobKey));
    const kept = databases.filter((database) => {
        const key = sharedJobKey(database);
        return (scopeJobs.length === 0 || scopeJobs.includes(key)) && (withRuns.has(key) || (!narrowed && !isFormer(database)));
    });
    return timelineDatabases(kept, [], false);
}
