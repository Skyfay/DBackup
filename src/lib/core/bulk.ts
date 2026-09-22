/**
 * Partial-success reporting for operations over several records.
 *
 * A bulk operation is not one operation over many rows, it is many operations that happen
 * to be requested together. One of them failing says nothing about the rest, so aborting
 * the batch on the first error would throw away work that succeeded and leave the user
 * unable to tell which half that was. Everything here exists to carry per-row outcomes
 * back to the UI instead.
 *
 * Lives in `lib/core` because it crosses every layer: services produce it, routes and
 * Server Actions forward it, client components render it.
 */

import { getErrorMessage } from "@/lib/logging/errors";

/**
 * Most rows one bulk request may carry.
 *
 * Batches run sequentially and some hit remote storage per row, so an unbounded selection
 * could outlive the request. Shared by the client, which disables the action above it, and
 * by every endpoint, which rejects above it - the two must not disagree.
 */
export const BULK_REQUEST_LIMIT = 200;

export interface BulkFailure {
    /** Identifier of the row that failed. A record id, or a file path for storage. */
    id: string;
    /** Human-readable name for the failure list. Falls back to the id when unknown. */
    name?: string;
    /** Why it failed, phrased for the user. */
    error: string;
}

export interface BulkResult {
    succeeded: string[];
    failed: BulkFailure[];
}

/** An empty result. Useful as a starting value and for an empty request. */
export function emptyBulkResult(): BulkResult {
    return { succeeded: [], failed: [] };
}

/**
 * Runs `fn` for every id, collecting outcomes instead of stopping at the first error.
 *
 * Sequential on purpose. These operations contend on the same rows, the same scheduler and
 * the same remote storage endpoint, so a parallel fan-out would multiply lock contention
 * and provider rate limits without finishing meaningfully sooner.
 */
export async function runBulk(
    ids: string[],
    fn: (id: string) => Promise<void>,
    nameOf?: (id: string) => string | undefined
): Promise<BulkResult> {
    const result = emptyBulkResult();

    for (const id of ids) {
        try {
            await fn(id);
            result.succeeded.push(id);
        } catch (error: unknown) {
            result.failed.push({
                id,
                name: nameOf?.(id),
                error: getErrorMessage(error),
            });
        }
    }

    return result;
}

/** How to name the thing being acted on, in both tenses the summary needs. */
export interface BulkLabels {
    /** Infinitive, used after "Could not". For example "delete". */
    verb: string;
    /** Past participle, used after a count. For example "deleted". */
    verbPast: string;
    noun: string;
    /** Defaults to the noun with an "s". */
    nounPlural?: string;
}

/**
 * One-line summary of a result, for a toast or an API `message`.
 *
 * Reads "8 jobs deleted", "8 of 10 jobs deleted", or "Could not delete 2 jobs".
 * Both verb forms are passed in rather than derived, because English past participles
 * are not reliably reachable from the infinitive by suffix rules.
 */
export function summarizeBulkResult(result: BulkResult, labels: BulkLabels): string {
    const succeeded = result.succeeded.length;
    const failed = result.failed.length;
    const total = succeeded + failed;
    const plural = labels.nounPlural ?? `${labels.noun}s`;

    if (total === 0) return `No ${plural} ${labels.verbPast}`;

    if (failed === 0) {
        return `${countNoun(succeeded, labels)} ${labels.verbPast}`;
    }

    if (succeeded === 0) {
        // Nothing happened, so the infinitive reads better than a past participle.
        return `Could not ${labels.verb} ${countNoun(failed, labels)}`;
    }

    return `${succeeded} of ${total} ${plural} ${labels.verbPast}`;
}

/** A count with its noun, like "1 connection" or "7 connections". */
export function countNoun(count: number, labels: BulkLabels): string {
    return `${count} ${count === 1 ? labels.noun : labels.nounPlural ?? `${labels.noun}s`}`;
}

/**
 * Title and note of the list of rows a bulk action could not process. Reads
 * "1 connection was not deleted" over "7 of 8 deleted", or over "Nothing was deleted".
 */
export function describeBulkFailures(result: BulkResult, labels: BulkLabels): { title: string; note: string } {
    const succeeded = result.succeeded.length;
    const failed = result.failed.length;
    return {
        title: `${countNoun(failed, labels)} ${failed === 1 ? "was" : "were"} not ${labels.verbPast}`,
        note: succeeded === 0 ? `Nothing was ${labels.verbPast}` : `${succeeded} of ${succeeded + failed} ${labels.verbPast}`,
    };
}
