/**
 * What a restore went through, kept in the metadata of its run, so the page of the run tells each
 * step like it tells a backup: where the restore read from and how much, and a row for every
 * database and folder with where it went, how big it was and how long it took.
 *
 * A customer's restore of a shared database keeps the same record without the destination and the
 * archive of the server, see `view`.
 */

import { versionShown } from "./shared-restore-log";

export type RestoredState = "waiting" | "restoring" | "done" | "failed";

export interface RestoredDatabase {
    /** The database in the backup. */
    name: string;
    /** The database it is restored into. */
    target: string;
    state: RestoredState;
    /** The size of its dump. */
    bytes: number | null;
    startedAt: string | null;
    endedAt: string | null;
    /** How far it is while it restores, from 0 to 100, as the adapter counts it. */
    percent: number | null;
    /** What the adapter says about it while it restores. */
    detail: string | null;
}

export interface RestoredFolder {
    /** The directory source in the archive. */
    id: string;
    label: string;
    /** Where its files go, like "Local Files:/srv/www". */
    target: string;
    /** The adapter of the storage its files go to. */
    adapterId: string | null;
    /** `partial` when some of its files arrived and some did not. */
    state: RestoredState | "partial";
    /** Files restored so far, out of `total`. */
    files: number;
    total: number;
    failed: number;
    /** Symbolic links the target cannot hold. */
    skipped: number;
    bytes: number;
    totalBytes: number;
    startedAt: string | null;
    endedAt: string | null;
}

export interface RestoreRecord {
    /** The destination it read from. Null in a customer's run, which never names it. */
    from: { name: string; adapterId: string } | null;
    /** The path of the archive at the destination. Null in a customer's run. */
    archive: string | null;
    /** Whether only the entries it needed were read, false when the backup was fetched in full. */
    ranged: boolean | null;
    /** Bytes read out of the backup so far. */
    read: number;
    /** The version of the server the backup was made of, and of the one it goes to. */
    backupVersion: string | null;
    targetVersion: string | null;
    databases: RestoredDatabase[];
    folders: RestoredFolder[];
}

export interface RestoreTracker {
    from(name: string, adapterId: string): void;
    archive(path: string): void;
    opened(ranged: boolean): void;
    versions(versions: { backup?: string | null; target?: string | null }): void;
    /** Adds bytes read out of the backup. */
    read(bytes: number): void;
    /** Sets what was read in all, for a backup fetched whole. */
    readTotal(bytes: number): void;
    planDatabases(databases: { name: string; target: string; bytes: number | null }[]): void;
    startDatabase(name: string): void;
    databaseProgress(name: string, percent: number, detail: string | null): void;
    endDatabase(name: string, restored: boolean): void;
    /** The folders of the restore, a folder whose target could not be opened as `failed`. */
    planFolders(folders: { id: string; label: string; target: string; adapterId: string | null; total: number; totalBytes: number; failed?: boolean }[]): void;
    /** One file or link of a folder, restored, failed, or a link its target cannot hold. */
    folderEntry(id: string, outcome: "restored" | "failed" | "skipped", bytes: number): void;
    endFolders(): void;
    /** The record as the metadata of a run keeps it, without the server's destination and archive for a customer. */
    view(customer: boolean): RestoreRecord;
}

const now = () => new Date().toISOString();

export function createRestoreTracker(): RestoreTracker {
    const record: RestoreRecord = { from: null, archive: null, ranged: null, read: 0, backupVersion: null, targetVersion: null, databases: [], folders: [] };
    const database = (name: string) => record.databases.find((entry) => entry.name === name);
    const folder = (id: string) => record.folders.find((entry) => entry.id === id);

    return {
        from(name, adapterId) {
            record.from = { name, adapterId };
        },
        archive(path) {
            record.archive = path;
        },
        opened(ranged) {
            record.ranged = ranged;
        },
        versions({ backup, target }) {
            if (backup) record.backupVersion = backup;
            if (target) record.targetVersion = target;
        },
        read(bytes) {
            if (Number.isFinite(bytes) && bytes > 0) record.read += bytes;
        },
        readTotal(bytes) {
            if (Number.isFinite(bytes) && bytes >= 0) record.read = bytes;
        },
        planDatabases(databases) {
            record.databases = databases.map((entry) => ({ ...entry, state: "waiting", startedAt: null, endedAt: null, percent: null, detail: null }));
        },
        startDatabase(name) {
            const entry = database(name);
            if (!entry) return;
            entry.state = "restoring";
            entry.startedAt = now();
        },
        databaseProgress(name, percent, detail) {
            const entry = database(name);
            if (!entry || entry.state !== "restoring") return;
            entry.percent = Math.max(0, Math.min(100, Math.round(percent)));
            entry.detail = detail;
        },
        endDatabase(name, restored) {
            const entry = database(name);
            if (!entry) return;
            entry.state = restored ? "done" : "failed";
            entry.endedAt = now();
            entry.percent = null;
            entry.detail = null;
        },
        planFolders(folders) {
            record.folders = folders.map(({ failed, ...entry }) => ({ ...entry, state: failed ? "failed" : "waiting", files: 0, failed: 0, skipped: 0, bytes: 0, startedAt: null, endedAt: null }));
        },
        folderEntry(id, outcome, bytes) {
            const entry = folder(id);
            if (!entry) return;
            if (entry.state === "waiting") {
                entry.state = "restoring";
                entry.startedAt = now();
            }
            if (outcome === "restored") entry.files += 1;
            else if (outcome === "failed") entry.failed += 1;
            else entry.skipped += 1;
            if (outcome === "restored") entry.bytes += bytes;
            entry.endedAt = now();
        },
        endFolders() {
            for (const entry of record.folders) {
                if (entry.state !== "waiting" && entry.state !== "restoring") continue;
                const missing = entry.failed + entry.skipped;
                entry.state = missing === 0 ? "done" : entry.files > 0 ? "partial" : "failed";
                entry.startedAt ??= now();
                entry.endedAt ??= now();
            }
        },
        view(customer) {
            const copy: RestoreRecord = structuredClone(record);
            // The customer reads the versions by their number, without the build and system of the server.
            return customer
                ? { ...copy, from: null, archive: null, backupVersion: versionShown(copy.backupVersion), targetVersion: versionShown(copy.targetVersion) }
                : copy;
        },
    };
}
