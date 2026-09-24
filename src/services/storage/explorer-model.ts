import type { BackupCopy, BackupRun, ExplorerFile, ExplorerJob, ExplorerJobKind } from "./explorer-types";

/**
 * Puts the listings of every destination together, by job and by run.
 *
 * Pure, so the rules can be tested without a storage or a database. The storage stays the truth:
 * everything here is worked out from the cached listings, which DBackup updates on every upload,
 * deletion, lock and check and compares with the storage every hour.
 */

/** The key of the config backups DBackup makes of itself. */
export const SYSTEM_KEY = "system";
/** The key of files that nothing links to a job. */
export const NO_JOB_KEY = "none";
const DELETED_ID = "deleted:";
const DELETED_NAME = "deleted-name:";

export interface JobRecord {
    id: string;
    name: string;
    incremental: boolean;
    sourceType: string | null;
    sourceName: string | null;
    hasFolders: boolean;
    /** Where the job writes now, in its upload order. */
    destinationIds: string[];
}

export interface DestinationListing {
    destinationId: string;
    files: ExplorerFile[];
}

export interface ExplorerModel {
    jobs: ExplorerJob[];
    /** Runs per job key, newest first. */
    runs: Map<string, BackupRun[]>;
}

/** A path as every adapter would write it, so the copies of one backup line up. */
export function normalizePath(path: string): string {
    return path.replace(/\\/g, "/").replace(/^\/+/, "");
}

/** When the backup was made, from its sidecar, or when the storage says it was written. */
export function timeOf(file: ExplorerFile): number {
    const time = new Date(file.createdAt ?? file.lastModified).getTime();
    return Number.isFinite(time) ? time : 0;
}

/**
 * Which job a file belongs to.
 *
 * The id from the sidecar decides, since it survives a rename. A job deleted and made again under
 * the same name gets a new id, so its old backups stay with the deleted one. Files listed without
 * an id, from before the sidecar carried one or found by their folder, fall back to the name.
 */
export function jobKeyOf(file: ExplorerFile, jobsById: Map<string, JobRecord>, jobsByName: Map<string, JobRecord>): string {
    if (file.sourceType === "SYSTEM") return SYSTEM_KEY;
    if (file.jobId) return jobsById.has(file.jobId) ? file.jobId : `${DELETED_ID}${file.jobId}`;
    const name = file.jobName && file.jobName !== "Unknown" ? file.jobName : null;
    if (!name) return NO_JOB_KEY;
    const job = jobsByName.get(name);
    return job ? job.id : `${DELETED_NAME}${name}`;
}

export function kindOfKey(key: string, jobsById: Map<string, { id: string }>): ExplorerJobKind {
    if (key === SYSTEM_KEY) return "system";
    if (key === NO_JOB_KEY) return "none";
    if (jobsById.has(key)) return "job";
    return "deleted";
}

interface Collected {
    /** Files of one job per destination. */
    byDestination: Map<string, ExplorerFile[]>;
}

function collect(jobs: JobRecord[], listings: DestinationListing[]): Map<string, Collected> {
    const jobsById = new Map(jobs.map((job) => [job.id, job]));
    const jobsByName = new Map(jobs.map((job) => [job.name, job]));
    const byKey = new Map<string, Collected>();

    for (const job of jobs) byKey.set(job.id, { byDestination: new Map() });
    for (const listing of listings) {
        for (const file of listing.files) {
            const key = jobKeyOf(file, jobsById, jobsByName);
            let entry = byKey.get(key);
            if (!entry) {
                entry = { byDestination: new Map() };
                byKey.set(key, entry);
            }
            const files = entry.byDestination.get(listing.destinationId);
            if (files) files.push(file);
            else entry.byDestination.set(listing.destinationId, [file]);
        }
    }
    return byKey;
}

/**
 * The runs of one job, each with its copies.
 *
 * A destination counts as missing a backup only when it should have got it. One the job writes to
 * now should have every run since its oldest unlocked backup of the job: a destination added later
 * never had the older runs, and one with a shorter retention has let them go, so neither of them is
 * reported. One the job no longer writes to, and every destination of a deleted job, is only held
 * to the runs between its oldest and its newest backup, since nothing says when the job stopped
 * writing to it. Locked backups are left out of both limits, they stay past the retention on purpose.
 */
export function runsOf(key: string, expected: string[], byDestination: Map<string, ExplorerFile[]>, configured: Set<string> = new Set(expected)): BackupRun[] {
    const oldest = new Map<string, number>();
    const newest = new Map<string, number>();
    const paths = new Map<string, Map<string, ExplorerFile>>();

    for (const [destinationId, files] of byDestination) {
        for (const file of files) {
            const path = normalizePath(file.path);
            let copies = paths.get(path);
            if (!copies) {
                copies = new Map();
                paths.set(path, copies);
            }
            copies.set(destinationId, file);
            if (!file.locked) {
                const time = timeOf(file);
                const first = oldest.get(destinationId);
                if (first === undefined || time < first) oldest.set(destinationId, time);
                const last = newest.get(destinationId);
                if (last === undefined || time > last) newest.set(destinationId, time);
            }
        }
    }

    const runs: BackupRun[] = [];
    for (const [path, stored] of paths) {
        const first = expected.map((id) => stored.get(id)).find((file) => file !== undefined) ?? stored.values().next().value!;
        const createdAt = timeOf(first);
        const copies: BackupCopy[] = [];
        for (const destinationId of expected) {
            const file = stored.get(destinationId);
            if (file) {
                copies.push({ destinationId, state: "stored", file });
                continue;
            }
            const since = oldest.get(destinationId);
            const until = configured.has(destinationId) ? Infinity : newest.get(destinationId) ?? -Infinity;
            if (since !== undefined && since < createdAt && createdAt < until) copies.push({ destinationId, state: "missing" });
        }
        runs.push({ path, jobKey: key, file: first, createdAt: new Date(createdAt).toISOString(), copies });
    }
    return runs.sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
}

/** The name a job is shown under, for the kinds that have no job record. */
function nameOf(key: string, files: ExplorerFile[]): string {
    if (key === SYSTEM_KEY) return "Config backups";
    if (key === NO_JOB_KEY) return "Without a job";
    // The newest backup carries the last name the job had.
    const newest = [...files].sort((a, b) => timeOf(b) - timeOf(a))[0];
    return newest?.jobName && newest.jobName !== "Unknown" ? newest.jobName : key.replace(DELETED_NAME, "");
}

const KIND_ORDER: Record<ExplorerJobKind, number> = { job: 0, deleted: 1, system: 2, none: 3 };

/** Every job with backups or a destination, and its runs. */
export function buildExplorer(jobs: JobRecord[], listings: DestinationListing[]): ExplorerModel {
    const jobsById = new Map(jobs.map((job) => [job.id, job]));
    const collected = collect(jobs, listings);
    const result: ExplorerJob[] = [];
    const runsByKey = new Map<string, BackupRun[]>();

    for (const [key, { byDestination }] of collected) {
        const record = jobsById.get(key);
        const kind = kindOfKey(key, jobsById);
        const files = [...byDestination.values()].flat();
        // A job with neither backups nor destinations has nothing to show, a config backup or a
        // file without a job only exists through its files.
        if (kind !== "job" && files.length === 0) continue;

        const configured = record?.destinationIds ?? [];
        const holding = [...byDestination.keys()].filter((id) => !configured.includes(id)).sort();
        const expected = [...configured, ...holding];
        const runs = runsOf(key, expected, byDestination, new Set(configured));
        runsByKey.set(key, runs);

        const sample = files.find((file) => file.sourceType) ?? files[0];
        result.push({
            key,
            kind,
            name: record?.name ?? nameOf(key, files),
            jobId: record?.id ?? (key.startsWith(DELETED_ID) ? key.slice(DELETED_ID.length) : null),
            sourceType: record ? record.sourceType : sample?.sourceType && sample.sourceType !== "directory-only" ? sample.sourceType : null,
            sourceName: record ? record.sourceName : sample?.sourceName ?? null,
            hasFolders: record ? record.hasFolders : files.some((file) => (file.combined?.directorySources ?? 0) > 0 || file.sourceType === "directory-only"),
            incremental: record ? record.incremental : files.some((file) => file.backupType === "incremental"),
            configuredDestinationIds: configured,
            destinationIds: expected.filter((id) => configured.includes(id) || byDestination.has(id)),
            runs: runs.length,
            size: files.reduce((sum, file) => sum + (file.size ?? 0), 0),
            newest: runs[0]?.createdAt ?? null,
            oldest: runs[runs.length - 1]?.createdAt ?? null,
            failedChecks: runs.filter((run) => run.copies.some((copy) => copy.file?.verification?.passed === false)).length,
            missingCopies: runs.reduce((sum, run) => sum + run.copies.filter((copy) => copy.state === "missing").length, 0),
            locked: runs.filter((run) => run.copies.some((copy) => copy.file?.locked)).length,
        });
    }

    result.sort((a, b) => KIND_ORDER[a.kind] - KIND_ORDER[b.kind] || a.name.localeCompare(b.name));
    return { jobs: result, runs: runsByKey };
}
