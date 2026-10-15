"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { checkPermission, currentSessionId, getViewer, type Viewer } from "@/lib/auth/access-control";
import { ACCOUNT_CHANGE, accountRefusal } from "@/lib/auth/account-access";
import { AUDIT_ACTIONS, AUDIT_RESOURCES } from "@/lib/core/audit-types";
import { MAX_PASSWORD_LENGTH } from "@/lib/auth/password-policy";
import { getErrorMessage, ValidationError, wrapError } from "@/lib/logging/errors";
import { logger } from "@/lib/logging/logger";
import { auditService } from "@/services/audit-service";
import { authService } from "@/services/auth/auth-service";
import { userService } from "@/services/user/user-service";

/**
 * What an admin does to how another user signs in: a new password, a reset of the second factor
 * and signing out their sessions. Each is written to the audit log.
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
 * Why the caller may not change how this account signs in, null when they may: the account of a
 * platform admin, and one that also works in another tenant, is for a platform admin alone. The
 * own account is always the caller's to change.
 */
async function refusal(userId: string, caller: Viewer | null): Promise<string | null> {
    if (!caller) return "Unauthorized";
    if (caller.id === userId) return null;
    const target = await userService.accountOf(userId);
    return target ? accountRefusal(caller, target) : null;
}

/**
 * Sets a new password for another user. The own password changes under Profile, which asks for
 * the current one. Only a platform admin sets the password of a platform admin, or of an account
 * that also works in another tenant, since whoever knows it signs in to all of them.
 */
export async function setUserPassword(userId: string, input: z.input<typeof PasswordSchema>) {
    await checkPermission(ACCOUNT_CHANGE);
    const id = IdSchema.safeParse(userId);
    const parsed = PasswordSchema.safeParse(input);
    if (!id.success || !parsed.success) {
        return { success: false, error: parsed.error?.issues[0]?.message ?? "Invalid request" };
    }

    const currentUser = await getViewer();
    if (!currentUser) return { success: false, error: "Unauthorized" };
    if (currentUser.id === id.data) {
        return { success: false, error: "Change your own password under Profile." };
    }
    const refused = await refusal(id.data, currentUser);
    if (refused) return { success: false, error: refused };

    try {
        await authService.setPassword(id.data, parsed.data.password);
        const signedOut = parsed.data.signOut ? await userService.revokeSessions(id.data) : 0;
        await auditService.log(currentUser.id, AUDIT_ACTIONS.UPDATE, AUDIT_RESOURCES.USER, { change: "Password Set", signedOut }, id.data);
        revalidatePath("/dashboard/users");
        return { success: true, data: { signedOut } };
    } catch (error: unknown) {
        if (error instanceof ValidationError) return { success: false, error: error.message };
        log.error("Setting a password failed", { userId: id.data }, wrapError(error));
        return { success: false, error: getErrorMessage(error) || "The password could not be set." };
    }
}

/**
 * Removes the authenticator app and the passkey as second factor, so the user can set one up
 * again. Who may is the same as for setting their password.
 */
export async function resetUserTwoFactor(userId: string) {
    await checkPermission(ACCOUNT_CHANGE);
    const id = IdSchema.safeParse(userId);
    if (!id.success) return { success: false, error: "Invalid request" };
    const currentUser = await getViewer();

    const refused = await refusal(id.data, currentUser);
    if (refused) return { success: false, error: refused };

    try {
        await userService.resetTwoFactor(id.data);
        if (currentUser) {
            await auditService.log(currentUser.id, AUDIT_ACTIONS.UPDATE, AUDIT_RESOURCES.USER, { change: "Two-Factor Reset" }, id.data);
        }
        revalidatePath("/dashboard/users");
        return { success: true };
    } catch (error: unknown) {
        log.error("Failed to reset 2FA", { userId: id.data }, wrapError(error));
        return { success: false, error: getErrorMessage(error) || "Failed to reset 2FA" };
    }
}

/**
 * Ends one session of a user. The session the caller uses is refused, the menu signs out of that
 * one. Who may is the same as for setting their password.
 */
export async function revokeUserSession(userId: string, sessionId: string) {
    await checkPermission(ACCOUNT_CHANGE);
    const id = IdSchema.safeParse(userId);
    const session = IdSchema.safeParse(sessionId);
    if (!id.success || !session.success) return { success: false, error: "Invalid request" };
    const currentUser = await getViewer();

    const refused = await refusal(id.data, currentUser);
    if (refused) return { success: false, error: refused };

    if (session.data === (await currentSessionId())) {
        return { success: false, error: "This is the session you are using. Sign out from the menu instead." };
    }

    try {
        const ended = await userService.revokeSession(id.data, session.data);
        if (!ended) return { success: false, error: "The session has ended already." };
        if (currentUser) {
            await auditService.log(currentUser.id, AUDIT_ACTIONS.UPDATE, AUDIT_RESOURCES.USER, { change: "Sessions Revoked", count: 1 }, id.data);
        }
        revalidatePath("/dashboard/users");
        return { success: true };
    } catch (error: unknown) {
        log.error("Ending a session failed", { userId: id.data }, wrapError(error));
        return { success: false, error: getErrorMessage(error) || "The session could not be ended." };
    }
}

/**
 * Ends every session of a user. For the caller's own account the session they use stays. Who may
 * is the same as for setting their password.
 */
export async function revokeUserSessions(userId: string) {
    await checkPermission(ACCOUNT_CHANGE);
    const id = IdSchema.safeParse(userId);
    if (!id.success) return { success: false, error: "Invalid request" };
    const currentUser = await getViewer();

    const refused = await refusal(id.data, currentUser);
    if (refused) return { success: false, error: refused };

    try {
        const keep = currentUser?.id === id.data ? await currentSessionId() : null;
        const count = await userService.revokeSessions(id.data, keep);
        if (currentUser) {
            await auditService.log(currentUser.id, AUDIT_ACTIONS.UPDATE, AUDIT_RESOURCES.USER, { change: "Sessions Revoked", count }, id.data);
        }
        revalidatePath("/dashboard/users");
        return { success: true, data: { count } };
    } catch (error: unknown) {
        log.error("Ending the sessions failed", { userId: id.data }, wrapError(error));
        return { success: false, error: getErrorMessage(error) || "The sessions could not be ended." };
    }
}
