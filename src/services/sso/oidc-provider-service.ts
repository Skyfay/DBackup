import prisma from "@/lib/prisma";
import { encrypt } from "@/lib/crypto";

export interface CreateSsoProviderInput {
    name: string;
    adapterId: string;
    type: "oidc" | "saml";
    providerId: string;
    enabled?: boolean; // Default true
    allowProvisioning?: boolean;
    /** The group someone the provider adds starts in, null for none. */
    defaultGroupId?: string | null;
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

    /** A provider with its client ID and secret in plain text, for the server only. */
    static async getProviderById(id: string) {
        return prisma.ssoProvider.findUnique({
            where: { id }
        });
    }

    /**
     * A provider as the audit log compares it before and after a change: in plain text, so a new
     * secret shows as changed, with the name of the group of new people. The secret is never written.
     */
    static async getAuditState(id: string) {
        const provider = await prisma.ssoProvider.findUnique({ where: { id } });
        if (!provider) return null;
        const group = provider.defaultGroupId
            ? await prisma.group.findUnique({ where: { id: provider.defaultGroupId }, select: { name: true } })
            : null;
        return { ...provider, groupName: group?.name ?? null };
    }

    /** A group new people of a provider could start in, with what it may do. */
    static async getGroup(id: string) {
        return prisma.group.findUnique({ where: { id }, select: { id: true, name: true, permissions: true } });
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
                defaultGroupId: data.defaultGroupId ?? null,
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

    static async updateProvider(id: string, data: Partial<Omit<CreateSsoProviderInput, "providerId">>) {
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
                // The provider ID is part of the callback URL and of every link, so it never changes.
                domain: data.domain,
                enabled: data.enabled,
                allowProvisioning: data.allowProvisioning,
                defaultGroupId: data.defaultGroupId,
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
     * Deletes a provider and any accounts users have linked to it.
     *
     * providerId gets a random suffix when a provider is created and never
     * changes after that, but an admin can pick an old providerId for a brand
     * new provider. We cascade
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
