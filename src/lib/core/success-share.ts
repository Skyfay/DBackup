/** How many runs ended in each way that counts for the share of successes. */
export interface FinishedRuns {
    succeeded: number;
    /** Runs that stored a copy but missed another, which count against the share. */
    partial: number;
    failed: number;
}

/**
 * The share of runs that succeeded, in percent with one decimal, null while none finished. Only
 * finished runs count: a partial run against the share, a cancelled, running or waiting run not at
 * all. The Overview, History, the Jobs page and the panel of a job all count with it, so the same
 * runs give the same number everywhere.
 */
export function successShare({ succeeded, partial, failed }: FinishedRuns): number | null {
    const finished = succeeded + partial + failed;
    if (finished === 0) return null;
    return Math.round((succeeded / finished) * 1000) / 10;
}
