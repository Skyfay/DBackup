import { describe, it, expect } from "vitest";
import crypto from "crypto";
import { Readable } from "stream";
import { pipeline } from "stream/promises";
import { deriveArchiveKeys, generateKdfSalt, KDF_SALT_LENGTH } from "@/lib/crypto/kdf";
import {
    sealEntry,
    openEntry,
    buildNonce,
    generateNoncePrefix,
    sealedSize,
    plaintextSize,
    TAG_LENGTH,
    NONCE_LENGTH,
    NONCE_PREFIX_LENGTH,
    INDEX_ORDINAL,
} from "@/lib/crypto/entry-cipher";

const MASTER_KEY = Buffer.alloc(32, 0xab);
const SALT = Buffer.alloc(32, 0xcd);

async function collect(stream: NodeJS.ReadableStream): Promise<Buffer> {
    const chunks: Buffer[] = [];
    for await (const chunk of stream) chunks.push(chunk as Buffer);
    return Buffer.concat(chunks);
}

async function seal(key: Buffer, prefix: Buffer, ordinal: number, plaintext: Buffer): Promise<Buffer> {
    return collect(Readable.from([plaintext]).pipe(sealEntry(key, prefix, ordinal)));
}

async function open(key: Buffer, prefix: Buffer, ordinal: number, sealedBytes: Buffer): Promise<Buffer> {
    return collect(Readable.from([sealedBytes]).pipe(openEntry(key, prefix, ordinal)));
}

describe("deriveArchiveKeys", () => {
    it("derives two distinct 32-byte subkeys", () => {
        const { dataKey, indexKey } = deriveArchiveKeys(MASTER_KEY, SALT);

        expect(dataKey).toHaveLength(32);
        expect(indexKey).toHaveLength(32);
        expect(dataKey.equals(indexKey)).toBe(false);
        // Neither subkey may be the master key itself - that would defeat the whole point.
        expect(dataKey.equals(MASTER_KEY)).toBe(false);
        expect(indexKey.equals(MASTER_KEY)).toBe(false);
    });

    it("is deterministic for the same master key and salt", () => {
        const a = deriveArchiveKeys(MASTER_KEY, SALT);
        const b = deriveArchiveKeys(MASTER_KEY, SALT);

        expect(a.dataKey.equals(b.dataKey)).toBe(true);
        expect(a.indexKey.equals(b.indexKey)).toBe(true);
    });

    it("produces different keys for a different salt", () => {
        const a = deriveArchiveKeys(MASTER_KEY, SALT);
        const b = deriveArchiveKeys(MASTER_KEY, Buffer.alloc(32, 0xef));

        expect(a.dataKey.equals(b.dataKey)).toBe(false);
        expect(a.indexKey.equals(b.indexKey)).toBe(false);
    });

    it("matches a known-answer vector so the Recovery Kit can be verified independently", () => {
        // Locked-in output for masterKey=0xab*32, salt=0xcd*32. A change here means every
        // existing archive became undecryptable - it must never happen accidentally.
        const { dataKey, indexKey } = deriveArchiveKeys(MASTER_KEY, SALT);
        const expectedData = Buffer.from(
            crypto.hkdfSync("sha256", MASTER_KEY, SALT, Buffer.from("dbackup/archive/v2/data", "utf-8"), 32)
        );
        const expectedIndex = Buffer.from(
            crypto.hkdfSync("sha256", MASTER_KEY, SALT, Buffer.from("dbackup/archive/v2/index", "utf-8"), 32)
        );

        expect(dataKey.toString("hex")).toBe(expectedData.toString("hex"));
        expect(indexKey.toString("hex")).toBe(expectedIndex.toString("hex"));
    });

    it("rejects a wrong-sized master key or salt", () => {
        expect(() => deriveArchiveKeys(Buffer.alloc(16), SALT)).toThrow(/master key length/i);
        expect(() => deriveArchiveKeys(MASTER_KEY, Buffer.alloc(8))).toThrow(/salt length/i);
    });

    it("generates a salt of the documented length", () => {
        expect(generateKdfSalt()).toHaveLength(KDF_SALT_LENGTH);
        expect(generateKdfSalt().equals(generateKdfSalt())).toBe(false);
    });
});

describe("buildNonce", () => {
    const prefix = Buffer.from([0x01, 0x02, 0x03, 0x04]);

    it("concatenates the prefix with a big-endian ordinal", () => {
        expect(buildNonce(prefix, 1).toString("hex")).toBe("010203040000000000000001");
        expect(buildNonce(prefix, INDEX_ORDINAL).toString("hex")).toBe("010203040000000000000000");
        expect(buildNonce(prefix, 0x0102).toString("hex")).toBe("010203040000000000000102");
    });

    it("always produces GCM's native 12-byte nonce", () => {
        expect(buildNonce(prefix, 999)).toHaveLength(NONCE_LENGTH);
        expect(prefix).toHaveLength(NONCE_PREFIX_LENGTH);
    });

    it("never repeats a nonce across ordinals within an archive", () => {
        const seen = new Set<string>();
        for (let ordinal = 0; ordinal < 5000; ordinal++) {
            seen.add(buildNonce(prefix, ordinal).toString("hex"));
        }
        expect(seen.size).toBe(5000);
    });

    it("rejects an invalid prefix or ordinal", () => {
        expect(() => buildNonce(Buffer.alloc(8), 1)).toThrow(/prefix length/i);
        expect(() => buildNonce(prefix, -1)).toThrow(/ordinal/i);
        expect(() => buildNonce(prefix, 1.5)).toThrow(/ordinal/i);
    });

    it("generates a prefix of the documented length", () => {
        expect(generateNoncePrefix()).toHaveLength(NONCE_PREFIX_LENGTH);
    });
});

describe("sealEntry / openEntry", () => {
    const { dataKey } = deriveArchiveKeys(MASTER_KEY, SALT);
    const prefix = Buffer.from([0xaa, 0xbb, 0xcc, 0xdd]);

    it("round-trips a payload", async () => {
        const plaintext = Buffer.from("SELECT * FROM users;\n".repeat(200), "utf-8");
        const sealedBytes = await seal(dataKey, prefix, 1, plaintext);

        expect(await open(dataKey, prefix, 1, sealedBytes)).toEqual(plaintext);
    });

    it("round-trips an empty payload", async () => {
        const sealedBytes = await seal(dataKey, prefix, 1, Buffer.alloc(0));

        expect(sealedBytes).toHaveLength(TAG_LENGTH);
        expect(await open(dataKey, prefix, 1, sealedBytes)).toEqual(Buffer.alloc(0));
    });

    it("round-trips a payload spread across many chunks", async () => {
        const plaintext = crypto.randomBytes(300_000);
        const chunks: Buffer[] = [];
        for (let i = 0; i < plaintext.length; i += 7919) {
            chunks.push(plaintext.subarray(i, i + 7919));
        }

        const sealedBytes = await collect(Readable.from(chunks).pipe(sealEntry(dataKey, prefix, 3)));
        const opened = await collect(Readable.from(sealedBytes).pipe(openEntry(dataKey, prefix, 3)));

        expect(opened.equals(plaintext)).toBe(true);
    });

    it("adds exactly TAG_LENGTH bytes, as sealedSize() promises", async () => {
        // The archive writer emits a tar header before producing ciphertext, so this
        // relationship has to hold exactly - GCM adds no padding.
        for (const size of [0, 1, 15, 16, 17, 4096, 65_537]) {
            const sealedBytes = await seal(dataKey, prefix, 1, crypto.randomBytes(size));
            expect(sealedBytes.length).toBe(sealedSize(size));
            expect(plaintextSize(sealedBytes.length)).toBe(size);
        }
    });

    it("fails when the payload was tampered with", async () => {
        const sealedBytes = await seal(dataKey, prefix, 1, Buffer.from("sensitive backup data"));
        const tampered = Buffer.from(sealedBytes);
        tampered[0] ^= 0xff;

        await expect(open(dataKey, prefix, 1, tampered)).rejects.toThrow(/authentication failed/i);
    });

    it("fails when the authentication tag was tampered with", async () => {
        const sealedBytes = await seal(dataKey, prefix, 1, Buffer.from("sensitive backup data"));
        const tampered = Buffer.from(sealedBytes);
        tampered[tampered.length - 1] ^= 0xff;

        await expect(open(dataKey, prefix, 1, tampered)).rejects.toThrow(/authentication failed/i);
    });

    it("fails when the entry is truncated instead of yielding partial plaintext", async () => {
        const sealedBytes = await seal(dataKey, prefix, 1, crypto.randomBytes(4096));

        await expect(open(dataKey, prefix, 1, sealedBytes.subarray(0, 2048)))
            .rejects.toThrow(/authentication failed/i);
        await expect(open(dataKey, prefix, 1, sealedBytes.subarray(0, TAG_LENGTH - 1)))
            .rejects.toThrow(/truncated/i);
    });

    it("fails when opened with the wrong ordinal", async () => {
        const sealedBytes = await seal(dataKey, prefix, 1, Buffer.from("entry one"));

        await expect(open(dataKey, prefix, 2, sealedBytes)).rejects.toThrow(/authentication failed/i);
    });

    it("fails when opened with the index subkey instead of the data subkey", async () => {
        const { indexKey } = deriveArchiveKeys(MASTER_KEY, SALT);
        const sealedBytes = await seal(dataKey, prefix, 1, Buffer.from("entry one"));

        await expect(open(indexKey, prefix, 1, sealedBytes)).rejects.toThrow(/authentication failed/i);
    });

    it("fails when opened with a key derived from a different archive salt", async () => {
        const other = deriveArchiveKeys(MASTER_KEY, Buffer.alloc(32, 0x11));
        const sealedBytes = await seal(dataKey, prefix, 1, Buffer.from("entry one"));

        await expect(open(other.dataKey, prefix, 1, sealedBytes)).rejects.toThrow(/authentication failed/i);
    });

    it("produces different ciphertext for identical plaintext at different ordinals", async () => {
        const plaintext = Buffer.from("identical content");
        const first = await seal(dataKey, prefix, 1, plaintext);
        const second = await seal(dataKey, prefix, 2, plaintext);

        expect(first.equals(second)).toBe(false);
    });

    it("rejects a wrong-sized key", () => {
        expect(() => sealEntry(Buffer.alloc(16), prefix, 1)).toThrow(/key length/i);
        expect(() => openEntry(Buffer.alloc(16), prefix, 1)).toThrow(/key length/i);
    });

    it("never leaks plaintext into the sealed bytes", async () => {
        const marker = "SUPER-SECRET-MARKER-9f3a";
        const sealedBytes = await seal(dataKey, prefix, 1, Buffer.from(`prefix ${marker} suffix`));

        expect(sealedBytes.toString("latin1")).not.toContain(marker);
    });

    it("surfaces a decryption failure as a pipeline error", async () => {
        const sealedBytes = await seal(dataKey, prefix, 1, crypto.randomBytes(1024));
        const tampered = Buffer.from(sealedBytes);
        tampered[100] ^= 0x01;

        const sink: Buffer[] = [];
        await expect(
            pipeline(
                Readable.from([tampered]),
                openEntry(dataKey, prefix, 1),
                async function* (source) {
                    for await (const chunk of source) sink.push(chunk as Buffer);
                }
            )
        ).rejects.toThrow(/authentication failed/i);
    });
});
