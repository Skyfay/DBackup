/**
 * Key derivation for the seekable archive format.
 *
 * Archives derive per-archive subkeys from the long-lived encryption profile master key
 * instead of using it directly. Two reasons, both load-bearing:
 *
 * 1. Nonce safety. The archive format encrypts every entry individually, so a single
 *    backup can consume hundreds of thousands of (key, nonce) pairs. NIST caps a single
 *    AES-GCM key at 2^32 invocations with random nonces, and nonce reuse under GCM is a
 *    total break (plaintext XOR recovery plus forgery), not a gradual weakening. A fresh
 *    key per archive combined with counter-based nonces (see entry-cipher.ts) makes
 *    repetition impossible by construction rather than merely unlikely.
 * 2. Blast radius. A leaked archive key exposes exactly one archive, never the profile.
 *
 * The salt is generated per archive and stored in cleartext in the archive's manifest, so
 * the Recovery Kit can re-derive both keys offline from the master key alone.
 */

import crypto from "crypto";

/** Length of the per-archive KDF salt in bytes. */
export const KDF_SALT_LENGTH = 32;

/** Required master key length in bytes (AES-256). */
const MASTER_KEY_LENGTH = 32;

/** Derived subkey length in bytes (AES-256). */
const DERIVED_KEY_LENGTH = 32;

/**
 * HKDF info strings. These are part of the on-disk format contract - changing a string
 * changes the derived key and makes every existing archive undecryptable. They are
 * versioned so a future format revision can rotate them deliberately.
 */
const INFO_DATA = "dbackup/archive/v2/data";
const INFO_INDEX = "dbackup/archive/v2/index";

export interface ArchiveKeys {
    /** Encrypts entry payloads (database dumps, directory files, bundles). */
    dataKey: Buffer;
    /** Encrypts the NDJSON index, which holds every file path, size, mtime and checksum. */
    indexKey: Buffer;
}

/**
 * Generates a fresh per-archive KDF salt. Callers store this in the archive manifest.
 */
export function generateKdfSalt(): Buffer {
    return crypto.randomBytes(KDF_SALT_LENGTH);
}

/**
 * Derives the data and index subkeys for one archive.
 *
 * @param masterKey - The encryption profile's 32-byte master key
 * @param kdfSalt - The archive's 32-byte salt, from generateKdfSalt() when writing or from
 * the manifest when reading
 */
export function deriveArchiveKeys(masterKey: Buffer, kdfSalt: Buffer): ArchiveKeys {
    if (masterKey.length !== MASTER_KEY_LENGTH) {
        throw new Error(`Invalid master key length: ${masterKey.length}. Must be ${MASTER_KEY_LENGTH} bytes.`);
    }
    if (kdfSalt.length !== KDF_SALT_LENGTH) {
        throw new Error(`Invalid KDF salt length: ${kdfSalt.length}. Must be ${KDF_SALT_LENGTH} bytes.`);
    }

    return {
        dataKey: derive(masterKey, kdfSalt, INFO_DATA),
        indexKey: derive(masterKey, kdfSalt, INFO_INDEX),
    };
}

function derive(masterKey: Buffer, salt: Buffer, info: string): Buffer {
    return Buffer.from(
        crypto.hkdfSync("sha256", masterKey, salt, Buffer.from(info, "utf-8"), DERIVED_KEY_LENGTH)
    );
}
