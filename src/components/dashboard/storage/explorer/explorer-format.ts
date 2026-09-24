import type { ExplorerFile, ExplorerJob } from "@/services/storage/explorer-types";

/**
 * How the explorer words a backup. Kept free of React so the rules can be tested.
 */

export type StartedByKind = "schedule" | "api" | "manual";

/** Who started the run that made the backup, like "Schedule" or "API · Deploy hook". */
export function startedBy(file: Pick<ExplorerFile, "trigger">): { kind: StartedByKind; label: string } | null {
    const trigger = file.trigger;
    if (!trigger) return null;
    if (trigger.type === "Scheduler") return { kind: "schedule", label: "Schedule" };
    if (trigger.type === "Api") return { kind: "api", label: trigger.actor ? `API · ${trigger.actor}` : "API" };
    return { kind: "manual", label: trigger.actor ? `By hand · ${trigger.actor}` : "By hand" };
}

/** When the backup was made, from its sidecar, or when the storage says it was written. */
export function madeAt(file: Pick<ExplorerFile, "createdAt" | "lastModified">): string {
    return file.createdAt ?? file.lastModified;
}

/** What a restore brings back. For an incremental more than the archive holds. */
export function snapshotBytes(file: Pick<ExplorerFile, "size" | "logicalSize">): number {
    return typeof file.logicalSize === "number" && file.logicalSize > file.size ? file.logicalSize : file.size;
}

export function isIncremental(file: Pick<ExplorerFile, "backupType" | "chain">): boolean {
    return file.chain?.type === "incremental" || file.backupType === "incremental";
}

/** "Full", or "Incremental · 3" with the position in its chain. */
export function typeLabel(file: Pick<ExplorerFile, "backupType" | "chain">): string {
    if (!isIncremental(file)) return "Full";
    return file.chain ? `Incremental · ${file.chain.index}` : "Incremental";
}

function plural(count: number, noun: string, nouns = `${noun}s`): string {
    return `${count.toLocaleString()} ${count === 1 ? noun : nouns}`;
}

/** What the backup holds, like "Shop · 3 databases" or "2 folders". */
export function contentsOf(file: Pick<ExplorerFile, "sourceName" | "sourceType" | "dbInfo" | "combined" | "databases">): string {
    if (file.sourceType === "SYSTEM") return "DBackup configuration";
    const folders = file.combined?.directorySources ?? 0;
    const databases = file.combined
        ? file.combined.databases
        : file.databases?.length ?? (typeof file.dbInfo?.count === "number" ? file.dbInfo.count : 0);
    const parts: string[] = [];
    if (databases > 0) {
        const source = file.sourceName && file.sourceName !== "Unknown" && file.sourceType !== "directory-only" ? `${file.sourceName} · ` : "";
        parts.push(`${source}${plural(databases, "database")}`);
    }
    if (folders > 0) parts.push(plural(folders, "folder"));
    if (parts.length === 0) return file.sourceName && file.sourceName !== "Unknown" ? file.sourceName : "Unknown";
    return parts.join(" + ");
}

/** The words for a job in the picker, like "30 runs · 6.1 GB". */
export function jobKindLabel(job: Pick<ExplorerJob, "kind">): string {
    switch (job.kind) {
        case "deleted":
            return "Job deleted";
        case "system":
            return "Config backups";
        case "none":
            return "Without a job";
        default:
            return "Job";
    }
}

/** A count with its noun, like "3 backups" or "1 copy". */
export function count(countValue: number, noun: string, nouns?: string): string {
    return plural(countValue, noun, nouns);
}
