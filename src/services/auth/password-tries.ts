import { authService } from "./auth-service";

/**
 * The wrong current passwords of a signed-in account. An action that asks for the current password,
 * like the change of the own password, runs past the rate limit of the sign-in, so a session could
 * otherwise guess it without end. After `MAX_WRONG_PASSWORDS` wrong ones within
 * `WRONG_PASSWORD_WINDOW_MS` the account gets no answer for `PASSWORD_LOCKOUT_MS`, whatever it sends.
 * Kept for this process, by the id of the account, like the tries of an email (`email-tries.ts`).
 */

export const MAX_WRONG_PASSWORDS = 5;
/** How long the wrong passwords of an account count. */
export const WRONG_PASSWORD_WINDOW_MS = 15 * 60 * 1000;
/** How long an account waits once it sent too many. */
export const PASSWORD_LOCKOUT_MS = 15 * 60 * 1000;

export const PASSWORD_LOCKED = `The current password was wrong ${MAX_WRONG_PASSWORDS} times. Try again in ${PASSWORD_LOCKOUT_MS / 60_000} minutes.`;

interface Tries {
    count: number;
    since: number;
    lockedUntil?: number;
}

const TRIES_KEY = Symbol.for("dbackup.wrongCurrentPasswords");
type TriesGlobal = typeof globalThis & { [TRIES_KEY]?: Map<string, Tries> };
function tries(): Map<string, Tries> {
    const holder = globalThis as TriesGlobal;
    holder[TRIES_KEY] ??= new Map();
    return holder[TRIES_KEY];
}

/** The wrong passwords of an account that still count, none once the window and the lockout ran out. */
function triesOf(userId: string, now: number): Tries | null {
    const entry = tries().get(userId);
    if (!entry) return null;
    if (entry.lockedUntil !== undefined ? now >= entry.lockedUntil : now - entry.since >= WRONG_PASSWORD_WINDOW_MS) {
        tries().delete(userId);
        return null;
    }
    return entry;
}

export type CurrentPasswordCheck = "ok" | "wrong" | "locked";

/**
 * Checks the current password of a signed-in account against its stored hash. A locked account is
 * not checked at all, so a right guess during the lockout tells nothing either. Each try counts
 * before the check, so requests sent at once check no more than `MAX_WRONG_PASSWORDS` passwords. A
 * right password forgets the wrong ones before it.
 */
export async function checkCurrentPassword(userId: string, password: string, now = Date.now()): Promise<CurrentPasswordCheck> {
    const counted = triesOf(userId, now);
    if (counted?.lockedUntil !== undefined) return "locked";
    // One entry per account, which requests sent at once share.
    const entry: Tries = counted ?? { count: 0, since: now };
    const attempt = (entry.count += 1);
    tries().set(userId, entry);
    if (attempt > MAX_WRONG_PASSWORDS) return "locked";
    if (await authService.verifyPassword(userId, password)) {
        tries().delete(userId);
        return "ok";
    }
    if (attempt < MAX_WRONG_PASSWORDS) return "wrong";
    entry.lockedUntil = now + PASSWORD_LOCKOUT_MS;
    return "locked";
}

/** Forgets every count, for the tests. */
export function resetPasswordTries(): void {
    tries().clear();
}
