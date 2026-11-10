import { APIError } from "better-auth/api";
import prisma from "@/lib/prisma";
import { lastPasskeyIsFactor } from "@/lib/auth/profile-guard";

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
 * added only by a session of a recent sign-in, and the last passkey of an account whose second
 * factor it is goes only with the password, like turning the passkey factor off.
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
    if (PASSKEY_REGISTRATION.has(path)) {
        const session = await sessionOf();
        if (session && now - new Date(session.session.createdAt).getTime() > FRESH_SIGN_IN_MS) {
            throw new APIError("FORBIDDEN", { code: "SESSION_NOT_FRESH", message: SIGN_IN_AGAIN });
        }
        return;
    }
    if (path === "/passkey/delete-passkey") {
        const session = await sessionOf();
        if (!session || !(await lastPasskeyIsFactor(session.user.id)) || !(await hasPassword(session.user.id))) return;
        const password = passwordOf(ctx.body);
        if (!password) throw new APIError("BAD_REQUEST", { code: "INVALID_PASSWORD", message: PASSWORD_NEEDED });
        await checkPassword(session.user.id, password);
    }
}

/**
 * Why the own passkey may not stop being the second factor, null when it may, like
 * `/two-factor/disable` asks for the password. An account without a password signs in without a
 * second factor, and one without a passkey left has none to end, which deleting its last passkey
 * already asked the password for.
 */
export async function passkeyFactorOffRefusal(userId: string, password: string | undefined): Promise<string | null> {
    const [signsInWithPassword, passkeys] = await Promise.all([hasPassword(userId), prisma.passkey.count({ where: { userId } })]);
    if (!signsInWithPassword || passkeys === 0) return null;
    if (!password) return PASSWORD_NEEDED;
    try {
        await checkPassword(userId, password);
        return null;
    } catch (error) {
        if (error instanceof APIError) return error.message;
        throw error;
    }
}
