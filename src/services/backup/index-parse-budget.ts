import { INDEX_MAX_INFLATED_BYTES, indexInflateLimit } from "@/lib/archive/limits";

/**
 * A bound on the indexes parsed at the same time, in the process every tenant shares.
 *
 * `parseIndex` keeps one or two bytes of heap for every byte of NDJSON an index inflates to, and
 * `limits.ts` bounds that text for each index alone, up to `INDEX_MAX_INFLATED_BYTES`. Nothing
 * bounded the parses that run at once, so a few requests for crafted sidecars of a few MB each, or
 * for one with a key override, which skips the cache, each grew the heap to that maximum and
 * together past what Node has. Each parse here claims the most its index may inflate to, from its
 * stored size, before it starts, and waits in line while the claims in flight would pass the
 * budget. A claim never passes the budget alone, so the largest index still parses, by itself.
 */
export type ParseBudget = <T>(storedBytes: number, parse: () => Promise<T>) => Promise<T>;

/** The NDJSON the indexes parsed at once may inflate to, all of them together: one index of the largest size. */
export const PARSE_MAX_TEXT_BYTES = INDEX_MAX_INFLATED_BYTES;

/** @param maxTextBytes - The budget, `PARSE_MAX_TEXT_BYTES` unless a test sets one */
export function createParseBudget(maxTextBytes: number = PARSE_MAX_TEXT_BYTES): ParseBudget {
    let inFlight = 0;
    // First come, first served, so a large index is not kept waiting by the small ones behind it.
    const waiting: { bytes: number; start: () => void }[] = [];

    const next = () => {
        while (waiting.length > 0 && inFlight + waiting[0].bytes <= maxTextBytes) {
            const claim = waiting.shift()!;
            inFlight += claim.bytes;
            claim.start();
        }
    };

    return async (storedBytes, parse) => {
        const bytes = Math.min(maxTextBytes, indexInflateLimit(storedBytes));
        await new Promise<void>((start) => {
            waiting.push({ bytes, start });
            next();
        });
        try {
            return await parse();
        } finally {
            inFlight -= bytes;
            next();
        }
    };
}

/** The budget of every index parse of this process. */
export const parseWithinBudget: ParseBudget = createParseBudget();
