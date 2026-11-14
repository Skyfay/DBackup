import { betterAuth } from "better-auth";
import { APIError, createAuthMiddleware, getSessionFromCtx } from "better-auth/api";
import { PROFILE_CHANGE_REFUSED, SERVER_ONLY_ENDPOINT_REFUSED, TRUSTED_DEVICE_REFUSED, asksTrustedDevice, profileChangeRefused, refusedFromBrowser } from "@/lib/auth/profile-guard";
import { refuseWeakPassword } from "@/lib/auth/password-guard";
import { claimFirstSignUp, refuseLateSignUp } from "@/lib/auth/sign-up-guard";
import { keepPasskeyFactor } from "@/lib/auth/passkey-factor-guard";
import { refusePasskeyFirstFactor } from "@/lib/auth/passkey-login-guard";
import { keptSessionAge, refuseWithoutReauth } from "@/lib/auth/reauth-guard";
import { prismaAdapter } from "better-auth/adapters/prisma";
import prisma from "@/lib/prisma";
import { twoFactor } from "better-auth/plugins";
import { passkey } from "@better-auth/passkey";
import { sso } from "@better-auth/sso";
import { shouldBlockBrowserEmailAuth } from "@/lib/auth/env-flags";
import { recordSignIn, recordSignOut } from "@/lib/auth/sign-in-audit";
import { noteSecurityChange, recordSecurityChange } from "@/lib/auth/security-audit";
import { isSsoManagementRequest, refuseDisabledProvider } from "@/lib/auth/sso-guard";
import { afterSsoLink, afterSsoUser, beforeSsoLink, beforeSsoSession, beforeSsoUser, refusedSsoLinkRedirect } from "@/lib/auth/sso-hooks";
import { logger } from "@/lib/logging/logger";
import { wrapError } from "@/lib/logging/errors";
import { DEFAULT_SESSION_DURATION, SESSION_OPTIONS, sessionDurationOf, sessionEndsAt } from "@/lib/auth/session-lifetime";
import { CLIENT_ADDRESS_HEADER } from "@/lib/core/client-address";
import { foreignSsoTarget, trustedOriginsFor } from "@/lib/auth/trusted-origins";
import { accountLinkingOptions } from "@/lib/auth/account-linking";
import { secureCookiesFor } from "@/lib/auth/secure-cookies";

const log = logger.child({ module: "Auth" });

/** The length of a new session, from Settings > Sign-in, or seven days. */
async function getSessionDuration(): Promise<number> {
    try {
        const setting = await prisma.systemSetting.findUnique({
            where: { key: "auth.sessionDuration" },
        });
        return sessionDurationOf(setting?.value);
    } catch {
        // DB might not be ready during initial setup
        return DEFAULT_SESSION_DURATION;
    }
}

const originalFetch = global.fetch;
global.fetch = async (input, init) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input instanceof Request ? input.url : "";

    // Only patch external requests (http/https) to avoid messing with internal calls
    // And specifically target potential OIDC endpoints if possible, or just apply conservatively
    if (url.startsWith("http")) {
        const headers = new Headers(init?.headers || {});
        if (!headers.has("User-Agent")) {
            // Mimic a real browser to bypass Cloudflare/WAF checks on OIDC endpoints
            headers.set("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36");

            init = {
                ...init,
                headers
            };
        }
    }

    return originalFetch(input, init);
};

/**
 * Cache for trusted SSO provider IDs.
 * This is loaded dynamically and used for account linking.
 *
 * IMPORTANT: We use a single array instance and MUTATE it (not reassign)
 * because better-auth stores the reference at config time.
 */
const trustedProvidersCache: string[] = [];

/**
 * Load trusted provider IDs from database into cache.
 * Called on every auth request to ensure newly added providers work immediately.
 *
 * NOTE: We use splice + push to MUTATE the array, not reassign it!
 * Reassigning would create a new array reference, but better-auth
 * holds a reference to the original array from config initialization.
 */
export async function loadTrustedProviders(): Promise<void> {
    try {
        const providers = await prisma.ssoProvider.findMany({
            where: { enabled: true },
            select: { providerId: true }
        });
        // Clear and repopulate the SAME array (mutate, don't reassign!)
        trustedProvidersCache.splice(0, trustedProvidersCache.length);
        trustedProvidersCache.push(...providers.map(p => p.providerId));
        // Note: We use debug level here as this runs on every auth request
    } catch (_error) {
        // Don't reassign, just clear - SSO will still work but without dynamic providers
        trustedProvidersCache.splice(0, trustedProvidersCache.length);
    }
}

/**
 * Get cached trusted providers for account linking.
 * Returns the SAME array instance that's used in config.
 */
function getTrustedProviders(): string[] {
    return trustedProvidersCache;
}

/**
 * Rejects browser-initiated email/password authentication when DISABLE_EMAIL_LOGIN
 * is set. Hiding the form is not enough - the endpoints are public.
 *
 * This deliberately does NOT use `emailAndPassword.enabled: false`. That flag is
 * checked inside the route handlers rather than at registration, and the sign-up
 * handler guards on `!enabled || disableSignUp`, so it would also break
 * `auth.api.signUpEmail()` behind the admin Users page.
 *
 * The decision itself lives in `shouldBlockBrowserEmailAuth` so it can be tested
 * without standing up better-auth. It also refuses a sign-up from the browser once the first
 * account exists (`sign-up-guard.ts`) and a sign-in provider that is off, keeps the own profile
 * to what the group allows (`profile-guard.ts`), refuses a new password that breaks the rules of
 * Settings > Passwords (`password-guard.ts`) and writes a sign-out to the audit log.
 */
const beforeAuth = createAuthMiddleware(async (ctx) => {
    if (shouldBlockBrowserEmailAuth(ctx.path, Boolean(ctx.request))) {
        throw new APIError("FORBIDDEN", {
            code: "EMAIL_LOGIN_DISABLED",
            message: "Password sign-in is disabled. Use single sign-on or a passkey.",
        });
    }
    // The browser signs up the first account only. Later ones come from an admin or a provider.
    await refuseLateSignUp(ctx.path, Boolean(ctx.request));
    // The issuers are trusted on this path for the endpoints of a provider, never as DBackup itself.
    if (ctx.request && (await foreignSsoTarget(ctx.path, ctx.body, ctx.request.headers))) {
        throw new APIError("FORBIDDEN", { code: "INVALID_ORIGIN", message: "Invalid origin" });
    }
    // Providers are managed on the pages of DBackup, never through the endpoints of the SSO plugin.
    if (isSsoManagementRequest(ctx.path, Boolean(ctx.request))) throw new APIError("NOT_FOUND");
    // A provider that is off signs nobody in, not only on the login page.
    await refuseDisabledProvider(ctx, (url) => ctx.redirect(url));
    // A passkey that is off as a way in still works as the second factor, see passkey-login-guard.ts.
    await refusePasskeyFirstFactor(ctx);
    // What DBackup changes through its own actions, with their checks and audit entries, never
    // straight from the browser.
    if (refusedFromBrowser(ctx.path, Boolean(ctx.request))) {
        throw new APIError("FORBIDDEN", { code: "SERVER_ONLY_ENDPOINT", message: SERVER_ONLY_ENDPOINT_REFUSED });
    }
    // A trusted device would skip the second factor and its sign-in entry later on.
    if (asksTrustedDevice(ctx.path, ctx.body)) {
        throw new APIError("FORBIDDEN", { code: "TRUSTED_DEVICE", message: TRUSTED_DEVICE_REFUSED });
    }
    // The own profile follows the group, also where the browser calls better-auth itself.
    if (await profileChangeRefused(ctx.path, Boolean(ctx.request), () => getSessionFromCtx(ctx))) {
        throw new APIError("FORBIDDEN", { code: "PROFILE_PERMISSION", message: PROFILE_CHANGE_REFUSED });
    }
    // The password of the second factor goes through the lockout, and a passkey needs a recent sign-in.
    await refuseWithoutReauth(ctx, () => getSessionFromCtx(ctx));
    // What a change of the second factor or a passkey replaces, for its audit entry after it.
    try {
        await noteSecurityChange(ctx, () => getSessionFromCtx(ctx));
    } catch (error) {
        log.warn("Reading a change of the second factor or a passkey for the audit log failed", {}, wrapError(error));
    }
    // Every new password follows the rules under Settings > Passwords.
    await refuseWeakPassword(ctx, () => getSessionFromCtx(ctx));
    // A sign-out is written before it runs, while the session to end is still there.
    if (ctx.path === "/sign-out") {
        try {
            await recordSignOut(ctx, await getSessionFromCtx(ctx));
        } catch (error) {
            log.warn("Writing a sign-out to the audit log failed", {}, wrapError(error));
        }
    }
});

/**
 * Sign-ins and failed sign-ins in the audit log, whichever way someone signed in, and the changes
 * of the own second factor and passkeys the browser makes through better-auth.
 */
const afterAuth = createAuthMiddleware(async (ctx) => {
    try {
        await recordSignIn(ctx);
    } catch (error) {
        log.warn("Writing a sign-in to the audit log failed", {}, wrapError(error));
    }
    try {
        await recordSecurityChange(ctx);
    } catch (error) {
        log.warn("Writing a change of the second factor or a passkey to the audit log failed", {}, wrapError(error));
    }
    // A callback whose link a provider may not make ends on the login page with the reason.
    refusedSsoLinkRedirect(ctx);
});

export const auth = betterAuth({
    logging: {
        level: "debug"
    },
    baseURL: process.env.BETTER_AUTH_URL || "http://localhost:3000",
    // The address of a session and of the rate limit of better-auth comes from the custom server,
    // which reads X-Forwarded-For of a trusted proxy only. Left to itself better-auth would take
    // a single X-Forwarded-For value from anyone.
    advanced: {
        ipAddress: { ipAddressHeaders: [CLIENT_ADDRESS_HEADER] },
        // Secure cookies whenever the browser reaches DBackup over HTTPS, also where BETTER_AUTH_URL
        // is unset or http:// behind a proxy, see secure-cookies.ts.
        useSecureCookies: secureCookiesFor(process.env),
    },
    trustedOrigins: async (request) => {
        // Refresh trusted providers on every auth request
        // This ensures newly added SSO providers work immediately without server restart
        // We mutate the same array reference, so better-auth sees the changes
        await loadTrustedProviders();
        // The address of DBackup, and the issuers of the providers only where the SSO plugin reads
        // their endpoints, see trusted-origins.ts.
        return trustedOriginsFor(request);
    },
    database: prismaAdapter(prisma, {
        provider: "sqlite",
    }),
    account: {
        // Linking a provider to an existing account, see account-linking.ts.
        accountLinking: accountLinkingOptions(getTrustedProviders()),
    },
    user: {
        additionalFields: {
            timezone: {
                type: "string",
                required: false,
                defaultValue: ""
            },
            dateFormat: {
                type: "string",
                required: false,
                defaultValue: "P"
            },
            timeFormat: {
                type: "string",
                required: false,
                defaultValue: "p"
            },
            passkeyTwoFactor: {
                type: "boolean",
                required: false,
                defaultValue: false
            }
        }
    },
    emailAndPassword: {
        enabled: true,
        autoSignIn: true
    },
    // A session ends after the length of Settings > Sign-in, set when it is created below, and
    // better-auth never extends it. See session-lifetime.ts.
    session: {
        ...SESSION_OPTIONS,
        // The tenant the session works in. Only the server sets it, see setActiveTenant.
        additionalFields: {
            activeTenantId: { type: "string", required: false, input: false },
        },
    },
    hooks: {
        before: beforeAuth,
        after: afterAuth,
    },
    databaseHooks: {
        user: {
            create: {
                before: async (user, context) => {
                    // Only one sign-up from the browser makes the first account, also two at once.
                    await claimFirstSignUp(context);
                    // The browser asks better-auth to add someone new, the provider decides.
                    await beforeSsoUser(user, context);
                    // DBackup sends no verification emails. The flag says whether an admin or a
                    // provider set the email, which every new account starts with, so a sign-in
                    // provider may link the account by its email (`allowTenantSsoLink`). An email
                    // someone picked themselves, through the own profile or an invitation, sets it
                    // false afterwards, and such an account links only from its own profile.
                    return {
                        data: {
                            ...user,
                            emailVerified: true,
                        },
                    };
                },
                // Someone a provider added starts in its group.
                after: afterSsoUser,
            },
            update: {
                // Turning off the authenticator app leaves a passkey as the second factor on.
                before: keepPasskeyFactor,
            },
        },
        account: {
            create: {
                // A provider links no account it may not sign in, see sso-tenant-guard.ts.
                before: beforeSsoLink,
                after: afterSsoLink,
            },
        },
        session: {
            create: {
                before: async (session, context) => {
                    // A provider signs in only an account linked to it that it may sign in, whenever it linked.
                    await beforeSsoSession(session, context);
                    // The end of every session, from the length the owner set.
                    const expiresAt = sessionEndsAt(await getSessionDuration());
                    return {
                        data: {
                            ...session,
                            expiresAt,
                            // A session that a code of the second factor replaces keeps its age, see reauth-guard.ts.
                            ...keptSessionAge(context),
                        },
                    };
                },
                after: async (session) => {
                    // Fire-and-forget system notification for user login
                    // Dynamic import to avoid circular dependencies
                    Promise.all([
                        import("@/services/notifications/system-notification-service"),
                        import("@/lib/notifications"),
                        prisma.user.findUnique({
                            where: { id: session.userId },
                            select: { name: true, email: true },
                        }),
                    ])
                        .then(([{ notify }, { NOTIFICATION_EVENTS }, user]) => {
                            if (!user) return;
                            return notify({
                                eventType: NOTIFICATION_EVENTS.USER_LOGIN,
                                data: {
                                    userName: user.name,
                                    email: user.email,
                                    ipAddress: session.ipAddress ?? undefined,
                                    userAgent: session.userAgent ?? undefined,
                                    timestamp: new Date().toISOString(),
                                },
                            });
                        })
                        .catch(() => {});
                },
            },
        },
    },
    plugins: [
        twoFactor(),
        passkey(),
        sso({
            // Trust email verification status from IdP
            // This allows automatic user creation without domain matching
            trustEmailVerified: true,
            // Disable automatic user creation by default. The login page asks for it with
            // requestSignUp when a provider adds new people, and refuseSsoSignUp checks the
            // provider itself, since the browser can ask for anything.
            disableImplicitSignUp: true,
        })
    ]
});
