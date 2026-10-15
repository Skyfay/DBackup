import { Lock, LockOpen, Trash2 } from "lucide-react";
import type { BulkAction } from "@/components/ui/data-table";
import type { BulkResult } from "@/lib/core/bulk";
import type { BackupRun } from "@/services/storage/explorer-types";
import { isLocked, runKey, targetsOf } from "./backup-filters";
import { count } from "./explorer-format";
import { bulkAcross } from "./use-backup-actions";

/** Turns the results per copy into results per backup, which is what the list selected. */
function perRun(result: BulkResult, runs: BackupRun[], at: string[]): BulkResult {
    const failedIds = new Map(result.failed.map((failure) => [failure.id, failure]));
    const merged: BulkResult = { succeeded: [], failed: [] };
    for (const run of runs) {
        const ids = targetsOf(run, at).map((target) => `${target.destinationId}:${target.file.path}`);
        const failure = ids.map((id) => failedIds.get(id)).find((entry) => entry !== undefined);
        if (failure) merged.failed.push({ id: runKey(run), name: run.file.name, error: failure.error });
        else merged.succeeded.push(runKey(run));
    }
    return merged;
}

/**
 * What the selected backups of the list can do together: lock, unlock and delete their copies within
 * the destinations of the filter. `scopeName` names those destinations in the confirmation.
 */
export function backupBulkActions(canDelete: boolean, at: string[], scopeName: string): BulkAction<BackupRun>[] {
    if (!canDelete) return [];
    const run = (action: "delete" | "lock" | "unlock") => async (rows: BackupRun[]) =>
        perRun(await bulkAcross(action, rows.flatMap((row) => targetsOf(row, at))), rows, at);
    const unreachable = (row: BackupRun) => (targetsOf(row, at).length === 0 ? "No copy of it there" : null);
    return [
        {
            id: "lock",
            labels: { verb: "lock", verbPast: "locked", noun: "backup" },
            icon: Lock,
            isAvailable: (rows) => rows.some((row) => !isLocked(row, at)),
            itemName: (row) => row.file.name,
            ineligible: (row) => unreachable(row) ?? (isLocked(row, at) ? "Already locked" : null),
            run: run("lock"),
        },
        {
            id: "unlock",
            labels: { verb: "unlock", verbPast: "unlocked", noun: "backup" },
            icon: LockOpen,
            isAvailable: (rows) => rows.some((row) => isLocked(row, at)),
            itemName: (row) => row.file.name,
            ineligible: (row) => unreachable(row) ?? (isLocked(row, at) ? null : "Not locked"),
            run: run("unlock"),
        },
        {
            id: "delete",
            labels: { verb: "delete", verbPast: "deleted", noun: "backup" },
            icon: Trash2,
            variant: "destructive",
            itemName: (row) => row.file.name,
            itemDetail: (row) => count(targetsOf(row, at).length, "copy", "copies"),
            // A locked backup was protected on purpose. The server refuses it as well.
            ineligible: (row) => unreachable(row) ?? (isLocked(row, at) ? "Locked, unlock it first" : null),
            confirm: {
                title: (rows) => `Delete ${rows.length} backup${rows.length === 1 ? "" : "s"}?`,
                description: () => (at.length > 0 ? `This removes them from ${scopeName}.` : "This removes every copy of them, at every destination of their job."),
                confirmLabel: "Delete",
            },
            run: run("delete"),
        },
    ];
}
