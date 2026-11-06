import { INDEX_MAX_INFLATED_BYTES, INDEX_MAX_LINES } from "@/lib/archive/limits";

/**
 * Bounds on the listing of a directory source.
 *
 * The server of a source may belong to a customer, and the walk keeps every entry in memory until
 * the collection is done. A tree of a hundred million names, or names of megabytes each, would
 * fill the memory of the one process all tenants share long before anything is transferred. Each
 * limit is far past what a real tree holds, and each matches what a restore reads back: an index
 * of at most `INDEX_MAX_LINES` lines, none longer than `INDEX_MAX_LINE_BYTES`.
 */

/** The most entries a directory source lists, files, links and refused names together. */
export const LISTING_MAX_ENTRIES = INDEX_MAX_LINES;

/**
 * The longest path or link target of an entry, in bytes. A file system allows 4 KB for a whole
 * path and S3 1 KB for a key. An index line holds a path and a link target, each escaped to at
 * most six times its bytes, so two of these stay below the line limit of a restore.
 */
export const LISTING_MAX_NAME_BYTES = 32 * 1024;

/**
 * The most bytes of paths and link targets one listing holds, all its entries together. The names
 * of a listing go into the index of the backup, which a restore reads back up to
 * `INDEX_MAX_INFLATED_BYTES`, so a listing past it could never be restored. Ten million entries of
 * 200 bytes each fit, and the count alone would let ten million names of 32 KB each through, 320 GB.
 */
export const LISTING_MAX_TOTAL_BYTES = INDEX_MAX_INFLATED_BYTES;

/** A listing past `LISTING_MAX_ENTRIES`, `LISTING_MAX_TOTAL_BYTES` or with a name past `LISTING_MAX_NAME_BYTES`. */
export class ListingTooLargeError extends Error {
    constructor(message: string) {
        super(message);
        this.name = "ListingTooLargeError";
    }
}

/** Why one name of a listing may not be kept, or null. */
export function listedNameProblem(name: string): string | null {
    const bytes = Buffer.byteLength(name, "utf-8");
    return bytes > LISTING_MAX_NAME_BYTES
        ? `The source lists a name of ${bytes} bytes, longer than the ${LISTING_MAX_NAME_BYTES} any file system allows. The source cannot be backed up as it is.`
        : null;
}

/**
 * Counts the entries of one listing as they arrive and fails it past the limits, so the walk
 * stops there instead of at the end of a tree of any size.
 */
export interface ListingGuard {
    /** Takes one entry, its path and its link target, or throws `ListingTooLargeError`. */
    add(path: string, linkTarget?: string): void;
    /** How many entries it took. */
    readonly count: number;
}

export function createListingGuard(maxEntries: number = LISTING_MAX_ENTRIES, maxTotalBytes: number = LISTING_MAX_TOTAL_BYTES): ListingGuard {
    let count = 0;
    let totalBytes = 0;
    return {
        add(path: string, linkTarget?: string) {
            count++;
            if (count > maxEntries) {
                throw new ListingTooLargeError(
                    `The source lists more than ${maxEntries} entries, more than one backup holds. Back up its subfolders as separate sources.`
                );
            }
            const problem = listedNameProblem(path) ?? (linkTarget !== undefined ? listedNameProblem(linkTarget) : null);
            if (problem) throw new ListingTooLargeError(problem);
            totalBytes += Buffer.byteLength(path, "utf-8") + (linkTarget !== undefined ? Buffer.byteLength(linkTarget, "utf-8") : 0);
            if (totalBytes > maxTotalBytes) {
                throw new ListingTooLargeError(
                    `The names the source lists add up to more than ${maxTotalBytes} bytes, more than the index of one backup holds. Back up its subfolders as separate sources.`
                );
            }
        },
        get count() {
            return count;
        },
    };
}

/**
 * Whether a walker may go down into a folder of this name. The server answers a listing with
 * whatever names it likes, and one that is empty, of dots alone or holds a `/` would make the walk
 * read the folder it is in, or one above it, again and again.
 */
export function descendableName(name: string): boolean {
    return name !== "" && !/^\.+$/.test(name) && !name.includes("/") && !name.includes("\0");
}

/** How many pages in a row a paged listing may answer without an entry before it is ended. */
export const LISTING_MAX_EMPTY_PAGES = 1000;

/**
 * The longest page token a paged listing takes, in bytes. S3 and Google Drive hand out a few
 * hundred bytes, a next link of OneDrive or a cursor of Dropbox a few KB at most.
 */
export const LISTING_MAX_TOKEN_BYTES = 16 * 1024;

/**
 * The most bytes of page tokens one listing keeps to find a token handed out twice. Tokens of a
 * few hundred bytes leave room for a hundred thousand pages and more, far past the ten million
 * entries a listing may hold at the page sizes of the storages.
 */
export const LISTING_MAX_SEEN_TOKEN_BYTES = 64 * 1024 * 1024;

/**
 * Ends a paged listing whose server never ends it: one that hands out a page token it handed out
 * before, which would start the same pages over, or answers page after page without an entry,
 * which the count of `createListingGuard` never sees. The tokens it keeps are bounded too, each by
 * `LISTING_MAX_TOKEN_BYTES` and all of them by `LISTING_MAX_SEEN_TOKEN_BYTES`.
 */
export interface PageGuard {
    /** Takes the token of the next page and how many entries the page that named it held, or throws `ListingTooLargeError`. */
    next(token: string | null | undefined, entries: number): void;
}

export function createPageGuard(
    maxEmptyPages: number = LISTING_MAX_EMPTY_PAGES,
    maxTokenBytes: number = LISTING_MAX_TOKEN_BYTES,
    maxSeenTokenBytes: number = LISTING_MAX_SEEN_TOKEN_BYTES
): PageGuard {
    const seen = new Set<string>();
    let seenBytes = 0;
    let empty = 0;
    return {
        next(token, entries) {
            empty = entries > 0 ? 0 : empty + 1;
            if (empty > maxEmptyPages) {
                throw new ListingTooLargeError(`The storage answered more than ${maxEmptyPages} pages of its listing in a row without an entry.`);
            }
            if (!token) return;
            const bytes = Buffer.byteLength(token, "utf-8");
            if (bytes > maxTokenBytes) {
                throw new ListingTooLargeError(`The storage handed out a page token of ${bytes} bytes, longer than the ${maxTokenBytes} a listing takes.`);
            }
            if (seen.has(token)) throw new ListingTooLargeError("The storage handed out a page of its listing it had handed out before.");
            seenBytes += bytes;
            if (seenBytes > maxSeenTokenBytes) {
                throw new ListingTooLargeError(`The page tokens of the listing add up to more than ${maxSeenTokenBytes} bytes.`);
            }
            seen.add(token);
        },
    };
}

/** Checks a whole listing at once, for an adapter whose walk could not be checked as it ran. */
export function assertListingWithinLimits(entries: readonly { path: string; linkTarget?: string }[], maxEntries: number = LISTING_MAX_ENTRIES): void {
    if (entries.length > maxEntries) {
        throw new ListingTooLargeError(
            `The source lists more than ${maxEntries} entries, more than one backup holds. Back up its subfolders as separate sources.`
        );
    }
    const guard = createListingGuard(Number.POSITIVE_INFINITY);
    for (const entry of entries) guard.add(entry.path, entry.linkTarget);
}
