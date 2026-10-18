import { APIError } from "better-auth/api";
import { wrapError } from "@/lib/logging/errors";
import { logger } from "@/lib/logging/logger";
import { placeSsoUser, refuseClaimedSsoSignUp, refuseSsoSignUp, type SsoHookContext } from "./sso-guard";
import { allowTenantSsoLink, joinSsoTenant, refuseSsoSession } from "./sso-tenant-guard";

const log = logger.child({ module: "Auth" });

/**
 * The database hooks of better-auth for a sign-in through a provider, which `index.ts` runs beside
 * its own. While better-auth handles the callback of a provider it adds someone new with the user
 * hooks and links them with the account hooks, or links an account it found by the email, and
 * then starts a session for that account, whether the link went through or not.
 */

/** The context better-auth hands a database hook, the one of the endpoint that runs. */
export type SsoDatabaseHookContext = (SsoHookContext & { redirect?: (url: string) => unknown }) | null | undefined;

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

/** Before an account is linked to a provider: false keeps a provider from linking an account it may not sign in. */
export async function beforeSsoLink(account: { userId: string }, context: SsoDatabaseHookContext): Promise<false | undefined> {
    return (await allowTenantSsoLink(account, context)) ? undefined : false;
}

/** After an account was linked: an account that signs in through a provider of a tenant for the first time joins it. */
export async function afterSsoLink(account: { userId: string }, context: SsoDatabaseHookContext): Promise<void> {
    try {
        await joinSsoTenant(account, context);
    } catch (error) {
        log.warn("Adding an account to the tenant of its sign-in provider failed", { userId: account.userId }, wrapError(error));
    }
}

/** Before a session starts: a callback of a provider signs in only an account linked to it, which it may sign in. */
export async function beforeSsoSession(session: { userId: string }, context: SsoDatabaseHookContext): Promise<void> {
    await refuseSsoSession(session, context, (url) => context?.redirect?.(url) ?? new APIError("FORBIDDEN"));
}
