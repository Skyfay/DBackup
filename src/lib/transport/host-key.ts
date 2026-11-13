/**
 * The one place that decides what DBackup does with the host key of an SSH server.
 *
 * A connection pins the key of its server on the first successful login (trust on first use) and
 * every later login refuses a server that presents another one, before a password, a key signature
 * or any data is sent. All SSH clients go through here: the ssh2 transport, the SFTP adapter and
 * the folder browse through `sshHostKeyCheck`, rsync through `host-key-openssh.ts`.
 *
 * What a client checks against travels on the resolved config as a policy under a symbol, like the
 * reach policy of `reach-policy.ts`, so no stored config and no config of a form sets or clears it.
 * `ssh-host-key-service.ts` builds the policy of a saved connection from its pin. A config without
 * a policy, the one of a connection with the check switched off or one that never went through the
 * resolver, accepts every key as before.
 */

import { createHash, timingSafeEqual } from "crypto";

import type { ServerHostKeyAlgorithm } from "ssh2";

import { HostKeyMismatchError } from "@/lib/logging/errors";
import { logger } from "@/lib/logging/logger";

const log = logger.child({ module: "ssh-host-key" });

/** A public host key as a `known_hosts` line holds it: its type and the base64 of its blob. */
export interface PinnedHostKey {
    type: string;
    key: string;
}

/** The key a server presented, with its `SHA256:...` fingerprint. */
export interface SeenHostKey extends PinnedHostKey {
    fingerprint: string;
}

/** A server that presented another key than the pinned one. */
export interface HostKeyMismatch {
    host: string;
    port: number;
    expected: string;
    /** Null when the client did not report the key it saw. */
    presented: string | null;
}

/** What the SSH clients of one connection do with the key of its server. */
export interface SshHostKeyPolicy {
    /** The SSH server as the connection names it, for the sentence of a mismatch. */
    host: string;
    port: number;
    /** Absent: nothing pinned yet, the first key is accepted and reported to `onFirstKey`. */
    pinned?: PinnedHostKey;
    /**
     * Receives the key of a server without a pin once the login succeeded, so a server that merely
     * answers the port pins nothing. A rejection ends the connection with its error.
     */
    onFirstKey?: (seen: SeenHostKey) => void | Promise<void>;
    /** Told of every refused key, for the audit log. Never fails the connection further. */
    onMismatch?: (mismatch: HostKeyMismatch) => void | Promise<void>;
}

const HOST_KEY_POLICY = Symbol("dbackup.sshHostKeyPolicy");

/** Marks a config with the host key policy of its connection, or clears it. Mutates and returns the config. */
export function markHostKey<T>(config: T, policy: SshHostKeyPolicy | null): T {
    if (typeof config === "object" && config !== null) {
        const target = config as Record<symbol, unknown>;
        if (policy) target[HOST_KEY_POLICY] = policy;
        else delete target[HOST_KEY_POLICY];
    }
    return config;
}

/** The policy a config carries, null for one that checks nothing. */
export function hostKeyOf(config: unknown): SshHostKeyPolicy | null {
    if (typeof config !== "object" || config === null) return null;
    const policy = (config as Record<symbol, unknown>)[HOST_KEY_POLICY];
    return policy && typeof policy === "object" ? (policy as SshHostKeyPolicy) : null;
}

/** `SHA256:...` of a raw host key blob, the value `ssh-keygen -lf` and `ssh` print. */
export function hostKeyFingerprint(key: Buffer): string {
    return `SHA256:${createHash("sha256").update(key).digest("base64").replace(/=+$/, "")}`;
}

/** The fingerprint of a pinned key. */
export function pinnedFingerprint(pinned: PinnedHostKey): string {
    return hostKeyFingerprint(Buffer.from(pinned.key, "base64"));
}

/** The type a host key blob names in its first field, like `ssh-ed25519`, empty when it reads as none. */
export function hostKeyType(key: Buffer): string {
    if (key.length < 4) return "";
    const length = key.readUInt32BE(0);
    if (length === 0 || length > 64 || key.length < 4 + length) return "";
    const type = key.subarray(4, 4 + length).toString("ascii");
    return /^[A-Za-z0-9@._-]+$/.test(type) ? type : "";
}

/** A raw host key as the key a pin or a form keeps. */
export function seenHostKey(key: Buffer): SeenHostKey {
    return { type: hostKeyType(key), key: key.toString("base64"), fingerprint: hostKeyFingerprint(key) };
}

/** Compares two keys by their SHA-256, in constant time. */
function sameKey(a: Buffer, b: Buffer): boolean {
    return timingSafeEqual(createHash("sha256").update(a).digest(), createHash("sha256").update(b).digest());
}

/**
 * The mismatch of a policy as the error every client throws, and tells `onMismatch` of it. For a
 * client that learns of the refusal itself, like rsync from the output of ssh.
 */
export function hostKeyMismatch(policy: SshHostKeyPolicy, presented: string | null): HostKeyMismatchError {
    const mismatch: HostKeyMismatch = {
        host: policy.host,
        port: policy.port,
        expected: policy.pinned ? pinnedFingerprint(policy.pinned) : "none",
        presented,
    };
    void Promise.resolve()
        .then(() => policy.onMismatch?.(mismatch))
        .catch((error: unknown) => log.warn("Could not note a changed SSH host key", { host: policy.host, port: policy.port, error: error instanceof Error ? error.message : String(error) }));
    return new HostKeyMismatchError(mismatch);
}

/** The host key algorithms ssh2 offers, in its own order of preference. */
const SERVER_HOST_KEY_ALGORITHMS: ServerHostKeyAlgorithm[] = ["ssh-ed25519", "ecdsa-sha2-nistp256", "ecdsa-sha2-nistp384", "ecdsa-sha2-nistp521", "rsa-sha2-512", "rsa-sha2-256", "ssh-rsa"];

/** The signature algorithms a key of a type is offered under. An RSA key signs under three names. */
function algorithmsOfType(type: string): ServerHostKeyAlgorithm[] {
    if (type === "ssh-rsa") return ["rsa-sha2-512", "rsa-sha2-256", "ssh-rsa"];
    return SERVER_HOST_KEY_ALGORITHMS.filter((name) => name === type);
}

/** One login of an ssh2 client, from the key exchange to the moment the login succeeded. */
export interface SshHostKeyCheck {
    /**
     * The `hostVerifier` of the connect config. ssh2 calls it with the raw host key after the key
     * exchange and before it sends any login, and ends the connection when it answers false.
     */
    verifier: (key: Buffer) => boolean;
    /**
     * With a pin: the host key algorithms with those of the pinned type first. A server that holds
     * several keys would otherwise present one of another type, which would read as a mismatch.
     */
    algorithms?: { serverHostKey: ServerHostKeyAlgorithm[] };
    /** The error of a failed connect: the mismatch when the verifier refused the key, else the error itself. */
    failure(error: unknown): unknown;
    /** Called once the login succeeded: reports the key of a server without a pin to the policy. */
    loggedIn(): Promise<void>;
}

/**
 * The host key check of one login for the policy of its connection. Without a policy every key is
 * accepted, as before pins existed, and its fingerprint is logged at debug level.
 */
export function sshHostKeyCheck(policy: SshHostKeyPolicy | null | undefined, target: { host: string; port?: number }): SshHostKeyCheck {
    let unknown: SeenHostKey | null = null;
    let mismatch: HostKeyMismatchError | null = null;

    const preferred = policy?.pinned ? algorithmsOfType(policy.pinned.type) : [];
    return {
        verifier: (key: Buffer): boolean => {
            if (!policy) {
                log.debug("SSH host key accepted without a check", { host: target.host, port: target.port ?? 22, fingerprint: hostKeyFingerprint(key) });
                return true;
            }
            if (!policy.pinned) {
                unknown = seenHostKey(key);
                return true;
            }
            if (sameKey(key, Buffer.from(policy.pinned.key, "base64"))) return true;
            mismatch = hostKeyMismatch(policy, hostKeyFingerprint(key));
            return false;
        },
        ...(preferred.length > 0
            ? { algorithms: { serverHostKey: [...preferred, ...SERVER_HOST_KEY_ALGORITHMS.filter((name) => !preferred.includes(name))] } }
            : {}),
        failure: (error: unknown): unknown => mismatch ?? error,
        loggedIn: async (): Promise<void> => {
            if (unknown && policy?.onFirstKey) await policy.onFirstKey(unknown);
        },
    };
}
