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

/** Lines that say the same thing about other tables or columns, counted as one kind. */
export interface RunKind {
    title: string;
    count: number;
    /** The first of its lines, as the tool wrote it. */
    raw: string;
    help: string | null;
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
    /** Warnings of one step about several things, each kind with how often it came up. */
    kinds?: RunKind[];
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

// ------------------------------------------------------------------ the summary of a run

/** The lines a tool, a destination or a source wrote about one thing, folded under its name. */
export interface RunOutput {
    source: string;
    lines: RunLine[];
}

export interface RunDumpProgress {
    /** How far it is, from 0 to 1. Null when there is nothing to measure it against yet. */
    share: number | null;
    /** True when the tool counted it, false when it is measured against the dump of the last backup. */
    exact: boolean;
    /** What the share counts, like "526,527 of 1,500,000 documents". */
    text: string;
    /** What the share is of when it is less than the whole database, like a collection. */
    part: string | null;
    etaMs: number | null;
}

/** One database of the dump step. */
export interface RunDump {
    name: string;
    state: "waiting" | "dumping" | "done" | "failed";
    bytes: number | null;
    durationMs: number | null;
    startedAt: string | null;
    /** What the tool said about it, like "2 collections · 1,500,001 documents". */
    facts: string | null;
    /** The size of its dump in the last backup of the job. */
    lastBytes: number | null;
    /** The command or statement it was dumped with. */
    command: string | null;
    outputs: RunOutput[];
    warnings: RunKind[];
    errors: string[];
    progress: RunDumpProgress | null;
}

/** A destination, a folder or a channel of a step, one row of its summary. */
export interface RunSummaryItem {
    key: string;
    label: string;
    adapterId: string | null;
    state: "done" | "failed" | "running" | "waiting" | "skipped" | "warning";
    text: string;
    outputs: RunOutput[];
}

/** A step told in a sentence or two, with a row for each database, destination or channel it went through. */
export interface RunStepSummary {
    step: string;
    /** What the step did. `{tool}` in it stands for the program it ran, which the page shows as a badge. */
    text: string | null;
    tool: string | null;
    dumps: RunDump[];
    items: RunSummaryItem[];
    /** The checksum every copy is checked against, on the upload step. */
    checksum: string | null;
    /** What the step does right now, like the entry it packs, while it is live. */
    now: string | null;
}

// ------------------------------------------------------------------ the copies an integrity check or a verification checked

export interface RunCopyCheck {
    destinationId: string;
    file: string;
    size: number | null;
    state: "waiting" | "checking" | "passed" | "failed" | "skipped" | "error";
    method: "native" | "download" | null;
    processed: number | null;
    total: number | null;
    reason: string | null;
    expected: string | null;
    actual: string | null;
}

export interface RunCheckDestination {
    id: string;
    name: string;
    adapterId: string | null;
    /** The copies it holds of what the run goes through. */
    total: number;
    checked: number;
    passed: number;
    differ: number;
    skipped: number;
    /** Whether it checks a copy by a checksum it keeps, without a download. */
    native: boolean;
}

export interface RunChecks {
    total: number;
    destinations: RunCheckDestination[];
    /** The copies checked so far, the one checked now among them. */
    copies: RunCopyCheck[];
    /** The backup a verification checks the copies of. */
    backup: { name: string; file: string; size: number | null } | null;
}

export interface RunDetail extends RunRow {
    job: { id: string; name: string } | null;
    path: string | null;
    backupType: string | null;
    logsPurgedAt: string | null;
    databases: string[];
    steps: RunStep[];
    summary: RunStepSummary[];
    problems: RunProblem[];
    uploads: RunUpload[];
    /** What an integrity check or a verification checked. Null for every other run. */
    checks: RunChecks | null;
    notifications: RunNotification[];
    /** The runs of the same job, newest first, for the switcher and the bars. */
    recent: RunNeighbour[];
    previous: RunNeighbour | null;
    next: RunNeighbour | null;
    /** Runs that wait for a free slot while this one runs. */
    queue: { id: string; name: string; starter: RunStarter }[];
}
