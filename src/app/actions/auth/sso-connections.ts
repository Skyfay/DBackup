"use server";

import { cookies, headers } from "next/headers";
import { z } from "zod";
import { revalidatePath } from "next/cache";
import { auth } from "@/lib/auth";
import { getViewer, hasPermission } from "@/lib/auth/access-control";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { auditService } from "@/services/audit-service";
import { accountLogOrigin } from "@/services/audit/account-log";
import { countSignInAccounts, listSsoConnections, prepareSsoConnect, providerNameOf, type SsoConnections } from "@/services/sso/sso-connections-service";
import { CONNECT_CALLBACK_PATH, CONNECT_NONCE_COOKIE, CONNECT_TOKEN_TTL_MS } from "@/lib/auth/sso-connect-nonce";
import { secureCookiesFor } from "@/lib/auth/secure-cookies";
import { AUDIT_ACTIONS, AUDIT_RESOURCES } from "@/lib/core/audit-types";
import { logger } from "@/lib/logging/logger";
import { userMessage } from "@/lib/logging/user-message";

export type { ConnectableProvider, SsoConnection } from "@/services/sso/sso-connections-service";

const log = logger.child({ action: "sso-connections" });

const IdSchema = z.string().min(1).max(200);
const UnlinkSchema = z.object({ providerId: IdSchema, accountId: IdSchema });

/**
 * Self-service: list the current user's linked SSO identities plus which
 * enabled providers they could still connect.
 * @no-permission-required - only ever reads the caller's own accounts
 */
export async function getMySsoConnections(): Promise<SsoConnections> {
    const currentUser = await getViewer();
    if (!currentUser) throw new Error("Unauthorized");

    return listSsoConnections(currentUser.id);
}

/**
 * Self-service: unlink one of the current user's SSO accounts. It re-links
 * automatically the next time the user signs in via that provider, thanks to
 * account-linking in src/lib/auth/index.ts. better-auth itself refuses to
 * remove a user's last remaining Account row of any kind, so this can never
 * fully lock a user out.
 * @no-permission-required - only ever targets the caller's own account
 */
export async function unlinkMySsoAccount(providerId: string, accountId: string) {
    const currentUser = await getViewer();
    if (!currentUser) throw new Error("Unauthorized");
    if (!(await hasPermission(PERMISSIONS.PROFILE.MANAGE_SSO))) {
        return { success: false, error: "Your group may not change your sign-in providers." };
    }

    const parsed = UnlinkSchema.safeParse({ providerId, accountId });
    if (!parsed.success) return { success: false, error: "Invalid request" };

    if ((await countSignInAccounts(currentUser.id)) <= 1) {
        return { success: false, error: "You need at least one other login method before removing this connection." };
    }

    try {
        const headersList = await headers();
        await auth.api.unlinkAccount({
            headers: headersList,
            body: parsed.data,
        });

        await auditService.log(
            currentUser.id,
            AUDIT_ACTIONS.DELETE,
            AUDIT_RESOURCES.AUTH,
            { change: "SSO account unlinked", name: await providerNameOf(parsed.data.providerId), providerId: parsed.data.providerId },
            currentUser.id,
            await accountLogOrigin(currentUser, currentUser.id)
        );

        revalidatePath("/dashboard/profile");
        return { success: true };
    } catch (error: unknown) {
        const message = userMessage(error, "The account could not be unlinked. The server log has the details.", log, "Failed to unlink SSO account", { userId: currentUser.id, providerId: parsed.data.providerId });
        return { success: false, error: message };
    }
}

/**
 * Self-service: begin a "connect an additional SSO provider" flow for the
 * currently logged-in user. better-auth's SSO plugin has no built-in
 * "link to my current session" endpoint - its sign-in flow resolves/creates
 * users purely from the IdP's returned email, unaware of any existing
 * session. The service hands back a callbackURL with a short-lived token that
 * the link callback checks against the resulting session, and a nonce this
 * action sets as a cookie, so the callback acts only for the browser that asked.
 * @no-permission-required - only ever targets the caller's own account
 */
export async function initiateSsoConnect(
    providerId: string
): Promise<{ success: true; callbackURL: string } | { success: false; error: string }> {
    const currentUser = await getViewer();
    if (!currentUser) throw new Error("Unauthorized");
    if (!(await hasPermission(PERMISSIONS.PROFILE.MANAGE_SSO))) {
        return { success: false, error: "Your group may not change your sign-in providers." };
    }

    const parsed = IdSchema.safeParse(providerId);
    if (!parsed.success) return { success: false, error: "Invalid request" };

    const prepared = await prepareSsoConnect(currentUser.id, parsed.data);
    if (!prepared.success) return prepared;
    // Only the hash of the nonce is in the address, so a link passed on to someone else lacks the cookie.
    (await cookies()).set(CONNECT_NONCE_COOKIE, prepared.nonce, {
        httpOnly: true,
        sameSite: "lax",
        secure: secureCookiesFor(process.env),
        path: CONNECT_CALLBACK_PATH,
        maxAge: CONNECT_TOKEN_TTL_MS / 1000,
    });
    return { success: true, callbackURL: prepared.callbackURL };
}
