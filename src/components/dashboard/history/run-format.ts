import { formatDuration } from "@/lib/utils";
import type { RunRow } from "@/services/history/run-types";

/** Small texts the rows, the cards and the page of a run share. */

export const TYPE_LABELS: Record<string, string> = {
    Backup: "Backup",
    Restore: "Restore",
    IntegrityCheck: "Integrity check",
    Verification: "Verification",
    "System Restore": "Configuration restore",
};

/** The Type filter lists the work of the jobs first and the system tasks under them. */
export const TYPE_GROUPS: Record<string, string> = {
    Backup: "Jobs",
    Restore: "Jobs",
    IntegrityCheck: "System tasks",
    Verification: "System tasks",
    "System Restore": "System tasks",
};

export function typeLabel(type: string): string {
    return TYPE_LABELS[type] ?? type;
}

export function isLive(row: Pick<RunRow, "status">): boolean {
    return row.status === "Running" || row.status === "Pending";
}

/** How long a run took, or how long it runs so far. */
export function tookOf(row: Pick<RunRow, "status" | "startedAt" | "durationMs">, now: number): string {
    if (row.status === "Pending") return "-";
    if (row.durationMs !== null) return formatDuration(row.durationMs);
    return formatDuration(Math.max(0, now - Date.parse(row.startedAt)));
}

export function usualText(usualMs: number | null): string | null {
    return usualMs ? `usual ${formatDuration(usualMs)}` : null;
}

/** The quick filters of the runs, as the states they stand for. */
export type RunQuick = "all" | "failed" | "partial" | "running";

export const QUICK_STATUSES: Record<RunQuick, string[]> = {
    all: [],
    failed: ["Failed"],
    partial: ["Partial"],
    running: ["Running", "Pending"],
};
