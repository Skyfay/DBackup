import { describe, it, expect, beforeAll } from "vitest";
import { generateKeyPairSync, createPrivateKey } from "crypto";
import { normalizeSshPrivateKey } from "@/lib/ssh/pkcs8-compat";

const PASSPHRASE = "testpass";
const WRONG_PASSPHRASE = "wrongpass";

let rsaEncryptedPem: string;
let ecEncryptedPem: string;
let ed25519EncryptedPem: string;

beforeAll(() => {
    const rsa = generateKeyPairSync("rsa", {
        modulusLength: 1024,
        privateKeyEncoding: {
            type: "pkcs8",
            format: "pem",
            cipher: "aes-256-cbc",
            passphrase: PASSPHRASE,
        },
    } as Parameters<typeof generateKeyPairSync>[1]);
    rsaEncryptedPem = rsa.privateKey as string;

    const ec = generateKeyPairSync("ec", {
        namedCurve: "P-256",
        privateKeyEncoding: {
            type: "pkcs8",
            format: "pem",
            cipher: "aes-256-cbc",
            passphrase: PASSPHRASE,
        },
    } as Parameters<typeof generateKeyPairSync>[1]);
    ecEncryptedPem = ec.privateKey as string;

    const ed = generateKeyPairSync("ed25519", {
        privateKeyEncoding: {
            type: "pkcs8",
            format: "pem",
            cipher: "aes-256-cbc",
            passphrase: PASSPHRASE,
        },
    } as Parameters<typeof generateKeyPairSync>[1]);
    ed25519EncryptedPem = ed.privateKey as string;
});

// ─── RSA ─────────────────────────────────────────────────────────────────────

describe("normalizeSshPrivateKey - RSA", () => {
    it("returns a PKCS#1 PEM for an encrypted RSA PKCS#8 key", () => {
        const result = normalizeSshPrivateKey(rsaEncryptedPem, PASSPHRASE);
        expect(result).toMatch(/^-----BEGIN RSA PRIVATE KEY-----/);
    });

    it("returned RSA key is parseable by createPrivateKey", () => {
        const result = normalizeSshPrivateKey(rsaEncryptedPem, PASSPHRASE);
        expect(() => createPrivateKey(result)).not.toThrow();
    });
});

// ─── EC ──────────────────────────────────────────────────────────────────────

describe("normalizeSshPrivateKey - EC", () => {
    it("returns a SEC1 PEM for an encrypted EC PKCS#8 key", () => {
        const result = normalizeSshPrivateKey(ecEncryptedPem, PASSPHRASE);
        expect(result).toMatch(/^-----BEGIN EC PRIVATE KEY-----/);
    });

    it("returned EC key is parseable by createPrivateKey", () => {
        const result = normalizeSshPrivateKey(ecEncryptedPem, PASSPHRASE);
        expect(() => createPrivateKey(result)).not.toThrow();
    });
});

// ─── Ed25519 ─────────────────────────────────────────────────────────────────

describe("normalizeSshPrivateKey - Ed25519", () => {
    it("returns an OpenSSH PEM for an encrypted Ed25519 PKCS#8 key", () => {
        const result = normalizeSshPrivateKey(ed25519EncryptedPem, PASSPHRASE);
        expect(result).toMatch(/^-----BEGIN OPENSSH PRIVATE KEY-----/);
        expect(result).toMatch(/-----END OPENSSH PRIVATE KEY-----\n?$/);
    });
});

// ─── Wrong passphrase ─────────────────────────────────────────────────────────

describe("normalizeSshPrivateKey - wrong passphrase", () => {
    it("throws with a message containing 'Failed to decrypt private key' for RSA", () => {
        expect(() => normalizeSshPrivateKey(rsaEncryptedPem, WRONG_PASSPHRASE)).toThrow(
            "Failed to decrypt private key"
        );
    });

    it("throws with a message containing 'Failed to decrypt private key' for EC", () => {
        expect(() => normalizeSshPrivateKey(ecEncryptedPem, WRONG_PASSPHRASE)).toThrow(
            "Failed to decrypt private key"
        );
    });

    it("throws with a message containing 'Failed to decrypt private key' for Ed25519", () => {
        expect(() => normalizeSshPrivateKey(ed25519EncryptedPem, WRONG_PASSPHRASE)).toThrow(
            "Failed to decrypt private key"
        );
    });
});
