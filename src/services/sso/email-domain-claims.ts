import prisma from "@/lib/prisma";
import { domainOfEmail, normalizeDomain } from "@/lib/auth/sso-domain";
import { HOME_TENANT_ID } from "@/lib/tenant/home";

/**
 * The tenant an email belongs to by its domain. A sign-in provider that claims a domain signs in
 * the accounts of its emails, linked by the email, so an account someone made with an email of
 * another tenant's domain, and a password they know, would later be the account of that person.
 * Only whoever manages the accounts of the platform gives an account such an email.
 */

export const CLAIMED_EMAIL = "The domain of this email signs in through the provider of another tenant. Only someone who manages the accounts of the platform can use it here.";

/** The tenant of the provider that claims the domain of an email, the home tenant for a provider of the platform, null when none does. */
export async function tenantClaimingEmail(email: string): Promise<string | null> {
    const domain = domainOfEmail(email);
    if (!domain) return null;
    // Few providers claim a domain, and one saved before domains were kept in lowercase still counts.
    const providers = await prisma.ssoProvider.findMany({ where: { domain: { not: null } }, select: { domain: true, tenantId: true } });
    const claim = providers.find((provider) => normalizeDomain(provider.domain) === domain);
    return claim ? claim.tenantId ?? HOME_TENANT_ID : null;
}

/**
 * Why an account in these tenants may not get the email, null when it may: the domain is free, or
 * claimed by a provider of one of the tenants. `platformLevel` is someone who manages the accounts
 * of the platform, who may give any email.
 */
export async function claimedEmailRefusal(email: string, tenantIds: readonly string[], platformLevel: boolean): Promise<string | null> {
    if (platformLevel) return null;
    const claim = await tenantClaimingEmail(email);
    return claim && !tenantIds.includes(claim) ? CLAIMED_EMAIL : null;
}
