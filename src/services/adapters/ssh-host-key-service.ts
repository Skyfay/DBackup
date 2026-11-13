/**
 * The pinned SSH host key of a saved connection: reading it for the SSH clients, pinning the key of
 * the first successful login and noting a changed key. Accepting a new key on purpose and
 * forgetting one are in `ssh-host-key-accept.ts`. The pin lives in the metadata of the connection, see `ssh-host-key-pins.ts`, and reaches the
 * clients as a policy on the resolved config, see `src/lib/transport/host-key.ts`.
 *
 * Every write is a compare-and-set on the metadata as it was read, so two first connects that run
 * side by side never store different keys: the second finds the pin of the first and, with another
 * key, fails as a mismatch.
 */

import prisma from "@/lib/prisma";
import { sameEndpoint, sshEndpointOf, verifiesHostKey, type SshEndpoint } from "@/lib/transport/ssh-endpoint";
import { decryptConfig } from "@/lib/crypto";
import { CHANGED_KEY, parseMetadata, pinFor, withPin, type PinnedBy, type StoredHostKey } from "@/lib/adapters/ssh-host-key-pins";
import { AUDIT_ACTIONS, AUDIT_RESOURCES } from "@/lib/core/audit-types";
import { HostKeyMismatchError } from "@/lib/logging/errors";
import { logger } from "@/lib/logging/logger";
import { runAsTenant } from "@/lib/tenant/context";
import { pinnedFingerprint, type HostKeyMismatch, type SeenHostKey, type SshHostKeyPolicy } from "@/lib/transport/host-key";
import { isHostKey } from "@/lib/transport/host-key-openssh";
import { auditService } from "@/services/audit-service";

const log = logger.child({ service: "SshHostKey" });

/** How often a write reads the metadata again after another writer changed it meanwhile. */
const WRITE_TRIES = 5;

/** The actions of the audit entries, read by `describeEntry` in `audit-sentence.ts`. */
export const HOST_KEY_AUDIT = {
    pin: "ssh-host-key.pin",
    accept: "ssh-host-key.accept",
    forget: "ssh-host-key.forget",
    mismatch: "ssh-host-key.mismatch",
} as const;

/** The connection a pin belongs to, with the tenant its row is read and written in. */
export interface PinnedConnection {
    id: string;
    tenantId?: string | null;
}

const inTenantOf = <T>(connection: PinnedConnection, run: () => Promise<T>): Promise<T> =>
    connection.tenantId ? runAsTenant(connection.tenantId, run) : run();

/** A key of a form or a client as a pin, null for one that does not read as a key. */
export function asPin(endpoint: SshEndpoint, key: { type?: unknown; key?: unknown }, pinnedBy: PinnedBy, now = new Date()): StoredHostKey | null {
    if (!isHostKey(key.type, key.key)) return null;
    const pinned = { type: key.type as string, key: key.key as string };
    return { ...endpoint, ...pinned, fingerprint: pinnedFingerprint(pinned), pinnedAt: now.toISOString(), pinnedBy };
}

/**
 * Changes the metadata of a connection with a compare-and-set: `change` gets the metadata as it is
 * and answers the next one, or null to leave it. Null when the connection is gone, false when it
 * was left as it is or other writers kept winning.
 */
export async function writePinMetadata(connection: PinnedConnection, change: (metadata: Record<string, unknown>) => Record<string, unknown> | null): Promise<{ name: string; written: boolean } | null> {
    return inTenantOf(connection, async () => {
        for (let attempt = 0; attempt < WRITE_TRIES; attempt++) {
            const row = await prisma.adapterConfig.findUnique({ where: { id: connection.id }, select: { name: true, metadata: true } });
            if (!row) return null;
            const next = change(parseMetadata(row.metadata));
            if (!next) return { name: row.name, written: false };
            const result = await prisma.adapterConfig.updateMany({ where: { id: connection.id, metadata: row.metadata }, data: { metadata: JSON.stringify(next) } });
            if (result.count === 1) return { name: row.name, written: true };
        }
        log.warn("The metadata of a connection kept changing, its SSH host key was not written", { configId: connection.id });
        return { name: "", written: false };
    });
}

/** Who decided about a host key: the person, and the API key of the request when it came with one. Nobody for a run or a health check. */
export interface HostKeyActor {
    userId: string | null;
    apiKeyId?: string | null;
}

/** An audit entry about the host key of a connection, in the log of its tenant. */
export async function auditHostKey(connection: PinnedConnection, action: string, by: HostKeyActor | null, details: Record<string, unknown>): Promise<void> {
    const kind = action === HOST_KEY_AUDIT.mismatch ? AUDIT_ACTIONS.EXECUTE : AUDIT_ACTIONS.UPDATE;
    const origin = { ...(by?.apiKeyId ? { apiKeyId: by.apiKeyId } : {}), ...(connection.tenantId ? { tenantId: connection.tenantId } : {}) };
    await auditService.log(by?.userId ?? null, kind, AUDIT_RESOURCES.ADAPTER, { action, ...details }, connection.id, origin);
}

/**
 * Pins the key of a first successful login, unless the connection holds a pin for that server
 * already. The same key again changes nothing.
 *
 * @throws HostKeyMismatchError when another login pinned another key meanwhile.
 */
export async function pinFirstKey(connection: PinnedConnection, endpoint: SshEndpoint, seen: SeenHostKey, pinnedBy: PinnedBy = "first-connect", by: HostKeyActor | null = null): Promise<void> {
    const pin = asPin(endpoint, seen, pinnedBy);
    if (!pin) return;
    let other: StoredHostKey | null = null;
    const written = await writePinMetadata(connection, (metadata) => {
        const existing = pinFor(metadata, endpoint);
        if (!existing) return withPin(metadata, pin);
        other = existing.key === pin.key ? null : existing;
        return null;
    });
    const conflict = other as StoredHostKey | null;
    if (conflict) throw new HostKeyMismatchError({ ...endpoint, expected: conflict.fingerprint, presented: pin.fingerprint });
    if (written?.written) await auditHostKey(connection, HOST_KEY_AUDIT.pin, by, { name: written.name, host: endpoint.host, port: endpoint.port, fingerprint: pin.fingerprint, how: pinnedBy });
}

/** Notes a refused key in the audit log, once per key: a health check meets the same one every minute. */
export async function noteMismatch(connection: PinnedConnection, mismatch: HostKeyMismatch): Promise<void> {
    const presented = mismatch.presented ?? "unknown";
    const written = await writePinMetadata(connection, (metadata) => (metadata[CHANGED_KEY] === presented ? null : { ...metadata, [CHANGED_KEY]: presented }));
    if (!written?.written) return;
    await auditHostKey(connection, HOST_KEY_AUDIT.mismatch, null, { name: written.name, host: mismatch.host, port: mismatch.port, expected: mismatch.expected, presented: mismatch.presented });
}

/**
 * The host key policy of a saved connection for its resolved config: its pin while it still dials
 * that server, and what a first login and a changed key do. Null for a connection without an SSH
 * login or with the check switched off, whose clients accept every key.
 */
export async function storedHostKeyPolicy(row: { id?: string; adapterId: string; tenantId?: string | null }, resolved: Record<string, unknown>): Promise<SshHostKeyPolicy | null> {
    const endpoint = sshEndpointOf(row.adapterId, resolved);
    if (!row.id || !endpoint || !verifiesHostKey(resolved)) return null;
    const connection: PinnedConnection = { id: row.id, tenantId: row.tenantId };
    const stored = await inTenantOf(connection, () => prisma.adapterConfig.findUnique({ where: { id: connection.id }, select: { metadata: true } }));
    // A row that is not saved, like the one a lab seed resolves before it stores it, has nowhere to keep a pin.
    if (!stored) return null;
    const pin = pinFor(parseMetadata(stored.metadata), endpoint);
    const policy: SshHostKeyPolicy = {
        ...endpoint,
        ...(pin ? { pinned: { type: pin.type, key: pin.key } } : {}),
        onFirstKey: async (seen) => {
            await pinFirstKey(connection, endpoint, seen);
            // The later logins of the same run check against the key just pinned, before they log in.
            policy.pinned = { type: seen.type, key: seen.key };
        },
        onMismatch: (mismatch) => noteMismatch(connection, mismatch),
    };
    return policy;
}

/** The SSH server a stored config dials, null for one that does not read or opens no SSH login. */
function storedEndpoint(adapterId: string, config: string): SshEndpoint | null {
    try {
        return sshEndpointOf(adapterId, decryptConfig(JSON.parse(config)) as Record<string, unknown>);
    } catch {
        return null;
    }
}

/** What the test of a form learned about the host key of its server. */
export interface HostKeyProbe {
    policy: SshHostKeyPolicy | null;
    /** The key of a server without a pin, once the login succeeded. */
    seen: () => SeenHostKey | null;
    mismatch: () => HostKeyMismatch | null;
    /** Pins the key the test saw with the saved connection it tried, see `pinFirstKey`. */
    pinSeen: () => Promise<void>;
}

/**
 * The host key policy of a config a form holds. With the saved connection it edits and the same
 * SSH server, the test checks against the pin of that connection, so a changed key fails the test
 * like it fails a run. Otherwise the test reports the key it saw, which the form sends with the save.
 */
export async function formHostKeyProbe(adapterId: string, config: Record<string, unknown>, configId?: string): Promise<HostKeyProbe> {
    const endpoint = sshEndpointOf(adapterId, config);
    let seen: SeenHostKey | null = null;
    let mismatch: HostKeyMismatch | null = null;
    const none: HostKeyProbe = { policy: null, seen: () => null, mismatch: () => null, pinSeen: async () => {} };
    if (!endpoint || !verifiesHostKey(config)) return none;

    const saved = configId ? await prisma.adapterConfig.findUnique({ where: { id: configId }, select: { adapterId: true, config: true, metadata: true, tenantId: true } }) : null;
    // Only while the form still names the SSH server the saved connection dials. A form edited to
    // another server is a test of that other server, which the saved pin says nothing about.
    const sameServer = !!saved && saved.adapterId === adapterId && sameEndpoint(endpoint, storedEndpoint(adapterId, saved.config));
    const connection = saved && sameServer && configId ? { id: configId, tenantId: saved.tenantId } : null;
    const pin = connection ? pinFor(parseMetadata(saved?.metadata), endpoint) : null;
    return {
        policy: {
            ...endpoint,
            ...(pin ? { pinned: { type: pin.type, key: pin.key } } : {}),
            onFirstKey: (key) => { seen = key; },
            onMismatch: (found) => {
                mismatch = found;
                return connection ? noteMismatch(connection, found) : undefined;
            },
        },
        seen: () => seen,
        mismatch: () => mismatch,
        pinSeen: async () => {
            if (connection && seen) await pinFirstKey(connection, endpoint, seen, "first-connect");
        },
    };
}
