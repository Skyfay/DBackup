/**
 * Per-entry AEAD sealing for the seekable archive format.
 *
 * Unlike crypto/stream.ts, which encrypts one whole backup file as a single GCM stream,
 * this module seals each archive entry independently so any entry can be decrypted from
 * its byte range alone. That is what makes file-level restore possible without
 * downloading and decrypting the entire archive.
 *
 * Wire layout of a sealed entry:
 *
 *     ciphertext ‖ authTag(16)
 *
 * The tag is appended rather than stored out-of-band so an entry is a self-contained AEAD
 * block: an offset and a length are enough to open it, with nothing to look up elsewhere.
 * Because GCM is a stream cipher there is no padding, so the sealed length is always
 * exactly `plaintextLength + TAG_LENGTH` - see sealedSize(), which the archive writer
 * relies on to emit a tar header before it has produced the ciphertext.
 *
 * Nonces are derived, never random: `noncePrefix(4) ‖ uint64BE(ordinal)`. Combined with a
 * per-archive key (see kdf.ts) this makes (key, nonce) repetition impossible by
 * construction. Random nonces would only make it unlikely, and GCM nonce reuse is a total
 * break rather than a gradual weakening.
 */

import { Transform, TransformCallback } from "stream";
import crypto from "crypto";
import { EncryptionError } from "@/lib/logging/errors";

const ALGORITHM = "aes-256-gcm";

/** GCM authentication tag length in bytes. */
export const TAG_LENGTH = 16;

/** Nonce length in bytes. 12 is GCM's native size - other lengths go through GHASH derivation. */
export const NONCE_LENGTH = 12;

/** Length of the per-archive random nonce prefix in bytes. */
export const NONCE_PREFIX_LENGTH = 4;

/**
 * Ordinal reserved for the archive's index entry. Data entries start at 1, so the index
 * can never collide with a payload even though both are sealed with different subkeys.
 */
export const INDEX_ORDINAL = 0;

/** Generates a fresh per-archive nonce prefix. Stored in cleartext in the manifest. */
export function generateNoncePrefix(): Buffer {
    return crypto.randomBytes(NONCE_PREFIX_LENGTH);
}

/**
 * Builds the deterministic nonce for one entry.
 *
 * @param noncePrefix - The archive's 4-byte prefix
 * @param ordinal - Entry ordinal, unique within the archive (0 = index, data starts at 1)
 */
export function buildNonce(noncePrefix: Buffer, ordinal: number): Buffer {
    if (noncePrefix.length !== NONCE_PREFIX_LENGTH) {
        throw new Error(`Invalid nonce prefix length: ${noncePrefix.length}. Must be ${NONCE_PREFIX_LENGTH} bytes.`);
    }
    if (!Number.isInteger(ordinal) || ordinal < 0) {
        throw new Error(`Invalid entry ordinal: ${ordinal}. Must be a non-negative integer.`);
    }

    const nonce = Buffer.alloc(NONCE_LENGTH);
    noncePrefix.copy(nonce, 0);
    nonce.writeBigUInt64BE(BigInt(ordinal), NONCE_PREFIX_LENGTH);
    return nonce;
}

/**
 * Sealed byte length for a given plaintext length. GCM adds no padding, so this is exact -
 * the archive writer uses it to size a tar header before streaming the ciphertext.
 */
export function sealedSize(plaintextSize: number): number {
    return plaintextSize + TAG_LENGTH;
}

/** Plaintext byte length for a given sealed length. Inverse of sealedSize(). */
export function plaintextSize(sealed: number): number {
    return sealed - TAG_LENGTH;
}

function assertKey(key: Buffer): void {
    if (key.length !== 32) {
        throw new Error(`Invalid key length: ${key.length}. Key must be 32 bytes for ${ALGORITHM}.`);
    }
}

/**
 * Transform stream that encrypts an entry and appends its authentication tag.
 *
 * @param key - The archive's data or index subkey, from deriveArchiveKeys()
 * @param noncePrefix - The archive's nonce prefix
 * @param ordinal - This entry's ordinal, unique within the archive
 */
export function sealEntry(key: Buffer, noncePrefix: Buffer, ordinal: number): Transform {
    assertKey(key);
    const cipher = crypto.createCipheriv(ALGORITHM, key, buildNonce(noncePrefix, ordinal));

    return new Transform({
        transform(chunk: Buffer, _encoding, callback: TransformCallback) {
            try {
                callback(null, cipher.update(chunk));
            } catch (e: unknown) {
                callback(new EncryptionError("encrypt", `Failed to seal archive entry ${ordinal}`, { cause: e as Error }));
            }
        },
        flush(callback: TransformCallback) {
            try {
                this.push(cipher.final());
                this.push(cipher.getAuthTag());
                callback();
            } catch (e: unknown) {
                callback(new EncryptionError("encrypt", `Failed to finalize archive entry ${ordinal}`, { cause: e as Error }));
            }
        },
    });
}

/**
 * Transform stream that verifies and decrypts a sealed entry.
 *
 * The trailing 16 bytes of the input are the authentication tag, which is only known once
 * the stream ends. The implementation therefore holds back a rolling 16-byte tail and
 * feeds everything before it to the decipher. Authentication failures surface as a stream
 * error on flush, so a truncated or tampered entry can never yield partial plaintext that
 * a caller mistakes for a successful restore.
 *
 * @param key - The archive's data or index subkey, from deriveArchiveKeys()
 * @param noncePrefix - The archive's nonce prefix, from the manifest
 * @param ordinal - The entry's ordinal, from the index
 */
export function openEntry(key: Buffer, noncePrefix: Buffer, ordinal: number): Transform {
    assertKey(key);
    const decipher = crypto.createDecipheriv(ALGORITHM, key, buildNonce(noncePrefix, ordinal));
    // The held-back tail is always a copy, never a view. Both `chunk` and any subarray of
    // it share memory the stream is free to reuse for the next read, and the tail has to
    // survive until flush.
    let tail: Buffer = Buffer.alloc(0);

    return new Transform({
        transform(chunk: Buffer, _encoding, callback: TransformCallback) {
            const buffered = tail.length > 0 ? Buffer.concat([tail, chunk]) : chunk;

            // Everything except the trailing TAG_LENGTH bytes is certain to be ciphertext.
            // The tail may still turn out to be the tag, so it is held back until flush.
            if (buffered.length <= TAG_LENGTH) {
                tail = Buffer.copyBytesFrom(buffered);
                callback();
                return;
            }

            const splitAt = buffered.length - TAG_LENGTH;
            tail = Buffer.copyBytesFrom(buffered.subarray(splitAt));

            try {
                callback(null, decipher.update(buffered.subarray(0, splitAt)));
            } catch (e: unknown) {
                callback(new EncryptionError("decrypt", `Failed to decrypt archive entry ${ordinal}`, { cause: e as Error }));
            }
        },
        flush(callback: TransformCallback) {
            if (tail.length !== TAG_LENGTH) {
                callback(new EncryptionError(
                    "decrypt",
                    `Archive entry ${ordinal} is truncated: expected a ${TAG_LENGTH}-byte authentication tag, got ${tail.length}`
                ));
                return;
            }

            try {
                decipher.setAuthTag(tail);
                this.push(decipher.final());
                callback();
            } catch (e: unknown) {
                callback(new EncryptionError(
                    "decrypt",
                    `Authentication failed for archive entry ${ordinal} - the data is corrupt or was tampered with`,
                    { cause: e as Error }
                ));
            }
        },
    });
}
