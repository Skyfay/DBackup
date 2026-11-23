// @vitest-environment node
import { AddressInfo } from "net";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Server, utils } from "ssh2";

import { findHostKey } from "@/lib/transport/host-key-probe";
import { hostKeyFingerprint } from "@/lib/transport/host-key";

/**
 * Trusting a changed host key reads the key in a handshake that ends before any login, so a server
 * that answers in place of the real one never receives the saved password or key.
 */

const ed25519 = utils.generateKeyPairSync("ed25519");
const hostKey = utils.parseKey(ed25519.private);
if (hostKey instanceof Error) throw hostKey;
const fingerprint = hostKeyFingerprint(Buffer.from(hostKey.getPublicSSH()));

let server: Server;
let port = 0;
let logins = 0;

beforeEach(async () => {
    logins = 0;
    server = new Server({ hostKeys: [ed25519.private] }, (client) => {
        client.on("authentication", (context) => {
            logins += 1;
            context.reject();
        });
        client.on("error", () => {});
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    port = (server.address() as AddressInfo).port;
});

afterEach(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
});

describe("reading the host key of a server before trusting it", () => {
    it("finds the key with the fingerprint shown and sends no login", async () => {
        const seen = await findHostKey({ host: "127.0.0.1", port }, null, fingerprint);

        expect(seen?.fingerprint).toBe(fingerprint);
        expect(seen?.type).toBe("ssh-ed25519");
        expect(logins).toBe(0);
    });

    it("answers null for a server that presents another key, still without a login", async () => {
        const other = "SHA256:AbCdEfGhIjKlMnOpQrStUvWxYz0123456789+/AbCdE";

        await expect(findHostKey({ host: "127.0.0.1", port }, null, other)).resolves.toBeNull();
        expect(logins).toBe(0);
    });

    it("answers null for a port nobody listens on", async () => {
        const closed = port;
        await new Promise<void>((resolve) => server.close(() => resolve()));
        server = new Server({ hostKeys: [ed25519.private] }, () => {});
        await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));

        await expect(findHostKey({ host: "127.0.0.1", port: closed }, null, fingerprint)).resolves.toBeNull();
    });
});
