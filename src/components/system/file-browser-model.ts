/** One entry of a folder, as the filesystem API lists it. */
export interface FileEntry {
    name: string;
    type: "directory" | "file";
    path: string;
    /** Bytes, for files only. */
    size?: number;
    /** When the entry last changed, as an ISO string. */
    modified?: string;
}

export interface FolderListing {
    currentPath: string;
    parentPath: string;
    entries: FileEntry[];
}

/** The files a field takes. They carry a badge in the list, while the other files are dimmed. */
export interface FileAccept {
    label: string;
    extensions: string[];
}

export const SQLITE_FILES: FileAccept = { label: "SQLite", extensions: [".db", ".sqlite", ".sqlite3", ".db3"] };

/** Whether a file is one the field takes. Without a rule every file fits. */
export function fits(name: string, accept: FileAccept | undefined): boolean {
    if (!accept) return true;
    const lower = name.toLowerCase();
    return accept.extensions.some((extension) => lower.endsWith(extension));
}

/** "/data/sqlite" as the folders on the way there, each with the path that opens it. */
export function pathSegments(path: string): { name: string; path: string }[] {
    const parts = path.split("/").filter(Boolean);
    return parts.map((name, index) => ({ name, path: "/" + parts.slice(0, index + 1).join("/") }));
}

/** The folder a path sits in, "/" for anything at the top. */
export function parentOf(path: string): string {
    const trimmed = path.replace(/\/+$/, "");
    const cut = trimmed.lastIndexOf("/");
    return cut <= 0 ? "/" : trimmed.slice(0, cut);
}

/**
 * The entries the list shows: hidden ones only on request, files only while a file is picked,
 * and only names that contain the filter.
 */
export function visibleEntries(
    entries: FileEntry[],
    { showHidden, filter, selectionType }: { showHidden: boolean; filter: string; selectionType: "file" | "directory" }
): FileEntry[] {
    const term = filter.trim().toLowerCase();
    return entries.filter(
        (entry) =>
            (showHidden || !entry.name.startsWith(".")) &&
            (selectionType === "file" || entry.type === "directory") &&
            (!term || entry.name.toLowerCase().includes(term))
    );
}
