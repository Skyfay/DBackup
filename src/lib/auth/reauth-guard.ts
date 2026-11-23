import { APIError } from "better-auth/api";
import prisma from "@/lib/prisma";
import { sessionCodeRefused, SESSION_CODES_LOCKED } from "@/services/auth/code-tries";

/**
 * What asks whoever holds a session to show again that they own the account. A session can be
 * taken, through its cookie or a browser left open, the password and a new sign-in cannot. So the
 * current password goes through the lockout of DBackup wherever better-auth checks it, and what
 * outlives the session, a passkey or the end of the passkey as second factor, asks for one of them.
 */

/** The endpoints of better-auth that check the current password themselves, without the lockout of `checkCurrentPassword`. */
const PASSWORD_ENDPOINTS: ReadonlySet<string> = new Set([
    "/two-factor/enable",
    "/two-factor/disable",
    "/two-factor/get-totp-uri",
    "/two-factor/generate-backup-codes",
]);

/** The endpoints that register a passkey, which signs in for as long as it stays. */
const PASSKEY_REGISTRATION: ReadonlySet<string> = new Set(["/passkey/generate-register-options", "/passkey/verify-registration"]);

/**
 * The endpoints that check a code of the second factor. Without a session they are the second step
 * of a sign-in, which better-auth limits itself. With one better-auth counts nothing, so a session
 * could guess the first code of an authenticator app that waits for it without end.
 */
const CODE_ENDPOINTS: ReadonlySet<string> = new Set(["/two-factor/verify-totp", "/two-factor/verify-otp", "/two-factor/verify-backup-code"]);

/** The endpoints where a right code makes better-auth replace the session of the request by a new one. */
const SESSION_REPLACING_CODES: ReadonlySet<string> = new Set(["/two-factor/verify-totp", "/two-factor/verify-otp"]);

/** How long after its sign-in a session may add a passkey. */
export const FRESH_SIGN_IN_MS = 15 * 60 * 1000;

export const SIGN_IN_AGAIN = `Sign out and sign in again to add a passkey. DBackup adds one only within ${FRESH_SIGN_IN_MS / 60_000} minutes of a sign-in.`;

export const PASSWORD_NEEDED = "Enter your password.";
export const PASSWORD_WRONG = "Invalid password";

/** The parts of the context of a better-auth hook the checks read. */
export interface ReauthContext {
    path?: string;
    body?: unknown;
}

type SessionOf = () => Promise<{ user: { id: string }; session: { createdAt: Date | string } } | null>;

/** Whether a passkey is the second factor of the account, however many it has. */
const passkeyIsFactor = async (userId: string) =>
    !!(await prisma.user.findUnique({ where: { id: userId }, select: { passkeyTwoFactor: true } }))?.passkeyTwoFactor;

/** Whether the account signs in with a password, after which a second factor applies at all. */
const hasPassword = async (userId: string) =>
    !!(await prisma.account.findFirst({ where: { userId, providerId: "credential", password: { not: null } }, select: { id: true } }));

const passwordOf = (body: unknown) => {
    const value = body && typeof body === "object" ? (body as Record<string, unknown>).password : undefined;
    return typeof value === "string" ? value : null;
};

/**
 * The current password against its stored hash, through the lockout of the account. The service
 * reads `auth` of ./index.ts, so it loads when a check runs.
 */
async function checkPassword(userId: string, password: string): Promise<void> {
    const { checkCurrentPassword, PASSWORD_LOCKED } = await import("@/services/auth/password-tries");
    const check = await checkCurrentPassword(userId, password);
    if (check === "locked") throw new APIError("TOO_MANY_REQUESTS", { code: "PASSWORD_LOCKED", message: PASSWORD_LOCKED });
    if (check === "wrong") throw new APIError("BAD_REQUEST", { code: "INVALID_PASSWORD", message: PASSWORD_WRONG });
}

/**
 * Runs before every endpoint of better-auth. A request without a session is answered by
 * better-auth itself. The second factor checks the password through the lockout first, a passkey is
 * added only by a session of a recent sign-in, and a passkey of an account whose second factor is a
 * passkey goes only with the password, like turning the passkey factor off. Every passkey, not the
 * last one alone: a count read here says nothing about the deletes that run beside this one, so two
 * requests at once would both see two passkeys and leave none. The codes a session sends are
 * counted per account before better-auth checks them.
 */
export async function refuseWithoutReauth(ctx: ReauthContext, sessionOf: SessionOf, now = Date.now()): Promise<void> {
    const path = ctx.path;
    if (!path) return;
    if (PASSWORD_ENDPOINTS.has(path)) {
        const password = passwordOf(ctx.body);
        const session = password === null ? null : await sessionOf();
        // Without a password better-auth refuses the request itself.
        if (session && password !== null) await checkPassword(session.user.id, password);
        return;
    }
    if (CODE_ENDPOINTS.has(path)) {
        const session = await sessionOf();
        if (session && sessionCodeRefused(session.user.id, now)) {
            throw new APIError("TOO_MANY_REQUESTS", { code: "CODE_LOCKED", message: SESSION_CODES_LOCKED });
        }
        return;
    }
    if (PASSKEY_REGISTRATION.has(path)) {
        const session = await sessionOf();
        if (session && now - new Date(session.session.createdAt).getTime() > FRESH_SIGN_IN_MS) {
            throw new APIError("FORBIDDEN", { code: "SESSION_NOT_FRESH", message: SIGN_IN_AGAIN });
        }
        return;
    }
    if (path === "/passkey/delete-passkey") {
        const session = await sessionOf();
        if (!session || !(await passkeyIsFactor(session.user.id)) || !(await hasPassword(session.user.id))) return;
        const password = passwordOf(ctx.body);
        if (!password) throw new APIError("BAD_REQUEST", { code: "INVALID_PASSWORD", message: PASSWORD_NEEDED });
        await checkPassword(session.user.id, password);
    }
}

/**
 * Why the own passkey may not stop being the second factor, null when it may, like
 * `/two-factor/disable` asks for the password. An account without a password signs in without a
 * second factor. One with a password is asked for it also with no passkey left, since the deletes
 * that took the last ones may have run at once.
 */
export async function passkeyFactorOffRefusal(userId: string, password: string | undefined): Promise<string | null> {
    if (!(await hasPassword(userId))) return null;
    if (!password) return PASSWORD_NEEDED;
    try {
        await checkPassword(userId, password);
        return null;
    } catch (error) {
        if (error instanceof APIError) return error.message;
        throw error;
    }
}

/** The parts of the context of a database hook of better-auth `keptSessionAge` reads. */
export interface SessionCreateContext {
    path?: string;
    context?: { session?: { session?: { createdAt?: Date | string; expiresAt?: Date | string } | null } | null };
}

/**
 * The start and end a new session keeps, null for one of a sign-in. A right code of an
 * authenticator app that waited for its first one makes better-auth replace the session of the
 * request by a new one, created now. A code is no sign-in and no proof of the password, so the new
 * session stays as old as the one it replaces and ends when that one would, and an old session
 * never becomes one that may add a passkey by a code. Without a session the code is the second step
 * of a sign-in, whose session is new.
 */
export function keptSessionAge(context: SessionCreateContext | null | undefined): { createdAt: Date; expiresAt?: Date } | null {
    if (!context?.path || !SESSION_REPLACING_CODES.has(context.path)) return null;
    const replaced = context.context?.session?.session;
    if (!replaced?.createdAt) return null;
    const createdAt = new Date(replaced.createdAt);
    if (Number.isNaN(createdAt.getTime())) return null;
    const expiresAt = replaced.expiresAt ? new Date(replaced.expiresAt) : null;
    return expiresAt && !Number.isNaN(expiresAt.getTime()) ? { createdAt, expiresAt } : { createdAt };
}
