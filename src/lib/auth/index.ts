import { betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
import prisma from "@/lib/prisma";
import { twoFactor } from "better-auth/plugins";
import { passkey } from "@better-auth/passkey";
import { sso } from "@better-auth/sso";

// Default session duration: 7 days (in seconds)
const DEFAULT_SESSION_DURATION = 3600 * 24 * 7;

/**
 * Load session duration from SystemSetting table.
 * Returns the configured duration in seconds, or the default (7 days).
 */
async function getSessionDuration(): Promise<number> {
    try {
        const setting = await prisma.systemSetting.findUnique({
            where: { key: "auth.sessionDuration" },
        });
        if (setting) {
            const seconds = parseInt(setting.value, 10);
            if (!isNaN(seconds) && seconds > 0) return seconds;
        }
    } catch {
        // DB might not be ready during initial setup
    }
    return DEFAULT_SESSION_DURATION;
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
 * Dynamically fetch trusted origins from SSO providers in the database.
 * This allows users to configure SSO providers via UI without hardcoding origins.
 */
async function getTrustedOriginsFromDb(): Promise<string[]> {
    try {
        const providers = await prisma.ssoProvider.findMany({
            where: { enabled: true },
            select: { issuer: true }
        });
        return providers
            .map(p => p.issuer)
            .filter((issuer): issuer is string => !!issuer);
    } catch {
        // During initial setup, DB might not be ready
        return [];
    }
}

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

export const auth = betterAuth({
    logging: {
        level: "debug"
    },
    baseURL: process.env.BETTER_AUTH_URL || "http://localhost:3000",
    trustedOrigins: async (_request) => {
        // Refresh trusted providers on every auth request
        // This ensures newly added SSO providers work immediately without server restart
        // We mutate the same array reference, so better-auth sees the changes
        await loadTrustedProviders();

        // Base trusted origins from BETTER_AUTH_URL
        const primaryUrl = process.env.BETTER_AUTH_URL || "http://localhost:3000";

        // Additional trusted origins (comma-separated) for multiple access URLs
        // Example: TRUSTED_ORIGINS="https://192.168.1.1:3000,https://backup.example.com"
        const additionalOrigins = process.env.TRUSTED_ORIGINS
            ? process.env.TRUSTED_ORIGINS.split(",").map(url => url.trim()).filter(Boolean)
            : [];

        const baseOrigins = [primaryUrl, ...additionalOrigins];

        // During SSO callback, we need to trust the IdP origins
        // Fetch them dynamically from the database
        const ssoOrigins = await getTrustedOriginsFromDb();

        return [...baseOrigins, ...ssoOrigins];
    },
    database: prismaAdapter(prisma, {
        provider: "sqlite",
    }),
    account: {
        // Enable automatic account linking for SSO providers
        // All enabled SSO providers are marked as trusted for seamless linking
        accountLinking: {
            enabled: true,
            // Allow linking accounts even if email domains don't match
            allowDifferentEmails: true,
            // Trust all enabled SSO providers - loaded from DB at startup
            // This allows linking even if local user has emailVerified=false
            trustedProviders: getTrustedProviders(),
        }
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
    session: {
        // Default expiry; dynamically overridden per-session via databaseHooks
        expiresIn: DEFAULT_SESSION_DURATION,
        updateAge: 60 * 60 * 24, // Refresh session every 24h
    },
    databaseHooks: {
        user: {
            create: {
                before: async (user) => {
                    // Email verification is not used as a feature anywhere in DBackup
                    // (no verification emails are sent, no login gating on this flag).
                    // Its only remaining effect is better-auth's SSO account-linking check
                    // (requireLocalEmailVerified, defaults to true), which otherwise blocks
                    // linking a dashboard-created user to a matching SSO identity.
                    return {
                        data: {
                            ...user,
                            emailVerified: true,
                        },
                    };
                },
            },
        },
        session: {
            create: {
                before: async (session) => {
                    // Dynamically set session expiry based on admin setting
                    const duration = await getSessionDuration();
                    const expiresAt = new Date(Date.now() + duration * 1000);
                    return {
                        data: {
                            ...session,
                            expiresAt,
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
            // Disable automatic user creation by default.
            // Each provider can enable it via allowProvisioning flag,
            // which is passed as requestSignUp from the client.
            disableImplicitSignUp: true,
        })
    ]
});
