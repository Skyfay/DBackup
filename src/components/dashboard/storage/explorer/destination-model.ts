import type { BackupRun, ExplorerDestination, ExplorerJob } from "@/services/storage/explorer-types";
import { isStale } from "./explorer-state";

/**
 * The Destinations tab: what each destination holds by job, what its states are for the filters,
 * and the numbers above the list. Plain functions without React, so the rules can be tested.
 */

/** A job as one destination sees it. */
export interface DestinationJob {
    job: ExplorerJob;
    /** Its backups stored there. */
    backups: number;
    /** Bytes of them. */
    size: number;
    newest: string | null;
    /** The other destinations that hold backups of the job, in the order they turn up. */
    alsoAt: string[];
    /** Its backups there whose check failed, and its runs whose copy is missing there. */
    failed: number;
    missing: number;
    locked: number;
}

/** Every job with backups at a destination, or a copy missing there, in the order of the index. */
export function jobsAt(destinationId: string, runs: BackupRun[], jobs: ExplorerJob[]): DestinationJob[] {
    const byJob = new Map<string, DestinationJob>();
    const jobsByKey = new Map(jobs.map((job) => [job.key, job]));
    for (const run of runs) {
        const here = run.copies.find((copy) => copy.destinationId === destinationId);
        const job = jobsByKey.get(run.jobKey);
        if (!here || !job) continue;
        let entry = byJob.get(run.jobKey);
        if (!entry) {
            entry = { job, backups: 0, size: 0, newest: null, alsoAt: [], failed: 0, missing: 0, locked: 0 };
            byJob.set(run.jobKey, entry);
        }
        if (here.state === "missing") {
            entry.missing++;
            continue;
        }
        entry.backups++;
        entry.size += here.file?.size ?? 0;
        if (!entry.newest || run.createdAt > entry.newest) entry.newest = run.createdAt;
        if (here.file?.verification?.passed === false) entry.failed++;
        if (here.file?.locked) entry.locked++;
        for (const copy of run.copies) {
            if (copy.destinationId !== destinationId && copy.state === "stored" && !entry.alsoAt.includes(copy.destinationId)) entry.alsoAt.push(copy.destinationId);
        }
    }
    return jobs.flatMap((job) => byJob.get(job.key) ?? []);
}

/** The states a job at a destination can be filtered by. A job in any of the picked ones stays. */
export type DestinationJobState = "deleted" | "missing" | "failed" | "locked";

export function statesOfJob(entry: DestinationJob): DestinationJobState[] {
    return [
        ...(entry.job.kind === "deleted" ? ["deleted" as const] : []),
        ...(entry.missing > 0 ? ["missing" as const] : []),
        ...(entry.failed > 0 ? ["failed" as const] : []),
        ...(entry.locked > 0 ? ["locked" as const] : []),
    ];
}

/** What kind of source a job backs up, for the Type filter of the jobs: its database, folders, or what stands in for a job. */
export function typeOfJob(job: ExplorerJob): string {
    if (job.kind === "system") return "system";
    if (job.kind === "none") return "none";
    return job.sourceType ?? "folders";
}

/** The states a destination can be filtered by. */
export type DestinationState = "online" | "missed" | "offline" | "behind" | "alert";

export function statesOfDestination(destination: ExplorerDestination): DestinationState[] {
    const { status } = destination.health;
    const alert = Object.values(destination.alerts).some((entry) => entry.active);
    return [
        status === "OFFLINE" ? "offline" : status === "DEGRADED" ? "missed" : "online",
        ...(isStale(destination) || !destination.listedAt ? ["behind" as const] : []),
        ...(alert ? ["alert" as const] : []),
    ];
}

/** The names of the alerts that fire right now at a destination. */
export function activeAlerts(destination: ExplorerDestination): string[] {
    const { usageSpike, storageLimit, missingBackup } = destination.alerts;
    return [
        ...(missingBackup.active ? ["Missing backup"] : []),
        ...(storageLimit.active ? ["Storage limit"] : []),
        ...(usageSpike.active ? ["Usage spike"] : []),
    ];
}

/** The share of the storage limit a destination fills, when its limit alert is on. */
export function limitShare(destination: ExplorerDestination): number | null {
    const { storageLimit } = destination.alerts;
    if (!storageLimit.enabled || storageLimit.bytes <= 0) return null;
    return destination.size / storageLimit.bytes;
}

/** The jobs that write to a destination now and the deleted ones with backups there. */
export function jobsOfDestination(destinationId: string, jobs: ExplorerJob[]): ExplorerJob[] {
    return jobs.filter((job) => job.destinationIds.includes(destinationId));
}

export interface DestinationsSummary {
    destinations: number;
    answering: number;
    size: number;
    /** What the destinations with a measurement a week old grew, null when none has one. */
    growth: number | null;
    backups: number;
    alerts: string[];
}

export function summarizeDestinations(destinations: ExplorerDestination[]): DestinationsSummary {
    const grown = destinations.filter((destination) => destination.growth !== null);
    return {
        destinations: destinations.length,
        answering: destinations.filter((destination) => destination.health.status === "ONLINE").length,
        size: destinations.reduce((sum, destination) => sum + destination.size, 0),
        growth: grown.length > 0 ? grown.reduce((sum, destination) => sum + (destination.growth ?? 0), 0) : null,
        backups: destinations.reduce((sum, destination) => sum + destination.count, 0),
        alerts: destinations.flatMap((destination) => activeAlerts(destination).map((name) => `${name} at ${destination.name}`)),
    };
}
