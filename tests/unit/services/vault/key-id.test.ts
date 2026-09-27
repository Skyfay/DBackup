import { describe, expect, it } from "vitest";
import { isKeyHex, keyIdOf } from "@/services/vault/key-id";

describe("keyIdOf", () => {
    it("is the start of the SHA-256 of the 32 bytes of the key, in two groups", () => {
        // sha256 of 32 zero bytes is 66687aad f862bd77...
        expect(keyIdOf("00".repeat(32))).toBe("6668 7aad");
    });

    it("reads a key the same in either case and with spaces around it", () => {
        const key = "8A2F".repeat(16);
        expect(keyIdOf(` ${key} `)).toBe(keyIdOf(key.toLowerCase()));
    });
});

describe("isKeyHex", () => {
    it("takes 64 hex characters and nothing else", () => {
        expect(isKeyHex("ab".repeat(32))).toBe(true);
        expect(isKeyHex("ab".repeat(31))).toBe(false);
        expect(isKeyHex("zz".repeat(32))).toBe(false);
    });
});
