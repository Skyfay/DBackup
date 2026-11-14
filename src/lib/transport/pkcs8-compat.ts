import { createPrivateKey } from "crypto";

import { assertPkcs8Cost, encryptedPkcs8Der } from "./key-cost";

/**
 * Converts an encrypted PKCS#8 private key (-----BEGIN ENCRYPTED PRIVATE KEY-----)
 * to a format that ssh2 accepts.
 *
 * ssh2 only supports:
 *   - OpenSSH format (all key types, including Ed25519)
 *   - PKCS#1 PEM for RSA  (-----BEGIN RSA PRIVATE KEY-----)
 *   - SEC1 PEM for EC     (-----BEGIN EC PRIVATE KEY-----)
 *
 * This function decrypts the key in-memory and re-exports it in the right format.
 * Throws if the passphrase is wrong or the key type is unsupported.
 */
export function normalizeSshPrivateKey(privateKey: string, passphrase: string): string {
    // The derivation runs on the event loop, so its cost is bounded first, and Node decrypts
    // the very bytes that were checked, never another block of the text.
    const der = encryptedPkcs8Der(privateKey);
    assertPkcs8Cost(der);
    let keyObj;
    try {
        keyObj = createPrivateKey({ key: der, format: "der", type: "pkcs8", passphrase });
    } catch {
        throw new Error("Failed to decrypt private key. Check your passphrase.");
    }

    const keyType = keyObj.asymmetricKeyType;

    if (keyType === "rsa") {
        return keyObj.export({ type: "pkcs1", format: "pem" }) as string;
    }

    if (keyType === "ec") {
        return keyObj.export({ type: "sec1", format: "pem" }) as string;
    }

    if (keyType === "ed25519") {
        return buildOpenSSHKey_Ed25519(keyObj);
    }

    throw new Error(`Unsupported private key type: ${keyType}. Supported types: rsa, ec, ed25519.`);
}

// ---------------------------------------------------------------------------
// Ed25519: build OpenSSH unencrypted private key format from JWK raw bytes.
// ssh2 only accepts OpenSSH format for Ed25519 - PKCS#8 (even unencrypted) is
// not supported by its key parser.
// ---------------------------------------------------------------------------

function buildOpenSSHKey_Ed25519(keyObj: ReturnType<typeof createPrivateKey>): string {
    const jwk = keyObj.export({ format: "jwk" }) as { d: string; x: string };

    // Buffer.from handles both standard and URL-safe base64 in Node.js.
    const privateBytes = Buffer.from(jwk.d, "base64");  // 32 bytes
    const publicBytes = Buffer.from(jwk.x, "base64");   // 32 bytes

    // OpenSSH public key blob: uint32(type_len) + type + uint32(pub_len) + pub
    const keyTypeBuf = Buffer.from("ssh-ed25519");
    const pubBlob = Buffer.concat([
        u32(keyTypeBuf.length), keyTypeBuf,
        u32(publicBytes.length), publicBytes,
    ]);

    // Private section (unencrypted, cipher = "none", block size = 8)
    // Format: checkInt x2, key_type string, public key, private+public key, comment, padding
    const checkInt = Math.floor(Math.random() * 0xFFFFFFFF);
    const privKeyFull = Buffer.concat([privateBytes, publicBytes]); // 64 bytes
    const comment = Buffer.alloc(0);

    const contentParts = Buffer.concat([
        u32(checkInt), u32(checkInt),
        u32(keyTypeBuf.length), keyTypeBuf,
        u32(publicBytes.length), publicBytes,
        u32(privKeyFull.length), privKeyFull,
        u32(comment.length),
    ]);

    // Pad to a multiple of 8 with bytes 0x01 0x02 0x03 ...
    const padLen = (8 - (contentParts.length % 8)) % 8;
    const padding = Buffer.from(Array.from({ length: padLen }, (_, i) => i + 1));
    const privSection = Buffer.concat([contentParts, padding]);

    // Full OpenSSH key file: magic + header fields + pubBlob + privSection
    const magic = Buffer.from("openssh-key-v1\x00");
    const cipher = Buffer.from("none");
    const kdf = Buffer.from("none");

    const keyBuf = Buffer.concat([
        magic,
        u32(cipher.length), cipher,
        u32(kdf.length), kdf,
        u32(0),         // kdf options length = 0
        u32(1),         // number of keys = 1
        u32(pubBlob.length), pubBlob,
        u32(privSection.length), privSection,
    ]);

    const b64 = keyBuf.toString("base64").match(/.{1,70}/g)!.join("\n");
    return `-----BEGIN OPENSSH PRIVATE KEY-----\n${b64}\n-----END OPENSSH PRIVATE KEY-----\n`;
}

function u32(value: number): Buffer {
    const buf = Buffer.alloc(4);
    buf.writeUInt32BE(value);
    return buf;
}
