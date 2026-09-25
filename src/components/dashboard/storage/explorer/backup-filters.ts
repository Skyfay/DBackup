import type { BackupCopy, BackupRun, ExplorerDestination, ExplorerFile, ExplorerJob } from "@/services/storage/explorer-types";
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
    /** Who started the runs, as `startedByKey` names them, none for anyone. */
    by: string[];
    /** Part of the name of a backup or of its job. */
    search: string;
    quick: BackupQuick;
}

/** A filter left out, for the counts beside that filter. */
type Skip = "jobs" | "at" | "by" | "quick";

/** Who started the run that made a backup: `schedule`, `manual:<person>`, `api:<key name>`, or `none` when the backup does not say. */
export function startedByKey(file: Pick<ExplorerFile, "trigger">): string {
    const trigger = file.trigger;
    if (!trigger) return "none";
    if (trigger.type === "Scheduler") return "schedule";
    return `${trigger.type === "Api" ? "api" : "manual"}:${trigger.actor ?? ""}`;
}

export interface StartedByOption {
    value: string;
    label: string;
    /** The heading it is listed under, empty for the schedule. */
    group: "" | "By hand" | "API keys" | "Other";
}

const STARTED_BY_ORDER: Record<StartedByOption["group"], number> = { "": 0, "By hand": 1, "API keys": 2, Other: 3 };

/** Everyone who started a run of these backups: the schedule, every person by hand and every API key. */
export function startedByOptions(runs: BackupRun[]): StartedByOption[] {
    const options = new Map<string, StartedByOption>();
    for (const run of runs) {
        const value = startedByKey(run.file);
        if (options.has(value)) continue;
        if (value === "schedule") options.set(value, { value, label: "Schedule", group: "" });
        else if (value === "none") options.set(value, { value, label: "Not recorded", group: "Other" });
        else {
            const actor = value.slice(value.indexOf(":") + 1);
            const manual = value.startsWith("manual:");
            options.set(value, { value, label: actor || (manual ? "No name recorded" : "No key name recorded"), group: manual ? "By hand" : "API keys" });
        }
    }
    return [...options.values()].sort((a, b) => STARTED_BY_ORDER[a.group] - STARTED_BY_ORDER[b.group] || a.label.localeCompare(b.label));
}

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

const ANSWER_RANK: Record<string, number> = { ONLINE: 0, DEGRADED: 1, OFFLINE: 2 };

/** Ranks the destinations of the copies by whether they answer right now, the ones that do first. */
export function byAnswer(destinations: Map<string, Pick<ExplorerDestination, "health">>): (destinationId: string) => number {
    return (destinationId) => ANSWER_RANK[destinations.get(destinationId)?.health.status ?? ""] ?? 3;
}

/**
 * The copy the list shows and acts on: the first one stored, in the upload order of the job. Given
 * a rank, one whose destination answers right now comes before one that does not, so a restore
 * reads from a copy it can reach.
 */
export function primaryCopy(run: BackupRun, at: string[] = [], rank?: (destinationId: string) => number): BackupTarget {
    const inScope = targetsOf(run, at);
    const pool = inScope.length > 0 ? inScope : targetsOf(run, []);
    if (pool.length === 0) return { file: run.file, destinationId: run.copies[0]?.destinationId ?? "" };
    if (!rank) return pool[0];
    return pool.reduce((best, target) => (rank(target.destinationId) < rank(best.destinationId) ? target : best));
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
    if (skip !== "by" && filters.by.length > 0 && !filters.by.includes(startedByKey(run.file))) return false;
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
    /** Backups per `startedByKey` under every other filter. */
    by: Map<string, number>;
    quick: Record<BackupQuick, number>;
}

/** What each option of each filter would leave, with the other filters as they are. */
export function countBackups(runs: BackupRun[], filters: BackupFilters, jobs: Map<string, ExplorerJob>, destinationIds: string[]): BackupCounts {
    const byJob = new Map<string, number>();
    for (const run of filterBackups(runs, filters, jobs, "jobs")) byJob.set(run.jobKey, (byJob.get(run.jobKey) ?? 0) + 1);

    const byDestination = new Map<string, number>();
    for (const id of destinationIds) byDestination.set(id, filterBackups(runs, { ...filters, at: [id] }, jobs).length);

    const byStarter = new Map<string, number>();
    for (const run of filterBackups(runs, filters, jobs, "by")) {
        const key = startedByKey(run.file);
        byStarter.set(key, (byStarter.get(key) ?? 0) + 1);
    }

    const base = filterBackups(runs, filters, jobs, "quick");
    const quick: Record<BackupQuick, number> = { all: base.length, missing: 0, failed: 0, locked: 0, deleted: 0 };
    for (const run of base) {
        if (hasMissing(run, filters.at)) quick.missing++;
        if (failedCheck(run, filters.at)) quick.failed++;
        if (isLocked(run, filters.at)) quick.locked++;
        if (jobs.get(run.jobKey)?.kind === "deleted") quick.deleted++;
    }
    return { jobs: byJob, at: byDestination, by: byStarter, quick };
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
