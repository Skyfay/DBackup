// @vitest-environment node
/**
 * A private key with a passphrase names its own cost to unlock, which ssh2 pays on the event loop
 * every tenant shares. It is unlocked once per process and kept without the passphrase, in a form
 * ssh2 reads at no cost, so a health check that logs in every minute pays it once.
 */
import { describe, expect, it, vi } from "vitest";
import { utils } from "ssh2";

import { buildConnectConfig } from "@/lib/transport/ssh-connection";
import { unlockedPrivateKey } from "@/lib/transport/unlocked-key";
import { connectSFTP } from "@/lib/adapters/storage/sftp";

const sftpLogins = vi.hoisted(() => [] as Record<string, unknown>[]);
vi.mock("ssh2-sftp-client", () => ({
    default: class {
        async connect(options: Record<string, unknown>) {
            sftpLogins.push(options);
        }
        async end() {}
    },
}));

const publicOf = (key: string, passphrase?: string) => {
    const parsed = utils.parseKey(key, passphrase);
    const one = Array.isArray(parsed) ? parsed[0] : parsed;
    if (one instanceof Error) throw one;
    return one.getPublicSSH().toString("base64");
};

describe.each(["ed25519", "ecdsa", "rsa"] as const)("an encrypted %s key", (type) => {
    const pair = utils.generateKeyPairSync(type, { bits: type === "rsa" ? 2048 : type === "ecdsa" ? 256 : undefined, passphrase: "dummy-pass", rounds: 16, cipher: "aes256-ctr" } as never);

    it("unlocks to a key ssh2 reads without a passphrase, with the same public half", () => {
        const plain = unlockedPrivateKey(pair.private, "dummy-pass");

        expect(plain).not.toBeNull();
        expect(publicOf(plain!)).toBe(publicOf(pair.private, "dummy-pass"));
    });

    it("is unlocked once, the next connect gets the kept key", () => {
        const first = unlockedPrivateKey(pair.private, "dummy-pass");
        const started = performance.now();
        const second = unlockedPrivateKey(pair.private, "dummy-pass");

        expect(second).toBe(first);
        expect(performance.now() - started).toBeLessThan(5);
    });

    it("goes to ssh2 without the passphrase once unlocked", () => {
        const config = buildConnectConfig({ host: "example.test", port: 22, username: "backup", authType: "privateKey", privateKey: pair.private, passphrase: "dummy-pass" } as never);

        expect(config.passphrase).toBeUndefined();
        expect(publicOf(String(config.privateKey))).toBe(publicOf(pair.private, "dummy-pass"));
    });

    it("goes to an SFTP destination the same way, without the passphrase", async () => {
        sftpLogins.length = 0;
        await connectSFTP({ host: "example.test", port: 22, username: "backup", privateKey: pair.private, passphrase: "dummy-pass" } as never).catch(() => {});

        expect(sftpLogins).toHaveLength(1);
        expect(sftpLogins[0].passphrase).toBeUndefined();
        expect(sftpLogins[0].privateKey).toBe(unlockedPrivateKey(pair.private, "dummy-pass"));
    });
});

describe("a key with the wrong passphrase", () => {
    it("is left to ssh2 as it is, which then says what is wrong", () => {
        const pair = utils.generateKeyPairSync("ed25519", { passphrase: "right", rounds: 16, cipher: "aes256-ctr" } as never);

        expect(unlockedPrivateKey(pair.private, "wrong")).toBeNull();
        const config = buildConnectConfig({ host: "example.test", port: 22, username: "backup", authType: "privateKey", privateKey: pair.private, passphrase: "wrong" } as never);
        expect(config.privateKey).toBe(pair.private);
        expect(config.passphrase).toBe("wrong");
    });
});
