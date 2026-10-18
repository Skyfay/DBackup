import prisma from "@/lib/prisma";
import { encrypt } from "@/lib/crypto";
import { tenantSignInRefusal } from "@/lib/auth/sso-tenant-guard";

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

export interface SsoConnections {
    connections: SsoConnection[];
    connectableProviders: ConnectableProvider[];
    totalAccountCount: number;
}

interface ConnectingUser {
    email: string;
    platformRole: string | null;
    /** An account of a platform group, which the sign-in through a provider of a tenant refuses. */
    platformGroupId: string | null;
    memberships: { tenantId: string }[];
}

const connectingUser = (userId: string): Promise<ConnectingUser | null> =>
    prisma.user.findUnique({ where: { id: userId }, select: { email: true, platformRole: true, platformGroupId: true, memberships: { select: { tenantId: true } } } });

/**
 * Whether someone may connect a provider to their account. Any of the platform, and one of a tenant
 * only in a tenant they work in, with an email of its domain and never as a platform admin or an
 * account of a platform group, which the sign-in through it refuses anyway. The others of tenants
 * stay unlisted.
 */
function mayConnect(provider: { tenantId: string | null; domain: string | null }, user: ConnectingUser | null): boolean {
    if (!provider.tenantId) return true;
    if (!user || tenantSignInRefusal(provider, user) !== null) return false;
    return user.memberships.some((membership) => membership.tenantId === provider.tenantId);
}

/** The SSO identities a user has linked, and the enabled providers they could still connect. */
export async function listSsoConnections(userId: string): Promise<SsoConnections> {
    const [accounts, providers, user] = await Promise.all([
        prisma.account.findMany({ where: { userId } }),
        prisma.ssoProvider.findMany({
            select: { providerId: true, name: true, adapterId: true, enabled: true, tenantId: true, domain: true },
        }),
        connectingUser(userId),
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
        .filter((p) => p.enabled && !linkedProviderIds.has(p.providerId) && mayConnect(p, user))
        .map((p) => ({ providerId: p.providerId, name: p.name, adapterId: p.adapterId }));

    return { connections, connectableProviders, totalAccountCount: accounts.length };
}

/** How many ways a user has to sign in, the password included. */
export async function countSignInAccounts(userId: string): Promise<number> {
    return prisma.account.count({ where: { userId } });
}

/**
 * Starts connecting another provider to a user. The callback URL carries a short-lived encrypted
 * token, which src/app/api/auth/sso-link-callback/route.ts checks against the session the
 * provider signs in, so a provider that answers with another registered email never switches
 * the browser to that account silently.
 */
export async function prepareSsoConnect(
    userId: string,
    providerId: string
): Promise<{ success: true; callbackURL: string } | { success: false; error: string }> {
    const provider = await prisma.ssoProvider.findUnique({ where: { providerId }, select: { enabled: true, tenantId: true, domain: true } });
    if (!provider || !provider.enabled || (provider.tenantId && !mayConnect(provider, await connectingUser(userId)))) {
        return { success: false, error: "This provider is not available." };
    }

    const alreadyLinked = await prisma.account.findFirst({ where: { userId, providerId }, select: { id: true } });
    if (alreadyLinked) {
        return { success: false, error: "This provider is already connected." };
    }

    const token = encrypt(JSON.stringify({ userId, expiresAt: Date.now() + CONNECT_TOKEN_TTL_MS }));
    return {
        success: true,
        callbackURL: `/api/auth/sso-link-callback?t=${encodeURIComponent(token)}`,
    };
}
