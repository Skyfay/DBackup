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

type Claim = { domain: string | null; tenantId: string | null };

/** The providers that claim a domain. Few do, and one saved before domains were kept in lowercase still counts. */
const claims = (): Promise<Claim[]> => prisma.ssoProvider.findMany({ where: { domain: { not: null } }, select: { domain: true, tenantId: true } });

function claimOf(email: string, providers: readonly Claim[]): string | null {
    const domain = domainOfEmail(email);
    if (!domain) return null;
    const claim = providers.find((provider) => normalizeDomain(provider.domain) === domain);
    return claim ? claim.tenantId ?? HOME_TENANT_ID : null;
}

/** The tenant of the provider that claims the domain of an email, the home tenant for a provider of the platform, null when none does. */
export async function tenantClaimingEmail(email: string): Promise<string | null> {
    if (!domainOfEmail(email)) return null;
    return claimOf(email, await claims());
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

/**
 * The tenants other than the home tenant whose providers claim the emails of these accounts, by the
 * id of the account, for the accounts of no tenant. Such an account counts as one of that tenant and
 * not of the home tenant, see `userService.accountOf`: its email is of the people of that tenant, so
 * whoever sets its password would sign in as one of them. Accounts whose email no provider of
 * another tenant claims are left out.
 */
export async function foreignClaimsOf(accounts: readonly { id: string; email: string }[]): Promise<Map<string, string>> {
    const claimed = new Map<string, string>();
    if (accounts.length === 0) return claimed;
    const providers = await claims();
    for (const { id, email } of accounts) {
        const claim = claimOf(email, providers);
        if (claim && claim !== HOME_TENANT_ID) claimed.set(id, claim);
    }
    return claimed;
}

/**
 * Whether one of these accounts works in no tenant and has an email whose domain a provider of a
 * tenant not among `tenantIds` claims. Without its platform group such an account counts as one of
 * the tenant of that provider, see `foreignClaimsOf`, so only someone who may give the email, whose
 * reach covers that tenant, takes the platform group, see `emailClaimScope`.
 */
export async function tenantlessClaimedBeyond(userIds: readonly string[], tenantIds: readonly string[]): Promise<boolean> {
    if (userIds.length === 0) return false;
    const accounts = await prisma.user.findMany({ where: { id: { in: [...userIds] }, memberships: { none: {} } }, select: { email: true } });
    if (accounts.length === 0) return false;
    const providers = await claims();
    return accounts.some(({ email }) => {
        const claim = claimOf(email, providers);
        return claim !== null && !tenantIds.includes(claim);
    });
}
