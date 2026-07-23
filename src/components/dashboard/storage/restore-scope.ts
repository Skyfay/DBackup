/**
 * Restore scope - which half of a backup a restore should touch.
 *
 * A manifest v2 archive can hold databases and directory sources at once. Restoring both
 * is rarely what someone wants when they came for one of them, so the Storage Explorer
 * asks up front and passes the answer to the restore page as a URL parameter. Everything
 * here is pure so the rules can be tested without rendering either side.
 */

/** What to restore from a backup that contains both databases and directory sources. */
export type RestoreMode = "all" | "databases" | "files";

/** Counts of what a combined (manifest v2) backup contains. */
export interface CombinedContents {
    databases: number;
    directorySources: number;
}

/**
 * Whether the restore action needs to ask what to restore.
 *
 * Only true when the backup actually holds both kinds - a database-only or files-only
 * backup has exactly one answer, so asking would just add a click.
 */
export function needsRestoreScopeChoice(combined?: CombinedContents | null): boolean {
    return !!combined && combined.databases > 0 && combined.directorySources > 0;
}

/**
 * Reads the scope out of the restore page's `mode` parameter.
 *
 * Anything unrecognised - including the parameter being absent, which is the case for
 * every single-kind backup and every older deep link - means "restore everything".
 *
 * The restore request carries this value as well as the page using it: the backend reads
 * an omitted database or directory mapping as "restore all of them", so it cannot tell a
 * half that was left out on purpose from one the caller simply did not mention.
 */
export function normalizeRestoreScope(param: string | null | undefined): RestoreMode {
    return param === "databases" || param === "files" ? param : "all";
}

/** The same decision as {@link normalizeRestoreScope}, as the two flags the page renders from. */
export function parseRestoreScope(param: string | null | undefined): {
    wantsDatabases: boolean;
    wantsFiles: boolean;
} {
    const scope = normalizeRestoreScope(param);
    return {
        wantsDatabases: scope !== "files",
        wantsFiles: scope !== "databases",
    };
}
