/**
 * Bounds the work an SSH private key may ask of the process before anything derives from it.
 *
 * An encrypted key names the cost of its own passphrase derivation: the bcrypt rounds of an
 * OpenSSH key, the PBKDF2 count or the scrypt parameters of an `ENCRYPTED PRIVATE KEY`. ssh2 and
 * Node derive synchronously on the one event loop every tenant shares, so a key that names
 * millions of rounds would stop the web server, the scheduler and every running backup. The
 * header is read here first, with the same framing the parsers use, and a key above the limits is
 * refused with a ValidationError.
 *
 * The legacy PEM encryption (`Proc-Type: 4,ENCRYPTED`) and PuTTY v2 keys derive with a fixed
 * number of hash calls, so they carry no cost to bound.
 */

import { ValidationError } from "@/lib/logging/errors";

/** ssh-keygen writes 16 or 24 rounds, hardening guides go up to 100. A round costs about 8 ms. */
export const MAX_BCRYPT_ROUNDS = 256;
/** OpenSSL writes 2048 by default, current guidance for PBKDF2 stays below this. About 0.2 s. */
export const MAX_PBKDF2_ITERATIONS = 1_000_000;
/** N * r * p. OpenSSL writes 16384 * 8 * 1, half of this. */
export const MAX_SCRYPT_WORK = 2 ** 18;
/** Far above an RSA 16384 key in any format. */
export const MAX_PRIVATE_KEY_CHARS = 64 * 1024;

/** The same expression ssh2 matches an OpenSSH key with, on the trimmed text. */
const OPENSSH_KEY = /^-----BEGIN OPENSSH PRIVATE KEY-----(?:\r\n|\n)([\s\S]+)(?:\r\n|\n)-----END OPENSSH PRIVATE KEY-----$/;
const PKCS8_ENCRYPTED_KEY = /-----BEGIN ENCRYPTED PRIVATE KEY-----([\s\S]*?)-----END ENCRYPTED PRIVATE KEY-----/;

const OPENSSH_MAGIC = "openssh-key-v1\0";

const OID_PBES2 = "2a864886f70d01050d";
const OID_PBKDF2 = "2a864886f70d01050c";
const OID_SCRYPT = "2b06010401da47040b";
/** PBES1 of PKCS#5 and the password schemes of PKCS#12, both `SEQUENCE { salt, iterations }`. */
const OID_PREFIXES_SALT_AND_COUNT = ["2a864886f70d0105", "2a864886f70d010c01"];

const TAG_INTEGER = 0x02;
const TAG_OID = 0x06;
const TAG_SEQUENCE = 0x30;

const malformed = () => new ValidationError("The private key is malformed.", { field: "privateKey" });

/**
 * Refuses a private key whose passphrase derivation costs more than DBackup runs. Called on every
 * path that hands a key to ssh2, before ssh2 sees it. ssh2 reads no `ENCRYPTED PRIVATE KEY`, the
 * one place that decrypts such a key is `normalizeSshPrivateKey`, which bounds it with
 * `assertPkcs8Cost` itself.
 */
export function assertKeyCost(privateKey: unknown): void {
    if (typeof privateKey !== "string") return;
    if (privateKey.length > MAX_PRIVATE_KEY_CHARS) {
        throw new ValidationError("The private key is too long.", { field: "privateKey" });
    }
    assertOpenSshCost(privateKey);
}

/**
 * The DER of the first `ENCRYPTED PRIVATE KEY` block of a PEM text. The caller decrypts exactly
 * these bytes, so the parameters checked are the parameters derived from.
 */
export function encryptedPkcs8Der(pem: string): Buffer {
    const body = PKCS8_ENCRYPTED_KEY.exec(pem)?.[1];
    if (body === undefined) throw malformed();
    return Buffer.from(body.replace(/\s+/g, ""), "base64");
}

// ---------------------------------------------------------------------------
// OpenSSH format
// ---------------------------------------------------------------------------

function assertOpenSshCost(privateKey: string): void {
    const body = OPENSSH_KEY.exec(privateKey.trim())?.[1];
    if (body === undefined) return;
    const data = Buffer.from(body, "base64");
    // What ssh2 refuses by itself before it derives anything is left to ssh2 and its message.
    if (data.length < 31 || data.toString("latin1", 0, OPENSSH_MAGIC.length) !== OPENSSH_MAGIC) return;

    let pos = OPENSSH_MAGIC.length;
    const next = (): Buffer => {
        if (pos + 4 > data.length) throw malformed();
        const length = data.readUInt32BE(pos);
        if (pos + 4 + length > data.length) throw malformed();
        const value = data.subarray(pos + 4, pos + 4 + length);
        pos += 4 + length;
        return value;
    };
    next(); // cipher
    if (next().toString("latin1") !== "bcrypt") return;
    const options = next();
    if (options.length < 4) throw malformed();
    const saltLength = options.readUInt32BE(0);
    if (options.length < 8 + saltLength) throw malformed();
    const rounds = options.readUInt32BE(4 + saltLength);
    if (rounds > MAX_BCRYPT_ROUNDS) {
        throw new ValidationError(
            `The private key asks for ${rounds} bcrypt rounds, more than the ${MAX_BCRYPT_ROUNDS} DBackup derives. Save it again with fewer, for example with ssh-keygen -p -a 16.`,
            { field: "privateKey" }
        );
    }
}

// ---------------------------------------------------------------------------
// Encrypted PKCS#8
// ---------------------------------------------------------------------------

interface Tlv {
    tag: number;
    content: Buffer;
    /** Where the next element starts. */
    end: number;
}

/** One DER element with a definite length. */
function readTlv(data: Buffer, pos: number): Tlv {
    if (pos + 2 > data.length) throw malformed();
    const tag = data[pos];
    let length = data[pos + 1];
    let start = pos + 2;
    if (length & 0x80) {
        const lengthBytes = length & 0x7f;
        if (lengthBytes === 0 || lengthBytes > 4 || start + lengthBytes > data.length) throw malformed();
        length = data.readUIntBE(start, lengthBytes);
        start += lengthBytes;
    }
    if (start + length > data.length) throw malformed();
    return { tag, content: data.subarray(start, start + length), end: start + length };
}

/** The elements of a SEQUENCE body. */
function elementsOf(body: Buffer): Tlv[] {
    const elements: Tlv[] = [];
    for (let pos = 0; pos < body.length; ) {
        const element = readTlv(body, pos);
        elements.push(element);
        pos = element.end;
    }
    return elements;
}

/** A non-negative INTEGER. One too large to count is answered as infinity, which no limit allows. */
function integerOf(element: Tlv | undefined): number {
    if (!element || element.tag !== TAG_INTEGER || element.content.length === 0) throw malformed();
    if (element.content[0] & 0x80) throw malformed();
    const bytes = element.content[0] === 0 ? element.content.subarray(1) : element.content;
    if (bytes.length > 6) return Number.POSITIVE_INFINITY;
    return bytes.length === 0 ? 0 : bytes.readUIntBE(0, bytes.length);
}

/** OID and parameters of an AlgorithmIdentifier. */
function algorithmOf(element: Tlv | undefined): { oid: string; parameters: Tlv[] } {
    if (!element || element.tag !== TAG_SEQUENCE) throw malformed();
    const [oid, parameters] = elementsOf(element.content);
    if (!oid || oid.tag !== TAG_OID) throw malformed();
    return {
        oid: oid.content.toString("hex"),
        parameters: parameters?.tag === TAG_SEQUENCE ? elementsOf(parameters.content) : [],
    };
}

const tooCostly = (what: string) =>
    new ValidationError(
        `The private key asks for ${what}, more than DBackup derives. Save it again with a lower cost.`,
        { field: "privateKey" }
    );

/** Reads the KDF parameters of an EncryptedPrivateKeyInfo and refuses what is above the limits. */
export function assertPkcs8Cost(der: Buffer): void {
    const outer = readTlv(der, 0);
    if (outer.tag !== TAG_SEQUENCE) throw malformed();
    const scheme = algorithmOf(elementsOf(outer.content)[0]);

    if (scheme.oid === OID_PBES2) {
        const kdf = algorithmOf(scheme.parameters[0]);
        if (kdf.oid === OID_PBKDF2) {
            const iterations = integerOf(kdf.parameters[1]);
            if (iterations > MAX_PBKDF2_ITERATIONS) throw tooCostly(`${iterations} PBKDF2 iterations`);
            return;
        }
        if (kdf.oid === OID_SCRYPT) {
            const work = integerOf(kdf.parameters[1]) * integerOf(kdf.parameters[2]) * integerOf(kdf.parameters[3]);
            if (work > MAX_SCRYPT_WORK) throw tooCostly("an scrypt cost above the limit");
            return;
        }
    } else if (OID_PREFIXES_SALT_AND_COUNT.some((prefix) => scheme.oid.startsWith(prefix))) {
        const iterations = integerOf(scheme.parameters[1]);
        if (iterations > MAX_PBKDF2_ITERATIONS) throw tooCostly(`${iterations} iterations`);
        return;
    }
    // A derivation whose cost cannot be read is not run.
    throw new ValidationError("The private key uses an encryption DBackup does not support.", { field: "privateKey" });
}
