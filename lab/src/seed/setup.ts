/**
 * What the connections of the seed need on this machine: the local folders, the local SQLite
 * database and a folder of files to back up. What the servers need is in ../servers.ts.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import path from "path";
import { REPO_ROOT } from "../config";
import { runOrThrow } from "../docker";

export function ensureFolder(folder: string): string {
    mkdirSync(folder, { recursive: true });
    return folder;
}

/** A SQLite database of the dataset for the local mode, made with the sqlite3 DBackup needs anyway. */
export async function ensureLocalSqlite(file: string): Promise<string> {
    if (existsSync(file)) return file;
    ensureFolder(path.dirname(file));
    const dataset = readFileSync(path.join(REPO_ROOT, "lab", "datasets", "sqlite.sql"), "utf8");
    await runOrThrow("sqlite3", [file], { input: dataset });
    return file;
}

/** A few files for the directory backups, with a nested folder, a name with Unicode and binary data. */
export function ensureFilesFolder(folder: string): string {
    if (existsSync(path.join(folder, "README.txt"))) return folder;
    ensureFolder(path.join(folder, "docs", "2026"));
    writeFileSync(path.join(folder, "README.txt"), "Files of the DBackup dev lab, backed up by the Lab Files job.\n");
    writeFileSync(path.join(folder, "docs", "2026", "Grüezi 🦊.txt"), "Unicode in the name and in the content: Zoë, 李雷.\n");
    writeFileSync(path.join(folder, "docs", "notes.md"), "# Notes\n\nChange this file between two runs to see an incremental backup pick it up.\n");
    writeFileSync(path.join(folder, "random.bin"), Buffer.from(Array.from({ length: 64 * 1024 }, (_, index) => (index * 7919) % 256)));
    return folder;
}
