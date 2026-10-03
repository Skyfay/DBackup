/**
 * The restore page: which database goes where and what happens to it, the groups of the lines
 * view and the sentences of the bar. Plain functions without React, so the rules can be tested.
 */

import type { ArchiveTreeSelection } from "@/components/dashboard/storage/archive-tree-selection";

/** A database of the backup and the name it gets on the server it is restored into. */
export interface DbChoice {
    id: string;
    name: string;
    targetName: string;
    selected: boolean;
}

/** A database the server has right now, from its statistics. */
export interface ServerDatabase {
    name: string;
    sizeInBytes?: number;
    tableCount?: number;
    /** Firebird only: the path of this alias. */
    path?: string;
}

/**
 * What a restore does to a database. `unverified` is a target DBackup cannot look into, like a
 * Firebird path, `stays` one only the server has, which the restore leaves as it is.
 */
export type DbOutcome = "overwrite" | "new" | "unverified" | "out" | "stays";

export interface DbRow {
    id: string;
    /** Its name in the backup, null for a database only the server has. */
    source: string | null;
    /** Bytes in the backup, when the backup says. */
    size: number | null;
    picked: boolean;
    /** Its name on the server afterwards. */
    target: string;
    outcome: DbOutcome;
    /** Bytes of the database of that name on the server now. */
    thereSize: number | null;
}

/** The rows of the list: every database of the backup, then the ones only the server has. */
export function buildDbRows(choices: DbChoice[], server: ServerDatabase[], sizes: Map<string, number>, unverified: boolean): DbRow[] {
    const byName = new Map(server.map((database) => [database.name, database]));
    const rows: DbRow[] = choices.map((choice) => {
        const there = byName.get(choice.targetName);
        const outcome: DbOutcome = !choice.selected ? "out" : unverified ? "unverified" : there ? "overwrite" : "new";
        return {
            id: choice.id,
            source: choice.name,
            size: sizes.get(choice.name) ?? null,
            picked: choice.selected,
            target: choice.targetName,
            outcome,
            thereSize: there?.sizeInBytes ?? null,
        };
    });
    const touched = new Set(choices.filter((choice) => choice.selected).map((choice) => choice.targetName));
    const staying = server
        .filter((database) => !touched.has(database.name))
        .sort((a, b) => a.name.localeCompare(b.name))
        .map<DbRow>((database) => ({
            id: `there:${database.name}`,
            source: null,
            size: null,
            picked: false,
            target: database.name,
            outcome: "stays",
            thereSize: database.sizeInBytes ?? null,
        }));
    return [...rows, ...staying];
}

export type DbFilter = "all" | "overwrite" | "new" | "stays" | "out";

export function matchesFilter(row: DbRow, filter: DbFilter): boolean {
    if (filter === "all") return true;
    if (filter === "new") return row.outcome === "new" || row.outcome === "unverified";
    return row.outcome === filter;
}

export function filterCounts(rows: DbRow[]): Record<DbFilter, number> {
    const counts: Record<DbFilter, number> = { all: rows.length, overwrite: 0, new: 0, stays: 0, out: 0 };
    for (const row of rows) {
        for (const filter of ["overwrite", "new", "stays", "out"] as const) {
            if (matchesFilter(row, filter)) counts[filter]++;
        }
    }
    return counts;
}

/**
 * The groups of the lines view. Databases that do the same under their own names share one line,
 * a database under another name gets a line of its own, and the ones left out share a row.
 */
export interface LineGroup {
    key: string;
    outcome: DbOutcome;
    rows: DbRow[];
    /** Restored under another name than it has in the backup. */
    renamed: boolean;
}

export function lineGroups(rows: DbRow[]): LineGroup[] {
    const fromBackup = rows.filter((row) => row.source !== null);
    const groups: LineGroup[] = [];
    for (const outcome of ["overwrite", "new", "unverified"] as const) {
        const same = fromBackup.filter((row) => row.picked && row.outcome === outcome && row.target === row.source);
        if (same.length > 0) groups.push({ key: `same:${outcome}`, outcome, rows: same, renamed: false });
    }
    for (const row of fromBackup.filter((entry) => entry.picked && entry.target !== entry.source)) {
        groups.push({ key: `renamed:${row.id}`, outcome: row.outcome, rows: [row], renamed: true });
    }
    const out = fromBackup.filter((row) => !row.picked);
    if (out.length > 0) groups.push({ key: "out", outcome: "out", rows: out, renamed: false });
    return groups;
}

/** A free name for a copy beside a database: shop becomes shop_restored, then shop_restored_2. */
export function copyName(name: string, taken: Set<string>): string {
    const base = `${name}_restored`;
    if (!taken.has(base)) return base;
    for (let index = 2; ; index++) {
        const candidate = `${base}_${index}`;
        if (!taken.has(candidate)) return candidate;
    }
}

function plural(count: number, noun: string): string {
    return `${count} ${noun}${count === 1 ? "" : "s"}`;
}

/** A few rows by name, like "shop and billing", or null when there are too many to name. */
function listed(rows: DbRow[], describe: (row: DbRow) => string): string | null {
    return rows.length <= 2 ? rows.map(describe).join(" and ") : null;
}

/** The sentence of the bar for the databases, like "shop is overwritten, billing comes back as billing_restored". */
export function databaseSentence(rows: DbRow[]): string {
    const picked = rows.filter((row) => row.picked && row.source !== null);
    if (picked.length === 0) return "No database is picked";
    const overwritten = picked.filter((row) => row.outcome === "overwrite");
    const renamed = picked.filter((row) => row.outcome !== "overwrite" && row.target !== row.source);
    const fresh = picked.filter((row) => row.outcome !== "overwrite" && row.target === row.source);
    const parts: string[] = [];
    if (overwritten.length > 0) {
        const who = listed(overwritten, (row) => row.target);
        parts.push(who ? `${who} ${overwritten.length === 1 ? "is" : "are"} overwritten` : `${overwritten.length} databases are overwritten`);
    }
    if (renamed.length > 0) {
        parts.push(listed(renamed, (row) => `${row.source} comes back as ${row.target}`) ?? `${renamed.length} come back under new names`);
    }
    if (fresh.length > 0) {
        const who = listed(fresh, (row) => row.target);
        parts.push(who ? `${who} ${fresh.length === 1 ? "is" : "are"} new there` : `${fresh.length} are new there`);
    }
    return parts.join(", ");
}

export function pickedCount(rows: DbRow[]): number {
    return rows.filter((row) => row.picked && row.source !== null).length;
}

/** What the button says, like "Restore 2 databases, 1 folder". */
export function restoreLabel(databases: number, folders: number): string {
    const parts = [...(databases > 0 ? [plural(databases, "database")] : []), ...(folders > 0 ? [plural(folders, "folder")] : [])];
    return parts.length > 0 ? `Restore ${parts.join(", ")}` : "Restore";
}

export { plural };

/** A folder source of the backup and where it goes. */
export interface FolderChoice {
    entryId: string;
    label: string;
    targetConfigId: string;
    targetPath: string;
    selected: boolean;
    /** null for everything in the source, a list for only these paths. */
    selection: ArchiveTreeSelection;
    showTree?: boolean;
    checkStatus?: "checking" | "empty" | "occupied" | "unverified";
}

/**
 * What a restore does to the path of a folder. `emptied` is a volume that exists and is emptied
 * before the backup goes in, which is a very different promise from replacing files of the same name.
 */
export type FolderOutcome = "replaces" | "emptied" | "empty" | "checking" | "unverified" | "incomplete" | "out";

export function folderOutcome(folder: FolderChoice, flat: boolean): FolderOutcome {
    if (!folder.selected) return "out";
    if (!folder.targetConfigId || !folder.targetPath.trim()) return "incomplete";
    if (folder.checkStatus === "occupied") return flat ? "emptied" : "replaces";
    if (folder.checkStatus === "empty") return "empty";
    if (folder.checkStatus === "unverified") return "unverified";
    return "checking";
}

/** Why the Restore button waits, or null when it can go. */
export function restoreBlocker(input: {
    needsServer: boolean;
    server: string;
    blockedBy: string | null;
    anything: boolean;
    folders: FolderChoice[];
    planError: string | null;
}): string | null {
    if (input.blockedBy) return input.blockedBy;
    if (!input.anything) return "Pick a database or a folder to restore";
    if (input.needsServer && !input.server) return "Pick the server the databases go to";
    const folder = input.folders.find((entry) => entry.selected && (!entry.targetConfigId || !entry.targetPath.trim()));
    if (folder) return `${folder.label} needs a directory source and a path`;
    const empty = input.folders.find((entry) => entry.selected && entry.selection !== null && entry.selection.length === 0);
    if (empty) return `No file of ${empty.label} is picked, leave the folder out instead`;
    return input.planError;
}
