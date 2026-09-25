import type { BackupCopy, BackupRun, ExplorerDestination, ExplorerFile, ExplorerJob } from "@/services/storage/explorer-types";
import type { BackupTarget } from "./use-backup-actions";

/**
 * The filters of the list of every backup, and what they leave. The list, the counts beside each
 * filter and the numbers above the list all come from here, so they never disagree. Kept free of
 * React so the rules can be tested.
 *
 * A filter by destination also sets what the rest looks at: the states, the numbers and the actions
 * only count the copies at those destinations.
 */

/** The states a backup can be filtered by. A backup in any of the picked ones stays. */
export type BackupState = "missing" | "failed" | "unreachable" | "locked" | "deleted";

export const BACKUP_STATES: BackupState[] = ["missing", "failed", "unreachable", "locked", "deleted"];

export interface BackupFilters {
    /** Job keys, none for every job. */
    jobs: string[];
    /** Destination ids, none for every destination. */
    at: string[];
    /** Who started the runs, as `startedByKey` names them, none for anyone. */
    by: string[];
    /** Part of the name of a backup or of its job. */
    search: string;
    /** States, none for every backup. */
    states: BackupState[];
}

/** What the filters look up: the jobs by key and the destinations that answer right now. */
export interface BackupLookup {
    jobs: Map<string, ExplorerJob>;
    /** Ids of the destinations whose last connection check got an answer. */
    answering: Set<string>;
}

/** The lookup for these jobs and destinations. A destination answers unless it missed its last check or is offline. */
export function lookupOf(jobs: Map<string, ExplorerJob>, destinations: Pick<ExplorerDestination, "id" | "health">[]): BackupLookup {
    const answering = destinations.filter((destination) => destination.health.status !== "OFFLINE" && destination.health.status !== "DEGRADED");
    return { jobs, answering: new Set(answering.map((destination) => destination.id)) };
}

/** A filter left out, for the counts beside that filter. */
type Skip = "jobs" | "at" | "by" | "states";

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
/** Whether no copy can be read right now: each stored one lies at a destination that does not answer. */
export const noAnswer = (run: BackupRun, at: string[], answering: Set<string>) => {
    const targets = targetsOf(run, at);
    return targets.length > 0 && !targets.some((target) => answering.has(target.destinationId));
};

/** The check to show for a run: a failed copy wins, then the one the list shows. */
export function verificationOf(run: BackupRun, at: string[] = []): ExplorerFile["verification"] {
    const failed = copiesIn(run, at).find((copy) => copy.file?.verification?.passed === false);
    return failed?.file?.verification ?? primaryCopy(run, at).file.verification;
}

function inState(run: BackupRun, state: BackupState, at: string[], lookup: BackupLookup): boolean {
    switch (state) {
        case "missing":
            return hasMissing(run, at);
        case "failed":
            return failedCheck(run, at);
        case "unreachable":
            return noAnswer(run, at, lookup.answering);
        case "locked":
            return isLocked(run, at);
        case "deleted":
            return lookup.jobs.get(run.jobKey)?.kind === "deleted";
    }
}

function matchesSearch(run: BackupRun, search: string, jobs: Map<string, ExplorerJob>): boolean {
    const text = search.trim().toLowerCase();
    if (!text) return true;
    return run.file.name.toLowerCase().includes(text) || (jobs.get(run.jobKey)?.name.toLowerCase().includes(text) ?? false);
}

function passes(run: BackupRun, filters: BackupFilters, lookup: BackupLookup, skip?: Skip): boolean {
    if (skip !== "jobs" && filters.jobs.length > 0 && !filters.jobs.includes(run.jobKey)) return false;
    if (skip !== "by" && filters.by.length > 0 && !filters.by.includes(startedByKey(run.file))) return false;
    const at = skip === "at" ? [] : filters.at;
    // A copy that is missing there still belongs to the destination, it is what a filter for it should find.
    if (at.length > 0 && !run.copies.some((copy) => at.includes(copy.destinationId))) return false;
    if (!matchesSearch(run, filters.search, lookup.jobs)) return false;
    return skip === "states" || filters.states.length === 0 || filters.states.some((state) => inState(run, state, at, lookup));
}

/** The runs the filters leave, newest first like the runs given. */
export function filterBackups(runs: BackupRun[], filters: BackupFilters, lookup: BackupLookup, skip?: Skip): BackupRun[] {
    return runs.filter((run) => passes(run, filters, lookup, skip));
}

export interface BackupCounts {
    /** Backups per job under every other filter. */
    jobs: Map<string, number>;
    /** Backups per destination under every other filter. */
    at: Map<string, number>;
    /** Backups per `startedByKey` under every other filter. */
    by: Map<string, number>;
    /** Backups per state under every other filter. */
    states: Record<BackupState, number>;
    /** Of those, the ones that need a look: with a copy missing, and with a failed check or no copy that answers. */
    attention: { warning: number; destructive: number };
}

/** What each option of each filter would leave, with the other filters as they are. */
export function countBackups(runs: BackupRun[], filters: BackupFilters, lookup: BackupLookup, destinationIds: string[]): BackupCounts {
    const byJob = new Map<string, number>();
    for (const run of filterBackups(runs, filters, lookup, "jobs")) byJob.set(run.jobKey, (byJob.get(run.jobKey) ?? 0) + 1);

    const byDestination = new Map<string, number>();
    for (const id of destinationIds) byDestination.set(id, filterBackups(runs, { ...filters, at: [id] }, lookup).length);

    const byStarter = new Map<string, number>();
    for (const run of filterBackups(runs, filters, lookup, "by")) {
        const key = startedByKey(run.file);
        byStarter.set(key, (byStarter.get(key) ?? 0) + 1);
    }

    const states: Record<BackupState, number> = { missing: 0, failed: 0, unreachable: 0, locked: 0, deleted: 0 };
    const attention = { warning: 0, destructive: 0 };
    for (const run of filterBackups(runs, filters, lookup, "states")) {
        const holds = BACKUP_STATES.filter((state) => inState(run, state, filters.at, lookup));
        for (const state of holds) states[state]++;
        if (holds.includes("missing")) attention.warning++;
        if (holds.includes("failed") || holds.includes("unreachable")) attention.destructive++;
    }
    return { jobs: byJob, at: byDestination, by: byStarter, states, attention };
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
