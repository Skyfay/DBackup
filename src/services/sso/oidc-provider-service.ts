import prisma from "@/lib/prisma";
import { encrypt } from "@/lib/crypto";

export interface CreateSsoProviderInput {
    name: string;
    adapterId: string;
    type: "oidc" | "saml";
    providerId: string;
    enabled?: boolean; // Default true
    allowProvisioning?: boolean;
    domain?: string | null; // Email domain for SSO matching (e.g., "example.com")
    adapterConfig?: string; // JSON string of the raw adapter configuration

    // Credentials
    clientId: string;
    clientSecret: string;

    // OIDC Endpoints (Calculated by Adapter before saving)
    issuer?: string;
    authorizationEndpoint: string;
    tokenEndpoint: string;
    userInfoEndpoint: string;
    jwksEndpoint?: string;
    /**
     * The OIDC discovery endpoint URL.
     * Required by better-auth even when skipDiscovery=true.
     * This should come from the adapter as different providers have different paths.
     */
    discoveryEndpoint?: string;
    scope?: string;
}

export interface UpdateSsoProviderInput extends Partial<CreateSsoProviderInput> {
    id: string;
}

export class OidcProviderService {

    static async getProviders() {
        return prisma.ssoProvider.findMany({
            orderBy: { createdAt: "desc" }
        });
    }

    static async getProviderById(id: string) {
        return prisma.ssoProvider.findUnique({
            where: { id }
        });
    }

    static async getEnabledProviders() {
        return prisma.ssoProvider.findMany({
            where: { enabled: true },
            select: {
                id: true,
                providerId: true,
                name: true,
                type: true,
                adapterId: true,
                domain: true,
                allowProvisioning: true
                // Do NOT select secrets
            }
        });
    }

    static async createProvider(data: CreateSsoProviderInput) {
        // Use discoveryEndpoint from adapter if provided, otherwise fallback to standard path
        // Different OIDC providers have different discovery paths (e.g., Authentik uses /application/o/{slug}/...)
        const discoveryEndpoint = data.discoveryEndpoint ?? (
            data.issuer
                ? `${data.issuer.replace(/\/$/, '')}/.well-known/openid-configuration`
                : undefined
        );

        // Encrypt credentials before storing
        const encryptedClientId = encrypt(data.clientId);
        const encryptedClientSecret = encrypt(data.clientSecret);

        const oidcConfig = data.type === "oidc" ? JSON.stringify({
            issuer: data.issuer,
            clientId: encryptedClientId,
            clientSecret: encryptedClientSecret,
            authorizationEndpoint: data.authorizationEndpoint,
            tokenEndpoint: data.tokenEndpoint,
            userInfoEndpoint: data.userInfoEndpoint,
            jwksEndpoint: data.jwksEndpoint,
            scope: data.scope || "openid profile email", // Ensure openid scope is present
            // discoveryEndpoint is required by better-auth even with skipDiscovery
            // It's called in the callback handler regardless of skipDiscovery setting
            discoveryEndpoint,
            // Skip OIDC discovery since we provide all endpoints manually
            skipDiscovery: true,
        }) : undefined;

        return prisma.ssoProvider.create({
            data: {
                name: data.name,
                adapterId: data.adapterId,
                type: data.type,
                providerId: data.providerId,
                enabled: data.enabled ?? true,
                allowProvisioning: data.allowProvisioning ?? true,
                domain: data.domain, // Required by better-auth SSO plugin
                adapterConfig: data.adapterConfig,

                clientId: encryptedClientId,
                clientSecret: encryptedClientSecret,

                issuer: data.issuer,
                authorizationEndpoint: data.authorizationEndpoint,
                tokenEndpoint: data.tokenEndpoint,
                userInfoEndpoint: data.userInfoEndpoint,
                jwksEndpoint: data.jwksEndpoint,

                oidcConfig
            }
        });
    }

    static async updateProvider(id: string, data: Partial<CreateSsoProviderInput>) {
        let oidcConfigUpdate: string | undefined = undefined;

        // If we have critical OIDC params or type OIDC, let's reconstruct config
        const isOidcUpdate = data.clientId || data.issuer || data.authorizationEndpoint;

        // We need existing data if partial update
        const existing = await prisma.ssoProvider.findUnique({ where: { id } });
        if (!existing) throw new Error("Provider not found");

        // Encrypt credentials if provided
        const encryptedClientId = data.clientId ? encrypt(data.clientId) : undefined;
        const encryptedClientSecret = data.clientSecret ? encrypt(data.clientSecret) : undefined;

        if (isOidcUpdate || data.type === "oidc") {

                // Merge new data with existing data for config construction
                // Note: existing values are already decrypted by Prisma middleware
                const merged = {
                    issuer: data.issuer ?? existing.issuer,
                    clientId: data.clientId ?? existing.clientId,
                    clientSecret: data.clientSecret ?? existing.clientSecret,
                    authorizationEndpoint: data.authorizationEndpoint ?? existing.authorizationEndpoint,
                    tokenEndpoint: data.tokenEndpoint ?? existing.tokenEndpoint,
                    userInfoEndpoint: data.userInfoEndpoint ?? existing.userInfoEndpoint,
                    jwksEndpoint: data.jwksEndpoint ?? existing.jwksEndpoint,
                    discoveryEndpoint: data.discoveryEndpoint ?? undefined
                };

                // If data.discoveryEndpoint is provided (from Action), use it.
                // If NOT provided, try to fallback to standard if issuer is present.
                let discEndpoint = data.discoveryEndpoint;
                if (!discEndpoint && merged.issuer) {
                    // Try to reconstruct standard path if not provided
                    discEndpoint = `${merged.issuer.replace(/\/$/, '')}/.well-known/openid-configuration`;
                }

                // Encrypt credentials inside oidcConfig
                oidcConfigUpdate = JSON.stringify({
                    ...merged,
                    clientId: encrypt(merged.clientId ?? ""),
                    clientSecret: encrypt(merged.clientSecret ?? ""),
                    scope: data.scope || "openid profile email",
                    discoveryEndpoint: discEndpoint,
                    skipDiscovery: true,
                });
        }

        return prisma.ssoProvider.update({
            where: { id },
            data: {
                name: data.name,
                providerId: data.providerId,
                domain: data.domain,
                enabled: data.enabled,
                allowProvisioning: data.allowProvisioning,
                adapterConfig: data.adapterConfig,

                clientId: encryptedClientId,
                clientSecret: encryptedClientSecret,

                issuer: data.issuer,
                authorizationEndpoint: data.authorizationEndpoint,
                tokenEndpoint: data.tokenEndpoint,
                userInfoEndpoint: data.userInfoEndpoint,
                jwksEndpoint: data.jwksEndpoint,

                ...(oidcConfigUpdate ? { oidcConfig: oidcConfigUpdate } : {})
            }
        });
    }

    /**
     * Reports who would be affected by deleting a provider, before the delete
     * actually happens: how many users are linked to it, and which of those
     * have no other login method (no password, no other SSO account) and
     * would therefore be completely locked out. Used to warn an admin before
     * they confirm OidcProviderService.deleteProvider().
     */
    static async getDeletionImpact(id: string) {
        const provider = await prisma.ssoProvider.findUnique({ where: { id } });
        if (!provider) {
            return { totalAffectedUsers: 0, usersWithNoOtherLogin: [] as { id: string; name: string; email: string }[] };
        }

        const linkedAccounts = await prisma.account.findMany({
            where: { providerId: provider.providerId },
            select: { userId: true },
        });
        const affectedUserIds = linkedAccounts.map((a) => a.userId);
        if (affectedUserIds.length === 0) {
            return { totalAffectedUsers: 0, usersWithNoOtherLogin: [] as { id: string; name: string; email: string }[] };
        }

        // Users whose ONLY account row is this provider's - deleting it would leave them with zero.
        const accountCounts = await prisma.account.groupBy({
            by: ["userId"],
            where: { userId: { in: affectedUserIds } },
            _count: { id: true },
        });
        const lockedOutUserIds = accountCounts.filter((c) => c._count.id <= 1).map((c) => c.userId);

        const usersWithNoOtherLogin = lockedOutUserIds.length > 0
            ? await prisma.user.findMany({
                where: { id: { in: lockedOutUserIds } },
                select: { id: true, name: true, email: true },
            })
            : [];

        return { totalAffectedUsers: affectedUserIds.length, usersWithNoOtherLogin };
    }

    /**
     * Deletes a provider and any accounts users have linked to it.
     *
     * providerId normally gets a random per-creation suffix (see
     * add-sso-provider-dialog.tsx), but that field is editable - an admin can
     * manually reuse an old providerId for a brand new provider. We cascade
     * the delete regardless: a removed provider should never leave old links
     * that could silently reactivate under a reused id without a fresh SSO
     * login re-verifying the connection. Affected users just re-link the
     * next time they sign in via that provider (see account-linking config
     * in src/lib/auth/index.ts).
     */
    static async deleteProvider(id: string) {
        return prisma.$transaction(async (tx) => {
            const provider = await tx.ssoProvider.findUniqueOrThrow({ where: { id } });
            await tx.account.deleteMany({ where: { providerId: provider.providerId } });
            return tx.ssoProvider.delete({ where: { id } });
        });
    }

    static async toggleProvider(id: string, enabled: boolean) {
        return prisma.ssoProvider.update({
            where: { id },
            data: { enabled }
        });
    }
}
