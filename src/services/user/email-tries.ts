/**
 * How often a person heard that an email cannot be used because it may belong to an account they
 * do not see, see `takenEmailRefusal` in `new-account-email.ts`. A link of an invitation that meets
 * such an email counts against whoever made it, so the links of one admin are no way around it.
 * Kept for this process, by the id of the person, like the failures of a link.
 */

/** How many such refusals a person gets within `REFUSAL_WINDOW_MS`, and how often a link may fail to make an account. */
export const MAX_FAILED_SIGN_UPS = 5;

/** How long the refusals of one person count. */
export const REFUSAL_WINDOW_MS = 60 * 60 * 1000;

interface Tries {
    count: number;
    since: number;
}

const TRIES_KEY = Symbol.for("dbackup.newAccountEmailRefusals");
type TriesGlobal = typeof globalThis & { [TRIES_KEY]?: Map<string, Tries> };
function tries(): Map<string, Tries> {
    const holder = globalThis as TriesGlobal;
    holder[TRIES_KEY] ??= new Map();
    return holder[TRIES_KEY];
}

/** The refusals of a person that still count, none once the window ran out. */
function triesOf(userId: string, now: number): Tries | null {
    const entry = tries().get(userId);
    if (!entry) return null;
    if (now - entry.since >= REFUSAL_WINDOW_MS) {
        tries().delete(userId);
        return null;
    }
    return entry;
}

/** Whether a person ran out of tries for now. */
export function emailTriesSpent(userId: string, now = Date.now()): boolean {
    return (triesOf(userId, now)?.count ?? 0) >= MAX_FAILED_SIGN_UPS;
}

/** Counts one refusal against a person. */
export function countEmailRefusal(userId: string, now = Date.now()): void {
    const counted = triesOf(userId, now);
    tries().set(userId, counted ? { ...counted, count: counted.count + 1 } : { count: 1, since: now });
}

/** Forgets every count, for the tests. */
export function resetEmailTries(): void {
    tries().clear();
}
