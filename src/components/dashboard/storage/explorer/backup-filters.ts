import type { BackupCopy, BackupRun, ExplorerFile, ExplorerJob } from "@/services/storage/explorer-types";
import type { BackupTarget } from "./use-backup-actions";

/**
 * The filters of the list of every backup, and what they leave. The list, the counts beside each
 * filter and the numbers above the list all come from here, so they never disagree. Kept free of
 * React so the rules can be tested.
 *
 * A filter by destination also sets what the rest looks at: the quick filters, the numbers and the
 * actions only count the copies at those destinations.
 */

/** The quick filters beside the search. */
export type BackupQuick = "all" | "missing" | "failed" | "locked" | "deleted";

export interface BackupFilters {
    /** Job keys, none for every job. */
    jobs: string[];
    /** Destination ids, none for every destination. */
    at: string[];
    /** Part of the name of a backup or of its job. */
    search: string;
    quick: BackupQuick;
}

/** A filter left out, for the counts beside that filter. */
type Skip = "jobs" | "at" | "quick";

/** A run's key in the list, since the path alone could repeat across jobs. */
export function runKey(run: Pick<BackupRun, "jobKey" | "path">): string {
    return `${run.jobKey}:${run.path}`;
}

/** The copies of a run within the destinations of the filter, every copy without one. */
export function copiesIn(run: BackupRun, at: string[]): BackupCopy[] {
    return at.length === 0 ? run.copies : run.copies.filter((copy) => at.includes(copy.destinationId));
}

/** The stored copies of a run within those destinations, the ones an action can reach. */
export function targetsOf(run: BackupRun, at: string[]): BackupTarget[] {
    return copiesIn(run, at).flatMap((copy) => (copy.state === "stored" && copy.file ? [{ file: copy.file, destinationId: copy.destinationId }] : []));
}

/** The copy the list shows and acts on: the first one stored, in the upload order of the job. */
export function primaryCopy(run: BackupRun, at: string[] = []): BackupTarget {
    return targetsOf(run, at)[0] ?? targetsOf(run, [])[0] ?? { file: run.file, destinationId: run.copies[0]?.destinationId ?? "" };
}

export const failedCheck = (run: BackupRun, at: string[] = []) => copiesIn(run, at).some((copy) => copy.file?.verification?.passed === false);
export const hasMissing = (run: BackupRun, at: string[] = []) => copiesIn(run, at).some((copy) => copy.state === "missing");
export const isLocked = (run: BackupRun, at: string[] = []) => copiesIn(run, at).some((copy) => copy.file?.locked);

/** The check to show for a run: a failed copy wins, then the one the list shows. */
export function verificationOf(run: BackupRun, at: string[] = []): ExplorerFile["verification"] {
    const failed = copiesIn(run, at).find((copy) => copy.file?.verification?.passed === false);
    return failed?.file?.verification ?? primaryCopy(run, at).file.verification;
}

function matchesQuick(run: BackupRun, quick: BackupQuick, at: string[], jobs: Map<string, ExplorerJob>): boolean {
    switch (quick) {
        case "missing":
            return hasMissing(run, at);
        case "failed":
            return failedCheck(run, at);
        case "locked":
            return isLocked(run, at);
        case "deleted":
            return jobs.get(run.jobKey)?.kind === "deleted";
        default:
            return true;
    }
}

function matchesSearch(run: BackupRun, search: string, jobs: Map<string, ExplorerJob>): boolean {
    const text = search.trim().toLowerCase();
    if (!text) return true;
    return run.file.name.toLowerCase().includes(text) || (jobs.get(run.jobKey)?.name.toLowerCase().includes(text) ?? false);
}

function passes(run: BackupRun, filters: BackupFilters, jobs: Map<string, ExplorerJob>, skip?: Skip): boolean {
    if (skip !== "jobs" && filters.jobs.length > 0 && !filters.jobs.includes(run.jobKey)) return false;
    const at = skip === "at" ? [] : filters.at;
    // A copy that is missing there still belongs to the destination, it is what a filter for it should find.
    if (at.length > 0 && !run.copies.some((copy) => at.includes(copy.destinationId))) return false;
    if (!matchesSearch(run, filters.search, jobs)) return false;
    return skip === "quick" || matchesQuick(run, filters.quick, at, jobs);
}

/** The runs the filters leave, newest first like the runs given. */
export function filterBackups(runs: BackupRun[], filters: BackupFilters, jobs: Map<string, ExplorerJob>, skip?: Skip): BackupRun[] {
    return runs.filter((run) => passes(run, filters, jobs, skip));
}

export interface BackupCounts {
    /** Backups per job under every other filter. */
    jobs: Map<string, number>;
    /** Backups per destination under every other filter. */
    at: Map<string, number>;
    quick: Record<BackupQuick, number>;
}

/** What each option of each filter would leave, with the other filters as they are. */
export function countBackups(runs: BackupRun[], filters: BackupFilters, jobs: Map<string, ExplorerJob>, destinationIds: string[]): BackupCounts {
    const byJob = new Map<string, number>();
    for (const run of filterBackups(runs, filters, jobs, "jobs")) byJob.set(run.jobKey, (byJob.get(run.jobKey) ?? 0) + 1);

    const byDestination = new Map<string, number>();
    for (const id of destinationIds) byDestination.set(id, filterBackups(runs, { ...filters, at: [id] }, jobs).length);

    const base = filterBackups(runs, filters, jobs, "quick");
    const quick: Record<BackupQuick, number> = { all: base.length, missing: 0, failed: 0, locked: 0, deleted: 0 };
    for (const run of base) {
        if (hasMissing(run, filters.at)) quick.missing++;
        if (failedCheck(run, filters.at)) quick.failed++;
        if (isLocked(run, filters.at)) quick.locked++;
        if (jobs.get(run.jobKey)?.kind === "deleted") quick.deleted++;
    }
    return { jobs: byJob, at: byDestination, quick };
}

export interface BackupSummary {
    runs: number;
    /** Jobs that exist and deleted ones among them. */
    jobs: number;
    deletedJobs: number;
    /** Bytes of the stored copies within the destinations of the filter. */
    stored: number;
    /** Destinations that hold those copies. */
    destinations: number;
    newest: BackupRun | null;
    oldest: BackupRun | null;
    copies: number;
    missing: number;
    verified: number;
    failed: number;
    locked: number;
}

/** The numbers above the list, for the runs it shows. */
export function summarize(runs: BackupRun[], at: string[], jobs: Map<string, ExplorerJob>): BackupSummary {
    const jobKeys = new Set(runs.map((run) => run.jobKey));
    const holding = new Set<string>();
    let stored = 0;
    let copies = 0;
    let missing = 0;
    for (const run of runs) {
        for (const copy of copiesIn(run, at)) {
            copies++;
            if (copy.state === "missing") {
                missing++;
                continue;
            }
            holding.add(copy.destinationId);
            stored += copy.file?.size ?? 0;
        }
    }
    return {
        runs: runs.length,
        jobs: [...jobKeys].filter((key) => jobs.get(key)?.kind === "job").length,
        deletedJobs: [...jobKeys].filter((key) => jobs.get(key)?.kind === "deleted").length,
        stored,
        destinations: holding.size,
        newest: runs[0] ?? null,
        oldest: runs[runs.length - 1] ?? null,
        copies,
        missing,
        verified: runs.filter((run) => verificationOf(run, at)?.passed === true).length,
        failed: runs.filter((run) => failedCheck(run, at)).length,
        locked: runs.filter((run) => isLocked(run, at)).length,
    };
}
