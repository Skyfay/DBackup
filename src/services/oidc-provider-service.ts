import prisma from "@/lib/prisma";

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

        const oidcConfig = data.type === "oidc" ? JSON.stringify({
            issuer: data.issuer,
            clientId: data.clientId,
            clientSecret: data.clientSecret,
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

                clientId: data.clientId,
                clientSecret: data.clientSecret,

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

        if (isOidcUpdate || data.type === "oidc") {

                // Merge new data with existing data for config construction
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

                oidcConfigUpdate = JSON.stringify({
                    ...merged,
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

                clientId: data.clientId,
                clientSecret: data.clientSecret,

                issuer: data.issuer,
                authorizationEndpoint: data.authorizationEndpoint,
                tokenEndpoint: data.tokenEndpoint,
                userInfoEndpoint: data.userInfoEndpoint,
                jwksEndpoint: data.jwksEndpoint,

                ...(oidcConfigUpdate ? { oidcConfig: oidcConfigUpdate } : {})
            }
        });
    }

    static async deleteProvider(id: string) {
        return prisma.ssoProvider.delete({
            where: { id }
        });
    }

    static async toggleProvider(id: string, enabled: boolean) {
        return prisma.ssoProvider.update({
            where: { id },
            data: { enabled }
        });
    }
}
