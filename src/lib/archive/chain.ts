/**
 * Chain bookkeeping for incremental archives.
 *
 * An incremental archive only stores what changed, but its index still describes the whole
 * tree. Unchanged files keep pointing at whichever archive already holds their bytes, so a
 * restore resolves a snapshot in a single lookup rather than replaying the chain forward.
 *
 * Everything here is pure, so the rules that decide what carries forward and which archives
 * a snapshot depends on can be tested without a runner, a storage adapter or a database.
 */

import {
    ArchiveIndex,
    CarriedIndexContent,
    entryKey,
    IndexEntryLine,
    IndexFileLine,
} from "./types";

/** Identifies a file within a snapshot. Paths are only unique per directory source. */
export function fileKey(src: string, path: string): string {
    // Separated by NUL, written as an escape so it stays visible in the source. It is
    // the one byte that cannot occur in a path, so the key is unambiguous.
    return `${src}\u0000${path}`;
}

/**
 * Carries unchanged files forward from the previous snapshot.
 *
 * @param previous - Parsed index of the predecessor snapshot
 * @param previousArchive - Filename of the predecessor archive
 * @param keep - Files to carry, as fileKey() values. Anything absent has been re-stored in
 * the new archive or no longer exists at the source.
 */
export function carryForward(
    previous: ArchiveIndex,
    previousArchive: string,
    keep: ReadonlySet<string>
): CarriedIndexContent {
    const files: IndexFileLine[] = [];
    const neededEntries = new Map<string, string | undefined>();

    for (const line of previous.files) {
        if (!keep.has(fileKey(line.src, line.p))) continue;

        // A line with no `a` lives in the predecessor itself. One that already has `a`
        // was carried before and keeps pointing further back, so chains never nest.
        const archive = line.a ?? previousArchive;
        files.push({ ...line, a: archive });
        neededEntries.set(entryKey(archive, line.n), line.a);
    }

    const entries: IndexEntryLine[] = [];
    for (const [key, originalArchive] of neededEntries) {
        const ordinal = Number(key.slice(key.lastIndexOf("#") + 1));
        const archive = key.slice(0, key.lastIndexOf("#"));
        const entry = previous.entries.get(entryKey(originalArchive, ordinal));
        if (!entry) {
            throw new Error(
                `Cannot carry forward from '${previousArchive}': its index references missing entry ${ordinal}`
            );
        }
        entries.push({ ...entry, a: archive });
    }

    return { files, entries };
}

/** Archives a snapshot needs besides its own, derived from its file lines. */
export function dependenciesOf(files: readonly IndexFileLine[]): string[] {
    return [...new Set(files.map((f) => f.a).filter((a): a is string => !!a))].sort();
}

export interface ChainCompleteness {
    complete: boolean;
    /** Archives referenced by the snapshot that are not available. */
    missing: string[];
}

/**
 * Checks a snapshot against the archives actually present.
 *
 * Called before a restore starts so a gap is reported by name up front, instead of
 * surfacing halfway through as a confusing failure on an individual file.
 */
export function checkChainCompleteness(
    index: ArchiveIndex,
    availableArchives: ReadonlySet<string>
): ChainCompleteness {
    const missing = index.deps.filter((archive) => !availableArchives.has(archive));
    return { complete: missing.length === 0, missing };
}
