import type { RunCopies, RunLive, RunRow, RunStarter, RunStatus, RunUpload } from "./run-types";

/**
 * A run as the History page shows it, out of its execution record. Pure, so the list, the page
 * of a run and the tests share one set of rules.
 */

/** The execution fields the page needs, with the job and its source for the name and the tile. */
export interface RunRecord {
    id: string;
    jobId: string | null;
    type: string;
    status: string;
    startedAt: Date;
    endedAt: Date | null;
    size: bigint | number | null;
    path: string | null;
    metadata: string | null;
    triggerType: string | null;
    triggerLabel: string | null;
    job: {
        name: string;
        source: { adapterId: string } | null;
        sources: { config: { adapterId: string } }[];
    } | null;
}

interface RunMetadata {
    progress?: unknown;
    stage?: unknown;
    detail?: unknown;
    names?: unknown;
    destinations?: unknown;
    uploads?: unknown;
    target?: unknown;
}

const SYSTEM_TASKS: Record<string, { name: string; sub: string }> = {
    IntegrityCheck: { name: "Integrity check", sub: "System task · the checksums of the backups" },
    Verification: { name: "Verification", sub: "System task · the copies of a backup" },
    "System Restore": { name: "Configuration restore", sub: "Restore · the configuration of DBackup" },
};

export function parseMetadata(metadata: string | null): RunMetadata {
    if (!metadata) return {};
    try {
        const value = JSON.parse(metadata);
        return value && typeof value === "object" ? value as RunMetadata : {};
    } catch {
        return {};
    }
}

export function isRunStatus(value: string): value is RunStatus {
    return ["Pending", "Running", "Success", "Partial", "Failed", "Cancelled"].includes(value);
}

export function starterOf(triggerType: string | null, triggerLabel: string | null): RunStarter {
    if (triggerType === "Scheduler") return { key: "schedule", kind: "schedule", label: "Schedule" };
    if (triggerType === "Api") return { key: `api:${triggerLabel ?? ""}`, kind: "api", label: triggerLabel || "API key" };
    if (triggerType === "Manual") return { key: `manual:${triggerLabel ?? ""}`, kind: "manual", label: triggerLabel || "By hand" };
    return { key: "none", kind: "none", label: "Not recorded" };
}

function strings(value: unknown): string[] {
    return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string" && entry.length > 0) : [];
}

/** The databases a backup held, as its metadata names them. */
export function databasesOf(metadata: RunMetadata): string[] {
    return strings(metadata.names);
}

function target(metadata: RunMetadata): { name: string; adapterId: string | null } | null {
    const value = metadata.target as { name?: unknown; adapterId?: unknown } | undefined;
    if (!value || typeof value.name !== "string" || !value.name) return null;
    return { name: value.name, adapterId: typeof value.adapterId === "string" ? value.adapterId : null };
}

function fileName(path: string | null): string | null {
    if (!path) return null;
    const parts = path.split("/");
    return parts[parts.length - 1] || null;
}

export function nameAndSub(record: RunRecord, metadata: RunMetadata): { name: string; sub: string } {
    const task = SYSTEM_TASKS[record.type];
    if (task) return task;
    if (record.type === "Restore") {
        const onto = target(metadata);
        const file = fileName(record.path);
        return { name: onto ? `Restore onto ${onto.name}` : "Restore", sub: file ? `Restore · ${file}` : "Restore" };
    }
    if (record.type === "Backup") {
        const databases = databasesOf(metadata);
        return {
            name: record.job?.name ?? "A deleted job",
            sub: databases.length > 0 ? `Backup · ${databases.join(", ")}` : "Backup",
        };
    }
    return { name: record.job?.name ?? record.type, sub: record.type };
}

export function adapterOf(record: RunRecord, metadata: RunMetadata): string | null {
    if (record.job?.source) return record.job.source.adapterId;
    if (record.job?.sources[0]) return record.job.sources[0].config.adapterId;
    return target(metadata)?.adapterId ?? null;
}

/** The copies of a backup: the per-destination result of a finished run, the live upload list of a running one. */
export function copiesOf(metadata: RunMetadata): RunCopies | null {
    const finished = Array.isArray(metadata.destinations) ? metadata.destinations as { name?: unknown; status?: unknown }[] : null;
    if (finished && finished.length > 0) {
        const failed = finished.filter((entry) => entry.status === "failed").map((entry) => String(entry.name ?? "A destination"));
        return { stored: finished.filter((entry) => entry.status === "success").length, total: finished.length, failed };
    }
    const uploads = uploadsOf(metadata);
    if (uploads.length === 0) return null;
    return {
        stored: uploads.filter((upload) => upload.state === "done").length,
        total: uploads.length,
        failed: uploads.filter((upload) => upload.state === "failed").map((upload) => upload.name),
    };
}

export function uploadsOf(metadata: RunMetadata): RunUpload[] {
    if (!Array.isArray(metadata.uploads)) return [];
    return (metadata.uploads as Partial<RunUpload>[]).filter((upload) => typeof upload?.configId === "string").map((upload) => ({
        configId: upload.configId!,
        name: upload.name ?? "A destination",
        adapterId: upload.adapterId ?? "",
        state: upload.state ?? "waiting",
        bytes: typeof upload.bytes === "number" ? upload.bytes : null,
        total: typeof upload.total === "number" ? upload.total : null,
        error: upload.error ?? null,
        startedAt: upload.startedAt ?? null,
        endedAt: upload.endedAt ?? null,
    }));
}

export function liveOf(metadata: RunMetadata): RunLive {
    const percent = typeof metadata.progress === "number" && Number.isFinite(metadata.progress) ? Math.max(0, Math.min(100, Math.round(metadata.progress))) : null;
    return {
        stage: typeof metadata.stage === "string" && metadata.stage ? metadata.stage : null,
        percent,
        detail: typeof metadata.detail === "string" && metadata.detail ? metadata.detail : null,
    };
}

/** "while dumping databases", for a run that stopped in that step. */
export function whileStage(stage: string | null): string | null {
    return stage ? `while ${stage.toLowerCase()}` : null;
}

/**
 * What the status of a run leaves out, in a few words. The error of a failed run is passed in,
 * since only the page of a run and the rows that failed read the log.
 */
export function noteOf(status: RunStatus, copies: RunCopies | null, live: RunLive, error: string | null): string | null {
    switch (status) {
        case "Failed":
            return error ?? whileStage(live.stage);
        case "Partial":
            if (copies && copies.failed.length === 1) return `${copies.failed[0]} failed`;
            if (copies && copies.failed.length > 1) return `${copies.failed.length} destinations failed`;
            return error;
        case "Cancelled":
            return whileStage(live.stage);
        case "Pending":
            return "waits for a free slot";
        case "Running":
            return live.stage ? `${live.stage}${live.percent !== null ? `, ${live.percent} %` : ""}` : null;
        case "Success":
            return copies ? `${copies.stored} of ${copies.total} ${copies.total === 1 ? "copy" : "copies"}` : null;
    }
}

/** The row of a run. `usualMs` and `error` come from the service, which reads them for many rows at once. */
export function runRow(record: RunRecord, usualMs: number | null, error: string | null): RunRow {
    const metadata = parseMetadata(record.metadata);
    const status: RunStatus = isRunStatus(record.status) ? record.status : "Failed";
    const copies = copiesOf(metadata);
    const live = liveOf(metadata);
    const { name, sub } = nameAndSub(record, metadata);
    const running = status === "Running" || status === "Pending";
    return {
        id: record.id,
        type: record.type,
        status,
        name,
        sub,
        adapterId: adapterOf(record, metadata),
        jobId: record.jobId,
        startedAt: record.startedAt.toISOString(),
        endedAt: record.endedAt?.toISOString() ?? null,
        durationMs: record.endedAt ? Math.max(0, record.endedAt.getTime() - record.startedAt.getTime()) : null,
        usualMs,
        size: record.size === null ? null : Number(record.size),
        copies,
        note: noteOf(status, copies, live, error),
        live: running ? live : null,
        starter: starterOf(record.triggerType, record.triggerLabel),
    };
}
