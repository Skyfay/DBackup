"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { checkPermission } from "@/lib/auth/access-control";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { AUDIT_ACTIONS, AUDIT_RESOURCES } from "@/lib/core/audit-types";
import { getErrorMessage, wrapError } from "@/lib/logging/errors";
import { logger } from "@/lib/logging/logger";
import { HOME_TENANT_ID } from "@/lib/tenant/home";
import { auditService } from "@/services/audit-service";
import { ssoProviderChanges } from "@/services/sso/oidc-audit";
import { discoverEndpoints } from "@/services/sso/oidc-discovery";
import { OidcProviderService } from "@/services/sso/oidc-provider-service";
import { settlePlacement } from "@/services/sso/sso-provider-rules";

const log = logger.child({ action: "oidc" });

const PAGE = "/dashboard/users";

// --- Schemas ---

const providerFields = {
    name: z.string().trim().min(1, "Give the provider a name.").max(100, "The name is too long."),
    domain: z.string().trim().max(253).optional(),
    clientId: z.string().trim().min(1, "The client ID is missing."),
    allowProvisioning: z.boolean().optional(),
    /** The group new people start in, null for none. */
    defaultGroupId: z.string().min(1).nullable().optional(),
    /** The tenant the provider belongs to, null for the platform. */
    tenantId: z.string().min(1).nullable().optional(),
    adapterConfig: z.record(z.string(), z.unknown()),
};

const createProviderSchema = z.object({
    ...providerFields,
    adapterId: z.string().min(1),
    providerId: z.string().min(1, "The provider ID is missing.").max(64).regex(/^[a-z0-9-_]+$/, "The provider ID takes lowercase letters, numbers, dashes and underscores."),
    clientSecret: z.string().min(1, "The client secret is missing."),
});

/** The type and the ID of a provider stay as they were saved, and an empty secret keeps the saved one. */
const updateProviderSchema = z.object({
    ...providerFields,
    id: z.string().min(1),
    clientSecret: z.string().optional(),
});

const checkSchema = z.object({
    adapterId: z.string().min(1),
    adapterConfig: z.record(z.string(), z.unknown()),
});

export type CreateSsoProviderInput = z.input<typeof createProviderSchema>;
export type UpdateSsoProviderInput = z.input<typeof updateProviderSchema>;

const firstIssue = (error: z.ZodError) => error.issues[0]?.message ?? "Invalid request";

/**
 * Whoever controls a sign-in provider signs in as anyone whose email it names, and the second
 * factor is not asked after it. So only a platform admin adds, changes, switches and deletes one:
 * no group and no platform group gives this right, see `ADMIN_ONLY` in owner-permissions.ts.
 */
const MANAGE = PERMISSIONS.PLATFORM.SIGN_IN_WRITE;

/**
 * The providers are the platform's, so every change is written to the log of the platform,
 * whichever tenant the viewer works in. The people a provider adds are written to its tenant.
 */
const PLATFORM_LOG = { tenantId: HOME_TENANT_ID };

// --- Actions ---

/** Reads the endpoints of a provider from its fields, for the check in its dialog and in its panel. */
export async function checkSsoConnection(input: z.input<typeof checkSchema>) {
    await checkPermission(MANAGE);
    const parsed = checkSchema.safeParse(input);
    if (!parsed.success) return { success: false, error: firstIssue(parsed.error) };

    const found = await discoverEndpoints(parsed.data.adapterId, parsed.data.adapterConfig);
    if (!found.ok) return { success: false, error: found.error };
    const { issuer, authorizationEndpoint, tokenEndpoint, userInfoEndpoint, jwksEndpoint } = found.endpoints;
    return {
        success: true,
        data: { issuer: issuer ?? null, authorization: authorizationEndpoint, token: tokenEndpoint, userInfo: userInfoEndpoint, jwks: jwksEndpoint ?? null },
    };
}

export async function createSsoProvider(input: CreateSsoProviderInput) {
    const user = await checkPermission(MANAGE);
    const parsed = createProviderSchema.safeParse(input);
    if (!parsed.success) return { success: false, error: firstIssue(parsed.error) };
    const { name, adapterId, providerId, domain, clientId, clientSecret, adapterConfig, allowProvisioning, defaultGroupId, tenantId } = parsed.data;

    const settled = await settlePlacement({ tenantId: tenantId ?? null, domain: domain ?? null, allowProvisioning: allowProvisioning ?? true, defaultGroupId: defaultGroupId ?? null }, null);
    if (!settled.ok) return { success: false, error: settled.error };
    const { placement } = settled;

    const found = await discoverEndpoints(adapterId, adapterConfig);
    if (!found.ok) return { success: false, error: found.error };

    try {
        const provider = await OidcProviderService.createProvider({
            name,
            adapterId,
            type: "oidc",
            providerId,
            domain: placement.domain,
            tenantId: placement.tenantId,
            clientId,
            clientSecret,
            allowProvisioning: placement.allowProvisioning,
            defaultGroupId: placement.defaultGroupId,
            adapterConfig: JSON.stringify(found.config),
            // The endpoints of the adapter, with the discovery endpoint for providers with an unusual path.
            issuer: found.endpoints.issuer,
            authorizationEndpoint: found.endpoints.authorizationEndpoint,
            tokenEndpoint: found.endpoints.tokenEndpoint,
            userInfoEndpoint: found.endpoints.userInfoEndpoint,
            jwksEndpoint: found.endpoints.jwksEndpoint,
            discoveryEndpoint: found.endpoints.discoveryEndpoint,
        });

        const state = await OidcProviderService.getAuditState(provider.id);
        await auditService.log(
            user.id,
            AUDIT_ACTIONS.CREATE,
            AUDIT_RESOURCES.SSO_PROVIDER,
            {
                name: provider.name,
                adapterId: provider.adapterId,
                providerId: provider.providerId,
                ...(settled.tenantName ? { tenant: settled.tenantName } : {}),
                ...(state?.groupName ? { group: state.groupName } : {}),
            },
            provider.id,
            PLATFORM_LOG
        );

        revalidatePath(PAGE);
        return { success: true, data: { id: provider.id } };
    } catch (error: unknown) {
        log.error("Failed to create SSO provider", {}, wrapError(error));
        return { success: false, error: getErrorMessage(error) };
    }
}

export async function updateSsoProvider(input: UpdateSsoProviderInput) {
    const user = await checkPermission(MANAGE);
    const parsed = updateProviderSchema.safeParse(input);
    if (!parsed.success) return { success: false, error: firstIssue(parsed.error) };
    const { id, name, domain, clientId, clientSecret, adapterConfig, allowProvisioning, defaultGroupId, tenantId } = parsed.data;

    // Read with the secrets in plain text, so a new client secret shows as changed. It is never written.
    const before = await OidcProviderService.getAuditState(id);
    if (!before) return { success: false, error: "The provider no longer exists." };

    // What the request leaves out stays as it is saved. Moving a provider to another tenant asks
    // for a group of that tenant again.
    const settled = await settlePlacement(
        {
            tenantId: tenantId === undefined ? before.tenantId : tenantId,
            domain: domain === undefined ? before.domain : domain,
            allowProvisioning: allowProvisioning ?? before.allowProvisioning,
            defaultGroupId: defaultGroupId === undefined ? before.defaultGroupId : defaultGroupId,
        },
        before
    );
    if (!settled.ok) return { success: false, error: settled.error };
    const { placement } = settled;

    const found = await discoverEndpoints(before.adapterId, adapterConfig);
    if (!found.ok) return { success: false, error: found.error };

    try {
        await OidcProviderService.updateProvider(id, {
            name,
            domain: placement.domain,
            tenantId: placement.tenantId,
            clientId,
            // Empty keeps the saved secret, the browser never has it.
            clientSecret: clientSecret || undefined,
            allowProvisioning: placement.allowProvisioning,
            defaultGroupId: placement.defaultGroupId,
            adapterConfig: JSON.stringify(found.config),
            issuer: found.endpoints.issuer,
            authorizationEndpoint: found.endpoints.authorizationEndpoint,
            tokenEndpoint: found.endpoints.tokenEndpoint,
            userInfoEndpoint: found.endpoints.userInfoEndpoint,
            jwksEndpoint: found.endpoints.jwksEndpoint,
            discoveryEndpoint: found.endpoints.discoveryEndpoint,
        });

        const after = await OidcProviderService.getAuditState(id);
        if (after) {
            await auditService.log(
                user.id,
                AUDIT_ACTIONS.UPDATE,
                AUDIT_RESOURCES.SSO_PROVIDER,
                {
                    name: after.name,
                    ...(before.name !== after.name ? { renamedFrom: before.name } : {}),
                    changes: ssoProviderChanges(before, after),
                },
                id,
                PLATFORM_LOG
            );
        }

        revalidatePath(PAGE);
        return { success: true };
    } catch (error: unknown) {
        log.error("Failed to update SSO provider", { providerId: id }, wrapError(error));
        return { success: false, error: getErrorMessage(error) };
    }
}

export async function deleteSsoProvider(id: string) {
    const user = await checkPermission(MANAGE);
    try {
        const deleted = await OidcProviderService.deleteProvider(id);
        await auditService.log(user.id, AUDIT_ACTIONS.DELETE, AUDIT_RESOURCES.SSO_PROVIDER, { name: deleted.name, providerId: deleted.providerId }, id, PLATFORM_LOG);
        revalidatePath(PAGE);
        return { success: true };
    } catch (error: unknown) {
        return { success: false, error: getErrorMessage(error) };
    }
}

export async function toggleSsoProvider(id: string, enabled: boolean) {
    const user = await checkPermission(MANAGE);
    try {
        const provider = await OidcProviderService.toggleProvider(id, enabled);
        await auditService.log(user.id, AUDIT_ACTIONS.UPDATE, AUDIT_RESOURCES.SSO_PROVIDER, { name: provider.name, enabled: provider.enabled }, id, PLATFORM_LOG);
        revalidatePath(PAGE);
        return { success: true };
    } catch (error: unknown) {
        return { success: false, error: getErrorMessage(error) };
    }
}
