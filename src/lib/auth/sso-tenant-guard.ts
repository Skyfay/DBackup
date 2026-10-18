import { getSessionCookie } from "better-auth/cookies";
import prisma from "@/lib/prisma";
import { PLATFORM_ADMIN_ROLE } from "@/lib/auth/owner-permissions";
import { emailOfDomain } from "@/lib/auth/sso-domain";
import { AUDIT_ACTIONS, AUDIT_RESOURCES } from "@/lib/core/audit-types";
import { runAsTenant } from "@/lib/tenant/context";
import { HOME_TENANT_ID } from "@/lib/tenant/home";
import { auditService } from "@/services/audit-service";
import { DISABLED_PROVIDER_URL, isSsoCallback, ssoProviderIdOf, type SsoHookContext } from "./sso-guard";

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
 *
 * Neither kind of provider links an account that another tenant made: its maker chose its password,
 * and the person of the email would sign in to an account someone else can sign in to as well. A
 * provider of a tenant never links one, a provider of the platform only for whoever signs in to the
 * account already and links the provider from their profile.
 */

/** The login page says why when a provider of a tenant may not sign someone in. */
export const TENANT_REFUSED_URL = "/?error=sso_tenant_refused";

/** The login page says so when a provider of a tenant that adds nobody meets someone who is no member there. */
export const TENANT_NOT_MEMBER_URL = "/?error=sso_tenant_not_member";

/** The login page says so when a provider meets an account of its email that it is not linked to and may not link. */
export const NOT_LINKED_URL = "/?error=sso_account_not_linked";

export const JOINED_THROUGH_SSO = "Joined through single sign-on";

export type TenantRefusal = "platform-admin" | "platform-group" | "other-domain" | "not-member";

interface RefusalProvider {
    tenantId: string | null;
    domain: string | null;
    /** Adds people, so someone who is no member of the tenant joins it. Left out, membership is not checked. */
    allowProvisioning?: boolean;
}

interface RefusalAccount {
    email: string;
    platformRole?: string | null;
    /** An account of a platform group works across tenants, which a provider of one tenant never vouches for. */
    platformGroupId?: string | null;
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
    if (user.platformGroupId) return "platform-group";
    if (!emailOfDomain(user.email, provider.domain)) return "other-domain";
    if (provider.allowProvisioning === false && user.memberships && !user.memberships.some((membership) => membership.tenantId === provider.tenantId)) return "not-member";
    return null;
}

/** The provider a callback signs in through, of a tenant or of the platform, null for any other request. */
async function providerOf(context: SsoHookContext | null | undefined) {
    const providerId = ssoProviderIdOf(context);
    if (!providerId) return null;
    return prisma.ssoProvider.findUnique({
        where: { providerId },
        select: { providerId: true, name: true, tenantId: true, domain: true, allowProvisioning: true, defaultGroupId: true },
    });
}

/** The provider of a tenant a callback signs in through, null for any other request. */
async function tenantProviderOf(context: SsoHookContext | null | undefined) {
    const provider = await providerOf(context);
    return provider?.tenantId ? { ...provider, tenantId: provider.tenantId } : null;
}

const accountOf = (userId: string) =>
    prisma.user.findUnique({ where: { id: userId }, select: { name: true, email: true, platformRole: true, platformGroupId: true, memberships: { select: { tenantId: true } } } });

/** Whether another tenant made the account: it works in tenants, none of them this one. */
const madeElsewhere = (user: { memberships: { tenantId: string }[] }, tenantId: string) =>
    user.memberships.length > 0 && !user.memberships.some((membership) => membership.tenantId === tenantId);

/** The account whose session the request carries, of someone who links a provider to their own account. */
async function signedInUserOf(context: SsoHookContext | null | undefined): Promise<string | null> {
    const cookie = context?.headers ? getSessionCookie(context.headers) : null;
    if (!cookie) return null;
    // The cookie holds the token and its signature, the session is found by the token.
    const token = decodeURIComponent(cookie).split(".")[0];
    const session = token ? await prisma.session.findUnique({ where: { token }, select: { userId: true, expiresAt: true } }) : null;
    return session && session.expiresAt.getTime() > Date.now() ? session.userId : null;
}

/**
 * Runs before better-auth links an account to a provider. False keeps a provider from linking an
 * account it may not sign in, and the session hook then sends the person back to the login page
 * with the reason, see `refuseSsoSession`. A new account is linked before it joins a tenant, so it
 * passes here and was checked when it was added.
 */
export async function allowTenantSsoLink(account: { userId: string }, context: SsoHookContext | null | undefined): Promise<boolean> {
    const provider = await providerOf(context);
    if (!provider) return true;
    const user = await accountOf(account.userId);
    if (!user) return true;
    if (provider.tenantId) return tenantSignInRefusal(provider, user) === null && !madeElsewhere(user, provider.tenantId);
    // The people of the platform and of the home tenant are the platform's own.
    if (user.platformRole || user.platformGroupId || !madeElsewhere(user, HOME_TENANT_ID)) return true;
    return (await signedInUserOf(context)) === account.userId;
}

/**
 * A sign-in through a provider of a tenant goes on only for an account it may sign in, also one
 * linked before the provider moved to the tenant, and never for an account another tenant made,
 * also one linked while it was a member here. An account of no tenant that links through it now
 * joins the tenant only after its session starts, see `joinSsoTenant`.
 */
export async function refuseTenantSsoSession(session: { userId: string }, context: SsoHookContext | null | undefined, redirect: (url: string) => unknown): Promise<void> {
    const provider = await tenantProviderOf(context);
    if (!provider) return;
    const user = await accountOf(session.userId);
    const refusal = user ? tenantSignInRefusal(provider, user) : "other-domain";
    if (refusal) throw redirect(refusal === "not-member" ? TENANT_NOT_MEMBER_URL : TENANT_REFUSED_URL);
    if (user && madeElsewhere(user, provider.tenantId)) throw redirect(TENANT_NOT_MEMBER_URL);
}

/**
 * Runs before every session better-auth starts. A callback of a provider starts one only for an
 * account linked to that provider. better-auth finds the account by the email and signs it in even
 * when the link hook refused the link, see `allowTenantSsoLink`, so a refused link ends here. Someone
 * new is linked before their session starts, like an account linked before.
 */
export async function refuseSsoSession(session: { userId: string }, context: SsoHookContext | null | undefined, redirect: (url: string) => unknown): Promise<void> {
    if (!isSsoCallback(context?.path)) return;
    const providerId = ssoProviderIdOf(context);
    // A callback that names no provider is refused before it runs, see refuseDisabledProvider.
    if (!providerId) throw redirect(DISABLED_PROVIDER_URL);
    // The reason of a provider of a tenant first, so the login page says why.
    await refuseTenantSsoSession(session, context, redirect);
    const linked = await prisma.account.findFirst({ where: { userId: session.userId, providerId }, select: { id: true } });
    if (!linked) throw redirect(NOT_LINKED_URL);
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
