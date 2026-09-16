import crypto from "crypto";
import { Transform, TransformCallback } from "stream";

/**
 * Hashes what flows through it, so a restored file or dump can be checked against the
 * checksum recorded in its index line. For unencrypted archives this is the only integrity
 * check an entry gets - there is no AEAD tag protecting it.
 */
export function hashingStream(onDigest: (digest: string) => void): Transform {
    const hash = crypto.createHash("sha256");
    return new Transform({
        transform(chunk: Buffer, _encoding, callback: TransformCallback) {
            hash.update(chunk);
            callback(null, chunk);
        },
        flush(callback: TransformCallback) {
            onDigest(hash.digest("hex"));
            callback();
        },
    });
}
