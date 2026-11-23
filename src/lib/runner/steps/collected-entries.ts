/**
 * The last check of a collected directory source before anything of it is read.
 *
 * Every adapter refuses the names of its listing that cannot be a file of the collection folder,
 * but the runner does not take that on trust: the server of a source may belong to a customer, and
 * an adapter that misses one would let a name like `../../data/dbackup.db` pack a file of the
 * server DBackup runs on into the archive the customer downloads. So every entry is checked here
 * again, for every adapter, and every file read now is read through `openCollectedFile`, which
 * reads only a regular file whose real path lies inside the collection folder, never through a link.
 */

import type { DirectoryFileEntry } from "@/lib/core/interfaces";
import { CollectedPathError, resolveCollectedPath, shownCollectedPath } from "@/lib/archive/collected-paths";
import { hashCollectedFile } from "@/lib/archive/collected-file";
import { mapWithConcurrency } from "@/lib/concurrency";

export interface CheckedCollection {
    /** The entries that stay, in listing order. */
    entries: DirectoryFileEntry[];
    /**
     * The files transferred in this run with their SHA-256 and their size as they lie in the
     * collection folder, in listing order. The size the listing reported may differ, from a file
     * that grew between listing and transfer or from a server that reports what it likes.
     */
    hashed: { entry: DirectoryFileEntry; checksum: string; size: number }[];
    /** What was refused, for the run log, with the name as the log shows it. */
    refused: { path: string; error: string }[];
}

export interface CheckCollectionOptions {
    /** How many files are hashed at once. */
    concurrency: number;
    signal?: AbortSignal;
    /** Called after each file is hashed, for the progress text. */
    onHashed?: (done: number, total: number) => void;
}

/** Why the name of an entry may not be used below `localDir`, or null. */
function nameProblem(localDir: string, relativePath: string): string | null {
    try {
        resolveCollectedPath(localDir, relativePath);
        return null;
    } catch (error) {
        if (error instanceof CollectedPathError) return error.reason;
        throw error;
    }
}

/**
 * Checks the entries of a collected source and hashes the files transferred now.
 *
 * A name that leaves `localDir`, and a transferred file that is a link, a device, a pipe or a socket
 * or whose real path leads out of `localDir`, is refused and named. A link of the source stays an
 * entry, packed from its target string and never followed. Any other failure, like a file the
 * listing named that never arrived, is thrown as before.
 */
export async function checkCollectedEntries(
    localDir: string,
    listed: DirectoryFileEntry[],
    options: CheckCollectionOptions
): Promise<CheckedCollection> {
    const refused: CheckedCollection["refused"] = [];
    const named: DirectoryFileEntry[] = [];
    for (const entry of listed) {
        const problem = nameProblem(localDir, entry.relativePath);
        if (problem) refused.push({ path: shownCollectedPath(entry.relativePath), error: `refused, ${problem}` });
        else named.push(entry);
    }

    // Links have no bytes here and unchanged files were never transferred, so only the rest is read.
    const toHash = named.filter((e) => !e.unchanged && e.linkTarget === undefined);
    let done = 0;
    const outcomes = await mapWithConcurrency(toHash, options.concurrency, async (entry) => {
        options.signal?.throwIfAborted();
        try {
            const { checksum, size } = await hashCollectedFile(localDir, entry.relativePath);
            done++;
            options.onHashed?.(done, toHash.length);
            return { checksum, size };
        } catch (error) {
            if (error instanceof CollectedPathError) return { refusal: error.reason };
            throw error;
        }
    });

    const dropped = new Set<DirectoryFileEntry>();
    const hashed: CheckedCollection["hashed"] = [];
    toHash.forEach((entry, i) => {
        const outcome = outcomes[i];
        if ("refusal" in outcome) {
            refused.push({ path: shownCollectedPath(entry.relativePath), error: `refused, ${outcome.refusal}` });
            dropped.add(entry);
        } else {
            hashed.push({ entry, checksum: outcome.checksum, size: outcome.size });
        }
    });

    return { entries: named.filter((e) => !dropped.has(e)), hashed, refused };
}
