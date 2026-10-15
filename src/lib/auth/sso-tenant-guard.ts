import prisma from "@/lib/prisma";
import { PLATFORM_ADMIN_ROLE } from "@/lib/auth/owner-permissions";
import { emailOfDomain } from "@/lib/auth/sso-domain";
import { AUDIT_ACTIONS, AUDIT_RESOURCES } from "@/lib/core/audit-types";
import { runAsTenant } from "@/lib/tenant/context";
import { auditService } from "@/services/audit-service";
import { ssoProviderIdOf, type SsoHookContext } from "./sso-guard";

/**
 * Sign-ins through a provider of a tenant. The tenant runs that identity provider, so DBackup takes
 * its word only for emails of the provider's domain, and never for a platform admin, who holds
 * every tenant. better-auth links an account by its email whenever the provider says the email is
 * verified, so these hooks refuse the link and the session instead of trusting the provider.
 *
 * An account that signs in through such a provider for the first time joins its tenant with the
 * provider's group, while the provider adds people. That mirrors the link itself: the provider
 * vouches for the email in both, and someone new of the same email would land there too. A
 * provider that adds nobody signs in only the members of its tenant.
 */

/** The login page says why when a provider of a tenant may not sign someone in. */
export const TENANT_REFUSED_URL = "/?error=sso_tenant_refused";

/** The login page says so when a provider of a tenant that adds nobody meets someone who is no member there. */
export const TENANT_NOT_MEMBER_URL = "/?error=sso_tenant_not_member";

export const JOINED_THROUGH_SSO = "Joined through single sign-on";

export type TenantRefusal = "platform-admin" | "other-domain" | "not-member";

interface RefusalProvider {
    tenantId: string | null;
    domain: string | null;
    /** Adds people, so someone who is no member of the tenant joins it. Left out, membership is not checked. */
    allowProvisioning?: boolean;
}

interface RefusalAccount {
    email: string;
    platformRole?: string | null;
    /** The tenants the account works in, left out where membership is not checked. */
    memberships?: { tenantId: string }[];
}

/**
 * Why a provider may not sign in an account, null when it may, which a provider of the platform
 * always may. A provider of a tenant that adds nobody signs in only the members of its tenant.
 */
export function tenantSignInRefusal(provider: RefusalProvider, user: RefusalAccount): TenantRefusal | null {
    if (!provider.tenantId) return null;
    if (user.platformRole === PLATFORM_ADMIN_ROLE) return "platform-admin";
    if (!emailOfDomain(user.email, provider.domain)) return "other-domain";
    if (provider.allowProvisioning === false && user.memberships && !user.memberships.some((membership) => membership.tenantId === provider.tenantId)) return "not-member";
    return null;
}

/** The provider of a tenant a callback signs in through, null for any other request. */
async function tenantProviderOf(context: SsoHookContext | null | undefined) {
    const providerId = ssoProviderIdOf(context);
    if (!providerId) return null;
    const provider = await prisma.ssoProvider.findUnique({
        where: { providerId },
        select: { providerId: true, name: true, tenantId: true, domain: true, allowProvisioning: true, defaultGroupId: true },
    });
    return provider?.tenantId ? { ...provider, tenantId: provider.tenantId } : null;
}

const accountOf = (userId: string) =>
    prisma.user.findUnique({ where: { id: userId }, select: { name: true, email: true, platformRole: true, memberships: { select: { tenantId: true } } } });

/**
 * Runs before better-auth links an account to a provider. False keeps a provider of a tenant from
 * linking an account it may not sign in, and the session hook then sends the person back to the
 * login page with the reason. A new account was checked when it was added, it is not visible yet.
 */
export async function allowTenantSsoLink(account: { userId: string }, context: SsoHookContext | null | undefined): Promise<boolean> {
    const provider = await tenantProviderOf(context);
    if (!provider) return true;
    const user = await accountOf(account.userId);
    return !user || tenantSignInRefusal(provider, user) === null;
}

/**
 * Runs before every session better-auth starts. A sign-in through a provider of a tenant goes on
 * only for an account it may sign in, also one linked before the provider moved to the tenant. An
 * account that joined the tenant through its link just now is a member by then.
 */
export async function refuseTenantSsoSession(session: { userId: string }, context: SsoHookContext | null | undefined, redirect: (url: string) => unknown): Promise<void> {
    const provider = await tenantProviderOf(context);
    if (!provider) return;
    const user = await accountOf(session.userId);
    const refusal = user ? tenantSignInRefusal(provider, user) : "other-domain";
    if (refusal === null) return;
    throw redirect(refusal === "not-member" ? TENANT_NOT_MEMBER_URL : TENANT_REFUSED_URL);
}

/**
 * Runs after better-auth linked an account to a provider. An account that signs in through a
 * provider of a tenant for the first time joins that tenant with the provider's group, unless it
 * is a member there already, and the log of the tenant says so. Someone new was placed when they
 * were added, so they are a member already, or the group was gone then too.
 */
export async function joinSsoTenant(account: { userId: string }, context: SsoHookContext | null | undefined): Promise<void> {
    const provider = await tenantProviderOf(context);
    if (!provider?.allowProvisioning || !provider.defaultGroupId) return;
    const { tenantId, defaultGroupId } = provider;
    const member = await prisma.tenantMembership.findUnique({ where: { userId_tenantId: { userId: account.userId, tenantId } }, select: { groupId: true } });
    if (member) return;
    const user = await accountOf(account.userId);
    if (!user || tenantSignInRefusal(provider, user)) return;
    // A group of the provider's tenant only, looked up there since nobody is signed in yet.
    const group = await runAsTenant(tenantId, () => prisma.group.findUnique({ where: { id: defaultGroupId }, select: { id: true, name: true } }));
    if (!group) return;
    await prisma.tenantMembership.create({ data: { userId: account.userId, tenantId, groupId: group.id } });
    await auditService.log(
        account.userId,
        AUDIT_ACTIONS.UPDATE,
        AUDIT_RESOURCES.USER,
        { name: user.name, email: user.email, via: "sso", change: JOINED_THROUGH_SSO, provider: provider.name, providerId: provider.providerId, group: group.name },
        account.userId,
        { tenantId }
    );
}
