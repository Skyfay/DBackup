import prisma from "@/lib/prisma";
import { isEmailDomain, normalizeDomain } from "@/lib/auth/sso-domain";
import { HOME_TENANT_ID } from "@/lib/tenant/home";
import { OidcProviderService } from "./oidc-provider-service";

/**
 * Who a sign-in provider belongs to, who reaches it and where the people it adds land, checked
 * before it is saved. A provider of the platform is a button on the login page and adds people to
 * the home tenant. A provider of a tenant is reached by the domain of an email only and adds
 * people to its tenant, so it needs both a domain and, while it adds people, a group there.
 */

export interface ProviderPlacement {
    /** The tenant that brings the provider, null for one of the platform. */
    tenantId: string | null;
    /** An email of this domain goes straight to the provider from the login page. */
    domain: string | null;
    /** Adds someone on their first sign-in. */
    allowProvisioning: boolean;
    /** The group new people start in, null for none. */
    defaultGroupId: string | null;
}

export type PlacementResult =
    | { ok: true; placement: ProviderPlacement; tenantName: string | null }
    | { ok: false; error: string };

/** The home tenant holds what the platform owns, so a provider of it is one of the platform. */
export const belongsTo = (tenantId: string | null | undefined): string | null => (!tenantId || tenantId === HOME_TENANT_ID ? null : tenantId);

/** What the checks read, from the database unless a test hands in its own. */
export interface PlacementLookups {
    tenantName: (tenantId: string) => Promise<string | null>;
    /** A group of that tenant, null for one that is gone or belongs to another tenant. */
    group: (groupId: string, tenantId: string) => Promise<{ id: string; name: string } | null>;
    /** The provider other than `exceptId` that claims the domain already. */
    domainOwner: (domain: string, exceptId: string | null) => Promise<{ name: string } | null>;
}

const DATABASE: PlacementLookups = {
    tenantName: async (tenantId) => (await prisma.tenant.findUnique({ where: { id: tenantId }, select: { name: true } }))?.name ?? null,
    group: (groupId, tenantId) => OidcProviderService.getGroup(groupId, tenantId),
    domainOwner: async (domain, exceptId) => {
        // Few providers claim a domain, and one saved before domains were kept in lowercase still counts.
        const claimed = await prisma.ssoProvider.findMany({
            where: { domain: { not: null }, ...(exceptId ? { NOT: { id: exceptId } } : {}) },
            select: { name: true, domain: true },
        });
        return claimed.find((provider) => normalizeDomain(provider.domain) === domain) ?? null;
    },
};

const refuse = (error: string): PlacementResult => ({ ok: false, error });

/**
 * Checks where a provider belongs and settles what its save keeps. `before` is the provider as it
 * is saved, null for a new one. A group that stays as it was in the same tenant is not looked up
 * again. A provider that adds nobody drops a group that no longer fits instead of refusing, since
 * its form does not show the group then.
 */
export async function settlePlacement(next: ProviderPlacement, before: (ProviderPlacement & { id: string }) | null, lookups: PlacementLookups = DATABASE): Promise<PlacementResult> {
    const tenantId = belongsTo(next.tenantId);
    const domain = normalizeDomain(next.domain);
    if (domain && !isEmailDomain(domain)) return refuse("The email domain is no domain. Type it like example.com, without the @.");

    let tenantName: string | null = null;
    if (tenantId) {
        tenantName = await lookups.tenantName(tenantId);
        if (!tenantName) return refuse("The tenant no longer exists.");
        if (!domain) return refuse("A provider of a tenant is reached by its email domain only, so it needs one.");
    }
    if (domain) {
        const owner = await lookups.domainOwner(domain, before?.id ?? null);
        if (owner) return refuse(`${owner.name} signs in ${domain} already. A domain belongs to one provider.`);
    }

    let groupId = next.defaultGroupId;
    const unchanged = before !== null && belongsTo(before.tenantId) === tenantId && before.defaultGroupId === groupId;
    if (groupId && !unchanged && !(await lookups.group(groupId, tenantId ?? HOME_TENANT_ID))) {
        if (next.allowProvisioning) return refuse(tenantName ? `The group is no group of ${tenantName}. Pick one of its groups.` : "The group no longer exists.");
        groupId = null;
    }
    if (tenantName && next.allowProvisioning && !groupId) {
        return refuse(`A provider of a tenant adds people to ${tenantName}, so it needs a group there for them.`);
    }
    return { ok: true, placement: { tenantId, domain, allowProvisioning: next.allowProvisioning, defaultGroupId: groupId }, tenantName };
}
