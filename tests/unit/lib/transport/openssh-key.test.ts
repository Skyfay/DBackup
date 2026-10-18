import { describe, it, expect, vi } from "vitest";
import { utils as sshUtils, type ParsedKey } from "ssh2";
import {
    generateSshKeyPair,
    readPublicKey,
    sanitizeKeyComment,
    sshFingerprint,
} from "@/lib/transport/openssh-key";
import { SSH_KEY_TYPES, type SshKeyType } from "@/lib/core/credentials";

// Generating a key waits on the crypto thread pool, which the rest of the suite keeps busy.
// The default five seconds are enough on an idle machine and not always under a full run.
vi.setConfig({ testTimeout: 30_000 });

/** ssh2 is what actually connects, so a key it cannot parse is a key DBackup cannot use. */
function parse(privateKey: string) {
    const parsed = sshUtils.parseKey(privateKey);
    if (parsed instanceof Error) throw parsed;
    if (Array.isArray(parsed)) throw new Error("expected a single key");
    return parsed;
}

/**
 * What ssh2 hands back for an ed25519 key whose public half starts with a zero byte: a public
 * key one byte short, and a private key nothing reads.
 */
function shortEd25519Pair() {
    const name = Buffer.from("ssh-ed25519");
    const blob = Buffer.alloc(4 + name.length + 4 + 31, 7);
    blob.writeUInt32BE(name.length, 0);
    name.copy(blob, 4);
    blob.writeUInt32BE(31, 4 + name.length);
    return {
        private: "-----BEGIN OPENSSH PRIVATE KEY-----\nbroken\n-----END OPENSSH PRIVATE KEY-----\n",
        public: `ssh-ed25519 ${blob.toString("base64")} dbackup@prod`,
    };
}

/** The length of the key in an ed25519 `authorized_keys` line, 32 for a key ssh2 wrote in full. */
function ed25519KeyLength(publicLine: string): number {
    const blob = Buffer.from(publicLine.split(" ")[1], "base64");
    return blob.readUInt32BE(4 + blob.readUInt32BE(0));
}

/**
 * An ed25519 pair ssh2 wrote in full, made once with its synchronous keygen, which the spy leaves
 * alone. One key in 256 comes out short, so it keeps the first full one.
 */
function readablePair(): { private: string; public: string } {
    for (let attempt = 0; attempt < 100; attempt++) {
        const pair = sshUtils.generateKeyPairSync("ed25519", { comment: "dbackup@prod" });
        if (ed25519KeyLength(pair.public) === 32) return { private: pair.private, public: pair.public };
    }
    throw new Error("ssh2 wrote no full ed25519 key in 100 attempts");
}

const READABLE_PAIR = readablePair();

type KeygenDone = (err: Error | null, pair: { private: string; public: string }) => void;

/**
 * Lets ssh2's keygen answer with the short pair, the next `times` calls and then with a full pair,
 * or every call. Nothing is left to the real keygen, which writes a short key now and then itself.
 */
function answerShort(times?: number) {
    const spy = vi.spyOn(sshUtils, "generateKeyPair");
    const answer = (pair: () => { private: string; public: string }) => (...args: unknown[]) => {
        (args[args.length - 1] as KeygenDone)(null, pair());
    };
    if (times === undefined) {
        spy.mockImplementation(answer(shortEd25519Pair));
    } else {
        for (let i = 0; i < times; i++) spy.mockImplementationOnce(answer(shortEd25519Pair));
        spy.mockImplementation(answer(() => READABLE_PAIR));
    }
    return spy;
}

const EXPECTED_ALGORITHM: Record<SshKeyType, string> = {
    ed25519: "ssh-ed25519",
    "rsa-4096": "ssh-rsa",
    "ecdsa-p256": "ecdsa-sha2-nistp256",
    "ecdsa-p384": "ecdsa-sha2-nistp384",
};

describe("SSH keypair generation", () => {
    // RSA 4096 dominates the runtime here, so the suite gets room beyond the default timeout.
    it.each(SSH_KEY_TYPES)("produces a usable %s keypair", async (keyType) => {
        const key = await generateSshKeyPair(keyType, "dbackup@prod");

        expect(key.privateKey.startsWith("-----BEGIN OPENSSH PRIVATE KEY-----")).toBe(true);
        expect(key.privateKey.trimEnd().endsWith("-----END OPENSSH PRIVATE KEY-----")).toBe(true);

        const parsed = parse(key.privateKey);
        expect(parsed.type).toBe(EXPECTED_ALGORITHM[keyType]);

        // The public line is the authorized_keys form of the same key.
        const [algorithm, blob, comment] = key.publicKey.split(" ");
        expect(algorithm).toBe(EXPECTED_ALGORITHM[keyType]);
        expect(blob).toBe(parsed.getPublicSSH().toString("base64"));
        expect(comment).toBe("dbackup@prod");

        expect(key.fingerprint).toMatch(/^SHA256:[A-Za-z0-9+/]{43}$/);
    }, 60_000);

    it("makes an ed25519 key again when ssh2 wrote it a byte short", async () => {
        const spy = answerShort(2);
        try {
            const key = await generateSshKeyPair("ed25519", "dbackup@prod");
            expect(spy).toHaveBeenCalledTimes(3);
            expect(parse(key.privateKey).type).toBe("ssh-ed25519");
        } finally {
            spy.mockRestore();
        }
    });

    it("gives up when every attempt comes out a byte short", async () => {
        const spy = answerShort();
        try {
            await expect(generateSshKeyPair("ed25519", "dbackup@prod")).rejects.toThrow(/readable ed25519 key/);
            expect(spy).toHaveBeenCalledTimes(8);
        } finally {
            spy.mockRestore();
        }
    });

    it("leaves the key unencrypted when no passphrase is given", async () => {
        const key = await generateSshKeyPair("ed25519", "dbackup@prod");
        // parseKey without a passphrase would fail on an encrypted key.
        expect(() => parse(key.privateKey)).not.toThrow();
    });

    it.each(SSH_KEY_TYPES)("encrypts a %s key with the given passphrase", async (keyType) => {
        const key = await generateSshKeyPair(keyType, "dbackup@prod", "correct horse");

        // Readable with the passphrase, refused without it and with the wrong one.
        const opened = sshUtils.parseKey(key.privateKey, "correct horse");
        expect(opened instanceof Error).toBe(false);
        expect(sshUtils.parseKey(key.privateKey) instanceof Error).toBe(true);
        expect(sshUtils.parseKey(key.privateKey, "wrong") instanceof Error).toBe(true);

        // The public half is unaffected by the encryption.
        expect(key.publicKey).toBe(
            `${EXPECTED_ALGORITHM[keyType]} ${(opened as ParsedKey)
                .getPublicSSH()
                .toString("base64")} dbackup@prod`
        );
    }, 60_000);

    it("treats an empty passphrase as no passphrase", async () => {
        const key = await generateSshKeyPair("ed25519", "dbackup@prod", "");
        expect(() => parse(key.privateKey)).not.toThrow();
    });

    it("gives every generated key its own material", async () => {
        const [first, second] = await Promise.all([
            generateSshKeyPair("ed25519", "a"),
            generateSshKeyPair("ed25519", "b"),
        ]);
        expect(first.privateKey).not.toBe(second.privateKey);
        expect(first.fingerprint).not.toBe(second.fingerprint);
    });

    it("keeps a comment from smuggling a second authorized_keys entry", async () => {
        const key = await generateSshKeyPair("ed25519", "prod\nssh-rsa AAAAB3Nz attacker@host");
        expect(key.publicKey.split("\n")).toHaveLength(1);
        expect(key.publicKey.endsWith("prod ssh-rsa AAAAB3Nz attacker@host")).toBe(true);
    });

    it("accepts an empty comment", async () => {
        const key = await generateSshKeyPair("ed25519", "");
        expect(key.publicKey.split(" ")).toHaveLength(2);
        expect(() => parse(key.privateKey)).not.toThrow();
    });
});

describe("sanitizeKeyComment", () => {
    it("collapses control characters and whitespace", () => {
        expect(sanitizeKeyComment("  dbackup\t\r\n  prod  ")).toBe("dbackup prod");
    });

    it("caps the length", () => {
        expect(sanitizeKeyComment("x".repeat(400))).toHaveLength(120);
    });
});

describe("readPublicKey", () => {
    it("derives the public half of a pasted key", async () => {
        const generated = await generateSshKeyPair("ed25519", "dbackup@prod");
        const derived = readPublicKey(generated.privateKey);

        expect(derived?.publicKey).toBe(generated.publicKey);
        expect(derived?.fingerprint).toBe(generated.fingerprint);
    });

    it("returns null for something that is not a key", () => {
        expect(readPublicKey("not a key")).toBeNull();
    });

    it("reads a passphrase-protected key only with its passphrase", () => {
        const encrypted = sshUtils.generateKeyPairSync("ed25519", {
            comment: "dbackup@prod",
            passphrase: "correct horse",
            cipher: "aes256-cbc",
            rounds: 1,
        });

        expect(readPublicKey(encrypted.private)).toBeNull();
        expect(readPublicKey(encrypted.private, "wrong")).toBeNull();
        expect(readPublicKey(encrypted.private, "correct horse")?.publicKey).toBe(
            encrypted.public
        );
    });
});

describe("sshFingerprint", () => {
    it("matches the fingerprint reported for the generated key", async () => {
        const generated = await generateSshKeyPair("ed25519", "dbackup@prod");
        expect(sshFingerprint(generated.publicKey)).toBe(generated.fingerprint);
    });

    it("ignores the comment", async () => {
        const generated = await generateSshKeyPair("ed25519", "dbackup@prod");
        const [algorithm, blob] = generated.publicKey.split(" ");
        expect(sshFingerprint(`${algorithm} ${blob}`)).toBe(generated.fingerprint);
    });

    it("returns null for a line without key material", () => {
        expect(sshFingerprint("ssh-ed25519")).toBeNull();
        expect(sshFingerprint("")).toBeNull();
    });
});
