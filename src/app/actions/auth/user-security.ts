"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { checkPermission, currentSessionId, type Viewer } from "@/lib/auth/access-control";
import { ACCOUNT_CHANGE } from "@/lib/auth/account-access";
import { AUDIT_ACTIONS, AUDIT_RESOURCES } from "@/lib/core/audit-types";
import { MAX_PASSWORD_LENGTH } from "@/lib/auth/password-policy";
import { ValidationError, wrapError } from "@/lib/logging/errors";
import { logger } from "@/lib/logging/logger";
import { auditService } from "@/services/audit-service";
import { accountLogOrigin } from "@/services/audit/account-log";
import { authService } from "@/services/auth/auth-service";
import { userService } from "@/services/user/user-service";
import { ACCOUNT_UNKNOWN, shownAccountName } from "@/services/user/account-visibility";

/**
 * What an admin does to how another user signs in: a new password, a reset of the second factor
 * and signing out their sessions. Each is written to the audit log, of the home tenant for an
 * account of another tenant, see `accountLogOrigin`.
 */

const log = logger.child({ action: "user-security" });

const IdSchema = z.string().min(1).max(200);

const PasswordSchema = z.object({
    // The rules of Settings > Passwords are checked by the service, which names the one it breaks.
    password: z.string().min(1, "Enter a password.").max(MAX_PASSWORD_LENGTH, `The password can have at most ${MAX_PASSWORD_LENGTH} characters.`),
    /** Ends the sessions the user holds, so the old password stops working everywhere at once. */
    signOut: z.boolean(),
});

/**
 * The name of the account whose sign-in the caller changes, for the audit log, or why they may not:
 * the account of a platform admin, and one that also works in another tenant, is for a platform
 * admin alone. An account the caller may not see answers exactly like one that does not exist,
 * `ACCOUNT_UNKNOWN`. The own account is always the caller's to change.
 */
async function target(userId: string, caller: Viewer | null): Promise<{ name: string; refusal: string | null }> {
    if (!caller) return { name: "", refusal: "Unauthorized" };
    if (caller.id === userId) return { name: caller.name || caller.email, refusal: null };
    const name = await shownAccountName({ ...caller, userId: caller.id }, userId);
    if (name === null) return { name: "", refusal: ACCOUNT_UNKNOWN };
    const refusal = await userService.accountRefusalFor(caller, userId);
    return { name, refusal };
}

/**
 * Sets a new password for another user. The own password changes under Profile, which asks for
 * the current one. Only a platform admin sets the password of a platform admin, or of an account
 * that also works in another tenant, since whoever knows it signs in to all of them.
 */
export async function setUserPassword(userId: string, input: z.input<typeof PasswordSchema>) {
    const currentUser = await checkPermission(ACCOUNT_CHANGE);
    const id = IdSchema.safeParse(userId);
    const parsed = PasswordSchema.safeParse(input);
    if (!id.success || !parsed.success) {
        return { success: false, error: parsed.error?.issues[0]?.message ?? "Invalid request" };
    }

    if (currentUser.id === id.data) {
        return { success: false, error: "Change your own password under Profile." };
    }
    const account = await target(id.data, currentUser);
    if (account.refusal) return { success: false, error: account.refusal };

    try {
        const origin = await accountLogOrigin(currentUser, id.data);
        await authService.setPassword(id.data, parsed.data.password);
        const signedOut = parsed.data.signOut ? await userService.revokeSessions(id.data) : 0;
        await auditService.log(currentUser.id, AUDIT_ACTIONS.UPDATE, AUDIT_RESOURCES.USER, { change: "Password Set", name: account.name, signedOut }, id.data, origin);
        revalidatePath("/dashboard/users");
        return { success: true, data: { signedOut } };
    } catch (error: unknown) {
        if (error instanceof ValidationError) return { success: false, error: error.message };
        log.error("Setting a password failed", { userId: id.data }, wrapError(error));
        return { success: false, error: "The password could not be set." };
    }
}

/**
 * Removes the authenticator app and the passkey as second factor, so the user can set one up
 * again. Who may is the same as for setting their password.
 */
export async function resetUserTwoFactor(userId: string) {
    const currentUser = await checkPermission(ACCOUNT_CHANGE);
    const id = IdSchema.safeParse(userId);
    if (!id.success) return { success: false, error: "Invalid request" };
    // The own second factor changes under Profile, as far as the group allows it there.
    if (currentUser?.id === id.data) return { success: false, error: "Change your own second factor under Profile." };

    const account = await target(id.data, currentUser);
    if (account.refusal || !currentUser) return { success: false, error: account.refusal ?? "Unauthorized" };

    try {
        const origin = await accountLogOrigin(currentUser, id.data);
        await userService.resetTwoFactor(id.data);
        await auditService.log(currentUser.id, AUDIT_ACTIONS.UPDATE, AUDIT_RESOURCES.USER, { change: "Two-Factor Reset", name: account.name }, id.data, origin);
        revalidatePath("/dashboard/users");
        return { success: true };
    } catch (error: unknown) {
        log.error("Failed to reset 2FA", { userId: id.data }, wrapError(error));
        return { success: false, error: "The second factor could not be reset." };
    }
}

/**
 * Ends one session of a user. The session the caller uses is refused, the menu signs out of that
 * one. Who may is the same as for setting their password.
 */
export async function revokeUserSession(userId: string, sessionId: string) {
    const currentUser = await checkPermission(ACCOUNT_CHANGE);
    const id = IdSchema.safeParse(userId);
    const session = IdSchema.safeParse(sessionId);
    if (!id.success || !session.success) return { success: false, error: "Invalid request" };

    const account = await target(id.data, currentUser);
    if (account.refusal || !currentUser) return { success: false, error: account.refusal ?? "Unauthorized" };

    if (session.data === (await currentSessionId())) {
        return { success: false, error: "This is the session you are using. Sign out from the menu instead." };
    }

    try {
        const origin = await accountLogOrigin(currentUser, id.data);
        const ended = await userService.revokeSession(id.data, session.data);
        if (!ended) return { success: false, error: "The session has ended already." };
        await auditService.log(currentUser.id, AUDIT_ACTIONS.UPDATE, AUDIT_RESOURCES.USER, { change: "Sessions Revoked", name: account.name, count: 1 }, id.data, origin);
        revalidatePath("/dashboard/users");
        return { success: true };
    } catch (error: unknown) {
        log.error("Ending a session failed", { userId: id.data }, wrapError(error));
        return { success: false, error: "The session could not be ended." };
    }
}

/**
 * Ends every session of a user. For the caller's own account the session they use stays. Who may
 * is the same as for setting their password.
 */
export async function revokeUserSessions(userId: string) {
    const currentUser = await checkPermission(ACCOUNT_CHANGE);
    const id = IdSchema.safeParse(userId);
    if (!id.success) return { success: false, error: "Invalid request" };

    const account = await target(id.data, currentUser);
    if (account.refusal || !currentUser) return { success: false, error: account.refusal ?? "Unauthorized" };

    try {
        const origin = await accountLogOrigin(currentUser, id.data);
        const keep = currentUser.id === id.data ? await currentSessionId() : null;
        const count = await userService.revokeSessions(id.data, keep);
        await auditService.log(currentUser.id, AUDIT_ACTIONS.UPDATE, AUDIT_RESOURCES.USER, { change: "Sessions Revoked", name: account.name, count }, id.data, origin);
        revalidatePath("/dashboard/users");
        return { success: true, data: { count } };
    } catch (error: unknown) {
        log.error("Ending the sessions failed", { userId: id.data }, wrapError(error));
        return { success: false, error: "The sessions could not be ended." };
    }
}
