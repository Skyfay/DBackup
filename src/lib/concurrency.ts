/**
 * Runs an async function over a list with a bounded number of calls in flight.
 *
 * Used to parallelise per-file work in the backup and restore paths, where processing one
 * file at a time is dominated by network round-trip latency. Results keep the input order
 * regardless of completion order, so callers that build an index or a manifest from the
 * results get a stable layout.
 *
 * A `limit` of 1 or less runs strictly sequentially - callers that must stay ordered (the
 * tar download stream) can pass 1 and take this path without a separate code branch. The
 * first item to reject aborts the whole call and no further items are started; callers that
 * want per-item failure handling (backup collection, storage restore) should catch inside
 * `fn` and return a result rather than throw.
 */
export async function mapWithConcurrency<T, R>(
    items: readonly T[],
    limit: number,
    fn: (item: T, index: number) => Promise<R>
): Promise<R[]> {
    const results: R[] = new Array(items.length);
    if (items.length === 0) return results;

    const workers = Math.max(1, Math.min(Math.floor(limit) || 1, items.length));
    let cursor = 0;

    const runWorker = async (): Promise<void> => {
        // Each worker pulls the next index until the list is exhausted. A shared cursor is
        // safe here because Node runs this single-threaded and the increment never spans an
        // await.
        while (cursor < items.length) {
            const index = cursor++;
            results[index] = await fn(items[index], index);
        }
    };

    await Promise.all(Array.from({ length: workers }, runWorker));
    return results;
}
