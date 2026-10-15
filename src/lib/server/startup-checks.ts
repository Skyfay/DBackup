import prisma from "@/lib/prisma";
import { registry } from "@/lib/core/registry";
import { registerAdapters } from "@/lib/adapters";
import { logger } from "@/lib/logging/logger";
import { wrapError } from "@/lib/logging/errors";
import { getOidcAutoRedirectProviderId } from "@/lib/auth/env-flags";

const log = logger.child({ module: "StartupChecks" });

const NO_PROFILE_MESSAGE = "No credential profile assigned";

/**
 * Validates that every `AdapterConfig` whose adapter declares a primary
 * credential requirement has a `primaryCredentialId` assigned.
 *
 * Adapters with a missing assignment are flagged `OFFLINE` with
 * `lastError = "No credential profile assigned"`. Adapters that recover
 * (now have a profile) and were previously flagged with this exact error
 * are reset to `ONLINE` so the next health check can re-evaluate.
 *
 * Never throws - failures are logged and swallowed so they don't block
 * application startup.
 */
export async function validateAdapterCredentials(): Promise<void> {
    try {
        registerAdapters();

        const configs = await prisma.adapterConfig.findMany({
            select: {
                id: true,
                name: true,
                adapterId: true,
                primaryCredentialId: true,
                lastStatus: true,
                lastError: true,
            },
        });

        let flagged = 0;
        let cleared = 0;

        for (const cfg of configs) {
            const adapter = registry.get(cfg.adapterId);
            const requiresPrimary = adapter?.credentials?.primary !== undefined && !adapter?.credentials?.primaryOptional;
            const isMissing = requiresPrimary && !cfg.primaryCredentialId;

            if (isMissing) {
                if (cfg.lastStatus !== "OFFLINE" || cfg.lastError !== NO_PROFILE_MESSAGE) {
                    await prisma.adapterConfig.update({
                        where: { id: cfg.id },
                        data: { lastStatus: "OFFLINE", lastError: NO_PROFILE_MESSAGE },
                    });
                    flagged++;
                    log.warn("Adapter missing credential profile - flagged OFFLINE", {
                        id: cfg.id,
                        name: cfg.name,
                        adapterId: cfg.adapterId,
                    });
                }
            } else if (cfg.lastError === NO_PROFILE_MESSAGE) {
                // Recovery: was missing before, now has a profile (or no longer requires one).
                // Set ONLINE optimistically and reset the failure counter; the next health
                // check cycle will correct the status if the adapter is still unreachable.
                await prisma.adapterConfig.update({
                    where: { id: cfg.id },
                    data: { lastStatus: "ONLINE", lastError: null, consecutiveFailures: 0 },
                });
                cleared++;
                log.info("Adapter credential profile recovered - cleared OFFLINE flag", {
                    id: cfg.id,
                    name: cfg.name,
                });
            }
        }

        log.debug("Credential profile validation complete", {
            checked: configs.length,
            flagged,
            cleared,
        });
    } catch (e) {
        log.error("Credential profile validation failed", {}, wrapError(e));
    }
}

/**
 * Verifies that `OIDC_AUTO_REDIRECT` names an SSO provider that exists and is enabled.
 *
 * The variable holds a `SsoProvider.providerId`, which the login page uses to send
 * visitors straight to that provider instead of showing the login form. A value that
 * matches nothing would leave the login page silently behaving as if the feature were
 * off, so it is reported loudly here instead.
 *
 * Never throws - a bad value logs an error and the application starts normally with
 * the redirect switched off. Aborting startup would take the instance down the moment
 * somebody deletes or disables that provider in the UI, which is exactly the situation
 * where an administrator needs to reach the login page.
 */
export async function validateOidcAutoRedirect(): Promise<void> {
    const providerId = getOidcAutoRedirectProviderId();
    if (!providerId) return;

    try {
        const provider = await prisma.ssoProvider.findUnique({
            where: { providerId },
            select: { providerId: true, name: true, enabled: true, tenantId: true },
        });

        if (!provider) {
            log.error(
                "OIDC_AUTO_REDIRECT names an unknown SSO provider - automatic redirect is disabled. " +
                "The value must be a provider ID from Users > SSO / OIDC.",
                { providerId },
            );
            return;
        }

        if (!provider.enabled) {
            log.error(
                "OIDC_AUTO_REDIRECT names a disabled SSO provider - automatic redirect is disabled. " +
                "Enable the provider under Users > SSO / OIDC or clear the variable.",
                { providerId },
            );
            return;
        }

        // The login page belongs to the platform. A provider of a tenant is never a button there,
        // so it is no target of the redirect either.
        if (provider.tenantId) {
            log.error(
                "OIDC_AUTO_REDIRECT names a provider of a tenant - automatic redirect is disabled. " +
                "Only a provider of the platform can be the target, a tenant's provider is reached by the email domain.",
                { providerId },
            );
            return;
        }

        log.info("OIDC auto-redirect active", { providerId, name: provider.name });
    } catch (e) {
        log.error("OIDC auto-redirect validation failed", { providerId }, wrapError(e));
    }
}
