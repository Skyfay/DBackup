import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

// AES-256-GCM requires a 64-char hex key (32 bytes)
const VALID_KEY = "a".repeat(64);

describe("encrypt / decrypt (AES-256-GCM)", () => {
    beforeEach(() => {
        vi.stubEnv("ENCRYPTION_KEY", VALID_KEY);
    });

    afterEach(() => {
        vi.unstubAllEnvs();
    });

    // Fresh import per test so the module re-reads ENCRYPTION_KEY from env
    async function getCrypto() {
        vi.resetModules();
        return import("@/lib/crypto");
    }

    describe("round-trip correctness", () => {
        it("decrypts to the original plaintext", async () => {
            const { encrypt, decrypt } = await getCrypto();
            const plaintext = "super-secret-password";
            expect(decrypt(encrypt(plaintext))).toBe(plaintext);
        });

        it("round-trips a full JSON credential payload", async () => {
            const { encrypt, decrypt } = await getCrypto();
            const payload = JSON.stringify({
                username: "admin",
                password: "s3cr3t!",
            });
            expect(decrypt(encrypt(payload))).toBe(payload);
        });

        it("produces different ciphertext each call (random IV)", async () => {
            const { encrypt } = await getCrypto();
            const c1 = encrypt("same");
            const c2 = encrypt("same");
            expect(c1).not.toBe(c2);
        });

        it("encodes output as iv:authTag:ciphertext (3 colon-separated hex segments)", async () => {
            const { encrypt } = await getCrypto();
            const parts = encrypt("x").split(":");
            expect(parts).toHaveLength(3);
            // Each segment must be non-empty hex
            for (const p of parts) {
                expect(p).toMatch(/^[0-9a-f]+$/);
            }
        });
    });

    describe("passthrough behaviour", () => {
        it("encrypt returns empty string unchanged", async () => {
            const { encrypt } = await getCrypto();
            expect(encrypt("")).toBe("");
        });

        it("decrypt returns empty string unchanged", async () => {
            const { decrypt } = await getCrypto();
            expect(decrypt("")).toBe("");
        });

        it("decrypt returns text that does not look encrypted (no 2 colons)", async () => {
            const { decrypt } = await getCrypto();
            expect(decrypt("plain-text")).toBe("plain-text");
        });
    });

    describe("tamper detection", () => {
        it("throws when the auth-tag is corrupted", async () => {
            const { encrypt, decrypt } = await getCrypto();
            const cipher = encrypt("sensitive");
            const parts = cipher.split(":");
            // Flip the first byte of the auth-tag
            const tagBuf = Buffer.from(parts[1], "hex");
            tagBuf[0] ^= 0xff;
            const tampered = `${parts[0]}:${tagBuf.toString("hex")}:${parts[2]}`;
            expect(() => decrypt(tampered)).toThrow();
        });

        it("throws when the ciphertext payload is modified", async () => {
            const { encrypt, decrypt } = await getCrypto();
            const cipher = encrypt("sensitive");
            const parts = cipher.split(":");
            // Flip the first byte of the ciphertext
            const ctBuf = Buffer.from(parts[2], "hex");
            ctBuf[0] ^= 0xff;
            const tampered = `${parts[0]}:${parts[1]}:${ctBuf.toString("hex")}`;
            expect(() => decrypt(tampered)).toThrow();
        });

        it("throws when the IV is replaced", async () => {
            const { encrypt, decrypt } = await getCrypto();
            const cipher = encrypt("sensitive");
            const parts = cipher.split(":");
            // Replace IV with all-zero bytes of same length
            const zeroIv = "0".repeat(parts[0].length);
            const tampered = `${zeroIv}:${parts[1]}:${parts[2]}`;
            expect(() => decrypt(tampered)).toThrow();
        });
    });

    describe("key validation", () => {
        it("throws EncryptionError when ENCRYPTION_KEY is not set", async () => {
            vi.stubEnv("ENCRYPTION_KEY", "");
            const { encrypt } = await getCrypto();
            expect(() => encrypt("x")).toThrow("ENCRYPTION_KEY environment variable is not set");
        });

        it("throws EncryptionError when ENCRYPTION_KEY is too short", async () => {
            vi.stubEnv("ENCRYPTION_KEY", "deadbeef");
            const { encrypt } = await getCrypto();
            expect(() => encrypt("x")).toThrow("64-character hex string");
        });

        it("throws EncryptionError when ENCRYPTION_KEY is too long", async () => {
            vi.stubEnv("ENCRYPTION_KEY", "a".repeat(128));
            const { encrypt } = await getCrypto();
            expect(() => encrypt("x")).toThrow("64-character hex string");
        });
    });

    describe("cross-key isolation", () => {
        it("decrypt throws when the key changes after encryption", async () => {
            const { encrypt } = await getCrypto();
            const cipher = encrypt("secret");

            // Switch to a different valid key
            vi.stubEnv("ENCRYPTION_KEY", "b".repeat(64));
            const { decrypt } = await getCrypto();
            expect(() => decrypt(cipher)).toThrow();
        });
    });

    describe("EncryptionError re-throw inside decrypt", () => {
        it("re-throws an EncryptionError thrown inside the try block (e.g. missing key)", async () => {
            vi.stubEnv("ENCRYPTION_KEY", "");
            const { decrypt } = await getCrypto();
            // "aaa:bbb:ccc" passes the outer format guard (3 parts), then getEncryptionKey()
            // throws an EncryptionError which must be re-thrown unchanged.
            expect(() => decrypt("aaa:bbb:ccc")).toThrow("ENCRYPTION_KEY environment variable is not set");
        });
    });
});

describe("stripSecrets", () => {
    async function getCrypto() {
        vi.resetModules();
        return import("@/lib/crypto");
    }

    it("passes through null unchanged", async () => {
        const { stripSecrets } = await getCrypto();
        expect(stripSecrets(null)).toBeNull();
    });

    it("passes through a primitive value unchanged", async () => {
        const { stripSecrets } = await getCrypto();
        expect(stripSecrets("plain")).toBe("plain");
        expect(stripSecrets(42)).toBe(42);
    });

    it("replaces known sensitive string fields with an empty string", async () => {
        const { stripSecrets } = await getCrypto();
        const result = stripSecrets({ password: "secret", host: "localhost" });
        expect(result.password).toBe("");
        expect(result.host).toBe("localhost");
    });

    it("recursively strips sensitive fields in nested objects", async () => {
        const { stripSecrets } = await getCrypto();
        const result = stripSecrets({ db: { password: "hidden", port: 3306 } });
        expect(result.db.password).toBe("");
        expect(result.db.port).toBe(3306);
    });

    it("handles arrays containing objects with sensitive fields", async () => {
        const { stripSecrets } = await getCrypto();
        const result = stripSecrets([{ password: "a" }, { token: "b" }]);
        expect(result[0].password).toBe("");
        expect(result[1].token).toBe("");
    });

    it("does not mutate the original object", async () => {
        const { stripSecrets } = await getCrypto();
        const original = { password: "secret" };
        stripSecrets(original);
        expect(original.password).toBe("secret");
    });

    it("strips the newly added webhook/twilio/token sensitive keys", async () => {
        const { stripSecrets } = await getCrypto();
        const result = stripSecrets({
            authHeader: "Bearer abc",
            accountSid: "AC123",
            authToken: "tok",
            appToken: "app",
            botToken: "bot",
            accessToken: "acc",
            serverUrl: "https://example.com",
        });
        expect(result.authHeader).toBe("");
        expect(result.accountSid).toBe("");
        expect(result.authToken).toBe("");
        expect(result.appToken).toBe("");
        expect(result.botToken).toBe("");
        expect(result.accessToken).toBe("");
        expect(result.serverUrl).toBe("https://example.com");
    });
});

describe("mergeSecrets", () => {
    async function getCrypto() {
        vi.resetModules();
        return import("@/lib/crypto");
    }

    it("keeps the existing secret when the incoming value is empty", async () => {
        const { mergeSecrets } = await getCrypto();
        const result = mergeSecrets(
            { host: "new-host", password: "" },
            { host: "old-host", password: "real-secret" }
        );
        expect(result.host).toBe("new-host");
        expect(result.password).toBe("real-secret");
    });

    it("restores a secret that is absent from incoming (DTO redacts the key)", async () => {
        const { mergeSecrets } = await getCrypto();
        const result = mergeSecrets({ host: "h" }, { host: "h", refreshToken: "rt" });
        // The list DTO removes secret keys, so an untouched secret is omitted on
        // re-submit and must be restored from the existing config.
        expect(result.refreshToken).toBe("rt");
    });

    it("does not restore an absent non-sensitive key", async () => {
        const { mergeSecrets } = await getCrypto();
        const result = mergeSecrets({ host: "h" }, { host: "h", region: "eu" });
        expect(result.region).toBeUndefined();
    });

    it("overwrites the existing secret when a non-empty value is supplied", async () => {
        const { mergeSecrets } = await getCrypto();
        const result = mergeSecrets(
            { clientSecret: "new-secret" },
            { clientSecret: "old-secret" }
        );
        expect(result.clientSecret).toBe("new-secret");
    });

    it("merges nested objects recursively", async () => {
        const { mergeSecrets } = await getCrypto();
        const result = mergeSecrets(
            { db: { host: "h", password: "" } },
            { db: { host: "old", password: "kept" } }
        );
        expect(result.db.password).toBe("kept");
        expect(result.db.host).toBe("h");
    });

    it("returns incoming verbatim when existing is not an object", async () => {
        const { mergeSecrets } = await getCrypto();
        expect(mergeSecrets({ password: "" }, null)).toEqual({ password: "" });
    });
});

describe("redactSecrets / getSecretStatus", () => {
    async function getCrypto() {
        vi.resetModules();
        return import("@/lib/crypto");
    }

    it("removes scalar secret keys entirely (not blanked to \"\")", async () => {
        const { redactSecrets } = await getCrypto();
        const result = redactSecrets({ host: "h", password: "secret", clientSecret: "cs" });
        expect(result).toEqual({ host: "h" });
        expect("password" in result).toBe(false);
        expect("clientSecret" in result).toBe(false);
    });

    it("recurses into nested objects and arrays", async () => {
        const { redactSecrets } = await getCrypto();
        const result = redactSecrets({ db: { port: 5432, password: "x" }, list: [{ token: "t", id: 1 }] });
        expect(result.db).toEqual({ port: 5432 });
        expect(result.list[0]).toEqual({ id: 1 });
    });

    it("reports which secrets are set via getSecretStatus", async () => {
        const { getSecretStatus } = await getCrypto();
        const status = getSecretStatus({
            host: "h",
            clientSecret: "cs",
            refreshToken: "",
            password: "pw",
        });
        expect(status).toEqual({ clientSecret: true, refreshToken: false, password: true });
        expect("host" in status).toBe(false);
    });
});

describe("encryptConfig / decryptConfig", () => {
    const VALID_KEY = "a".repeat(64);

    beforeEach(() => {
        vi.stubEnv("ENCRYPTION_KEY", VALID_KEY);
    });

    afterEach(() => {
        vi.unstubAllEnvs();
    });

    async function getCrypto() {
        vi.resetModules();
        return import("@/lib/crypto");
    }

    it("encryptConfig passes through null unchanged", async () => {
        const { encryptConfig } = await getCrypto();
        expect(encryptConfig(null)).toBeNull();
    });

    it("decryptConfig passes through a primitive value unchanged", async () => {
        const { decryptConfig } = await getCrypto();
        expect(decryptConfig(42)).toBe(42);
        expect(decryptConfig(null)).toBeNull();
    });

    it("encrypts sensitive fields while leaving non-sensitive ones intact", async () => {
        const { encryptConfig } = await getCrypto();
        const result = encryptConfig({ password: "secret", host: "localhost" });
        expect(result.host).toBe("localhost");
        expect(result.password).not.toBe("secret");
        expect(result.password.split(":")).toHaveLength(3);
    });

    it("round-trips a flat config via encryptConfig + decryptConfig", async () => {
        const { encryptConfig, decryptConfig } = await getCrypto();
        const config = { password: "s3cr3t", host: "db.example.com", port: 5432 };
        expect(decryptConfig(encryptConfig(config))).toEqual(config);
    });

    it("round-trips a deeply nested config", async () => {
        const { encryptConfig, decryptConfig } = await getCrypto();
        const config = { credentials: { password: "pw", token: "tok" }, host: "h" };
        expect(decryptConfig(encryptConfig(config))).toEqual(config);
    });

    it("round-trips an array of configs", async () => {
        const { encryptConfig, decryptConfig } = await getCrypto();
        const configs = [{ password: "alpha" }, { token: "beta" }];
        expect(decryptConfig(encryptConfig(configs))).toEqual(configs);
    });

    it("does not mutate the original config object", async () => {
        const { encryptConfig } = await getCrypto();
        const original = { password: "secret" };
        encryptConfig(original);
        expect(original.password).toBe("secret");
    });
});

describe("encrypt - unexpected error wrapping", () => {
    afterEach(() => {
        vi.unstubAllEnvs();
    });

    async function getCrypto() {
        vi.resetModules();
        return import("@/lib/crypto");
    }

    it("wraps non-EncryptionError as EncryptionError when the hex key decodes to wrong length", async () => {
        // "g".repeat(64) is 64 chars (passes the length check) but contains no valid hex digits,
        // so Buffer.from(..., 'hex') returns an empty Buffer. createCipheriv then throws
        // a raw Error (not an EncryptionError), which must be wrapped by the catch block.
        vi.stubEnv("ENCRYPTION_KEY", "g".repeat(64));
        const { encrypt } = await getCrypto();
        expect(() => encrypt("x")).toThrow("Failed to encrypt data");
    });
});
