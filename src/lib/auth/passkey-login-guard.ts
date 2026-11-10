import { APIError } from "better-auth/api";
import prisma from "@/lib/prisma";
import { pendingTwoFactorUser, type SignInHookContext } from "@/lib/auth/sign-in-audit";

/**
 * Settings > Sign-in can switch the sign-in with a passkey off. Hiding the button of the login page
 * is not enough, the endpoints of better-auth are public, so the server refuses a passkey as the
 * first factor too. A passkey as the second factor keeps working: after the password, better-auth
 * keeps the account of the pending second factor behind the signed `two_factor` cookie, and the
 * second-factor step calls the same endpoint. A passkey counts there only when it is one of that
 * account, so the cookie of someone else's password lets no passkey in.
 */

/** The setting of Settings > Sign-in, "true" while the sign-in with a passkey is off. */
export const PASSKEY_LOGIN_OFF_KEY = "auth.disablePasskeyLogin";

export const PASSKEY_LOGIN_OFF = "Signing in with a passkey is switched off. Sign in with your password or a provider.";

/** The endpoint that signs someone in with a passkey, as the first or the second factor. */
const VERIFY_PASSKEY = "/passkey/verify-authentication";

/** Whether Settings > Sign-in switched the sign-in with a passkey off. */
export async function isPasskeyLoginOff(): Promise<boolean> {
    const setting = await prisma.systemSetting.findUnique({ where: { key: PASSKEY_LOGIN_OFF_KEY }, select: { value: true } });
    return setting?.value === "true";
}

/** The credential the browser answers with, `response.id` of the body, as better-auth looks the passkey up by it. */
function credentialOf(body: unknown): string | null {
    const response = (body as { response?: { id?: unknown } } | null | undefined)?.response;
    return typeof response?.id === "string" && response.id ? response.id : null;
}

/**
 * Runs before every endpoint of better-auth. While the sign-in with a passkey is off, a passkey
 * signs in only as the second factor of the account whose password was just right.
 */
export async function refusePasskeyFirstFactor(ctx: SignInHookContext): Promise<void> {
    if (ctx.path !== VERIFY_PASSKEY) return;
    if (!(await isPasskeyLoginOff())) return;
    const pending = await pendingTwoFactorUser(ctx);
    const credentialID = credentialOf(ctx.body);
    if (pending && credentialID) {
        const passkey = await prisma.passkey.findUnique({ where: { credentialID }, select: { userId: true } });
        if (passkey?.userId === pending) return;
    }
    throw new APIError("FORBIDDEN", { code: "PASSKEY_LOGIN_DISABLED", message: PASSKEY_LOGIN_OFF });
}
