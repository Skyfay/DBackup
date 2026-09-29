"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { checkPermission, getCurrentUserWithGroup } from "@/lib/auth/access-control";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { AUDIT_ACTIONS, AUDIT_RESOURCES } from "@/lib/core/audit-types";
import { getErrorMessage, wrapError } from "@/lib/logging/errors";
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
    password: z.string().min(8, "The password needs at least 8 characters.").max(128, "The password can have at most 128 characters."),
    /** Ends the sessions the user holds, so the old password stops working everywhere at once. */
    signOut: z.boolean(),
});

/** The session of whoever calls, which signing out someone's sessions never ends. */
async function viewerSessionId(): Promise<string | null> {
    try {
        const session = await auth.api.getSession({ headers: await headers() });
        return session?.session.id ?? null;
    } catch {
        return null;
    }
}

/**
 * Sets a new password for another user. The own password changes under Profile, which asks for
 * the current one. Only a SuperAdmin sets the password of a SuperAdmin, since whoever knows it
 * signs in with every permission.
 */
export async function setUserPassword(userId: string, input: z.input<typeof PasswordSchema>) {
    await checkPermission(PERMISSIONS.USERS.WRITE);
    const id = IdSchema.safeParse(userId);
    const parsed = PasswordSchema.safeParse(input);
    if (!id.success || !parsed.success) {
        return { success: false, error: parsed.error?.issues[0]?.message ?? "Invalid request" };
    }

    const currentUser = await getCurrentUserWithGroup();
    if (!currentUser) return { success: false, error: "Unauthorized" };
    if (currentUser.id === id.data) {
        return { success: false, error: "Change your own password under Profile." };
    }
    if (await userService.isSuperAdmin(id.data) && currentUser.group?.name !== "SuperAdmin") {
        return { success: false, error: "Only a SuperAdmin can set the password of a SuperAdmin." };
    }

    try {
        await authService.setPassword(id.data, parsed.data.password);
        const signedOut = parsed.data.signOut ? await userService.revokeSessions(id.data) : 0;
        await auditService.log(currentUser.id, AUDIT_ACTIONS.UPDATE, AUDIT_RESOURCES.USER, { change: "Password Set", signedOut }, id.data);
        revalidatePath("/dashboard/users");
        return { success: true, data: { signedOut } };
    } catch (error: unknown) {
        log.error("Setting a password failed", { userId: id.data }, wrapError(error));
        return { success: false, error: getErrorMessage(error) || "The password could not be set." };
    }
}

/** Removes the authenticator app and the passkey as second factor, so the user can set one up again. */
export async function resetUserTwoFactor(userId: string) {
    await checkPermission(PERMISSIONS.USERS.WRITE);
    const id = IdSchema.safeParse(userId);
    if (!id.success) return { success: false, error: "Invalid request" };
    const currentUser = await getCurrentUserWithGroup();

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

/** Ends one session of a user. The session the caller uses is refused, the menu signs out of that one. */
export async function revokeUserSession(userId: string, sessionId: string) {
    await checkPermission(PERMISSIONS.USERS.WRITE);
    const id = IdSchema.safeParse(userId);
    const session = IdSchema.safeParse(sessionId);
    if (!id.success || !session.success) return { success: false, error: "Invalid request" };
    const currentUser = await getCurrentUserWithGroup();

    if (session.data === (await viewerSessionId())) {
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

/** Ends every session of a user. For the caller's own account the session they use stays. */
export async function revokeUserSessions(userId: string) {
    await checkPermission(PERMISSIONS.USERS.WRITE);
    const id = IdSchema.safeParse(userId);
    if (!id.success) return { success: false, error: "Invalid request" };
    const currentUser = await getCurrentUserWithGroup();

    try {
        const keep = currentUser?.id === id.data ? await viewerSessionId() : null;
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
