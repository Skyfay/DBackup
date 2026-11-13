/**
 * The codes of the second factor a signed-in account sends. better-auth limits the codes of a
 * sign-in, by challenge and by account, but counts none that come with a session, so a session
 * could guess the first code of an authenticator app that waits for it without end. After
 * `MAX_SESSION_CODES` codes within `SESSION_CODE_WINDOW_MS` the account sends no further one until
 * the window ran out. Every code counts, right or wrong, before better-auth checks it, so requests
 * sent at once check no more than the limit. Finishing the setup of an app takes one or two.
 * Kept for this process, by the id of the account, like the wrong passwords (`password-tries.ts`).
 */

export const MAX_SESSION_CODES = 5;
/** How long the codes of an account count. */
export const SESSION_CODE_WINDOW_MS = 15 * 60 * 1000;

export const SESSION_CODES_LOCKED = `Too many codes. Try again in ${SESSION_CODE_WINDOW_MS / 60_000} minutes.`;

interface CodeTries {
    count: number;
    since: number;
}

const TRIES_KEY = Symbol.for("dbackup.sessionCodeTries");
type TriesGlobal = typeof globalThis & { [TRIES_KEY]?: Map<string, CodeTries> };
function tries(): Map<string, CodeTries> {
    const holder = globalThis as TriesGlobal;
    holder[TRIES_KEY] ??= new Map();
    return holder[TRIES_KEY];
}

/** Counts a code of a signed-in account and says whether it is one too many to check. */
export function sessionCodeRefused(userId: string, now = Date.now()): boolean {
    const entry = tries().get(userId);
    if (!entry || now - entry.since >= SESSION_CODE_WINDOW_MS) {
        tries().set(userId, { count: 1, since: now });
        return false;
    }
    entry.count += 1;
    return entry.count > MAX_SESSION_CODES;
}

/** Forgets every count, for the tests. */
export function resetSessionCodeTries(): void {
    tries().clear();
}
