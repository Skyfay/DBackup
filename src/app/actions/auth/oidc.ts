"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { checkPermission, getUserPermissions } from "@/lib/auth/access-control";
import { groupPermissions, type OwnerGroup } from "@/lib/auth/owner-permissions";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { AUDIT_ACTIONS, AUDIT_RESOURCES } from "@/lib/core/audit-types";
import { getErrorMessage, wrapError } from "@/lib/logging/errors";
import { logger } from "@/lib/logging/logger";
import { auditService } from "@/services/audit-service";
import { ssoProviderChanges } from "@/services/sso/oidc-audit";
import { discoverEndpoints } from "@/services/sso/oidc-discovery";
import { OidcProviderService } from "@/services/sso/oidc-provider-service";
import { groupLockReason } from "@/services/sso/sso-providers-types";
import { SUPER_ADMIN_GROUP } from "@/services/user/users-model";

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
 * Why the caller may not send the new people of a provider into a group, or null when they may.
 * Whoever controls a provider can add people through it, so nobody sends them into a group that
 * may do more than their own. A group that stays as it was is not checked again.
 */
async function groupRefusal(groupId: string | null | undefined, current: string | null, caller: OwnerGroup | null): Promise<string | null> {
    if (!groupId || groupId === current) return null;
    const group = await OidcProviderService.getGroup(groupId);
    if (!group) return "The group no longer exists.";
    const reason = groupLockReason(
        { superAdmin: group.name === SUPER_ADMIN_GROUP, permissions: groupPermissions(group) },
        { superAdmin: caller?.name === SUPER_ADMIN_GROUP, permissions: groupPermissions(caller) }
    );
    return reason ? `${reason}.` : null;
}

// --- Actions ---

export async function getPublicSsoProviders() {
    // Audit compliance: Safe for public access because it returns [] if not logged in
    await getUserPermissions();
    return OidcProviderService.getEnabledProviders();
}

/** Reads the endpoints of a provider from its fields, for the check in its dialog and in its panel. */
export async function checkSsoConnection(input: z.input<typeof checkSchema>) {
    await checkPermission(PERMISSIONS.SETTINGS.WRITE);
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
    const user = await checkPermission(PERMISSIONS.SETTINGS.WRITE);
    const parsed = createProviderSchema.safeParse(input);
    if (!parsed.success) return { success: false, error: firstIssue(parsed.error) };
    const { name, adapterId, providerId, domain, clientId, clientSecret, adapterConfig, allowProvisioning, defaultGroupId } = parsed.data;

    const refused = await groupRefusal(defaultGroupId, null, user.group);
    if (refused) return { success: false, error: refused };

    const found = await discoverEndpoints(adapterId, adapterConfig);
    if (!found.ok) return { success: false, error: found.error };

    try {
        const provider = await OidcProviderService.createProvider({
            name,
            adapterId,
            type: "oidc",
            providerId,
            domain: domain || null,
            clientId,
            clientSecret,
            allowProvisioning: allowProvisioning ?? true,
            defaultGroupId: defaultGroupId ?? null,
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
            { name: provider.name, adapterId: provider.adapterId, providerId: provider.providerId, ...(state?.groupName ? { group: state.groupName } : {}) },
            provider.id
        );

        revalidatePath(PAGE);
        return { success: true, data: { id: provider.id } };
    } catch (error: unknown) {
        log.error("Failed to create SSO provider", {}, wrapError(error));
        return { success: false, error: getErrorMessage(error) };
    }
}

export async function updateSsoProvider(input: UpdateSsoProviderInput) {
    const user = await checkPermission(PERMISSIONS.SETTINGS.WRITE);
    const parsed = updateProviderSchema.safeParse(input);
    if (!parsed.success) return { success: false, error: firstIssue(parsed.error) };
    const { id, name, domain, clientId, clientSecret, adapterConfig, allowProvisioning, defaultGroupId } = parsed.data;

    // Read with the secrets in plain text, so a new client secret shows as changed. It is never written.
    const before = await OidcProviderService.getAuditState(id);
    if (!before) return { success: false, error: "The provider no longer exists." };

    const refused = await groupRefusal(defaultGroupId, before.defaultGroupId, user.group);
    if (refused) return { success: false, error: refused };

    const found = await discoverEndpoints(before.adapterId, adapterConfig);
    if (!found.ok) return { success: false, error: found.error };

    try {
        await OidcProviderService.updateProvider(id, {
            name,
            domain: domain || null,
            clientId,
            // Empty keeps the saved secret, the browser never has it.
            clientSecret: clientSecret || undefined,
            allowProvisioning,
            defaultGroupId,
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
                id
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
    const user = await checkPermission(PERMISSIONS.SETTINGS.WRITE);
    try {
        const deleted = await OidcProviderService.deleteProvider(id);
        await auditService.log(user.id, AUDIT_ACTIONS.DELETE, AUDIT_RESOURCES.SSO_PROVIDER, { name: deleted.name, providerId: deleted.providerId }, id);
        revalidatePath(PAGE);
        return { success: true };
    } catch (error: unknown) {
        return { success: false, error: getErrorMessage(error) };
    }
}

export async function toggleSsoProvider(id: string, enabled: boolean) {
    const user = await checkPermission(PERMISSIONS.SETTINGS.WRITE);
    try {
        const provider = await OidcProviderService.toggleProvider(id, enabled);
        await auditService.log(user.id, AUDIT_ACTIONS.UPDATE, AUDIT_RESOURCES.SSO_PROVIDER, { name: provider.name, enabled: provider.enabled }, id);
        revalidatePath(PAGE);
        return { success: true };
    } catch (error: unknown) {
        return { success: false, error: getErrorMessage(error) };
    }
}
