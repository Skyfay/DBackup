import { betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
import prisma from "./prisma";
import { twoFactor } from "better-auth/plugins";
import { passkey } from "@better-auth/passkey";
import { sso } from "@better-auth/sso";
import { PERMISSIONS } from "@/lib/permissions";

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
 * This is loaded at server startup and used for account linking.
 * Adding new providers requires a server restart to be recognized as trusted.
 *
 * IMPORTANT: We use a single array instance and MUTATE it (not reassign)
 * because better-auth stores the reference at config time.
 */
const trustedProvidersCache: string[] = [];

/**
 * Load trusted provider IDs from database into cache.
 * Called at module load time and can be refreshed if needed.
 *
 * NOTE: We use splice + push to MUTATE the array, not reassign it!
 * Reassigning would create a new array reference, but better-auth
 * holds a reference to the original array from config initialization.
 */
async function loadTrustedProviders(): Promise<void> {
    try {
        const providers = await prisma.ssoProvider.findMany({
            where: { enabled: true },
            select: { providerId: true }
        });
        // Clear and repopulate the SAME array (mutate, don't reassign!)
        trustedProvidersCache.splice(0, trustedProvidersCache.length);
        trustedProvidersCache.push(...providers.map(p => p.providerId));
        console.log("[Auth] Loaded trusted SSO providers:", trustedProvidersCache);
    } catch (error) {
        console.warn("[Auth] Could not load trusted providers:", error);
        // Don't reassign, just clear
        trustedProvidersCache.splice(0, trustedProvidersCache.length);
    }
}

// Initialize cache on module load (async IIFE)
loadTrustedProviders();

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
    baseURL: process.env.NEXT_PUBLIC_APP_URL || process.env.BETTER_AUTH_URL || "http://localhost:3000",
    trustedOrigins: async (request) => {
        // Base trusted origins
        const baseOrigins = [
            process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000",
        ];

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
                defaultValue: "UTC"
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
    plugins: [
        twoFactor(),
        passkey(),
        sso({
            // Trust email verification status from IdP
            // This allows automatic user creation without domain matching
            trustEmailVerified: true,
        })
    ]
});
