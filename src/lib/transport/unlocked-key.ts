/**
 * A private key with a passphrase, unlocked once per process.
 *
 * An OpenSSH key names its own cost to unlock (bcrypt rounds, see `key-cost.ts`), and ssh2 pays it
 * on the one event loop every tenant shares, at every connect. A health check that logs in every
 * minute with such a key would hold the server for that long each time. So the key is unlocked
 * once, written again without a passphrase in a format ssh2 reads at no cost, and kept in memory
 * under a digest of the key and its passphrase. The plain key never leaves the process, the same
 * as the decrypted config every connect holds anyway.
 */

import { createHash, createPrivateKey } from "crypto";

import { utils as sshUtils } from "ssh2";

import { assertKeyCost } from "./key-cost";
import { normalizeSshPrivateKey } from "./pkcs8-compat";

/** How many unlocked keys the process keeps, the oldest dropped first. */
const MAX_KEPT = 200;

/** On globalThis, since every bundle of Next.js loads this module anew. */
const kept = ((globalThis as unknown as { unlockedSshKeys?: Map<string, string> }).unlockedSshKeys ??= new Map<string, string>());

/** A string of the SSH wire format: its length, then its bytes. */
function wireString(value: Buffer | string): Buffer {
    const bytes = typeof value === "string" ? Buffer.from(value) : value;
    const length = Buffer.alloc(4);
    length.writeUInt32BE(bytes.length);
    return Buffer.concat([length, bytes]);
}

/** A whole number of the SSH wire format. */
function wireUint32(value: number): Buffer {
    const bytes = Buffer.alloc(4);
    bytes.writeUInt32BE(value);
    return bytes;
}

/**
 * An ed25519 key in the unencrypted OpenSSH format, the one `ssh-keygen -N ""` writes. ssh2 writes
 * the private half of such a key as PKCS#8, which it cannot read back, so it is written here.
 */
function openSshEd25519(pkcs8Pem: string, publicBlob: Buffer): string {
    const der = createPrivateKey(pkcs8Pem).export({ format: "der", type: "pkcs8" });
    const seed = der.subarray(der.length - 32);
    const pub = publicBlob.subarray(publicBlob.length - 32);
    const check = createHash("sha256").update(pub).digest().readUInt32BE(0);
    let secret = Buffer.concat([
        wireUint32(check), wireUint32(check),
        wireString("ssh-ed25519"), wireString(pub), wireString(Buffer.concat([seed, pub])), wireString(""),
    ]);
    // Padded to the block size of the cipher none, 8, with 1, 2, 3 and so on.
    const padding: number[] = [];
    for (let next = 1; (secret.length + padding.length) % 8 !== 0; next++) padding.push(next);
    secret = Buffer.concat([secret, Buffer.from(padding)]);
    const body = Buffer.concat([
        Buffer.from("openssh-key-v1\0"),
        wireString("none"), wireString("none"), wireString(""),
        wireUint32(1), wireString(publicBlob), wireString(secret),
    ]);
    const lines = body.toString("base64").match(/.{1,70}/g) ?? [];
    return ["-----BEGIN OPENSSH PRIVATE KEY-----", ...lines, "-----END OPENSSH PRIVATE KEY-----", ""].join("\n");
}

/**
 * What `unlock` makes of a key and its passphrase, run at most once per process for the two, or
 * null when it answers null, which is not kept, so a later connect tries again.
 */
export function unlockOnce(privateKey: string, passphrase: string, unlock: () => string | null): string | null {
    const digest = createHash("sha256").update(privateKey).update("\0").update(passphrase).digest("hex");
    const known = kept.get(digest);
    if (known) return known;
    const plain = unlock();
    if (plain === null) return null;
    if (kept.size >= MAX_KEPT) kept.delete(kept.keys().next().value!);
    kept.set(digest, plain);
    return plain;
}

/**
 * The key without its passphrase, unlocked at most once per process for a key and a passphrase,
 * or null when ssh2 cannot read it with that passphrase or the result would not read the same. A
 * null leaves the connect to ssh2 with the key as it is, which then says what is wrong.
 */
export function unlockedPrivateKey(privateKey: string, passphrase: string): string | null {
    return unlockOnce(privateKey, passphrase, () => {
        const parsed = sshUtils.parseKey(privateKey, passphrase);
        const key = Array.isArray(parsed) ? parsed[0] : parsed;
        if (!key || key instanceof Error) return null;
        const publicBlob = key.getPublicSSH();
        let plain: string;
        try {
            plain = key.type === "ssh-ed25519" ? openSshEd25519(key.getPrivatePEM(), publicBlob) : key.getPrivatePEM();
        } catch {
            return null;
        }
        const again = sshUtils.parseKey(plain);
        const check = Array.isArray(again) ? again[0] : again;
        return check && !(check instanceof Error) && check.getPublicSSH().equals(publicBlob) ? plain : null;
    });
}

/**
 * The key and passphrase ssh2 gets for a login with a private key, unlocked at most once per
 * process, for every client of ssh2 alike. ssh2 cannot read a PKCS#8 encrypted key (BEGIN ENCRYPTED
 * PRIVATE KEY), so that one is decrypted in memory. Any other key with a passphrase goes through
 * `unlockedPrivateKey`, and to ssh2 as it is when that cannot read it.
 *
 * @throws Error for a key whose cost to unlock is too high, see `key-cost.ts`, or a PKCS#8 encrypted key without a passphrase.
 */
export function loginKey(privateKey: string | undefined, passphrase: string | undefined): { privateKey?: string; passphrase?: string } {
    // ssh2 derives the key of an encrypted file on the event loop, so its cost is bounded first.
    assertKeyCost(privateKey);
    if (!privateKey) return {};
    if (privateKey.includes("BEGIN ENCRYPTED PRIVATE KEY")) {
        if (!passphrase) throw new Error("This private key is passphrase-protected. Please provide the passphrase.");
        return { privateKey: unlockOnce(privateKey, passphrase, () => normalizeSshPrivateKey(privateKey, passphrase)) ?? privateKey };
    }
    if (!passphrase) return { privateKey };
    // Unlocked once per process, so the cost the key names is not paid on every connect.
    const unlocked = unlockedPrivateKey(privateKey, passphrase);
    return unlocked ? { privateKey: unlocked } : { privateKey, passphrase };
}
