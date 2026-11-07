import { Client, type ConnectConfig } from "ssh2";

import { checkedSocket } from "@/lib/network/checked-socket";

import { normalizeSshPrivateKey } from "./pkcs8-compat";
import type { SshConnectionConfig } from "./types";

/** Handshake budget. Matches the previous SshClient so behaviour does not shift. */
const READY_TIMEOUT_MS = 20_000;

/**
 * Translate a normalized SSH config into ssh2's ConnectConfig.
 *
 * Kept separate from SshHost so the auth handling, including the PKCS#8
 * workaround, can be tested without standing up a whole host.
 */
export function buildConnectConfig(config: SshConnectionConfig): ConnectConfig {
    const connectConfig: ConnectConfig = {
        host: config.host,
        port: config.port ?? 22,
        username: config.username,
        readyTimeout: READY_TIMEOUT_MS,
        keepaliveInterval: 10_000,
        keepaliveCountMax: 3,
    };

    if (config.authType === "privateKey") {
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
 */
export async function openSshClient(config: SshConnectionConfig): Promise<Client> {
    const connectConfig = buildConnectConfig(config);
    if (config.reach) connectConfig.sock = await checkedSocket(config.host, config.port ?? 22, config.reach.allowed);

    return new Promise((resolve, reject) => {
        const client = new Client();
        const onError = (err: Error) => {
            client.removeListener("ready", onReady);
            reject(err);
        };
        const onReady = () => {
            client.removeListener("error", onError);
            resolve(client);
        };

        client.once("ready", onReady).once("error", onError).connect(connectConfig);
    });
}
