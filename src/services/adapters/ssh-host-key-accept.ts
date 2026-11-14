/**
 * What a person decides about the pinned SSH host key of a connection: trusting the key its server
 * presents now, after a reinstall say, and forgetting the pin. The pin itself and the first connect
 * are in `ssh-host-key-service.ts`. The caller checks the right to change the connection, the rule
 * about connections that reach the server DBackup runs on is asked here like on every other change.
 */

import prisma from "@/lib/prisma";
import { registry } from "@/lib/core/registry";
import { registerAdapters } from "@/lib/adapters";
import { resolveAdapterConfig } from "@/lib/adapters/config-resolver";
import { sshEndpointOf } from "@/lib/transport/ssh-endpoint";
import { CHANGED_KEY, pinFor, storedPin, withoutPin, withPin, type StoredHostKey } from "@/lib/adapters/ssh-host-key-pins";
import { decryptConfig } from "@/lib/crypto";
import { NotFoundError, ValidationError, wrapError } from "@/lib/logging/errors";
import { logger } from "@/lib/logging/logger";
import { runConnectivityCheck } from "@/lib/transport/adapter-invoke";
import { markHostKey, type SeenHostKey } from "@/lib/transport/host-key";
import { assertMayManageHostLocal } from "./adapter-create";
import { asPin, auditHostKey, HOST_KEY_AUDIT, writePinMetadata, type HostKeyActor } from "./ssh-host-key-service";

const log = logger.child({ service: "SshHostKeyAccept" });

const ACCEPT_TIMEOUT_MS = 20_000;

/** A fingerprint as ssh prints it, `SHA256:` and 43 characters of base64. */
export const FINGERPRINT_PATTERN = /^SHA256:[A-Za-z0-9+/]{43}$/;

export interface HostKeyChange {
    name: string;
    type: string;
    /** The fingerprint trusted before, null when there was none. */
    previous: string | null;
    /** The fingerprint trusted now, null after a forget. */
    fingerprint: string | null;
}

/** The connection with the rule of every change of it asked: only a platform admin changes one that reaches the server DBackup runs on. */
async function loadForChange(id: string) {
    const row = await prisma.adapterConfig.findUnique({
        where: { id },
        select: { id: true, name: true, type: true, adapterId: true, config: true, primaryCredentialId: true, sshCredentialId: true, tenantId: true },
    });
    if (!row) throw new NotFoundError("Adapter", id);
    let stored: Record<string, unknown> = {};
    try {
        stored = decryptConfig(JSON.parse(row.config)) as Record<string, unknown>;
    } catch (error: unknown) {
        log.warn("The config of a connection does not read, its host-local rule is asked without it", { configId: id }, wrapError(error));
    }
    await assertMayManageHostLocal(row.adapterId, stored, { primaryCredentialId: row.primaryCredentialId ?? null, sshCredentialId: row.sshCredentialId ?? null }, true);
    return row;
}

/**
 * Trusts the key the SSH server of a connection presents now, when it is the one the person was
 * shown. Logs in once without a pin, compares the key of that login with `fingerprint` and stores
 * it only on a match, so nobody accepts whatever answers a moment later.
 *
 * @throws NotFoundError for a connection that does not exist.
 * @throws ValidationError for a connection without an SSH login, one that reaches the server
 *   DBackup runs on for anyone but a platform admin, a login that failed, or another key.
 */
export async function acceptHostKey(id: string, fingerprint: string, by: HostKeyActor): Promise<HostKeyChange> {
    registerAdapters();
    const row = await loadForChange(id);
    const resolved = (await resolveAdapterConfig(row)) as Record<string, unknown>;
    const endpoint = sshEndpointOf(row.adapterId, resolved);
    const adapter = registry.get(row.adapterId);
    if (!endpoint || !adapter) throw new ValidationError("This connection opens no SSH login, so it has no host key to trust.");

    // This one login accepts whatever key the server presents and only reports it. Nothing is
    // stored unless it is the key the person was shown.
    let seen: SeenHostKey | null = null;
    markHostKey(resolved, { ...endpoint, onFirstKey: (key) => { seen = key; } });
    try {
        await runConnectivityCheck(adapter, resolved, { timeoutMs: ACCEPT_TIMEOUT_MS, label: row.name });
    } catch (error: unknown) {
        log.warn("The login that reads a new SSH host key failed", { configId: id }, wrapError(error));
    }
    const presented = seen as SeenHostKey | null;
    if (!presented) throw new ValidationError("DBackup could not log in to the server, so its key was not trusted. Test the connection and try again.");
    if (presented.fingerprint !== fingerprint) {
        throw new ValidationError(`The server now presents another key (${presented.fingerprint}) than the one shown to you. Nothing was changed. Test the connection again.`);
    }
    const pin = asPin(endpoint, presented, "accepted");
    if (!pin) throw new ValidationError("The key of the server does not read as a host key.");

    let previous: string | null = null;
    const written = await writePinMetadata(row, (metadata) => {
        previous = pinFor(metadata, endpoint)?.fingerprint ?? null;
        return withPin(metadata, pin);
    });
    if (!written?.written) throw new ValidationError("The key could not be stored. Try again.");
    await auditHostKey(row, HOST_KEY_AUDIT.accept, by, { name: row.name, host: endpoint.host, port: endpoint.port, previous, fingerprint: pin.fingerprint });
    return { name: row.name, type: row.type, previous, fingerprint: pin.fingerprint };
}

/**
 * Forgets the pinned key of a connection, so its next successful login pins the key it sees, for a
 * server that is about to be reinstalled.
 *
 * @throws NotFoundError for a connection that does not exist.
 * @throws ValidationError for one that reaches the server DBackup runs on, for anyone but a platform admin.
 */
export async function forgetHostKey(id: string, by: HostKeyActor): Promise<HostKeyChange> {
    const row = await loadForChange(id);
    let previous: StoredHostKey | null = null;
    const written = await writePinMetadata(row, (metadata) => {
        previous = storedPin(metadata);
        return previous || metadata[CHANGED_KEY] !== undefined ? withoutPin(metadata) : null;
    });
    const forgotten = previous as StoredHostKey | null;
    if (written?.written && forgotten) {
        await auditHostKey(row, HOST_KEY_AUDIT.forget, by, { name: row.name, host: forgotten.host, port: forgotten.port, previous: forgotten.fingerprint });
    }
    return { name: row.name, type: row.type, previous: forgotten?.fingerprint ?? null, fingerprint: null };
}
