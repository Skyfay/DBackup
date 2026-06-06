import prisma from "@/lib/prisma";
import { registry } from "@/lib/core/registry";
import { registerAdapters } from "@/lib/adapters";
import { logger } from "@/lib/logging/logger";
import { wrapError } from "@/lib/logging/errors";

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
