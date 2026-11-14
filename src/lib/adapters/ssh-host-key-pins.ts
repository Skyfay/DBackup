/**
 * The pinned SSH host key of a connection as its metadata keeps it, as plain data. The metadata is
 * the JSON column that already holds what DBackup notes about a connection by itself, like the
 * version of its server, so the pin needs no column of its own:
 *
 *   "sshHostKeys": { "primary": { host, port, type, key, fingerprint, pinnedAt, pinnedBy } }
 *   "sshHostKeyChanged": "SHA256:..."
 *
 * The whole public key is kept, since rsync needs it for a `known_hosts` line, and a public key is
 * no secret. `primary` is the one SSH server every adapter of today logs in to, the map leaves
 * room for a jump host. A pin counts only while the connection still dials its host and port, see
 * `ssh-endpoint.ts`. `sshHostKeyChanged` is the last other key a server presented that the audit
 * log already holds, so a health check that meets it every minute writes one entry, not one a minute.
 *
 * Only the server writes these two keys. A save of the connection form sends the metadata it
 * loaded back, so `keepPinKeys` puts the stored ones over whatever a request brings.
 * No Node.js module here, the connection form reads the pin to show it.
 */

import { sameEndpoint, type SshEndpoint } from "@/lib/transport/ssh-endpoint";

/** How a key came to be pinned. */
export type PinnedBy = "first-connect" | "form-test" | "accepted";

export interface StoredHostKey {
    host: string;
    port: number;
    type: string;
    key: string;
    fingerprint: string;
    /** ISO 8601, UTC. */
    pinnedAt: string;
    pinnedBy: PinnedBy;
}

export const PINS_KEY = "sshHostKeys";
export const CHANGED_KEY = "sshHostKeyChanged";
const SLOT = "primary";

type Metadata = Record<string, unknown>;

const isRecord = (value: unknown): value is Metadata => !!value && typeof value === "object" && !Array.isArray(value);

/** The metadata of a connection as an object, empty for none or one that does not read. */
export function parseMetadata(metadata: string | null | undefined): Metadata {
    if (!metadata) return {};
    try {
        const value: unknown = JSON.parse(metadata);
        return isRecord(value) ? value : {};
    } catch {
        return {};
    }
}

/** The pin a metadata object holds, whatever server it was taken at, null for none that reads. */
export function storedPin(metadata: Metadata): StoredHostKey | null {
    const pins = metadata[PINS_KEY];
    const pin = isRecord(pins) ? pins[SLOT] : null;
    if (!isRecord(pin)) return null;
    const { host, port, type, key, fingerprint, pinnedAt, pinnedBy } = pin;
    if (typeof host !== "string" || typeof port !== "number" || typeof type !== "string" || typeof key !== "string" || typeof fingerprint !== "string") return null;
    return {
        host, port, type, key, fingerprint,
        pinnedAt: typeof pinnedAt === "string" ? pinnedAt : "",
        pinnedBy: pinnedBy === "form-test" || pinnedBy === "accepted" ? pinnedBy : "first-connect",
    };
}

/** The pin that counts for a connection: the stored one while the connection still dials its host and port. */
export function pinFor(metadata: Metadata, endpoint: SshEndpoint | null): StoredHostKey | null {
    const pin = storedPin(metadata);
    return pin && sameEndpoint(endpoint, pin) ? pin : null;
}

/** The metadata with this pin, and without the note of a changed key, which the new pin answers. */
export function withPin(metadata: Metadata, pin: StoredHostKey): Metadata {
    const { [CHANGED_KEY]: _changed, ...rest } = metadata;
    return { ...rest, [PINS_KEY]: { [SLOT]: pin } };
}

/** The metadata without a pin and without the note of a changed key, like the one of a copy. */
export function withoutPin(metadata: Metadata): Metadata {
    const { [PINS_KEY]: _pins, [CHANGED_KEY]: _changed, ...rest } = metadata;
    return rest;
}

/**
 * The metadata a request sent, with the pin keys of the stored one instead of its own. A request
 * never sets, changes or drops a pin through the metadata.
 */
export function keepPinKeys(incoming: Metadata, stored: Metadata): Metadata {
    const next = withoutPin(incoming);
    if (stored[PINS_KEY] !== undefined) next[PINS_KEY] = stored[PINS_KEY];
    if (stored[CHANGED_KEY] !== undefined) next[CHANGED_KEY] = stored[CHANGED_KEY];
    return next;
}
