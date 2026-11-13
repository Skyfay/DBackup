import { generateKeyPairSync } from "crypto";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/logging/logger", () => {
    const child = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
    return { logger: { ...child, child: () => child } };
});

import { ValidationError } from "@/lib/logging/errors";
import { connectSFTP } from "@/lib/adapters/storage/sftp";
import { assertKeyCost, assertPkcs8Cost, encryptedPkcs8Der, MAX_BCRYPT_ROUNDS, MAX_PBKDF2_ITERATIONS, MAX_PRIVATE_KEY_CHARS } from "@/lib/transport/key-cost";
import { generateSshKeyPair, readPublicKey } from "@/lib/transport/openssh-key";
import { normalizeSshPrivateKey } from "@/lib/transport/pkcs8-compat";
import { buildConnectConfig } from "@/lib/transport/ssh-connection";

// ---------------------------------------------------------------------------
// Key builders. Every key here is made up for the test and opens nothing.
// ---------------------------------------------------------------------------

const u32 = (value: number) => {
    const buf = Buffer.alloc(4);
    buf.writeUInt32BE(value);
    return buf;
};
const sshString = (value: Buffer | string) => {
    const bytes = Buffer.isBuffer(value) ? value : Buffer.from(value);
    return Buffer.concat([u32(bytes.length), bytes]);
};

function opensshArmor(data: Buffer): string {
    const body = data.toString("base64").match(/.{1,70}/g)!.join("\n");
    return `-----BEGIN OPENSSH PRIVATE KEY-----\n${body}\n-----END OPENSSH PRIVATE KEY-----\n`;
}

/** The bytes of an OpenSSH key whose header names `rounds` bcrypt rounds, like the one of the audit. */
function opensshBytes(rounds: number): Buffer {
    const publicBlob = Buffer.concat([sshString("ssh-ed25519"), sshString(Buffer.alloc(32, 7))]);
    return Buffer.concat([
        Buffer.from("openssh-key-v1\0"),
        sshString("aes256-ctr"),
        sshString("bcrypt"),
        sshString(Buffer.concat([sshString(Buffer.alloc(16, 1)), u32(rounds)])),
        u32(1),
        sshString(publicBlob),
        sshString(Buffer.alloc(16, 2)),
    ]);
}
const opensshKeyWithRounds = (rounds: number) => opensshArmor(opensshBytes(rounds));

function der(tag: number, ...parts: Buffer[]): Buffer {
    const content = Buffer.concat(parts);
    if (content.length < 0x80) return Buffer.concat([Buffer.from([tag, content.length]), content]);
    const length = Buffer.alloc(2);
    length.writeUInt16BE(content.length);
    return Buffer.concat([Buffer.from([tag, 0x82]), length, content]);
}
const seq = (...parts: Buffer[]) => der(0x30, ...parts);
const oid = (hex: string) => der(0x06, Buffer.from(hex, "hex"));
const octets = (length: number) => der(0x04, Buffer.alloc(length, 3));
function int(value: number): Buffer {
    let hex = value.toString(16);
    if (hex.length % 2) hex = `0${hex}`;
    if (parseInt(hex.slice(0, 2), 16) & 0x80) hex = `00${hex}`;
    return der(0x02, Buffer.from(hex, "hex"));
}
const pem = (bytes: Buffer) =>
    `-----BEGIN ENCRYPTED PRIVATE KEY-----\n${bytes.toString("base64").match(/.{1,64}/g)!.join("\n")}\n-----END ENCRYPTED PRIVATE KEY-----\n`;

const PBES2 = "2a864886f70d01050d";
const PBKDF2 = "2a864886f70d01050c";
const SCRYPT = "2b06010401da47040b";
const AES_256_CBC = seq(oid("60864801650304012a"), octets(16));

/** An ENCRYPTED PRIVATE KEY whose PBKDF2 parameters hold `count` as the iteration count. */
const pbkdf2KeyOf = (count: Buffer) =>
    pem(seq(seq(oid(PBES2), seq(seq(oid(PBKDF2), seq(octets(8), count)), AES_256_CBC)), octets(48)));
const pbkdf2Key = (iterations: number) => pbkdf2KeyOf(int(iterations));

/** An ENCRYPTED PRIVATE KEY that names the scrypt parameters N, r and p. */
const scryptKey = (n: number, r: number, p: number) =>
    pem(seq(seq(oid(PBES2), seq(seq(oid(SCRYPT), seq(octets(8), int(n), int(r), int(p))), AES_256_CBC)), octets(48)));

/** Runs `fn` and answers what it threw with the time it took. */
function refusal(fn: () => unknown): { error: unknown; ms: number } {
    const start = performance.now();
    try {
        fn();
    } catch (error) {
        return { error, ms: performance.now() - start };
    }
    throw new Error("Expected a refusal");
}

/** Far below the minutes the derivation of such a key takes, far above a header read. */
const NO_DERIVATION_MS = 1000;

const ssh = (privateKey: string, passphrase = "x") =>
    ({ host: "ssh.example.test", port: 22, username: "backup", authType: "privateKey", privateKey, passphrase }) as const;

describe("a pasted SSH key cannot stall the server with the derivation cost it names", () => {
    const costly = opensshKeyWithRounds(100_000);

    it("refuses an OpenSSH key of 100000 bcrypt rounds when a credential profile reads its public key", () => {
        const { error, ms } = refusal(() => readPublicKey(costly, "x"));
        expect(error).toBeInstanceOf(ValidationError);
        expect((error as Error).message).toContain("bcrypt rounds");
        expect(ms).toBeLessThan(NO_DERIVATION_MS);
    });

    it("refuses it when an SSH connection, test or run builds its connect config", () => {
        const { error, ms } = refusal(() => buildConnectConfig(ssh(costly)));
        expect(error).toBeInstanceOf(ValidationError);
        expect(ms).toBeLessThan(NO_DERIVATION_MS);
    });

    it("refuses it when an SFTP or rsync destination connects, before any dial", async () => {
        const start = performance.now();
        await expect(
            connectSFTP({ host: "sftp.example.test", port: 22, username: "backup", privateKey: costly, passphrase: "x" })
        ).rejects.toBeInstanceOf(ValidationError);
        expect(performance.now() - start).toBeLessThan(NO_DERIVATION_MS);
    });

    it("refuses the largest count a key can name", () => {
        expect(refusal(() => assertKeyCost(opensshKeyWithRounds(0xffffffff))).error).toBeInstanceOf(ValidationError);
    });

    it("refuses a key whose header ends before its rounds", () => {
        const cut = opensshArmor(opensshBytes(16).subarray(0, 60));
        expect(refusal(() => assertKeyCost(cut)).error).toBeInstanceOf(ValidationError);
    });

    it("lets a key at the limit and what ssh-keygen writes pass the check", () => {
        expect(() => assertKeyCost(opensshKeyWithRounds(16))).not.toThrow();
        expect(() => assertKeyCost(opensshKeyWithRounds(MAX_BCRYPT_ROUNDS))).not.toThrow();
        expect(refusal(() => assertKeyCost(opensshKeyWithRounds(MAX_BCRYPT_ROUNDS + 1))).error).toBeInstanceOf(ValidationError);
    });

    it("still reads a passphrase-protected key DBackup generated", async () => {
        const key = await generateSshKeyPair("ed25519", "test", "correct horse");
        expect(readPublicKey(key.privateKey, "correct horse")?.fingerprint).toBe(key.fingerprint);
        expect(buildConnectConfig(ssh(key.privateKey, "correct horse")).privateKey).toBe(key.privateKey);
    });

    it("refuses a key longer than any real key", () => {
        expect(refusal(() => assertKeyCost("A".repeat(MAX_PRIVATE_KEY_CHARS + 1))).error).toBeInstanceOf(ValidationError);
    });
});

describe("an encrypted PKCS#8 key cannot name a derivation above the limits", () => {
    /** The check `normalizeSshPrivateKey` runs before Node decrypts the key. */
    const checkCost = (key: string) => assertPkcs8Cost(encryptedPkcs8Der(key));

    it("refuses 2000000 PBKDF2 iterations in the connect config, the conversion", () => {
        const key = pbkdf2Key(2_000_000);
        const built = refusal(() => buildConnectConfig(ssh(key)));
        expect(built.error).toBeInstanceOf(ValidationError);
        expect((built.error as Error).message).toContain("PBKDF2");
        expect(refusal(() => normalizeSshPrivateKey(key, "x")).error).toBeInstanceOf(ValidationError);
    });

    it("refuses it when an SFTP or rsync destination connects, before any dial", async () => {
        await expect(
            connectSFTP({ host: "sftp.example.test", port: 22, username: "backup", privateKey: pbkdf2Key(2_000_000), passphrase: "x" })
        ).rejects.toBeInstanceOf(ValidationError);
    });

    it("refuses a count too large to hold in a number", () => {
        const huge = pbkdf2KeyOf(der(0x02, Buffer.alloc(9, 0x7f)));
        expect(refusal(() => checkCost(huge)).error).toBeInstanceOf(ValidationError);
    });

    it("refuses scrypt parameters above the limit and lets the ones OpenSSL writes pass", () => {
        expect(() => checkCost(scryptKey(16384, 8, 1))).not.toThrow();
        expect(refusal(() => checkCost(scryptKey(16384, 8, 1000))).error).toBeInstanceOf(ValidationError);
        expect(refusal(() => checkCost(scryptKey(2 ** 30, 8, 1))).error).toBeInstanceOf(ValidationError);
    });

    it("refuses a derivation whose cost it cannot read", () => {
        const unknown = pem(seq(seq(oid("2a0304"), seq(octets(8), int(1))), octets(48)));
        expect(refusal(() => checkCost(unknown)).error).toBeInstanceOf(ValidationError);
    });

    it("checks the block it decrypts, so a harmless second block hides nothing", () => {
        const text = `${pbkdf2Key(2_000_000)}${pbkdf2Key(2048)}`;
        expect(refusal(() => normalizeSshPrivateKey(text, "x")).error).toBeInstanceOf(ValidationError);
    });

    it("lets a count at the limit pass the check", () => {
        expect(() => checkCost(pbkdf2Key(MAX_PBKDF2_ITERATIONS))).not.toThrow();
    });

    it("answers a text of many BEGIN lines and no END line at once", () => {
        const starts = "-----BEGIN ENCRYPTED PRIVATE KEY-----a".repeat(1700);
        const began = Date.now();

        expect(() => encryptedPkcs8Der(starts)).toThrow(ValidationError);
        expect(Date.now() - began).toBeLessThan(100);
        expect(() => encryptedPkcs8Der(starts.repeat(4))).toThrow("too long");
    });

    it("still converts a key that OpenSSL encrypted with its defaults", () => {
        const { privateKey } = generateKeyPairSync("ed25519", {
            publicKeyEncoding: { type: "spki", format: "pem" },
            privateKeyEncoding: { type: "pkcs8", format: "pem", cipher: "aes-256-cbc", passphrase: "secret" },
        });
        expect(privateKey).toContain("BEGIN ENCRYPTED PRIVATE KEY");
        expect(normalizeSshPrivateKey(privateKey, "secret")).toContain("BEGIN OPENSSH PRIVATE KEY");
        expect(() => normalizeSshPrivateKey(privateKey, "wrong")).toThrow("Check your passphrase");
    });
});
