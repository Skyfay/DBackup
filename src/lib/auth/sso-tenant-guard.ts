import { getSessionCookie } from "better-auth/cookies";
import prisma from "@/lib/prisma";
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
 * account already and links the provider from their profile. An account of no tenant counts as one
 * of the home tenant, whose admins set its password, so only a provider of the platform or of the
 * home tenant links it.
 *
 * A provider of a customer's tenant signs in only an account that works in its tenant alone. The
 * customer runs the provider, so an account that also works in another tenant, or holds a platform
 * group or role, would let the customer's provider into the data of someone else. Such an account
 * signs in another way, and the invitation page warns before an account joins a second tenant. A
 * provider of the home tenant belongs to the platform's own people, who often work in the tenants of
 * customers too, so it keeps signing them in.
 *
 * Neither links an account by its email when the email was not set by an admin either
 * (`User.emailVerified` false): someone who changed their own email or signed up through an
 * invitation may have picked the address of a person who has not signed in through the provider
 * yet. Such an account links only from its own profile, while signed in to it.
 */

/** The login page says why when a provider of a tenant may not sign someone in. */
export const TENANT_REFUSED_URL = "/?error=sso_tenant_refused";

/** The login page says so when a provider of a tenant that adds nobody meets someone who is no member there. */
export const TENANT_NOT_MEMBER_URL = "/?error=sso_tenant_not_member";

/** The login page says so when a provider of a customer's tenant meets an account that works beyond its tenant. */
export const TENANT_SHARED_ACCOUNT_URL = "/?error=sso_tenant_shared_account";

/** The login page says so when a provider meets an account of its email that it is not linked to and may not link. */
export const NOT_LINKED_URL = "/?error=sso_account_not_linked";

export const JOINED_THROUGH_SSO = "Joined through single sign-on";

export type TenantRefusal = "platform-admin" | "platform-group" | "other-domain" | "other-tenant" | "not-member";

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
 * Whether an account works in the tenant of a customer's provider and in another tenant too, which
 * that provider never vouches for. An account of other tenants only is no member there, which
 * `madeElsewhere` and the membership of a provider that adds nobody answer with their own reason.
 */
export function worksBeyond(tenantId: string, memberships: { tenantId: string }[] | undefined): boolean {
    if (tenantId === HOME_TENANT_ID || !memberships?.some((membership) => membership.tenantId === tenantId)) return false;
    return memberships.some((membership) => membership.tenantId !== tenantId);
}

/**
 * Why a provider may not sign in an account, null when it may, which a provider of the platform
 * always may. A provider of a customer's tenant signs in only an account that works in its tenant
 * alone, and one that adds nobody only the members of its tenant.
 */
export function tenantSignInRefusal(provider: RefusalProvider, user: RefusalAccount): TenantRefusal | null {
    if (!provider.tenantId) return null;
    // Any role of the platform reaches beyond the tenant, the role of a platform admin is the one there is.
    if (user.platformRole) return "platform-admin";
    if (user.platformGroupId) return "platform-group";
    if (!emailOfDomain(user.email, provider.domain)) return "other-domain";
    if (worksBeyond(provider.tenantId, user.memberships)) return "other-tenant";
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
    prisma.user.findUnique({ where: { id: userId }, select: { name: true, email: true, emailVerified: true, platformRole: true, platformGroupId: true, memberships: { select: { tenantId: true } } } });

/**
 * Whether another tenant made the account: none of the tenants it works in is this one. An account
 * of no tenant counts as one of the home tenant, whose admins set its password, like `accountRefusal`
 * counts it, so a provider of another tenant never links it. Someone new a provider adds is a member
 * of its tenant before the link, see `placeSsoUser`.
 */
const madeElsewhere = (user: { memberships: { tenantId: string }[] }, tenantId: string) => {
    const tenants = user.memberships.length > 0 ? user.memberships.map((membership) => membership.tenantId) : [HOME_TENANT_ID];
    return !tenants.includes(tenantId);
};

/** The session the request carries, of someone who links a provider to their own account, with the tenant it works in. */
export async function signedInSessionOf(context: SsoHookContext | null | undefined): Promise<{ userId: string; activeTenantId: string | null } | null> {
    const cookie = context?.headers ? getSessionCookie(context.headers) : null;
    if (!cookie) return null;
    // The cookie holds the token and its signature, the session is found by the token.
    const token = decodeURIComponent(cookie).split(".")[0];
    const session = token ? await prisma.session.findUnique({ where: { token }, select: { userId: true, expiresAt: true, activeTenantId: true } }) : null;
    return session && session.expiresAt.getTime() > Date.now() ? { userId: session.userId, activeTenantId: session.activeTenantId ?? null } : null;
}

/** The account whose session the request carries, of someone who links a provider to their own account. */
async function signedInUserOf(context: SsoHookContext | null | undefined): Promise<string | null> {
    return (await signedInSessionOf(context))?.userId ?? null;
}

/**
 * Runs before better-auth links an account to a provider. False keeps a provider from linking an
 * account it may not sign in, and on a callback `beforeSsoLink` then ends the sign-in with the
 * reason. A new account joined the tenant of its provider when it was added, see `placeSsoUser`,
 * so it passes here and was checked then.
 */
export async function allowTenantSsoLink(account: { userId: string }, context: SsoHookContext | null | undefined): Promise<boolean> {
    const provider = await providerOf(context);
    if (!provider) return true;
    const user = await accountOf(account.userId);
    if (!user) return true;
    // An email the account chose itself vouches for nobody, only its owner links it, see above.
    if (user.emailVerified === false && (await signedInUserOf(context)) !== account.userId) return false;
    if (provider.tenantId) return tenantSignInRefusal(provider, user) === null && !madeElsewhere(user, provider.tenantId);
    // The people of the platform and of the home tenant are the platform's own.
    if (user.platformRole || user.platformGroupId || !madeElsewhere(user, HOME_TENANT_ID)) return true;
    return (await signedInUserOf(context)) === account.userId;
}

/** Where the login page says why, for each refusal of a provider of a tenant. */
const REFUSAL_URLS: Record<TenantRefusal, string> = {
    "platform-admin": TENANT_SHARED_ACCOUNT_URL,
    "platform-group": TENANT_SHARED_ACCOUNT_URL,
    "other-tenant": TENANT_SHARED_ACCOUNT_URL,
    "other-domain": TENANT_REFUSED_URL,
    "not-member": TENANT_NOT_MEMBER_URL,
};

/**
 * A sign-in through a provider of a tenant goes on only for an account it may sign in, also one
 * linked before the provider moved to the tenant, and never for an account another tenant made,
 * also one linked while it was a member here. An account of no tenant counts as one of the home
 * tenant there, see `madeElsewhere`.
 */
export async function refuseTenantSsoSession(session: { userId: string }, context: SsoHookContext | null | undefined, redirect: (url: string) => unknown): Promise<void> {
    const url = await tenantRefusalUrl(session.userId, context);
    if (url) throw redirect(url);
}

/** Where the login page says why a provider of a tenant may not sign in an account, null when it may, see `refuseTenantSsoSession`. */
export async function tenantRefusalUrl(userId: string, context: SsoHookContext | null | undefined): Promise<string | null> {
    const provider = await tenantProviderOf(context);
    if (!provider) return null;
    const user = await accountOf(userId);
    const refusal = user ? tenantSignInRefusal(provider, user) : "other-domain";
    if (refusal) return REFUSAL_URLS[refusal];
    return user && madeElsewhere(user, provider.tenantId) ? TENANT_NOT_MEMBER_URL : null;
}

/**
 * Runs before every session better-auth starts. A callback of a provider starts one only for an
 * account linked to that provider, and to the identity of the callback where the link hook saw it
 * (`accountId`). A refused link ends the callback before, see `beforeSsoLink`, so this is the second
 * line. Someone new is linked before their session starts, like an account linked before.
 */
export async function refuseSsoSession(session: { userId: string }, context: SsoHookContext | null | undefined, redirect: (url: string) => unknown, accountId?: string): Promise<void> {
    if (!isSsoCallback(context?.path)) return;
    const providerId = ssoProviderIdOf(context);
    // A callback that names no provider is refused before it runs, see refuseDisabledProvider.
    if (!providerId) throw redirect(DISABLED_PROVIDER_URL);
    // The reason of a provider of a tenant first, so the login page says why.
    await refuseTenantSsoSession(session, context, redirect);
    const linked = await prisma.account.findFirst({ where: { userId: session.userId, providerId, ...(accountId ? { accountId } : {}) }, select: { id: true } });
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

/**
 * The providers of customers' tenants that sign an account in today and refuse it once it joins
 * another tenant, by name, for the warning of the invitation page. Nothing ends for a tenant the
 * account works in already, nor for an account that works in several tenants by now.
 */
export async function providersEndedByJoining(userId: string, tenantId: string): Promise<string[]> {
    const user = await accountOf(userId);
    if (!user || user.memberships.some((membership) => membership.tenantId === tenantId)) return [];
    const tenants = user.memberships.map((membership) => membership.tenantId).filter((id) => id !== HOME_TENANT_ID);
    if (tenants.length === 0) return [];
    const providers = await prisma.ssoProvider.findMany({
        where: { enabled: true, tenantId: { in: tenants } },
        orderBy: { name: "asc" },
        select: { name: true, tenantId: true, domain: true, allowProvisioning: true },
    });
    const joined = { ...user, memberships: [...user.memberships, { tenantId }] };
    return providers.filter((provider) => tenantSignInRefusal(provider, user) === null && tenantSignInRefusal(provider, joined) !== null).map((provider) => provider.name);
}
