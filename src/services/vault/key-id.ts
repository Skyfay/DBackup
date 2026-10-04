import crypto from "crypto";

/**
 * The Key ID of an encryption key: the first 8 characters of the SHA-256 of its 32 bytes, as two
 * groups of four like "8a2f 91c3".
 *
 * It tells two keys apart, or an imported key from the one it came from, without showing either.
 * Anyone holding the key can check it with `xxd -r -p <<< $KEY | sha256sum`. Eight characters of a
 * hash say nothing about a random 256-bit key.
 */
export function keyIdOf(keyHex: string): string {
    const digest = crypto.createHash("sha256").update(Buffer.from(keyHex.trim(), "hex")).digest("hex");
    return `${digest.slice(0, 4)} ${digest.slice(4, 8)}`;
}

/** Whether a text is a key the Vault takes: 64 hex characters, 256 bits. */
export function isKeyHex(value: string): boolean {
    return /^[0-9a-fA-F]{64}$/.test(value.trim());
}
