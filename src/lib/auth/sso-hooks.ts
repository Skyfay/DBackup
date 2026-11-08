import { APIError } from "better-auth/api";
import { wrapError } from "@/lib/logging/errors";
import { logger } from "@/lib/logging/logger";
import { isSsoCallback, placeSsoUser, refuseClaimedSsoSignUp, refuseSsoSignUp, type SsoHookContext } from "./sso-guard";
import { recordSsoLink } from "./sso-link-audit";
import { allowTenantSsoLink, joinSsoTenant, NOT_LINKED_URL, refuseSsoSession, tenantRefusalUrl } from "./sso-tenant-guard";

const log = logger.child({ module: "Auth" });

/**
 * The database hooks of better-auth for a sign-in through a provider, which `index.ts` runs beside
 * its own. While better-auth handles the callback of a provider it adds someone new with the user
 * hooks and links them with the account hooks, or links an account it found by the email, and
 * then starts a session for that account, whether the link went through or not.
 */

/** The context better-auth hands a database hook, the one of the endpoint that runs. */
export type SsoDatabaseHookContext = (SsoHookContext & { request?: Request; redirect?: (url: string) => unknown }) | null | undefined;

/**
 * What the link hook met on a callback, by its request: the identity it let link, which the session
 * hook then asks for, or where the login page says why it refused the link.
 */
const callbackLinks = new WeakMap<Request, { accountId?: string; refusedUrl?: string }>();

/** Before a user is added: the provider decides whether it adds them, never the browser. */
export async function beforeSsoUser(user: { email?: string | null }, context: SsoDatabaseHookContext): Promise<void> {
    await refuseSsoSignUp(context, user);
    await refuseClaimedSsoSignUp(context, user);
}

/** After a user was added: someone a provider added starts in its group. */
export async function afterSsoUser(user: { id: string; name: string; email: string }, context: SsoDatabaseHookContext): Promise<void> {
    try {
        await placeSsoUser(user, context);
    } catch (error) {
        log.warn("Putting a new user of a sign-in provider into its group failed", { userId: user.id }, wrapError(error));
    }
}

/**
 * Before an account is linked to a provider: a provider links no account it may not sign in. On a
 * callback the refusal throws, since better-auth goes on after a link that returned nothing, marks
 * the email as verified, which `allowTenantSsoLink` reads, and starts a session. better-auth answers
 * a failed link with an error of its own, which `refusedSsoLinkRedirect` replaces with the reason.
 */
export async function beforeSsoLink(account: { userId: string; accountId?: string }, context: SsoDatabaseHookContext): Promise<false | undefined> {
    const callback = isSsoCallback(context?.path);
    const allowed = await allowTenantSsoLink(account, context);
    if (!callback) return allowed ? undefined : false;
    const refusedUrl = allowed ? undefined : ((await tenantRefusalUrl(account.userId, context)) ?? NOT_LINKED_URL);
    if (context?.request) callbackLinks.set(context.request, { accountId: account.accountId, refusedUrl });
    if (refusedUrl) throw new APIError("FORBIDDEN", { message: "account not linked" });
    return undefined;
}

/** After a callback whose link was refused: the login page says why, see `beforeSsoLink`. */
export function refusedSsoLinkRedirect(ctx: { request?: Request; redirect: (url: string) => unknown }): void {
    const refusedUrl = ctx.request ? callbackLinks.get(ctx.request)?.refusedUrl : undefined;
    if (refusedUrl) throw ctx.redirect(refusedUrl);
}

/**
 * After an account was linked: a link the signed-in owner made goes into the audit log, and an
 * account that signs in through a provider of a tenant for the first time joins it.
 */
export async function afterSsoLink(account: { userId: string }, context: SsoDatabaseHookContext): Promise<void> {
    try {
        await recordSsoLink(account, context);
    } catch (error) {
        log.warn("Writing a linked sign-in provider to the audit log failed", { userId: account.userId }, wrapError(error));
    }
    try {
        await joinSsoTenant(account, context);
    } catch (error) {
        log.warn("Adding an account to the tenant of its sign-in provider failed", { userId: account.userId }, wrapError(error));
    }
}

/** Before a session starts: a callback of a provider signs in only an account linked to it, which it may sign in. */
export async function beforeSsoSession(session: { userId: string }, context: SsoDatabaseHookContext): Promise<void> {
    const accountId = context?.request ? callbackLinks.get(context.request)?.accountId : undefined;
    await refuseSsoSession(session, context, (url) => context?.redirect?.(url) ?? new APIError("FORBIDDEN"), accountId);
}
