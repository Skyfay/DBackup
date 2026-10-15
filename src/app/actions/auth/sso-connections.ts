"use server";

import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { auth } from "@/lib/auth";
import { getViewer, hasPermission } from "@/lib/auth/access-control";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { auditService } from "@/services/audit-service";
import { countSignInAccounts, listSsoConnections, prepareSsoConnect, type SsoConnections } from "@/services/sso/sso-connections-service";
import { AUDIT_ACTIONS, AUDIT_RESOURCES } from "@/lib/core/audit-types";
import { logger } from "@/lib/logging/logger";
import { wrapError, getErrorMessage } from "@/lib/logging/errors";

export type { ConnectableProvider, SsoConnection } from "@/services/sso/sso-connections-service";

const log = logger.child({ action: "sso-connections" });

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

    if ((await countSignInAccounts(currentUser.id)) <= 1) {
        return { success: false, error: "You need at least one other login method before removing this connection." };
    }

    try {
        const headersList = await headers();
        await auth.api.unlinkAccount({
            headers: headersList,
            body: { providerId, accountId },
        });

        await auditService.log(
            currentUser.id,
            AUDIT_ACTIONS.DELETE,
            AUDIT_RESOURCES.AUTH,
            { change: "SSO account unlinked", providerId },
            currentUser.id
        );

        revalidatePath("/dashboard/profile");
        return { success: true };
    } catch (error: unknown) {
        log.error("Failed to unlink SSO account", { userId: currentUser.id, providerId }, wrapError(error));
        return { success: false, error: getErrorMessage(error) || "Failed to unlink account" };
    }
}

/**
 * Self-service: begin a "connect an additional SSO provider" flow for the
 * currently logged-in user. better-auth's SSO plugin has no built-in
 * "link to my current session" endpoint - its sign-in flow resolves/creates
 * users purely from the IdP's returned email, unaware of any existing
 * session. The service hands back a callbackURL with a short-lived token that
 * the link callback checks against the resulting session.
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

    return prepareSsoConnect(currentUser.id, providerId);
}
