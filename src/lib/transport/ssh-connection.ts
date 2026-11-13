import { Client, type ConnectConfig } from "ssh2";

import { checkedSocket } from "@/lib/network/checked-socket";

import { sshHostKeyCheck, type SshHostKeyCheck } from "./host-key";
import { assertKeyCost } from "./key-cost";
import { normalizeSshPrivateKey } from "./pkcs8-compat";
import type { SshConnectionConfig } from "./types";

/** Handshake budget. Matches the previous SshClient so behaviour does not shift. */
const READY_TIMEOUT_MS = 20_000;

/**
 * Translate a normalized SSH config into ssh2's ConnectConfig.
 *
 * Kept separate from SshHost so the auth handling, including the PKCS#8
 * workaround, can be tested without standing up a whole host. The host key check of the login
 * is the one of `host-key.ts`, which `openSshClient` hands in to hear how the login ended.
 */
export function buildConnectConfig(config: SshConnectionConfig, check: SshHostKeyCheck = sshHostKeyCheck(config.hostKey, config)): ConnectConfig {
    const connectConfig: ConnectConfig = {
        host: config.host,
        port: config.port ?? 22,
        username: config.username,
        readyTimeout: READY_TIMEOUT_MS,
        keepaliveInterval: 10_000,
        keepaliveCountMax: 3,
        hostVerifier: check.verifier,
        ...(check.algorithms ? { algorithms: check.algorithms } : {}),
    };

    if (config.authType === "privateKey") {
        // ssh2 derives the key of an encrypted file on the event loop, so its cost is bounded first.
        assertKeyCost(config.privateKey);
        // ssh2 cannot read PKCS#8 encrypted keys (BEGIN ENCRYPTED PRIVATE KEY),
        // so those are decrypted in memory first.
        if (config.privateKey?.includes("BEGIN ENCRYPTED PRIVATE KEY")) {
            if (!config.passphrase) {
                throw new Error("This private key is passphrase-protected. Please provide the passphrase.");
            }
            connectConfig.privateKey = normalizeSshPrivateKey(config.privateKey, config.passphrase);
        } else {
            connectConfig.privateKey = config.privateKey;
            if (config.passphrase) {
                connectConfig.passphrase = config.passphrase;
            }
        }
    } else if (config.authType === "agent") {
        connectConfig.agent = process.env.SSH_AUTH_SOCK;
    } else {
        connectConfig.password = config.password;
    }

    return connectConfig;
}

/**
 * Open an authenticated ssh2 client, or reject with the handshake error. For a tenant that blocks
 * the local network ssh2 gets a socket connected to a checked address, the next one where the first
 * does not answer, see `checked-socket.ts`, so the name cannot lead elsewhere the second time.
 *
 * @throws HostKeyMismatchError when the server presents another host key than the pinned one,
 *   before any login is sent, or when another first connect pinned another key meanwhile.
 */
export async function openSshClient(config: SshConnectionConfig): Promise<Client> {
    const check = sshHostKeyCheck(config.hostKey, config);
    const connectConfig = buildConnectConfig(config, check);
    if (config.reach) connectConfig.sock = await checkedSocket(config.host, config.port ?? 22, config.reach.allowed);

    return new Promise((resolve, reject) => {
        const client = new Client();
        const onError = (err: Error) => {
            client.removeListener("ready", onReady);
            // ssh2 reports a refused host key as a plain handshake error, the check knows why.
            reject(check.failure(err));
        };
        const onReady = () => {
            client.removeListener("error", onError);
            // The key of a server without a pin is pinned only now, after the login succeeded.
            check.loggedIn().then(() => resolve(client), (error: unknown) => {
                client.on("error", () => {});
                client.end();
                reject(error);
            });
        };

        client.once("ready", onReady).once("error", onError).connect(connectConfig);
    });
}
