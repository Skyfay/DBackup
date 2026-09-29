import { APIError } from "better-auth/api";
import prisma from "@/lib/prisma";
import { AUDIT_ACTIONS, AUDIT_RESOURCES } from "@/lib/core/audit-types";
import { auditService } from "@/services/audit-service";

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

/**
 * Runs before better-auth adds a user. Someone new through a provider is added only while the
 * provider is on and adds new people, whatever the browser asked for. The refusal reads like the
 * one of better-auth, so the login page shows its message.
 */
export async function refuseSsoSignUp(context: SsoHookContext | null | undefined): Promise<void> {
    const providerId = ssoProviderIdOf(context);
    if (!providerId) return;
    const provider = await prisma.ssoProvider.findUnique({ where: { providerId }, select: { enabled: true, allowProvisioning: true } });
    if (provider?.enabled && provider.allowProvisioning) return;
    throw new APIError("FORBIDDEN", { message: "signup disabled" });
}

/**
 * Runs after better-auth added a user. Someone a provider added starts in the group of the
 * provider, and the log says they signed up through it. A group deleted in between leaves them
 * without one, like a provider without a group.
 */
export async function placeSsoUser(user: { id: string; name: string; email: string }, context: SsoHookContext | null | undefined): Promise<void> {
    const providerId = ssoProviderIdOf(context);
    if (!providerId) return;
    const provider = await prisma.ssoProvider.findUnique({ where: { providerId }, select: { name: true, defaultGroupId: true } });
    if (!provider) return;
    const group = provider.defaultGroupId
        ? await prisma.group.findUnique({ where: { id: provider.defaultGroupId }, select: { id: true, name: true } })
        : null;
    if (group) await prisma.user.update({ where: { id: user.id }, data: { groupId: group.id } });
    await auditService.log(
        user.id,
        AUDIT_ACTIONS.CREATE,
        AUDIT_RESOURCES.USER,
        { name: user.name, email: user.email, via: "sso", provider: provider.name, providerId, ...(group ? { group: group.name } : {}) },
        user.id
    );
}
