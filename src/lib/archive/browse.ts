/**
 * Derives a browsable directory tree from an archive's flat file index.
 *
 * The index stores one line per file with its full relative path. Rendering a folder tree
 * from that means grouping by path prefix, one level at a time, which is what these
 * helpers do. Everything here is pure so it can be tested without a storage adapter or a
 * database.
 */

import { ArchiveIndex, IndexFileLine } from "./types";

export interface BrowseEntry {
    name: string;
    /** Full path relative to the directory source root, POSIX separators. */
    path: string;
    type: "directory" | "file";
    /** Uncompressed size. For a directory, the total of everything beneath it. */
    size: number;
    /** ISO 8601 mtime. Files only. */
    mtime?: string;
    /** SHA-256 of the plaintext content. Files only. */
    checksum?: string;
    /** Number of files beneath this entry. Directories only. */
    fileCount?: number;
}

/** Normalizes a browse prefix to "" or "some/dir/". */
function normalizePrefix(prefix?: string): string {
    if (!prefix) return "";
    const trimmed = prefix.replace(/^\/+/, "").replace(/\/+$/, "");
    return trimmed.length === 0 ? "" : `${trimmed}/`;
}

/**
 * Lists the immediate children of one directory level within a directory source.
 *
 * @param index - Parsed archive index
 * @param jobSourceId - Which directory source to browse
 * @param prefix - Directory to list, relative to the source root. Omit for the root.
 */
export function browseLevel(index: ArchiveIndex, jobSourceId: string, prefix?: string): BrowseEntry[] {
    const normalized = normalizePrefix(prefix);
    const directories = new Map<string, { size: number; fileCount: number }>();
    const files: BrowseEntry[] = [];

    for (const file of index.files) {
        if (file.src !== jobSourceId) continue;
        if (normalized.length > 0 && !file.p.startsWith(normalized)) continue;

        const relative = file.p.slice(normalized.length);
        if (relative.length === 0) continue;

        const slash = relative.indexOf("/");
        if (slash === -1) {
            files.push({
                name: relative,
                path: file.p,
                type: "file",
                size: file.s,
                mtime: file.m,
                ...(file.h ? { checksum: file.h } : {}),
            });
            continue;
        }

        // Anything deeper rolls up into the immediate child directory, so a folder shows
        // its full recursive size rather than just what sits directly inside it.
        const name = relative.slice(0, slash);
        const existing = directories.get(name);
        if (existing) {
            existing.size += file.s;
            existing.fileCount += 1;
        } else {
            directories.set(name, { size: file.s, fileCount: 1 });
        }
    }

    const directoryEntries: BrowseEntry[] = [...directories.entries()].map(([name, stats]) => ({
        name,
        path: `${normalized}${name}`,
        type: "directory" as const,
        size: stats.size,
        fileCount: stats.fileCount,
    }));

    const byName = (a: BrowseEntry, b: BrowseEntry) => a.name.localeCompare(b.name);
    return [...directoryEntries.sort(byName), ...files.sort(byName)];
}

/**
 * Expands a selection of paths into the concrete files it covers.
 *
 * A selected path is either a file or a directory, and selecting a directory means
 * everything beneath it. Resolving this against the index rather than in the UI keeps the
 * client from having to enumerate a tree it never fully loaded.
 *
 * @param index - Parsed archive index
 * @param jobSourceId - Directory source the paths belong to
 * @param paths - Selected paths, relative to the source root
 */
export function resolveSelection(index: ArchiveIndex, jobSourceId: string, paths: string[]): IndexFileLine[] {
    const exact = new Set(paths.map((p) => p.replace(/^\/+/, "").replace(/\/+$/, "")));
    const prefixes = [...exact].map((p) => `${p}/`);

    return index.files.filter((file) => {
        if (file.src !== jobSourceId) return false;
        if (exact.has(file.p)) return true;
        return prefixes.some((prefix) => file.p.startsWith(prefix));
    });
}

/** Total uncompressed bytes of the given files. */
export function totalSize(files: IndexFileLine[]): number {
    return files.reduce((sum, file) => sum + file.s, 0);
}
