import { z } from "zod";
import { logger } from "@/lib/logging/logger";

const log = logger.child({ module: "EnvValidation" });

/**
 * Schema for required and optional environment variables.
 * Validates at application startup to catch misconfigurations early.
 */
const envSchema = z.object({
    // Required
    BETTER_AUTH_SECRET: z
        .string({ error: "BETTER_AUTH_SECRET is required. Generate with: openssl rand -base64 32" })
        .min(16, "BETTER_AUTH_SECRET must be at least 16 characters"),

    // Hex only, since a key with any other character opens no cipher and fails at the first secret.
    ENCRYPTION_KEY: z
        .string({ error: "ENCRYPTION_KEY is required. Generate with: openssl rand -hex 32" })
        .length(64, "ENCRYPTION_KEY must be a 64-character hex string (32 bytes)")
        .regex(/^[0-9a-fA-F]*$/, "ENCRYPTION_KEY must hold hex characters only (0-9, a-f). Generate with: openssl rand -hex 32"),

    // Optional with defaults
    DATABASE_URL: z
        .string()
        .default("file:./prisma/dev.db"),

    SQLITE_WAL_MODE: z
        .enum(["true", "false"])
        .default("true"),

    BETTER_AUTH_URL: z
        .string()
        .url("BETTER_AUTH_URL must be a valid URL (e.g. http://localhost:3000)")
        .optional(),

    TRUSTED_ORIGINS: z
        .string()
        .optional(),

    LOG_LEVEL: z
        .enum(["debug", "info", "warn", "error"])
        .default("info"),

    TZ: z
        .string()
        .default("UTC"),

    PORT: z
        .string()
        .regex(/^\d+$/, "PORT must be a number")
        .default("3000"),

    TMPDIR: z
        .string()
        .optional(),

    DISABLE_HTTPS: z
        .enum(["true", "false"])
        .default("false"),

    CERTS_DIR: z
        .string()
        .default("/data/certs"),

    DATA_DIR: z
        .string()
        .default("/data"),

    // Blocks browser-facing email/password sign-in and sign-up. Server-side
    // auth.api calls (admin user creation, password reset) stay available.
    DISABLE_EMAIL_LOGIN: z
        .enum(["true", "false"])
        .default("false"),

    // providerId of the SSO provider the login page redirects to automatically.
    // Only the format is checked here - whether the provider actually exists is
    // verified against the database in startup-checks.ts.
    OIDC_AUTO_REDIRECT: z
        .string()
        .regex(/^[a-z0-9-_]+$/, "OIDC_AUTO_REDIRECT must be an SSO provider ID (lowercase letters, numbers, dashes and underscores)")
        .optional(),
});

export type ValidatedEnv = z.infer<typeof envSchema>;

/**
 * Validates environment variables at startup.
 * Logs warnings for missing optional vars and throws on missing required vars.
 * Returns the validated env object.
 */
export function validateEnvironment(): ValidatedEnv {
    log.info("Validating environment variables...");

    const result = envSchema.safeParse(process.env);

    if (!result.success) {
        const errors = result.error.issues;
        const critical: string[] = [];
        const warnings: string[] = [];

        for (const issue of errors) {
            const path = issue.path.join(".");
            const msg = `${path}: ${issue.message}`;

            // Required fields are critical
            if (path === "BETTER_AUTH_SECRET" || path === "ENCRYPTION_KEY") {
                critical.push(msg);
            } else {
                warnings.push(msg);
            }
        }

        // Log warnings for non-critical issues
        for (const warning of warnings) {
            log.warn(`ENV warning: ${warning}`);
        }

        // Throw on critical missing vars
        if (critical.length > 0) {
            const errorMsg = [
                "╔══════════════════════════════════════════════════════════╗",
                "║         MISSING REQUIRED ENVIRONMENT VARIABLES          ║",
                "╠══════════════════════════════════════════════════════════╣",
                ...critical.map(e => `║  ✗ ${e.padEnd(54)}║`),
                "╠══════════════════════════════════════════════════════════╣",
                "║  See: https://docs.dbackup.app/user-guide/installation      ║",
                "╚══════════════════════════════════════════════════════════╝",
            ].join("\n");

            log.error(`Missing required environment variables:\n${errorMsg}`);
            throw new Error(`Startup aborted: ${critical.join("; ")}`);
        }
    }

    log.info("Environment validation passed");

    // Return parsed env (with defaults applied)
    return result.success ? result.data : envSchema.parse(process.env);
}
