/**
 * How long a session lasts. The owner sets it under Settings > Sign-in, from one hour to 90 days,
 * and it counts from the sign-in, however often the session is used.
 *
 * better-auth extends a session once `updateAge` passed, to its own fixed `expiresIn` from that
 * moment. Every length turned into seven days counted from the last visit, so someone who came
 * back once a week was never signed out. DBackup switches that refresh off and sets the end of a
 * session itself, when it is created (`databaseHooks.session.create` in ./index.ts).
 */

/** The lengths the setting allows, in seconds: one hour to 90 days. */
export const SESSION_DURATION_LIMITS = { min: 3600, max: 7776000 } as const;

/** Seven days, until the owner sets another length. */
export const DEFAULT_SESSION_DURATION = 604800;

/** The `session` options of better-auth. */
export const SESSION_OPTIONS = {
    // The cookie of a session lasts this long, so it never ends before the longest length does.
    // The session in the database decides when it ends.
    expiresIn: SESSION_DURATION_LIMITS.max,
    // A session ends after its length, however often it is used.
    disableSessionRefresh: true,
    // No action here asks for a fresh sign-in, and the default of a day made unlinking an
    // account fail with SESSION_NOT_FRESH for most people.
    freshAge: 0,
} as const;

/** A stored length, or the default when it is missing or out of the limits. */
export function sessionDurationOf(stored: string | null | undefined): number {
    const seconds = Number(stored);
    if (!Number.isInteger(seconds) || seconds < SESSION_DURATION_LIMITS.min || seconds > SESSION_DURATION_LIMITS.max) return DEFAULT_SESSION_DURATION;
    return seconds;
}

/** When a session made now ends. */
export function sessionEndsAt(durationSeconds: number, now = Date.now()): Date {
    return new Date(now + durationSeconds * 1000);
}
