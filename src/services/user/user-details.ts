import prisma from "@/lib/prisma";
import { auditSentence } from "@/lib/core/audit-sentence";
import { parseUserAgent } from "@/lib/core/user-agent";
import { getDataRetentionValues } from "@/services/system/data-retention-service";
import { CREDENTIAL_PROVIDER, heldByBrowser } from "./users-model";
import type { UserDetails } from "./users-types";

/** The newest entries of the audit log the panel of a user lists. */
const ACTIVITY_LIMIT = 8;

/**
 * Everything the panel of one user shows beyond its row: how they sign in, the sessions their
 * browsers hold, their API keys and what they did last. Null when the user is gone.
 *
 * `viewerSessionId` marks the session of whoever looks, which the panel never signs out.
 */
export async function getUserDetails(userId: string, viewerSessionId: string | null, now = Date.now()): Promise<UserDetails | null> {
    const user = await prisma.user.findUnique({
        where: { id: userId },
        select: {
            id: true,
            twoFactorEnabled: true,
            passkeyTwoFactor: true,
            accounts: { select: { providerId: true, createdAt: true, updatedAt: true } },
            passkeys: { select: { id: true, name: true, createdAt: true, deviceType: true }, orderBy: { createdAt: "desc" } },
            sessions: { select: { id: true, createdAt: true, expiresAt: true, userAgent: true, ipAddress: true }, orderBy: { createdAt: "desc" } },
            apiKeys: { select: { id: true, name: true, prefix: true, enabled: true, expiresAt: true, lastUsedAt: true }, orderBy: { createdAt: "desc" } },
        },
    });
    if (!user) return null;

    const ssoIds = user.accounts.filter((account) => account.providerId !== CREDENTIAL_PROVIDER).map((account) => account.providerId);
    const [providers, activity, retention] = await Promise.all([
        ssoIds.length === 0
            ? Promise.resolve([])
            : prisma.ssoProvider.findMany({ where: { providerId: { in: ssoIds } }, select: { providerId: true, name: true, adapterId: true } }),
        prisma.auditLog.findMany({
            where: { userId },
            orderBy: { createdAt: "desc" },
            take: ACTIVITY_LIMIT,
            select: { id: true, createdAt: true, action: true, resource: true, details: true },
        }),
        getDataRetentionValues(),
    ]);
    const names = new Map(providers.map((provider) => [provider.providerId, provider]));
    const password = user.accounts.find((account) => account.providerId === CREDENTIAL_PROVIDER);

    return {
        id: user.id,
        password: password ? { changedAt: password.updatedAt.toISOString() } : null,
        app: Boolean(user.twoFactorEnabled && !user.passkeyTwoFactor),
        passkeys: user.passkeys.map((passkey) => ({
            id: passkey.id,
            name: passkey.name,
            createdAt: passkey.createdAt?.toISOString() ?? null,
            deviceType: passkey.deviceType,
        })),
        sso: user.accounts
            .filter((account) => account.providerId !== CREDENTIAL_PROVIDER)
            .map((account) => ({
                providerId: account.providerId,
                name: names.get(account.providerId)?.name ?? account.providerId,
                adapterId: names.get(account.providerId)?.adapterId ?? null,
                linkedAt: account.createdAt.toISOString(),
            })),
        sessions: user.sessions
            .filter((session) => heldByBrowser(session) && session.expiresAt.getTime() > now)
            .map((session) => {
                const agent = parseUserAgent(session.userAgent);
                return {
                    id: session.id,
                    createdAt: session.createdAt.toISOString(),
                    expiresAt: session.expiresAt.toISOString(),
                    agent,
                    device: agent.device,
                    ip: session.ipAddress || null,
                    current: session.id === viewerSessionId,
                };
            }),
        apiKeys: user.apiKeys.map((key) => ({
            id: key.id,
            name: key.name,
            prefix: key.prefix,
            enabled: key.enabled,
            expiresAt: key.expiresAt?.toISOString() ?? null,
            lastUsedAt: key.lastUsedAt?.toISOString() ?? null,
        })),
        activity: activity.map((entry) => ({ id: entry.id, at: entry.createdAt.toISOString(), action: entry.action, text: auditSentence(entry) })),
        auditDays: retention.auditLog,
    };
}
