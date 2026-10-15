/**
 * Test connection of the connection form: tries the config the form holds, before or after it is
 * saved, and keeps the server version a passing test reports with the saved connection.
 */

import prisma from "@/lib/prisma";
import { registry } from "@/lib/core/registry";
import { registerAdapters } from "@/lib/adapters";
import { applyStoredSecrets, overlayCredentialsOnConfig } from "@/lib/adapters/config-resolver";
import { runAdapterTest } from "@/lib/transport/adapter-invoke";
import { logger } from "@/lib/logging/logger";
import { wrapError } from "@/lib/logging/errors";

registerAdapters();

const log = logger.child({ service: "ConnectionTest" });

const TEST_TIMEOUT_MS = 10_000;

export interface ConnectionTestInput {
    adapterId: string;
    /** The config as the form holds it. */
    config: Record<string, unknown>;
    /** The saved connection whose secrets fill the gaps of the form. Only for a caller who may change it. */
    storedConfigId?: string;
    /** The saved connection being edited, which keeps the version a passing test reports. */
    configId?: string;
    primaryCredentialId?: string | null;
    sshCredentialId?: string | null;
}

export interface ConnectionTestResult {
    success: boolean;
    message: string;
    version?: string;
}

/** The result of the test, or why there was none: no such adapter, or one that cannot be tested. */
export type ConnectionTestOutcome =
    | { ok: true; result: ConnectionTestResult }
    | { ok: false; reason: "adapter-missing" | "unsupported" };

export async function testConnection(input: ConnectionTestInput): Promise<ConnectionTestOutcome> {
    const { adapterId, configId } = input;
    const adapter = registry.get(adapterId);
    if (!adapter) return { ok: false, reason: "adapter-missing" };
    if (!adapter.test) return { ok: false, reason: "unsupported" };

    // Secrets held in the config itself reach the browser redacted, so an edit of a saved
    // connection submits them missing. They are filled back in, or the test would try a config
    // the saved connection never had.
    const submittedConfig = input.storedConfigId
        ? await applyStoredSecrets(adapterId, input.storedConfigId, { ...input.config })
        : { ...input.config };

    // The logins of the credential profiles go on top, so the adapter gets a config it can use as it is.
    const mergedConfig = await overlayCredentialsOnConfig(
        adapterId,
        submittedConfig,
        input.primaryCredentialId ?? null,
        input.sshCredentialId ?? null
    );

    const result = await Promise.race([
        runAdapterTest(adapter, mergedConfig).then((r) => r!),
        new Promise<{ success: false; message: string }>((resolve) =>
            setTimeout(
                () => resolve({ success: false, message: "Connection test timed out after 10s. Check the host and port settings." }),
                TEST_TIMEOUT_MS
            )
        ),
    ]);

    if (result.success && result.version && configId) {
        await recordVersion(configId, result.version);
    }
    return { ok: true, result };
}

/** Keeps the version a passing test found with the saved connection. A failure here never fails the test. */
async function recordVersion(configId: string, version: string): Promise<void> {
    try {
        const existing = await prisma.adapterConfig.findUnique({ where: { id: configId }, select: { metadata: true } });
        const currentMeta = existing?.metadata ? JSON.parse(existing.metadata) : {};
        const metadata = {
            ...currentMeta,
            engineVersion: version,
            lastCheck: new Date().toISOString(),
            status: "Online",
        };
        await prisma.adapterConfig.update({ where: { id: configId }, data: { metadata: JSON.stringify(metadata) } });
    } catch (metaError: unknown) {
        log.error("Failed to update metadata", { configId }, wrapError(metaError));
    }
}
