/**
 * Reads the host key an SSH server presents without logging in to it.
 *
 * ssh2 hands the key to `hostVerifier` after the key exchange and before any login. The verifier
 * keeps the key and answers false, so the client ends the connection there and sends no user name
 * that counts, no password and no signature. Trusting a changed key reads the key this way and
 * compares it with the one the person was shown, so a server that answers in its place by then
 * receives nothing, see `ssh-host-key-accept.ts`. rsync's OpenSSH client gets the key only later,
 * from the pin this writes.
 */

import { Client, type ServerHostKeyAlgorithm } from "ssh2";

import { checkedSocket } from "@/lib/network/checked-socket";
import type { ReachPolicy } from "@/lib/network/reach-policy";

import { algorithmsOfType, seenHostKey, type SeenHostKey } from "./host-key";
import type { SshEndpoint } from "./ssh-endpoint";

const PROBE_TIMEOUT_MS = 10_000;

/** A name for the handshake. The connection ends before ssh2 would send it in a login. */
const PROBE_USER = "dbackup-host-key";

/**
 * The key the server presents under the signature algorithms of one key type, null when it holds no
 * key of that type or cannot be reached. For a tenant that blocks the local network the socket goes
 * to a checked address, like every other SSH dial.
 */
async function presentedKey(endpoint: SshEndpoint, reach: ReachPolicy | null, algorithms: ServerHostKeyAlgorithm[]): Promise<SeenHostKey | null> {
    let sock;
    try {
        sock = reach ? await checkedSocket(endpoint.host, endpoint.port, reach.allowed, PROBE_TIMEOUT_MS) : undefined;
    } catch {
        return null;
    }
    return new Promise((resolve) => {
        const client = new Client();
        let seen: SeenHostKey | null = null;
        const done = () => {
            client.removeAllListeners();
            client.on("error", () => {});
            client.end();
            resolve(seen);
        };
        client.once("error", done).once("close", done).once("ready", done);
        client.connect({
            host: endpoint.host,
            port: endpoint.port,
            username: PROBE_USER,
            readyTimeout: PROBE_TIMEOUT_MS,
            algorithms: { serverHostKey: algorithms },
            hostVerifier: (key: Buffer) => {
                seen = seenHostKey(key);
                return false;
            },
            ...(sock ? { sock } : {}),
        });
    });
}

/** The key types a server may hold, each tried on its own since a server presents one per handshake. */
const KEY_TYPES = ["ssh-ed25519", "ecdsa-sha2-nistp256", "ecdsa-sha2-nistp384", "ecdsa-sha2-nistp521", "ssh-rsa"] as const;

/**
 * The key of the server whose fingerprint is `fingerprint`, null when the server presents none of
 * that fingerprint. The type of the key pinned before goes first, the clients prefer it as well.
 */
export async function findHostKey(endpoint: SshEndpoint, reach: ReachPolicy | null, fingerprint: string, preferredType?: string): Promise<SeenHostKey | null> {
    const types = [...new Set([...(preferredType ? [preferredType] : []), ...KEY_TYPES])];
    for (const type of types) {
        const algorithms = algorithmsOfType(type);
        if (algorithms.length === 0) continue;
        const seen = await presentedKey(endpoint, reach, algorithms);
        if (seen?.fingerprint === fingerprint) return seen;
    }
    return null;
}
