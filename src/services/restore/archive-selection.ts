/**
 * Turns a restore or download request into concrete index lines.
 *
 * One place decides what "the whole snapshot", "these paths" and "these databases" mean, so a
 * dry run, a streamed download and a write-back to storage can never disagree about what a
 * selection contains.
 */

import { resolveSelection } from "@/lib/archive/browse";
import { matchesAnyExcludePattern } from "@/lib/exclude-patterns";
import { ValidationError } from "@/lib/logging/errors";
import type { ArchiveIndex, IndexDatabaseLine, IndexFileLine } from "@/lib/archive/types";

export interface FileRestoreSelection {
    /** JobSource id of the directory source. */
    src: string;
    /**
     * Selected paths relative to that source's root. A directory selects everything below
     * it. Absent means the whole source.
     */
    paths?: string[];
}

export interface SelectionRequest {
    selections?: FileRestoreSelection[];
    /** Database names, as recorded in the archive index. */
    databases?: string[];
    excludePatterns?: string[];
}

export interface ResolvedContents {
    files: { src: string; file: IndexFileLine }[];
    databases: IndexDatabaseLine[];
}

/**
 * Expands a request into the files and database dumps it covers.
 *
 * Asking for neither files nor databases means the complete snapshot, which is what the
 * Storage Explorer's download sends, so the user gets every file and every dump rather than
 * an incremental's delta. Asking for either one means exactly that and nothing of the other
 * kind. Exclude patterns only ever apply to files.
 */
export function resolveContents(index: ArchiveIndex, request: SelectionRequest): ResolvedContents {
    const patterns = (request.excludePatterns ?? []).filter((p) => p.trim().length > 0);
    const keep = (file: IndexFileLine) => patterns.length === 0 || !matchesAnyExcludePattern(file.p, patterns);

    const hasSelections = !!request.selections && request.selections.length > 0;
    const hasDatabases = !!request.databases && request.databases.length > 0;

    if (!hasSelections && !hasDatabases) {
        return {
            files: index.files.filter(keep).map((file) => ({ src: file.src, file })),
            databases: [...index.databases],
        };
    }

    const files: ResolvedContents["files"] = [];
    const seen = new Set<string>();
    for (const selection of request.selections ?? []) {
        const matched = selection.paths && selection.paths.length > 0
            ? resolveSelection(index, selection.src, selection.paths)
            : index.files.filter((f) => f.src === selection.src);
        for (const file of matched) {
            if (!keep(file)) continue;
            const key = `${file.src}::${file.p}`;
            if (seen.has(key)) continue;
            seen.add(key);
            files.push({ src: selection.src, file });
        }
    }

    const databases: IndexDatabaseLine[] = [];
    const unknown: string[] = [];
    for (const name of new Set(request.databases ?? [])) {
        const line = index.databases.find((d) => d.name === name);
        if (line) databases.push(line);
        else unknown.push(name);
    }
    // Named rather than silently skipped: a caller asking for a database the backup does not
    // hold has the wrong backup, and an empty download would not tell them that.
    if (unknown.length > 0) {
        throw new ValidationError(
            `This backup does not contain the database(s): ${unknown.join(", ")}`,
            { field: "databases" }
        );
    }

    return { files, databases };
}

/**
 * What a download of this request produces.
 *
 * Exactly one database and no files is the single dump itself, decrypted and decompressed,
 * which is what someone fetching one customer's database wants to hand to their tools.
 * Everything else is a gzipped tar, because several items need a container. Decided by the
 * request alone, so a caller can predict the response before sending it.
 */
export function downloadShape(request: SelectionRequest): "dump" | "tar" {
    const hasSelections = !!request.selections && request.selections.length > 0;
    return !hasSelections && new Set(request.databases ?? []).size === 1 ? "dump" : "tar";
}
