/**
 * The rules of the download dialog: what can be picked, what a pick comes out as, and the
 * command that fetches it on another host. Free of React, so the tests read it directly.
 */

/** A database dump or a folder of a backup, as a row of the pick list. */
export interface DownloadItem {
    /** The database name, or the id of the folder source, which the request names. */
    id: string;
    name: string;
    detail: string;
    /** Bytes, when the backup recorded them. */
    size: number | null;
}

/** A group gets a search once it has this many entries. Below that the list is short enough to read. */
export const SEARCH_FROM = 8;

export type Tool = "curl" | "wget" | "powershell";

/** What a link or a download of the picked items comes out as. */
export type Output = "dump" | "tar" | null;

/** The entries of a group that the search shows, the search being a part of the name. */
export function shown(items: DownloadItem[], term: string): DownloadItem[] {
    const query = term.trim().toLowerCase();
    return query ? items.filter((item) => item.name.toLowerCase().includes(query)) : items;
}

/** The checkbox in the head of a group, for the entries the search shows. */
export function headState(visible: DownloadItem[], picked: ReadonlySet<string>): boolean | "indeterminate" {
    const count = visible.filter((item) => picked.has(item.id)).length;
    return visible.length > 0 && count === visible.length ? true : count > 0 ? "indeterminate" : false;
}

/** The head checkbox picks or drops what the search shows, and leaves the rest alone. */
export function toggleShown(visible: DownloadItem[], picked: ReadonlySet<string>, on: boolean): Set<string> {
    const next = new Set(picked);
    for (const item of visible) {
        if (on) next.add(item.id);
        else next.delete(item.id);
    }
    return next;
}

/** Bytes of the entries, or null when any of them has no size recorded. */
export function sizeOf(items: DownloadItem[]): number | null {
    return items.some((item) => item.size === null) ? null : items.reduce((sum, item) => sum + (item.size ?? 0), 0);
}

/** One database alone downloads as its dump, anything more as one tar.gz. */
export function outputOf(databases: DownloadItem[], folders: DownloadItem[]): Output {
    const count = databases.length + folders.length;
    if (count === 0) return null;
    return databases.length === 1 && folders.length === 0 ? "dump" : "tar";
}

/** What the request names for a pick. Everything is named, so a link can never mean more than was picked. */
export function requestOf(databases: DownloadItem[], folders: DownloadItem[]): { databases?: string[]; selections?: { src: string }[] } {
    return {
        ...(databases.length > 0 ? { databases: databases.map((item) => item.id) } : {}),
        ...(folders.length > 0 ? { selections: folders.map((item) => ({ src: item.id })) } : {}),
    };
}

function plural(count: number, noun: string): string {
    return `${count} ${noun}${count === 1 ? "" : "s"}`;
}

function names(items: DownloadItem[]): string {
    const list = items.map((item) => item.name);
    return list.length <= 1 ? list.join("") : `${list.slice(0, -1).join(", ")} and ${list[list.length - 1]}`;
}

/**
 * The title of a pick: a few names spelled out, a whole group named as such, many counted.
 * `total` is how many databases and folders the backup holds.
 */
export function pickTitle(databases: DownloadItem[], folders: DownloadItem[], total: { databases: number; folders: number }): string {
    const count = databases.length + folders.length;
    if (count === 0) return "Nothing is picked yet";
    const allDatabases = total.databases > 1 && databases.length === total.databases;
    const allFolders = total.folders > 1 && folders.length === total.folders;
    if (allDatabases && allFolders) return "Everything in the backup";
    if (allDatabases && folders.length === 0) return `All ${total.databases} databases`;
    if (allFolders && databases.length === 0) return `All ${total.folders} folders`;
    if (count <= 3) return names([...databases, ...folders]);
    return [databases.length > 0 ? plural(databases.length, "database") : null, folders.length > 0 ? plural(folders.length, "folder") : null].filter(Boolean).join(" and ");
}

/** The line under the title: how many, how big, and in what form. */
export function pickNote(databases: DownloadItem[], folders: DownloadItem[], formatBytes: (bytes: number) => string): string {
    const output = outputOf(databases, folders);
    if (output === null) return "Tick what you need. One database comes as its dump, more as one tar.gz.";
    const size = sizeOf([...databases, ...folders]);
    const parts = [
        `${databases.length + folders.length} picked`,
        size !== null ? formatBytes(size) : null,
        output === "dump" ? "its dump, decrypted and unpacked" : "one tar.gz, decrypted and unpacked",
    ];
    return parts.filter(Boolean).join(" · ");
}

const MISSING_LINK = "<make the link first>";

/**
 * The command that fetches a link on another host. curl and wget keep the name DBackup sends,
 * PowerShell needs it spelled out. curl gets -f, so a spent link fails instead of saving the
 * error as the file.
 */
export function commandFor(tool: Tool, url: string | null, fileName: string): string {
    const link = url ?? MISSING_LINK;
    if (tool === "curl") return `curl -fOJ "${link}"`;
    if (tool === "wget") return `wget --content-disposition "${link}"`;
    return `Invoke-WebRequest -UseBasicParsing -Uri '${link}' -OutFile '${fileName.replace(/'/g, "''")}'`;
}

/** The value to mark in a command, amber while it cannot work and green once it can. */
export function commandMark(url: string | null, usable: boolean): { text: string; tone: "warning" | "success" } {
    return { text: url ?? MISSING_LINK, tone: url && usable ? "success" : "warning" };
}
