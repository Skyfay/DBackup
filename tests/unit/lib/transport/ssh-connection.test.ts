import { describe, it, expect, vi } from "vitest";

vi.mock("ssh2", async (importOriginal) => {
    // The key parser stays real, `unlocked-key.ts` reads keys with it.
    const actual = await importOriginal<typeof import("ssh2") & { default?: typeof import("ssh2") }>();
    return { ...actual, utils: actual.utils ?? actual.default?.utils, Client: vi.fn() };
});

import { buildConnectConfig } from "@/lib/transport/ssh-connection";
import type { SshConnectionConfig } from "@/lib/transport/types";

/**
 * Auth handling, split out of the old SshClient so it can be checked without
 * standing up a connection.
 */

const base: SshConnectionConfig = {
    host: "10.0.0.4",
    username: "ops",
    authType: "password",
};

describe("buildConnectConfig", () => {
    it("carries host, username and the default port", () => {
        expect(buildConnectConfig(base)).toMatchObject({
            host: "10.0.0.4",
            port: 22,
            username: "ops",
        });
    });

    it("uses an explicit port", () => {
        expect(buildConnectConfig({ ...base, port: 2222 }).port).toBe(2222);
    });

    it("keeps the handshake and keepalive budget", () => {
        // A long dump must not be cut off by an idle connection.
        expect(buildConnectConfig(base)).toMatchObject({
            readyTimeout: 20_000,
            keepaliveInterval: 10_000,
            keepaliveCountMax: 3,
        });
    });

    it("passes a password through for password auth", () => {
        expect(buildConnectConfig({ ...base, password: "hunter2" }).password).toBe("hunter2");
    });

    it("passes a private key through unchanged", () => {
        const key = "-----BEGIN OPENSSH PRIVATE KEY-----\nabc\n-----END OPENSSH PRIVATE KEY-----";
        const config = buildConnectConfig({ ...base, authType: "privateKey", privateKey: key });

        expect(config.privateKey).toBe(key);
        expect(config.password).toBeUndefined();
    });

    it("passes a passphrase alongside an encrypted OpenSSH key it cannot unlock itself", () => {
        const key = "-----BEGIN OPENSSH PRIVATE KEY-----\nabc\n-----END OPENSSH PRIVATE KEY-----";
        const config = buildConnectConfig({
            ...base,
            authType: "privateKey",
            privateKey: key,
            passphrase: "pp",
        });

        expect(config.privateKey).toBe(key);
        expect(config.passphrase).toBe("pp");
    });

    it("rejects a PKCS#8 encrypted key without a passphrase", () => {
        // ssh2 cannot read this format at all, so it is decrypted in memory
        // first, which needs the passphrase.
        expect(() => buildConnectConfig({
            ...base,
            authType: "privateKey",
            privateKey: "-----BEGIN ENCRYPTED PRIVATE KEY-----\nabc\n-----END ENCRYPTED PRIVATE KEY-----",
        })).toThrow(/passphrase-protected/);
    });

    it("uses the agent socket for agent auth", () => {
        process.env.SSH_AUTH_SOCK = "/tmp/agent.sock";
        try {
            expect(buildConnectConfig({ ...base, authType: "agent" }).agent).toBe("/tmp/agent.sock");
        } finally {
            delete process.env.SSH_AUTH_SOCK;
        }
    });

    it("never sets a password for agent auth", () => {
        const config = buildConnectConfig({ ...base, authType: "agent", password: "hunter2" });
        expect(config.password).toBeUndefined();
    });
});
