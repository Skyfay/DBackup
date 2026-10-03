/**
 * The rules of the integrity dialog: which copies a backup has, what their last check says, and
 * how a check of them goes. Free of React, so the tests read it directly.
 */

import type { BackupCopy, ExplorerDestination, ExplorerFile } from "@/services/storage/explorer-types";
import type { CopyCheck } from "@/services/storage/copy-verification";

/** What the dialog says about a copy: its last check, or where a running check stands. */
export type CopyStatus = "passed" | "failed" | "never" | "missing" | "unverifiable" | "waiting" | "checking" | "skipped" | "error";

export interface CopyRow {
    destinationId: string;
    name: string;
    adapterId: string;
    destination: ExplorerDestination | null;
    /** The file at that destination, absent for a copy that is missing there. */
    file: ExplorerFile | null;
    checksNatively: boolean;
}

const VERIFIED_BY: Record<string, string> = {
    "post-upload": "after the upload",
    manual: "by hand",
    scheduled: "by the weekly check",
};

/** The copies of a backup in the order the dialog lists them: the one it was opened from first. */
export function copyRows(copies: BackupCopy[], destinations: Map<string, ExplorerDestination>, first?: string): CopyRow[] {
    const rows = copies.map((copy) => {
        const destination = destinations.get(copy.destinationId) ?? null;
        return {
            destinationId: copy.destinationId,
            name: destination?.name ?? "A removed destination",
            adapterId: destination?.adapterId ?? "",
            destination,
            file: copy.state === "stored" ? copy.file ?? null : null,
            checksNatively: destination?.checksNatively ?? false,
        };
    });
    return [...rows.filter((row) => row.destinationId === first), ...rows.filter((row) => row.destinationId !== first)];
}

/** A copy can be checked when it is there and has a checksum to compare with. */
export function verifiable(row: CopyRow): boolean {
    return !!row.file && !!(row.file.checksum || row.file.checksumMd5);
}

/** The status of a copy, from a running check when there is one, else from its last check. */
export function statusOf(row: CopyRow, live?: CopyCheck): CopyStatus {
    if (live) return live.state;
    if (!row.file) return "missing";
    if (!verifiable(row)) return "unverifiable";
    if (!row.file.verification) return "never";
    return row.file.verification.passed ? "passed" : "failed";
}

/** How a copy is checked, or was the last time. */
export function howText(row: CopyRow, formatBytes: (bytes: number) => string): string {
    const method = row.file?.verification?.method ?? (row.checksNatively ? "native" : "download");
    if (!row.file) return "No copy here";
    return method === "native" ? "By the checksum it keeps, no download" : `Downloads ${formatBytes(row.file.size)} to hash it`;
}

/** When and why a copy was last checked, or what a running check does with it right now. */
export function lastCheckText(row: CopyRow, live: CopyCheck | undefined, formatDate: (date: Date) => string, formatBytes: (bytes: number) => string): string {
    if (live) {
        if (live.state === "checking") {
            return live.total ? `${formatBytes(live.processed ?? 0)} of ${formatBytes(live.total)} downloaded` : "Checking now";
        }
        if (live.state === "waiting") return "Waits for the ones before it";
        if (live.state === "skipped" || live.state === "error") return live.reason ?? "Could not be checked";
        return "Checked just now";
    }
    if (!row.file) return "The upload to it failed";
    if (!verifiable(row)) return "Stored without a checksum";
    const verification = row.file.verification;
    if (!verification) return "Not checked since the upload";
    return `${formatDate(new Date(verification.verifiedAt))} · ${VERIFIED_BY[verification.trigger] ?? "checked"}`;
}

/** The line above the list: how many copies passed, failed and were never checked. */
export function summaryText(statuses: CopyStatus[]): string {
    const count = (wanted: CopyStatus) => statuses.filter((status) => status === wanted).length;
    return [
        count("passed") > 0 ? `${count("passed")} passed` : null,
        count("failed") > 0 ? `${count("failed")} ${count("failed") === 1 ? "does" : "do"} not match` : null,
        count("never") > 0 ? `${count("never")} not checked` : null,
        count("missing") > 0 ? `${count("missing")} missing` : null,
    ].filter(Boolean).join(" · ");
}

/** The order a check of several copies takes on the server: the ones that need no download first. */
export function checkOrder(rows: CopyRow[]): CopyRow[] {
    return [...rows.filter((row) => row.checksNatively), ...rows.filter((row) => !row.checksNatively)];
}
