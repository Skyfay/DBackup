import type { LogLevel, LogType } from "@/lib/core/logs";

/** The page model of the History page and of the page of a run. Plain data, safe to send to the browser. */

export type RunStatus = "Pending" | "Running" | "Success" | "Partial" | "Failed" | "Cancelled";

/** Who started a run: `schedule`, `manual:<person>`, `api:<key name>`, or `none` when the run does not say. */
export interface RunStarter {
    key: string;
    kind: "schedule" | "manual" | "api" | "none";
    label: string;
}

export interface RunCopies {
    stored: number;
    total: number;
    /** The names of the destinations that did not take the backup. */
    failed: string[];
}

export interface RunLive {
    stage: string | null;
    percent: number | null;
    detail: string | null;
}

/** One run as a row of the History page. */
export interface RunRow {
    id: string;
    type: string;
    status: RunStatus;
    name: string;
    /** What the run did, like "Backup · shop, billing, reports". */
    sub: string;
    /** The adapter of its source, for the tile. Null for the system tasks. */
    adapterId: string | null;
    jobId: string | null;
    startedAt: string;
    endedAt: string | null;
    /** How long a finished run took. Null while it runs. */
    durationMs: number | null;
    /** How long a run of its job usually takes. */
    usualMs: number | null;
    size: number | null;
    copies: RunCopies | null;
    /** What went wrong or what it found, in a few words. */
    note: string | null;
    live: RunLive | null;
    starter: RunStarter;
}

export interface RunFacets {
    type: Record<string, number>;
    status: Record<string, number>;
    job: Record<string, number>;
    starter: Record<string, number>;
}

export interface RunJobOption {
    id: string;
    name: string;
    adapterId: string | null;
}

export interface RunStarterOption {
    value: string;
    label: string;
    group: "System" | "By hand" | "API keys" | "Other";
}

export interface RunStats {
    /** Runs in the last 30 days. */
    total: number;
    succeeded: number;
    failed: number;
    lastFailed: { name: string; at: string } | null;
    partial: number;
    lastPartial: { name: string; at: string } | null;
    running: string[];
    queued: string[];
}

export interface RunPage {
    rows: RunRow[];
    total: number;
    facets: RunFacets;
    jobs: RunJobOption[];
    starters: RunStarterOption[];
    stats: RunStats;
}

// ------------------------------------------------------------------ the page of a run

export type RunStepState = "done" | "warning" | "failed" | "running" | "pending" | "skipped";

export interface RunLine {
    at: string;
    level: LogLevel;
    type: LogType;
    message: string;
    details?: string;
    /** The problem this line belongs to. */
    problem?: string;
}

export interface RunStep {
    name: string;
    state: RunStepState;
    startedAt: string | null;
    durationMs: number | null;
    usualMs: number | null;
    errors: number;
    warnings: number;
    lines: RunLine[];
}

export interface RunProblemAction {
    kind: "destination" | "source" | "channel" | "job";
    /** The connection it opens, when the problem names one. */
    id?: string;
    label: string;
}

/** Something to look at, told once however often it came up. */
export interface RunProblem {
    id: string;
    tone: "error" | "warning";
    title: string;
    /** The message as the server or the adapter wrote it. */
    raw: string;
    step: string;
    /** The destination, database or channel it is about. */
    subject: string | null;
    at: string;
    /** The earlier tries of the same thing, folded into this one. */
    tries: string[];
    help: string | null;
    actions: RunProblemAction[];
}

export interface RunUpload {
    configId: string;
    name: string;
    adapterId: string;
    state: "waiting" | "uploading" | "done" | "failed" | "skipped";
    bytes: number | null;
    total: number | null;
    error: string | null;
    startedAt: string | null;
    endedAt: string | null;
}

export interface RunNotification {
    id: string;
    channelId: string | null;
    channelName: string;
    adapterId: string;
    status: "Success" | "Failed";
    error: string | null;
    title: string;
    sentAt: string;
}

export interface RunNeighbour {
    id: string;
    startedAt: string;
    status: RunStatus;
    durationMs: number | null;
    size: number | null;
    starter: RunStarter;
}

export interface RunDetail extends RunRow {
    job: { id: string; name: string } | null;
    path: string | null;
    backupType: string | null;
    logsPurgedAt: string | null;
    databases: string[];
    steps: RunStep[];
    problems: RunProblem[];
    uploads: RunUpload[];
    notifications: RunNotification[];
    /** The runs of the same job, newest first, for the switcher and the bars. */
    recent: RunNeighbour[];
    previous: RunNeighbour | null;
    next: RunNeighbour | null;
    /** Runs that wait for a free slot while this one runs. */
    queue: { id: string; name: string; starter: RunStarter }[];
}
