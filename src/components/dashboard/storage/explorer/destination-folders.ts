import type { CopyState, DestinationBackup, ExplorerJob, ExplorerJobKind } from "@/services/storage/explorer-types";
import { madeAt } from "./explorer-format";

/**
 * The backups of one destination as folders, one per job, like the storage keeps them: every job
 * writes into a folder of its own. Kept free of React so it can be tested.
 */
export interface BackupFolder {
    key: string;
    job: ExplorerJob | null;
    name: string;
    kind: ExplorerJobKind;
    /** Newest first. */
    backups: DestinationBackup[];
    size: number;
    newest: string;
    failed: number;
    locked: number;
    /** The other destinations that hold copies of its backups, stored when any copy is there. */
    elsewhere: { destinationId: string; state: CopyState }[];
    /** Copies of its backups missing at the other destinations of its job. */
    missing: number;
}

const KIND_ORDER: Record<ExplorerJobKind, number> = { job: 0, deleted: 1, system: 2, none: 3 };

export function foldersOf(backups: DestinationBackup[], jobs: Map<string, ExplorerJob>): BackupFolder[] {
    const byKey = new Map<string, DestinationBackup[]>();
    for (const backup of backups) {
        const list = byKey.get(backup.jobKey) ?? [];
        list.push(backup);
        byKey.set(backup.jobKey, list);
    }

    const folders: BackupFolder[] = [];
    for (const [key, list] of byKey) {
        const job = jobs.get(key) ?? null;
        const sorted = [...list].sort((a, b) => Date.parse(madeAt(b.file)) - Date.parse(madeAt(a.file)));
        const elsewhere = new Map<string, CopyState>();
        let missing = 0;
        for (const backup of sorted) {
            for (const copy of backup.elsewhere) {
                if (copy.state === "missing") missing++;
                if (copy.state === "stored") elsewhere.set(copy.destinationId, "stored");
                else if (!elsewhere.has(copy.destinationId)) elsewhere.set(copy.destinationId, "missing");
            }
        }
        folders.push({
            key,
            job,
            name: job?.name ?? "Without a job",
            kind: job?.kind ?? "none",
            backups: sorted,
            size: sorted.reduce((sum, backup) => sum + backup.file.size, 0),
            newest: madeAt(sorted[0].file),
            failed: sorted.filter((backup) => backup.file.verification?.passed === false).length,
            locked: sorted.filter((backup) => backup.file.locked).length,
            elsewhere: [...elsewhere.entries()].map(([destinationId, state]) => ({ destinationId, state })),
            missing,
        });
    }

    return folders.sort((a, b) => KIND_ORDER[a.kind] - KIND_ORDER[b.kind] || a.name.localeCompare(b.name));
}
