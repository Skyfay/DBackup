import prisma from "@/lib/prisma";
import { SsoProvider } from "@prisma/client";
import { OIDCEndpoints } from "@/lib/core/oidc-adapter";

export interface CreateSsoProviderInput {
    name: string;
    adapterId: string;
    type: "oidc" | "saml";
    providerId: string;
    enabled?: boolean; // Default true
    allowProvisioning?: boolean;

    // Credentials
    clientId: string;
    clientSecret: string;

    // OIDC Endpoints (Calculated by Adapter before saving)
    issuer?: string;
    authorizationEndpoint: string;
    tokenEndpoint: string;
    userInfoEndpoint: string;
    jwksEndpoint?: string;
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
                adapterId: true
                // Do NOT select secrets
            }
        });
    }

    static async createProvider(data: CreateSsoProviderInput) {
        return prisma.ssoProvider.create({
            data: {
                name: data.name,
                adapterId: data.adapterId,
                type: data.type,
                providerId: data.providerId,
                enabled: data.enabled ?? true,
                allowProvisioning: data.allowProvisioning ?? true,

                clientId: data.clientId,
                clientSecret: data.clientSecret,

                issuer: data.issuer,
                authorizationEndpoint: data.authorizationEndpoint,
                tokenEndpoint: data.tokenEndpoint,
                userInfoEndpoint: data.userInfoEndpoint,
                jwksEndpoint: data.jwksEndpoint,
                scope: data.scope
            }
        });
    }

    static async updateProvider(id: string, data: Partial<CreateSsoProviderInput>) {
        return prisma.ssoProvider.update({
            where: { id },
            data
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
