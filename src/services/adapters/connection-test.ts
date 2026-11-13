/**
 * Test connection of the connection form: tries the config the form holds, before or after it is
 * saved, and keeps the server version a passing test reports with the saved connection.
 */

import prisma from "@/lib/prisma";
import { registry } from "@/lib/core/registry";
import { registerAdapters } from "@/lib/adapters";
import { applyStoredSecrets, mayReachHost, overlayCredentialsOnConfig } from "@/lib/adapters/config-resolver";
import { hostLocalReason } from "@/lib/adapters/host-local";
import { sameAddress } from "@/lib/adapters/stored-secrets";
import { decryptConfig } from "@/lib/crypto";
import { runAdapterTest } from "@/lib/transport/adapter-invoke";
import { markHostKey } from "@/lib/transport/host-key";
import { hostKeyMismatchMessage } from "@/lib/logging/errors";
import { formHostKeyProbe } from "./ssh-host-key-service";
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
    /**
     * The host key of the SSH server, when the test logged in to one that has no pin with the
     * connection yet. A new connection sends it with its save, which pins it.
     */
    hostKey?: { type: string; key: string; fingerprint: string };
    /** Set when the server presented another host key than the pinned one, so the form can offer to trust it. */
    hostKeyMismatch?: { expected: string; presented: string | null };
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
        ? await applyStoredSecrets(adapterId, input.storedConfigId, { ...input.config }, { primaryCredentialId: input.primaryCredentialId, sshCredentialId: input.sshCredentialId })
        : { ...input.config };

    // The logins of the credential profiles go on top, so the adapter gets a config it can use as it is.
    const mergedConfig = await overlayCredentialsOnConfig(
        adapterId,
        submittedConfig,
        input.primaryCredentialId ?? null,
        input.sshCredentialId ?? null
    );
    // The SSH clients check the host key against the pin of the saved connection the form edits,
    // and report the key of a server without one, see `ssh-host-key-service.ts`.
    const hostKey = await formHostKeyProbe(adapterId, mergedConfig, configId);
    markHostKey(mergedConfig, hostKey.policy);

    const tested = await Promise.race([
        runAdapterTest(adapter, mergedConfig).then((r) => r!),
        new Promise<{ success: false; message: string }>((resolve) =>
            setTimeout(
                () => resolve({ success: false, message: "Connection test timed out after 10s. Check the host and port settings." }),
                TEST_TIMEOUT_MS
            )
        ),
    ]);

    const result: ConnectionTestResult = { ...tested };
    const mismatch = hostKey.mismatch();
    if (mismatch) {
        // The adapters word a failed login each their own way, a changed key reads the same everywhere.
        result.success = false;
        result.message = hostKeyMismatchMessage(mismatch);
        result.hostKeyMismatch = { expected: mismatch.expected, presented: mismatch.presented };
    }
    const seen = hostKey.seen();
    if (result.success && seen) {
        result.hostKey = seen;
        // A saved connection without a pin gets it from its first successful test.
        if (configId) await pinTested(hostKey.pinSeen, configId);
    }

    if (result.success && result.version && configId) {
        await recordVersion(configId, adapterId, submittedConfig, result.version);
    }
    return { ok: true, result };
}

/** Pins the key a passing test saw with the saved connection. A failure here never fails the test. */
async function pinTested(pin: () => Promise<void>, configId: string): Promise<void> {
    try {
        await pin();
    } catch (error: unknown) {
        log.warn("The SSH host key of a tested connection was not pinned", { configId }, wrapError(error));
    }
}

/**
 * Keeps the version a passing test found with the saved connection, only while the test tried that
 * connection: the same adapter at the same hosts and ports, see `sameAddress`, and for a connection
 * to the server DBackup runs on only from whoever may test one, see `mayReachHost`. A version of
 * another server would otherwise pass for the one of the saved connection, in the Database Explorer
 * and the version checks of a restore. A failure here never fails the test.
 */
async function recordVersion(configId: string, adapterId: string, tested: Record<string, unknown>, version: string): Promise<void> {
    try {
        const existing = await prisma.adapterConfig.findUnique({ where: { id: configId }, select: { adapterId: true, config: true, metadata: true } });
        if (!existing || existing.adapterId !== adapterId) return;
        let stored: Record<string, unknown>;
        try {
            stored = decryptConfig(JSON.parse(existing.config)) as Record<string, unknown>;
        } catch {
            return;
        }
        if (!sameAddress(adapterId, stored, tested)) return;
        if ((hostLocalReason(adapterId, stored) || hostLocalReason(adapterId, tested)) && !(await mayReachHost())) return;
        const currentMeta = existing.metadata ? JSON.parse(existing.metadata) : {};
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
