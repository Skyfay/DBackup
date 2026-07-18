"use server";

import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { auth } from "@/lib/auth";
import prisma from "@/lib/prisma";
import { getCurrentUserWithGroup } from "@/lib/auth/access-control";
import { auditService } from "@/services/audit-service";
import { AUDIT_ACTIONS, AUDIT_RESOURCES } from "@/lib/core/audit-types";
import { encrypt } from "@/lib/crypto";
import { logger } from "@/lib/logging/logger";
import { wrapError, getErrorMessage } from "@/lib/logging/errors";

const log = logger.child({ action: "sso-connections" });

const CONNECT_TOKEN_TTL_MS = 5 * 60 * 1000;

export interface SsoConnection {
    /** Account row's DB id - React list key only, NOT what better-auth matches on for unlink. */
    id: string;
    /** The OAuth/OIDC subject id at the IdP (Account.accountId) - this is what unlinkAccount matches on, together with providerId. */
    accountId: string;
    providerId: string;
    createdAt: Date;
    providerName: string;
    adapterId: string | null;
    providerAvailable: boolean;
}

export interface ConnectableProvider {
    providerId: string;
    name: string;
    adapterId: string;
}

/**
 * Self-service: list the current user's linked SSO identities plus which
 * enabled providers they could still connect.
 * @no-permission-required - only ever reads the caller's own accounts
 */
export async function getMySsoConnections(): Promise<{
    connections: SsoConnection[];
    connectableProviders: ConnectableProvider[];
    totalAccountCount: number;
}> {
    const currentUser = await getCurrentUserWithGroup();
    if (!currentUser) throw new Error("Unauthorized");

    const [accounts, providers] = await Promise.all([
        prisma.account.findMany({ where: { userId: currentUser.id } }),
        prisma.ssoProvider.findMany({
            select: { providerId: true, name: true, adapterId: true, enabled: true },
        }),
    ]);

    const providerByProviderId = new Map(providers.map((p) => [p.providerId, p]));
    const linkedProviderIds = new Set<string>();

    const connections: SsoConnection[] = accounts
        .filter((a) => a.providerId !== "credential")
        .map((a) => {
            linkedProviderIds.add(a.providerId);
            const provider = providerByProviderId.get(a.providerId);
            return {
                id: a.id,
                accountId: a.accountId,
                providerId: a.providerId,
                createdAt: a.createdAt,
                providerName: provider?.name ?? a.providerId,
                adapterId: provider?.adapterId ?? null,
                providerAvailable: !!provider?.enabled,
            };
        });

    const connectableProviders: ConnectableProvider[] = providers
        .filter((p) => p.enabled && !linkedProviderIds.has(p.providerId))
        .map((p) => ({ providerId: p.providerId, name: p.name, adapterId: p.adapterId }));

    return { connections, connectableProviders, totalAccountCount: accounts.length };
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
    const currentUser = await getCurrentUserWithGroup();
    if (!currentUser) throw new Error("Unauthorized");

    const totalAccounts = await prisma.account.count({ where: { userId: currentUser.id } });
    if (totalAccounts <= 1) {
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
 * session. To avoid silently switching the browser session to a different
 * account if the IdP authenticates a different (but already registered)
 * email, the returned callbackURL carries a short-lived encrypted token that
 * src/app/api/auth/sso-link-callback/route.ts verifies against the resulting
 * session before treating the connection as successful.
 * @no-permission-required - only ever targets the caller's own account
 */
export async function initiateSsoConnect(
    providerId: string
): Promise<{ success: true; callbackURL: string } | { success: false; error: string }> {
    const currentUser = await getCurrentUserWithGroup();
    if (!currentUser) throw new Error("Unauthorized");

    const provider = await prisma.ssoProvider.findUnique({ where: { providerId } });
    if (!provider || !provider.enabled) {
        return { success: false, error: "This provider is not available." };
    }

    const alreadyLinked = await prisma.account.findFirst({ where: { userId: currentUser.id, providerId } });
    if (alreadyLinked) {
        return { success: false, error: "This provider is already connected." };
    }

    const token = encrypt(
        JSON.stringify({ userId: currentUser.id, expiresAt: Date.now() + CONNECT_TOKEN_TTL_MS })
    );

    return {
        success: true,
        callbackURL: `/api/auth/sso-link-callback?t=${encodeURIComponent(token)}`,
    };
}
