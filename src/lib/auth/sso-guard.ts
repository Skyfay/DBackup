import { APIError } from "better-auth/api";
import prisma from "@/lib/prisma";
import { AUDIT_ACTIONS, AUDIT_RESOURCES } from "@/lib/core/audit-types";
import { auditService } from "@/services/audit-service";
import { emailOfDomain } from "@/lib/auth/sso-domain";
import { runAsTenant } from "@/lib/tenant/context";
import { HOME_TENANT_ID } from "@/lib/tenant/home";

/**
 * Single sign-on as the saved providers decide it, not the browser. better-auth signs anyone in
 * through a provider it finds and adds someone new whenever the browser asks for it, so these
 * hooks refuse a provider that is off, refuse new people for a provider that does not add them,
 * and put the people a provider adds into its group.
 */

/** The parts of the context of a better-auth hook these checks read. */
export interface SsoHookContext {
    path?: string;
    body?: unknown;
    params?: Record<string, string | undefined>;
}

/** The login page sends people here when a provider is off, with a message it knows. */
export const DISABLED_PROVIDER_URL = "/?error=sso_access_denied";

/** The provider an endpoint signs in through, when it has one in its path, like the callback. */
export function ssoProviderIdOf(ctx: SsoHookContext | null | undefined): string | null {
    const path = ctx?.path;
    if (!path || !(path.startsWith("/sso/callback/") || path.startsWith("/sso/saml2/"))) return null;
    return ctx.params?.providerId || null;
}

/** The provider the start of a sign-in names, before it leaves for the provider. */
function requestedProviderId(ctx: SsoHookContext): string | null {
    if (ctx.path !== "/sign-in/sso" || !ctx.body || typeof ctx.body !== "object") return null;
    const providerId = (ctx.body as Record<string, unknown>).providerId;
    return typeof providerId === "string" && providerId ? providerId : null;
}

/**
 * Runs before every endpoint of better-auth. A provider that is off refuses to start a sign-in,
 * and its callback sends people back to the login page, so switching it off works for a sign-in
 * that already left for it too.
 */
export async function refuseDisabledProvider(ctx: SsoHookContext, redirect: (url: string) => unknown): Promise<void> {
    const starting = requestedProviderId(ctx);
    const providerId = starting ?? ssoProviderIdOf(ctx);
    if (!providerId) return;
    const provider = await prisma.ssoProvider.findUnique({ where: { providerId }, select: { enabled: true } });
    // A provider that does not exist is refused by better-auth itself.
    if (!provider || provider.enabled) return;
    if (starting) throw new APIError("FORBIDDEN", { code: "SSO_PROVIDER_DISABLED", message: "This sign-in provider is switched off." });
    throw redirect(DISABLED_PROVIDER_URL);
}

/** What better-auth hands on when a provider of a tenant may not add someone, which the login page turns into its message. */
export const TENANT_SIGN_UP_REFUSED = "tenant sign-in refused";

/**
 * Runs before better-auth adds a user. Someone new through a provider is added only while the
 * provider is on and adds new people, whatever the browser asked for. A provider of a tenant adds
 * only an email of its own domain, since its tenant runs the identity provider and vouches for
 * nothing else. The refusal reads like the one of better-auth, so the login page shows its message.
 */
export async function refuseSsoSignUp(context: SsoHookContext | null | undefined, user?: { email?: string | null }): Promise<void> {
    const providerId = ssoProviderIdOf(context);
    if (!providerId) return;
    const provider = await prisma.ssoProvider.findUnique({ where: { providerId }, select: { enabled: true, allowProvisioning: true, tenantId: true, domain: true } });
    if (!provider?.enabled || !provider.allowProvisioning) throw new APIError("FORBIDDEN", { message: "signup disabled" });
    if (provider.tenantId && !emailOfDomain(user?.email, provider.domain)) throw new APIError("FORBIDDEN", { message: TENANT_SIGN_UP_REFUSED });
}

/**
 * Runs after better-auth added a user. Someone a provider added starts in the group of the
 * provider in its tenant, the home tenant for a provider of the platform, and the log of that
 * tenant says they signed up through it. A group deleted in between leaves them without one, like
 * a provider without a group.
 */
export async function placeSsoUser(user: { id: string; name: string; email: string }, context: SsoHookContext | null | undefined): Promise<void> {
    const providerId = ssoProviderIdOf(context);
    if (!providerId) return;
    const provider = await prisma.ssoProvider.findUnique({ where: { providerId }, select: { name: true, defaultGroupId: true, tenantId: true } });
    if (!provider) return;
    const tenantId = provider.tenantId ?? HOME_TENANT_ID;
    // A group of the provider's tenant only, looked up there since nobody is signed in yet.
    const group = provider.defaultGroupId
        ? await runAsTenant(tenantId, () => prisma.group.findUnique({ where: { id: provider.defaultGroupId! }, select: { id: true, name: true } }))
        : null;
    if (group) await prisma.tenantMembership.create({ data: { userId: user.id, tenantId, groupId: group.id } });
    await auditService.log(
        user.id,
        AUDIT_ACTIONS.CREATE,
        AUDIT_RESOURCES.USER,
        { name: user.name, email: user.email, via: "sso", provider: provider.name, providerId, ...(group ? { group: group.name } : {}) },
        user.id,
        { tenantId }
    );
}
