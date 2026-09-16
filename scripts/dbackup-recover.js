#!/usr/bin/env node
/**
 * DBackup Recovery Tool
 *
 * Standalone. Needs nothing but Node.js 18+ - no DBackup server, no database, no npm
 * install. This file is a complete, independent implementation of the formats documented in
 * docs/developer-guide/reference/archive-format.md, so a backup stays recoverable even if
 * DBackup itself is gone. Keep it with your master key.
 *
 * Started with no arguments it scans the folder it sits in, shows what it found, and asks
 * what to do with it. That is the path a recovery actually takes: someone copies a backup
 * next to this kit and wants their files back, without first having to learn which of two
 * archive formats they are holding.
 *
 * The classic command line is still there for scripting:
 *
 *   node dbackup-recover.js --list    <archive|folder> [<hex_key>]
 *   node dbackup-recover.js --extract <archive|folder> <output_dir> [<hex_key>] [glob...]
 *   node dbackup-recover.js --decrypt <backup.enc> [<hex_key>] [<output_dir>]
 *
 * Every mode writes into ./restored unless another folder is named, and every mode leaves
 * files that are ready to use - a multi-database backup comes out as one dump per database
 * rather than as a TAR to unpack afterwards.
 *
 * The key is read from master.key next to this file when it is there. Pass it explicitly to
 * override, or leave it out entirely for unencrypted backups.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * Deliberately one file, well past the size this project allows anywhere else.
 * It is unzipped into a strange folder in the worst week of someone's year, and
 * anything that can be separated from it by a careless copy eventually will be.
 * ─────────────────────────────────────────────────────────────────────────────
 */

/* eslint-disable @typescript-eslint/no-require-imports */
// CommonJS on purpose: this file is extracted from the Recovery Kit into an arbitrary
// folder with no package.json, where Node treats a bare .js as CommonJS.
const fs = require("fs");
const path = require("path");
const zlib = require("zlib");
const crypto = require("crypto");
const stream = require("stream");
const readline = require("readline");
const { pipeline } = require("stream/promises");

// ══════════════════════════════════════════════════════════════════════════════
// Format constants (see the spec document)
// ══════════════════════════════════════════════════════════════════════════════

const TAR_BLOCK = 512;
const MANIFEST_MEMBER = "manifest.json";
const INDEX_MEMBER = "index";
const TAG_LENGTH = 16;
const NONCE_LENGTH = 12;
const NONCE_PREFIX_LENGTH = 4;
const INDEX_ORDINAL = 0;
const INFO_DATA = "dbackup/archive/v2/data";
const INFO_INDEX = "dbackup/archive/v2/index";

const padded = (size) => Math.ceil(size / TAR_BLOCK) * TAR_BLOCK;

/** Dump filename extension per format. Mirrors EXTENSION_BY_FORMAT in src/lib/archive/format.ts. */
const DUMP_EXTENSIONS = {
    sql: "sql",
    custom: "dump",
    archive: "archive",
    bak: "bak",
    fbk: "fbk",
    bacpac: "bacpac",
    rdb: "rdb",
    sqlite: "sqlite",
};

/**
 * Makes a database name usable as a single path segment. Mirrors safeNameSegment in
 * src/lib/archive/dump-names.ts, so a dump lands under the same name DBackup gives it.
 */
function safeNameSegment(name) {
    const replaced = String(name).replace(/[/\\\u0000-\u001f\u007f]/g, "_").replace(/^\./, "_");
    return replaced.length > 0 ? replaced : "_";
}

// ══════════════════════════════════════════════════════════════════════════════
// Crypto
// ══════════════════════════════════════════════════════════════════════════════

/**
 * Derives the per-archive data and index subkeys.
 *
 * The master key is never used directly. A fresh key per archive plus counter-based
 * nonces makes (key, nonce) repetition impossible, which under AES-GCM is the difference
 * between "secure" and "completely broken".
 */
function deriveKeys(masterKey, kdfSaltHex) {
    const salt = Buffer.from(kdfSaltHex, "hex");
    return {
        dataKey: Buffer.from(crypto.hkdfSync("sha256", masterKey, salt, Buffer.from(INFO_DATA, "utf-8"), 32)),
        indexKey: Buffer.from(crypto.hkdfSync("sha256", masterKey, salt, Buffer.from(INFO_INDEX, "utf-8"), 32)),
    };
}

/** Nonce = noncePrefix(4) || uint64BE(ordinal). */
function buildNonce(noncePrefixHex, ordinal) {
    const nonce = Buffer.alloc(NONCE_LENGTH);
    Buffer.from(noncePrefixHex, "hex").copy(nonce, 0);
    nonce.writeBigUInt64BE(BigInt(ordinal), NONCE_PREFIX_LENGTH);
    return nonce;
}

/** Opens one sealed entry. Layout is `ciphertext || authTag(16)`. */
function openEntry(sealed, key, noncePrefixHex, ordinal) {
    if (sealed.length < TAG_LENGTH) {
        throw new Error(`Entry ${ordinal} is truncated`);
    }
    const ciphertext = sealed.subarray(0, sealed.length - TAG_LENGTH);
    const tag = sealed.subarray(sealed.length - TAG_LENGTH);

    const decipher = crypto.createDecipheriv("aes-256-gcm", key, buildNonce(noncePrefixHex, ordinal));
    decipher.setAuthTag(tag);
    try {
        return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
    } catch {
        throw new Error(
            `Authentication failed for entry ${ordinal}. Either the key is wrong or the archive is damaged.`
        );
    }
}

function decompress(buffer, kind) {
    if (!kind) return buffer;
    if (kind === "GZIP") return zlib.gunzipSync(buffer);
    if (kind === "BROTLI") return zlib.brotliDecompressSync(buffer);
    throw new Error(`Unsupported compression: ${kind}`);
}

function createDecompressStream(kind) {
    if (!kind || kind === "NONE") return null;
    if (kind === "GZIP") return zlib.createGunzip();
    if (kind === "BROTLI") return zlib.createBrotliDecompress();
    throw new Error(`Unsupported compression: ${kind}`);
}

const isHexKey = (value) => typeof value === "string" && /^[0-9a-fA-F]{64}$/.test(value.trim());

/** Everything a restore produces lands here unless the user says otherwise. */
const DEFAULT_OUTPUT_DIR = path.resolve(process.cwd(), "restored");

/**
 * Every key this kit holds, from the folder the script sits in.
 *
 * Two shapes. A kit for one profile ships `master.key`. A kit covering several ships a
 * `keys/` folder with one file per profile plus `keys/keys.json`, which ties each key to
 * the profile id a backup records - so the right one can be picked outright rather than
 * tried.
 *
 * The kit ships keys as files and used to tell people to paste them on the command line,
 * which put them in shell history and in the process list. Reading them is easier and
 * quieter.
 */
function loadKeys() {
    for (const root of [__dirname, process.cwd()]) {
        const keys = [];

        const single = readHexFile(path.join(root, "master.key"));
        if (single) keys.push({ name: "master.key", hex: single });

        const index = readJson(path.join(root, "keys", "keys.json"));
        if (index && Array.isArray(index.keys)) {
            for (const entry of index.keys) {
                const hex = readHexFile(path.join(root, "keys", entry.file));
                if (hex) keys.push({ name: entry.name ?? entry.file, hex, profileId: entry.profileId });
            }
        } else {
            // A keys/ folder without its index still works - the names come from the
            // filenames, and the right key is found by trying rather than by lookup.
            for (const file of listKeyFiles(path.join(root, "keys"))) {
                const hex = readHexFile(path.join(root, "keys", file));
                if (hex) keys.push({ name: file.replace(/\.key$/, ""), hex });
            }
        }

        if (keys.length > 0) return { keys, source: root };
    }

    return { keys: [], source: null };
}

function readHexFile(target) {
    try {
        const contents = fs.readFileSync(target, "utf-8").trim();
        return isHexKey(contents) ? contents : null;
    } catch {
        return null;
    }
}

function listKeyFiles(dir) {
    try {
        return fs.readdirSync(dir).filter((name) => name.endsWith(".key")).sort();
    } catch {
        return [];
    }
}

/**
 * The key for a backup, when it can be known without trying.
 *
 * A backup records the profile that encrypted it, so a kit that carries the same id knows
 * the answer outright. With a single key there is nothing to choose. Otherwise the caller
 * has to test candidates against the backup itself.
 */
function keyFor(keys, profileId) {
    if (keys.length === 0) return null;
    if (profileId) {
        const exact = keys.find((key) => key.profileId === profileId);
        if (exact) return exact;
    }
    return keys.length === 1 ? keys[0] : null;
}

/** Human-readable summary of what the kit is carrying, for the banner. */
function describeKeys({ keys, source }) {
    if (keys.length === 0) return "No key found in this folder";
    if (keys.length === 1) return `Key loaded from ${path.basename(source ?? "")}`;
    return `${keys.length} keys loaded: ${keys.map((key) => key.name).join(", ")}`;
}

/** The encryption profile a backup was made with, read without needing any key. */
function recordedProfileId(backupPath) {
    const manifest = peekManifest(backupPath);
    if (manifest) return manifest.encryption?.profileId;
    return readJson(`${backupPath}.meta.json`)?.encryption?.profileId;
}

/**
 * Works out which key opens a backup.
 *
 * The profile a backup records is normally enough, and that costs nothing. Trying keys is
 * the fallback for when it is not - a profile deleted and created again elsewhere carries
 * a different id, and a `keys/` folder assembled by hand has no index at all.
 *
 * @returns The key as hex, or undefined when the backup needs none.
 */
function resolveKey(backupPath, keys) {
    if (keys.length === 0) return undefined;

    const profileId = recordedProfileId(backupPath);
    const known = keyFor(keys, profileId);
    if (known) return known.hex;

    for (const candidate of keys) {
        if (keyOpens(backupPath, candidate.hex)) return candidate.hex;
    }

    throw new Error(
        `None of the ${keys.length} keys in this kit open ${path.basename(backupPath)}` +
        `${profileId ? ` (it was encrypted with profile ${profileId})` : ""}. ` +
        `Tried: ${keys.map((key) => key.name).join(", ")}`
    );
}

/** Whether a candidate key opens this backup, judged as cheaply as its format allows. */
function keyOpens(backupPath, hexKey) {
    const manifest = peekManifest(backupPath);
    if (manifest) {
        // Exact: the archive's index carries an authentication tag, so a wrong key cannot
        // parse it. Costs one manifest and one index read.
        let archive;
        try {
            archive = openArchive(backupPath, hexKey);
            return true;
        } catch {
            return false;
        } finally {
            if (archive) { try { fs.closeSync(archive.fd); } catch { /* already gone */ } }
        }
    }

    return headLooksDecrypted(backupPath, hexKey);
}

/**
 * Heuristic check on the first kilobyte of a whole-file backup.
 *
 * These are one AES-GCM stream whose tag only verifies at the very end, so proving a key
 * properly would mean decrypting the entire dump once per candidate. Instead the leading
 * bytes are deciphered with `update()` alone - which skips tag verification - and judged by
 * what the plaintext should look like.
 */
function headLooksDecrypted(backupPath, hexKey) {
    const meta = readJson(`${backupPath}.meta.json`);
    const encryption = meta?.encryption;
    if (!encryption?.iv || !encryption?.authTag) return false;

    let fd;
    try {
        fd = fs.openSync(backupPath, "r");
        const head = Buffer.alloc(1024);
        const read = fs.readSync(fd, head, 0, head.length, 0);
        if (read === 0) return false;

        const decipher = crypto.createDecipheriv(
            "aes-256-gcm",
            Buffer.from(hexKey, "hex"),
            Buffer.from(encryption.iv, "hex")
        );
        decipher.setAuthTag(Buffer.from(encryption.authTag, "hex"));
        return looksLikeBackupContent(decipher.update(head.subarray(0, read)), meta.compression);
    } catch {
        return false;
    } finally {
        if (fd !== undefined) { try { fs.closeSync(fd); } catch { /* already gone */ } }
    }
}

/** Recognises the openings DBackup's dump formats produce. */
function looksLikeBackupContent(chunk, compression) {
    if (chunk.length < 2) return false;

    // GZIP, either from the pipeline or from a dump tool that compresses internally.
    if (chunk[0] === 0x1f && chunk[1] === 0x8b) return true;
    if (compression === "GZIP") return false;

    const startsWith = (text) => chunk.length >= text.length && chunk.subarray(0, text.length).toString("ascii") === text;
    if (startsWith("PGDMP")) return true;               // pg_dump custom format
    if (startsWith("SQLite format 3")) return true;
    if (startsWith("REDIS")) return true;
    // POSIX tar writes "ustar" at offset 257 - a multi-database backup.
    if (chunk.length >= 262 && chunk.subarray(257, 262).toString("ascii") === "ustar") return true;

    // Brotli, or a plain SQL dump.
    return chunk.filter((byte) => byte >= 0x20 && byte <= 0x7e).length / chunk.length > 0.7;
}

// ══════════════════════════════════════════════════════════════════════════════
// TAR reading
// ══════════════════════════════════════════════════════════════════════════════

function readString(block, start, length) {
    const raw = block.subarray(start, start + length);
    const end = raw.indexOf(0);
    return raw.subarray(0, end === -1 ? raw.length : end).toString("utf-8");
}

/**
 * Reads a numeric TAR header field.
 *
 * A size of 8 GiB or more does not fit the octal field and is written in GNU base-256
 * form, flagged by the high bit of the first byte. Without this the member walk would
 * read 0 for such an entry and lose its place in the archive - so a backup containing one
 * large file could not even be listed, let alone extracted.
 */
function readNumeric(block, start, length) {
    const first = block[start];

    if ((first & 0x80) !== 0) {
        let value = first === 0xff ? -1 : first & 0x7f;
        for (let i = start + 1; i < start + length; i++) {
            value = value * 256 + block[i];
        }
        if (!Number.isSafeInteger(value)) {
            throw new Error(`TAR header field at offset ${start} exceeds the safe integer range`);
        }
        return value;
    }

    const text = readString(block, start, length).trim();
    const value = parseInt(text, 8);
    return Number.isNaN(value) ? 0 : value;
}

/**
 * Walks the archive's headers, seeking over payloads.
 *
 * Cost scales with the number of members rather than the size of the archive, so this is
 * cheap even on a multi-terabyte backup.
 */
function walkMembers(fd, fileSize) {
    const members = [];
    const block = Buffer.alloc(TAR_BLOCK);
    let position = 0;
    let paxName = null;

    while (position + TAR_BLOCK <= fileSize) {
        if (fs.readSync(fd, block, 0, TAR_BLOCK, position) < TAR_BLOCK) break;
        if (block.every((b) => b === 0)) break;

        const size = readNumeric(block, 124, 12);
        const typeFlag = String.fromCharCode(block[156]);
        const dataOffset = position + TAR_BLOCK;

        if (typeFlag === "x" || typeFlag === "X" || typeFlag === "L") {
            const payload = Buffer.alloc(size);
            fs.readSync(fd, payload, 0, size, dataOffset);
            if (typeFlag === "L") {
                paxName = payload.toString("utf-8").replace(/\0+$/, "");
            } else {
                const match = payload.toString("utf-8").match(/\d+ path=(.*)\n/);
                paxName = match ? match[1] : null;
            }
            position = dataOffset + padded(size);
            continue;
        }

        let name = paxName ?? readString(block, 0, 100);
        if (paxName === null) {
            const prefix = readString(block, 345, 155);
            if (prefix.length > 0) name = `${prefix}/${name}`;
        }
        paxName = null;

        members.push({ name, offset: dataOffset, size });
        position = dataOffset + padded(size);
    }

    return members;
}

/** A single readSync tops out at 2 GiB, so large entries are read in chunks. */
const READ_CHUNK = 64 * 1024 * 1024;

function readAt(fd, offset, size) {
    const buffer = Buffer.alloc(size);
    let read = 0;
    while (read < size) {
        const want = Math.min(READ_CHUNK, size - read);
        const got = fs.readSync(fd, buffer, read, want, offset + read);
        if (got <= 0) break;
        read += got;
    }
    return buffer;
}

// ══════════════════════════════════════════════════════════════════════════════
// Archive access
// ══════════════════════════════════════════════════════════════════════════════

/**
 * Reads only the manifest, without opening the index or needing a key.
 *
 * This is what makes the folder scan cheap and key-free: the manifest is the first member
 * and always cleartext, so a whole folder can be classified before anyone is asked for
 * anything.
 */
function peekManifest(archivePath) {
    let fd;
    try {
        fd = fs.openSync(archivePath, "r");
        const stat = fs.fstatSync(fd);
        if (!stat.isFile() || stat.size < TAR_BLOCK) return null;

        const header = Buffer.alloc(TAR_BLOCK);
        if (fs.readSync(fd, header, 0, TAR_BLOCK, 0) < TAR_BLOCK) return null;
        if (readString(header, 0, 100) !== MANIFEST_MEMBER) return null;

        const size = readNumeric(header, 124, 12);
        if (size <= 0 || size > 1024 * 1024) return null;
        const manifest = JSON.parse(readAt(fd, TAR_BLOCK, size).toString("utf-8"));
        return manifest.version === 2 ? manifest : null;
    } catch {
        return null;
    } finally {
        if (fd !== undefined) { try { fs.closeSync(fd); } catch { /* already gone */ } }
    }
}

function openArchive(archivePath, hexKey) {
    const fd = fs.openSync(archivePath, "r");
    // Kept so entries can be opened as a stream: a multi-GB file must never be held in
    // memory in one piece, which is what a recovery tool is most likely to meet.
    const filePath = archivePath;
    const fileSize = fs.statSync(archivePath).size;

    const members = walkMembers(fd, fileSize);
    const byName = new Map(members.map((m) => [m.name, m]));

    const manifestMember = byName.get(MANIFEST_MEMBER);
    if (!manifestMember) {
        fs.closeSync(fd);
        throw new Error("Not a DBackup v2 archive: no manifest.json found");
    }
    const manifest = JSON.parse(readAt(fd, manifestMember.offset, manifestMember.size).toString("utf-8"));
    if (manifest.version !== 2) {
        fs.closeSync(fd);
        throw new Error(
            `This archive uses format version ${manifest.version}. Use --decrypt for older backups.`
        );
    }

    let keys = null;
    if (manifest.encryption) {
        if (!hexKey) {
            fs.closeSync(fd);
            throw new Error("This archive is encrypted. Pass your master key (see master.key in this kit).");
        }
        const masterKey = Buffer.from(hexKey.trim(), "hex");
        if (masterKey.length !== 32) {
            fs.closeSync(fd);
            throw new Error(`Invalid key: expected 64 hex characters, got ${hexKey.trim().length}`);
        }
        keys = deriveKeys(masterKey, manifest.encryption.kdfSalt);
    }

    // The index is the last member. It is read from the archive itself rather than the
    // .index sidecar, so a lost sidecar never blocks a recovery.
    const indexMember = byName.get(INDEX_MEMBER);
    if (!indexMember) {
        fs.closeSync(fd);
        throw new Error("Archive contains no index member - it may be truncated");
    }

    let indexBytes = readAt(fd, indexMember.offset, indexMember.size);
    if (manifest.encryption) {
        indexBytes = openEntry(indexBytes, keys.indexKey, manifest.encryption.noncePrefix, INDEX_ORDINAL);
    }

    const index = { entries: new Map(), databases: [], directories: [], files: [], deps: [] };
    for (const line of zlib.gunzipSync(indexBytes).toString("utf-8").split("\n")) {
        if (!line) continue;
        const parsed = JSON.parse(line);
        // Entry ordinals are only unique within their own archive, so carried entries are
        // keyed by archive as well. An absent `a` means this archive.
        if (parsed.k === "e") index.entries.set(entryKey(parsed.a, parsed.n), parsed);
        else if (parsed.k === "deps") index.deps = parsed.archives;
        else if (parsed.k === "db") index.databases.push(parsed);
        else if (parsed.k === "d") index.directories.push(parsed);
        else if (parsed.k === "f") index.files.push(parsed);
    }

    return { fd, filePath, manifest, index, keys, chain: new Map() };
}

/** Addresses an entry across a chain. Ordinals repeat between archives. */
function entryKey(archive, ordinal) {
    return `${archive ?? ""}#${ordinal}`;
}

/**
 * Opens the archives a snapshot depends on.
 *
 * They live next to the snapshot in the same folder, which is exactly what the folder
 * layout is for: copying that folder gives you a complete, restorable backup.
 */
function openChain(archivePath, index, hexKey) {
    const dir = path.dirname(archivePath);
    const chain = new Map();
    const missing = [];

    for (const name of index.deps) {
        const siblingPath = path.join(dir, name);
        if (!fs.existsSync(siblingPath)) {
            missing.push(name);
            continue;
        }
        chain.set(name, openArchive(siblingPath, hexKey));
    }

    return { chain, missing };
}

/**
 * Returns the plaintext bytes of one physical entry, from this archive or a chain sibling.
 *
 * Buffers the entry whole, so it is only used for bundles - a few MB at most. Anything
 * that can be arbitrarily large goes through streamEntryToFile instead.
 */
function readEntry(archive, ordinal, fromArchive) {
    const { target, entry } = resolveEntry(archive, ordinal, fromArchive);

    let payload = readAt(target.fd, entry.off, entry.size);
    if (entry.sealed) {
        payload = openEntry(payload, target.keys.dataKey, target.manifest.encryption.noncePrefix, entry.n);
    }
    return decompress(payload, entry.comp);
}

/**
 * Transform that unseals an entry as it flows past, instead of buffering it whole.
 *
 * The authentication tag is the last 16 bytes of the entry, so the final chunk cannot be
 * deciphered until the stream ends. Everything before it is passed through as it arrives,
 * and `final()` at the end is what proves the data was not tampered with.
 */
function createUnsealStream(key, noncePrefixHex, ordinal) {
    const decipher = crypto.createDecipheriv("aes-256-gcm", key, buildNonce(noncePrefixHex, ordinal));
    let tail = Buffer.alloc(0);

    return new stream.Transform({
        transform(chunk, _encoding, callback) {
            const buffered = tail.length > 0 ? Buffer.concat([tail, chunk]) : chunk;

            if (buffered.length <= TAG_LENGTH) {
                tail = Buffer.from(buffered);
                callback();
                return;
            }

            const splitAt = buffered.length - TAG_LENGTH;
            tail = Buffer.from(buffered.subarray(splitAt));
            try {
                callback(null, decipher.update(buffered.subarray(0, splitAt)));
            } catch {
                callback(new Error(`Failed to decrypt entry ${ordinal}`));
            }
        },
        flush(callback) {
            if (tail.length !== TAG_LENGTH) {
                callback(new Error(`Entry ${ordinal} is truncated`));
                return;
            }
            try {
                decipher.setAuthTag(tail);
                this.push(decipher.final());
                callback();
            } catch {
                callback(new Error(
                    `Authentication failed for entry ${ordinal}. Either the key is wrong or the archive is damaged.`
                ));
            }
        },
    });
}

/**
 * Writes one entry straight to disk, in constant memory.
 *
 * Written to a temporary file and renamed only once the stream has finished, so the
 * verify-before-visible property of the buffered path survives: AES-GCM only authenticates
 * at the end, and a half-written file that failed its tag must never be mistaken for a
 * restored one.
 */
async function streamEntryToFile(target, entry, targetPath, expectedChecksum) {
    const partial = `${targetPath}.partial`;
    fs.mkdirSync(path.dirname(targetPath), { recursive: true });

    const hash = crypto.createHash("sha256");
    const stages = [fs.createReadStream(target.filePath, { start: entry.off, end: entry.off + entry.size - 1 })];

    if (entry.sealed) {
        stages.push(createUnsealStream(target.keys.dataKey, target.manifest.encryption.noncePrefix, entry.n));
    }
    const decompressStage = createDecompressStream(entry.comp);
    if (decompressStage) stages.push(decompressStage);

    stages.push(new stream.Transform({
        transform(chunk, _encoding, callback) {
            hash.update(chunk);
            callback(null, chunk);
        },
    }));
    stages.push(fs.createWriteStream(partial));

    try {
        await pipeline(stages);
    } catch (error) {
        fs.rmSync(partial, { force: true });
        throw error;
    }

    const actual = hash.digest("hex");
    if (expectedChecksum && actual !== expectedChecksum) {
        fs.rmSync(partial, { force: true });
        return { ok: false, actual };
    }

    fs.renameSync(partial, targetPath);
    return { ok: true, actual };
}

/**
 * Resolves the archive an ordinal lives in - this one, or a sibling of its chain.
 *
 * Ordinals restart at 1 in every archive, so an entry carried forward from an earlier
 * snapshot is only addressable together with the archive it came from.
 */
function resolveEntry(archive, ordinal, fromArchive) {
    const target = fromArchive ? archive.chain.get(fromArchive) : archive;
    if (!target) {
        throw new Error(`Archive '${fromArchive}' is part of this backup's chain but is not in this folder`);
    }
    const entry = target.index.entries.get(entryKey(undefined, ordinal))
        ?? archive.index.entries.get(entryKey(fromArchive, ordinal));
    if (!entry) throw new Error(`Index references missing entry ${ordinal}`);
    return { target, entry };
}

/** Returns the plaintext bytes of one logical file, slicing it out of a bundle if needed. */
function readFileFromArchive(archive, fileLine) {
    const payload = readEntry(archive, fileLine.n, fileLine.a);
    if (fileLine.o === undefined || fileLine.l === undefined) return payload;
    return payload.subarray(fileLine.o, fileLine.o + fileLine.l);
}

// ══════════════════════════════════════════════════════════════════════════════
// Matching
// ══════════════════════════════════════════════════════════════════════════════

/** Very small glob: `*` matches within a path segment, `**` matches across segments. */
function globToRegExp(pattern) {
    let out = "";
    for (let i = 0; i < pattern.length; i++) {
        const c = pattern[i];
        if (c === "*") {
            if (pattern[i + 1] === "*") { out += ".*"; i++; }
            else out += "[^/]*";
        } else if (c === "?") out += "[^/]";
        else out += c.replace(/[.+^${}()|[\]\\]/g, "\\$&");
    }
    return new RegExp(`^${out}$`);
}

function matchesAny(filePath, patterns) {
    if (patterns.length === 0) return true;
    return patterns.some((pattern) => {
        if (filePath === pattern) return true;
        if (filePath.startsWith(`${pattern}/`)) return true;
        return globToRegExp(pattern).test(filePath);
    });
}

// ══════════════════════════════════════════════════════════════════════════════
// Whole-file encrypted backups (database dumps)
// ══════════════════════════════════════════════════════════════════════════════

/**
 * Restores a backup that was encrypted as one stream: decrypts it, decompresses it, and
 * unpacks it if what comes out is an archive of database dumps.
 *
 * Everything needed beyond the key is in the `.meta.json` written next to the backup: the
 * IV, the authentication tag, and whether the plaintext is gzip or brotli.
 *
 * A job backing up several databases at once produces one TAR holding one dump per
 * database. Handing that back as a `.tar` and leaving the user to unpack it was one step
 * short of the job - especially next to the file-backup path, which has always come out as
 * ready-to-use files.
 *
 * @returns Absolute paths of everything written.
 */
// LEGACY-FORMAT(shared): Whole-file decryption for older database backups and config backups.
async function restoreWholeFile(inputPath, hexKey, outputDir, databases) {
    const metaPath = `${inputPath}.meta.json`;
    if (!fs.existsSync(metaPath)) {
        throw new Error(
            `No metadata found at ${path.basename(metaPath)}. It holds the IV and authentication tag, ` +
            `so decryption cannot proceed without it. Copy it from the backup destination alongside the backup.`
        );
    }

    const meta = JSON.parse(fs.readFileSync(metaPath, "utf-8"));
    const compression = meta.compression && meta.compression !== "NONE" ? meta.compression : null;
    const encryption = meta.encryption?.enabled ? meta.encryption : null;

    if (encryption && (!encryption.iv || !encryption.authTag)) {
        throw new Error("The metadata is missing the IV or authentication tag, so this backup cannot be decrypted.");
    }
    if (encryption && !hexKey) {
        throw new Error("This backup is encrypted. Put master.key next to this tool, or pass the key.");
    }

    const root = path.resolve(outputDir);
    fs.mkdirSync(root, { recursive: true });
    const plainName = path.basename(defaultDecryptedName(inputPath, compression));
    const partial = path.join(root, `${plainName}.partial`);

    const stages = [fs.createReadStream(inputPath)];
    if (encryption) {
        const decipher = crypto.createDecipheriv(
            "aes-256-gcm",
            Buffer.from(hexKey.trim(), "hex"),
            Buffer.from(encryption.iv, "hex")
        );
        decipher.setAuthTag(Buffer.from(encryption.authTag, "hex"));
        stages.push(decipher);
    }
    const decompressStage = createDecompressStream(compression);
    if (decompressStage) stages.push(decompressStage);
    stages.push(fs.createWriteStream(partial));

    try {
        await pipeline(stages);
    } catch (error) {
        // Nothing half-written survives: under AES-GCM the tag is only checked at the end,
        // so a truncated output would otherwise look like a successful restore.
        fs.rmSync(partial, { force: true });
        if (/auth|unable to authenticate/i.test(error.message)) {
            throw new Error("Decryption failed. Either the key is wrong or the backup is damaged.");
        }
        throw error;
    }

    try {
        const unpacked = await unpackMultiDbTar(partial, root, databases);
        if (unpacked) return unpacked;

        if (databases && databases.length > 0) {
            throw new Error(
                "This backup holds a single database, so there is nothing to pick from. Restore it without naming one."
            );
        }

        const target = path.join(root, plainName);
        fs.renameSync(partial, target);
        return [target];
    } finally {
        // The decrypted archive is a means, not a result. A no-op when the single-file path
        // renamed it away, and the cleanup everywhere else.
        fs.rmSync(partial, { force: true });
    }
}

/**
 * Unpacks a multi-database TAR, if that is what this file is.
 *
 * Recognised by its own `manifest.json` declaring version 1, which is what DBackup writes
 * ahead of the dumps. Anything else - a single dump, or some unrelated tar a user happens
 * to have - is left exactly as it is rather than being taken apart on a guess.
 *
 * @returns Paths written, or null when the file is not a multi-database archive.
 */
// LEGACY-FORMAT(read): Unpacks the multi-database TAR that database-only jobs wrote before the
// seekable archive.
async function unpackMultiDbTar(tarPath, outputDir, selection) {
    let fd;
    let members;
    let manifest;
    try {
        fd = fs.openSync(tarPath, "r");
        const size = fs.fstatSync(fd).size;
        if (size < TAR_BLOCK * 2) return null;

        const header = Buffer.alloc(TAR_BLOCK);
        fs.readSync(fd, header, 0, TAR_BLOCK, 0);
        if (header.subarray(257, 262).toString("ascii") !== "ustar") return null;

        members = walkMembers(fd, size);
        const manifestMember = members.find((m) => m.name === MANIFEST_MEMBER);
        if (!manifestMember || manifestMember.size > 1024 * 1024) return null;

        manifest = JSON.parse(readAt(fd, manifestMember.offset, manifestMember.size).toString("utf-8"));
        if (manifest.version !== 1 || !Array.isArray(manifest.databases)) return null;
    } catch {
        return null;
    } finally {
        if (fd !== undefined) { try { fs.closeSync(fd); } catch { /* already gone */ } }
    }

    // The manifest is what maps a database name to the member holding its dump, so a
    // selection is resolved through it rather than by guessing at filenames.
    let wanted = null;
    if (selection && selection.length > 0) {
        const available = manifest.databases.map((db) => db.name);
        const unknown = selection.filter((name) => !available.includes(name));
        if (unknown.length > 0) {
            throw new Error(
                `This backup has no database called ${unknown.join(", ")}. It contains: ${available.join(", ")}`
            );
        }
        wanted = new Set(manifest.databases.filter((db) => selection.includes(db.name)).map((db) => db.filename));
    }

    const written = [];
    for (const member of members) {
        if (member.name === MANIFEST_MEMBER || member.size === 0) continue;
        if (wanted && !wanted.has(member.name)) continue;

        // Refuse anything that would escape the output directory.
        const target = path.resolve(outputDir, member.name);
        const root = path.resolve(outputDir);
        if (target !== root && !target.startsWith(root + path.sep)) {
            console.error(`SKIPPED (unsafe path): ${member.name}`);
            continue;
        }

        // Streamed, not buffered: a single dump in here can be tens of gigabytes.
        fs.mkdirSync(path.dirname(target), { recursive: true });
        await pipeline(
            fs.createReadStream(tarPath, { start: member.offset, end: member.offset + member.size - 1 }),
            fs.createWriteStream(target)
        );
        written.push(target);
    }

    return written;
}

/**
 * Strips `.enc`, then the compression suffix, since the output is decompressed too.
 *
 * A backup that is compressed but not encrypted still gets unpacked here, so its `.gz` has
 * to come off as well - naming the result `.gz.decrypted` would describe neither what it
 * is nor what happened to it.
 */
function defaultDecryptedName(inputPath, compression) {
    let name = inputPath;
    if (name.endsWith(".enc")) name = name.slice(0, -4);
    if (compression === "GZIP" && name.endsWith(".gz")) name = name.slice(0, -3);
    if (compression === "BROTLI" && name.endsWith(".br")) name = name.slice(0, -3);
    // Nothing to strip means there was nothing to do, and writing back to the same path
    // would destroy the input.
    return name === inputPath ? `${inputPath}.restored` : name;
}

// ══════════════════════════════════════════════════════════════════════════════
// Discovery
// ══════════════════════════════════════════════════════════════════════════════

/**
 * Finds every backup at or below a path and groups incremental chains together.
 *
 * The point is that the user never has to know which format they are holding, nor which
 * archive of a chain is the one to point at. They copied a folder, and this works out what
 * is in it.
 *
 * @returns Backups, newest first. Each is either `{kind:"chain"}` or `{kind:"archive"}` for
 * the seekable format, or `{kind:"file"}` for a whole-file encrypted backup.
 */
function scanForBackups(rootPath, maxDepth = 3) {
    const archives = [];
    const wholeFiles = [];

    const visit = (dir, depth) => {
        let entries;
        try {
            entries = fs.readdirSync(dir, { withFileTypes: true });
        } catch {
            return;
        }

        for (const entry of entries) {
            const full = path.join(dir, entry.name);
            if (entry.isDirectory()) {
                if (depth < maxDepth) visit(full, depth + 1);
                continue;
            }
            if (!entry.isFile()) continue;
            // Sidecars describe a backup, they are not one.
            if (full.endsWith(".meta.json") || full.endsWith(".index")) continue;

            const manifest = peekManifest(full);
            if (manifest) {
                archives.push({ path: full, manifest, size: safeSize(full) });
                continue;
            }
            if (fs.existsSync(`${full}.meta.json`)) {
                const meta = readJson(`${full}.meta.json`);
                if (meta) wholeFiles.push({ path: full, meta, size: safeSize(full) });
            }
        }
    };

    const stat = statOrNull(rootPath);
    if (!stat) return [];

    if (stat.isFile()) {
        const manifest = peekManifest(rootPath);
        if (manifest) archives.push({ path: rootPath, manifest, size: safeSize(rootPath) });
        else if (fs.existsSync(`${rootPath}.meta.json`)) {
            const meta = readJson(`${rootPath}.meta.json`);
            if (meta) wholeFiles.push({ path: rootPath, meta, size: safeSize(rootPath) });
        }
        // A single archive named directly is still resolved against its folder, so pointing
        // at one member of a chain finds the rest.
        if (archives.length === 1 && archives[0].manifest.chain) {
            visit(path.dirname(rootPath), maxDepth);
        }
    } else {
        visit(rootPath, 0);
    }

    return groupBackups(archives, wholeFiles);
}

/** Collapses the archives of a chain into one entry, represented by its newest snapshot. */
function groupBackups(archives, wholeFiles) {
    const chains = new Map();
    const found = [];
    const seen = new Set();

    for (const archive of archives) {
        if (seen.has(archive.path)) continue;
        seen.add(archive.path);

        const chainId = archive.manifest.chain?.id;
        if (!chainId) {
            found.push({
                kind: "archive",
                label: path.basename(archive.path),
                path: archive.path,
                createdAt: archive.manifest.createdAt,
                encrypted: Boolean(archive.manifest.encryption),
                size: archive.size,
                manifest: archive.manifest,
                ...contentCounts(archive.manifest),
            });
            continue;
        }

        if (!chains.has(chainId)) chains.set(chainId, []);
        chains.get(chainId).push(archive);
    }

    for (const members of chains.values()) {
        // The newest snapshot describes the whole tree and pulls each file out of whichever
        // archive holds it, so it is the one to point at for "the current state".
        members.sort((a, b) => (a.manifest.chain.index ?? 0) - (b.manifest.chain.index ?? 0));
        const newest = members[members.length - 1];
        found.push({
            kind: "chain",
            label: path.basename(path.dirname(newest.path)),
            path: newest.path,
            createdAt: newest.manifest.createdAt,
            encrypted: Boolean(newest.manifest.encryption),
            size: members.reduce((sum, m) => sum + m.size, 0),
            manifest: newest.manifest,
            members,
            ...contentCounts(newest.manifest),
        });
    }

    for (const file of wholeFiles) {
        // Names, not just a count: a whole-file backup cannot be looked into without
        // decrypting it, so the sidecar's list is the only way to offer a choice up front.
        const names = file.meta.multiDb?.databases
            ?? (Array.isArray(file.meta.databases) ? file.meta.databases : file.meta.databases?.names)
            ?? [];
        found.push({
            kind: "file",
            label: path.basename(file.path),
            path: file.path,
            createdAt: file.meta.timestamp ?? null,
            encrypted: Boolean(file.meta.encryption?.enabled),
            size: file.size,
            meta: file.meta,
            databaseNames: names,
            databases: names.length,
            directorySources: 0,
        });
    }

    return found.sort((a, b) => String(b.createdAt ?? "").localeCompare(String(a.createdAt ?? "")));
}

/**
 * What a v2 archive holds, from its manifest alone.
 *
 * Read during the scan so the menu can offer database selection only where there are
 * databases, without opening anything or asking for a key first.
 */
function contentCounts(manifest) {
    return {
        databases: manifest.counts?.databases ?? 0,
        directorySources: manifest.counts?.directorySources ?? 0,
    };
}

function statOrNull(target) {
    try { return fs.statSync(target); } catch { return null; }
}

function safeSize(target) {
    return statOrNull(target)?.size ?? 0;
}

function readJson(target) {
    try { return JSON.parse(fs.readFileSync(target, "utf-8")); } catch { return null; }
}

// ══════════════════════════════════════════════════════════════════════════════
// Output helpers
// ══════════════════════════════════════════════════════════════════════════════

const COLOR = process.stdout.isTTY && !process.env.NO_COLOR;
const c = {
    dim: (s) => (COLOR ? `\x1b[2m${s}\x1b[0m` : s),
    bold: (s) => (COLOR ? `\x1b[1m${s}\x1b[0m` : s),
    green: (s) => (COLOR ? `\x1b[32m${s}\x1b[0m` : s),
    yellow: (s) => (COLOR ? `\x1b[33m${s}\x1b[0m` : s),
    red: (s) => (COLOR ? `\x1b[31m${s}\x1b[0m` : s),
    cyan: (s) => (COLOR ? `\x1b[36m${s}\x1b[0m` : s),
};

function formatBytes(bytes) {
    const units = ["B", "KB", "MB", "GB", "TB"];
    let value = bytes;
    let unit = 0;
    while (value >= 1024 && unit < units.length - 1) { value /= 1024; unit++; }
    return `${value.toFixed(unit === 0 ? 0 : 1)} ${units[unit]}`;
}

/** Local wall-clock, because a recovery kit is read by a person under pressure. */
function formatDate(iso) {
    if (!iso) return "unknown date";
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) return String(iso);
    const pad = (n) => String(n).padStart(2, "0");
    return `${pad(date.getDate())}.${pad(date.getMonth() + 1)}.${date.getFullYear()} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function describeBackup(backup) {
    const parts = [formatDate(backup.createdAt), formatBytes(backup.size)];
    parts.push(backup.encrypted ? "encrypted" : "not encrypted");
    if (backup.databases > 0) parts.push(`${backup.databases} database(s)`);
    if (backup.directorySources > 0) parts.push(`${backup.directorySources} directory source(s)`);
    if (backup.kind === "chain") {
        parts.push(`incremental chain, ${backup.members.length} archive(s)`);
    }
    return parts.join("  ");
}

// ══════════════════════════════════════════════════════════════════════════════
// Interactive wizard
// ══════════════════════════════════════════════════════════════════════════════

/**
 * Everything the wizard reads goes through here.
 *
 * Deliberately not `readline.createInterface`: the wizard asks many questions in sequence,
 * and opening and closing an interface per question drops whatever the pipe had already
 * delivered past the newline. One buffer, owned here, behaves the same whether stdin is a
 * terminal or a pipe - which is also what makes the tool testable.
 */
let stdinBuffer = "";

function readLine() {
    const take = () => {
        const newline = stdinBuffer.indexOf("\n");
        if (newline === -1) return null;
        const line = stdinBuffer.slice(0, newline).replace(/\r$/, "");
        stdinBuffer = stdinBuffer.slice(newline + 1);
        return line;
    };

    const buffered = take();
    if (buffered !== null) return Promise.resolve(buffered);

    return new Promise((resolve) => {
        const done = (value) => {
            process.stdin.off("data", onData);
            process.stdin.off("end", onEnd);
            process.stdin.pause();
            resolve(value);
        };
        const onData = (chunk) => {
            stdinBuffer += chunk;
            const line = take();
            if (line !== null) done(line);
        };
        // Stdin closing is an answer too - an empty one, which every prompt treats as its
        // default. Without this the tool would hang forever on a closed pipe.
        const onEnd = () => done("");

        process.stdin.setEncoding("utf8");
        process.stdin.resume();
        process.stdin.on("data", onData);
        process.stdin.on("end", onEnd);
    });
}

/**
 * Trims one menu row to the terminal's width, so it can never wrap.
 *
 * A wrapped row breaks the redraw arithmetic, and it reads badly besides. The label is what
 * identifies the backup, so the hint gives up its space first and only what is left over is
 * taken from the label itself.
 */
function fitRow(marker, label, hint) {
    const budget = Math.max(16, (process.stdout.columns || 80) - 1 - marker.length);
    const gap = hint ? 2 : 0;

    if (label.length + gap + (hint?.length ?? 0) <= budget) return { label, hint };

    const shortLabel = label.length > budget ? `${label.slice(0, budget - 1)}…` : label;
    const room = budget - shortLabel.length - gap;
    if (!hint || room < 2) return { label: shortLabel, hint: "" };

    return { label: shortLabel, hint: hint.length > room ? `${hint.slice(0, room - 1)}…` : hint };
}

/**
 * A menu the user drives with the arrow keys, falling back to typing a number.
 *
 * Raw mode is not available everywhere this runs - a piped stdin, some CI shells, the
 * occasional minimal Windows console - and a recovery tool that becomes unusable in those
 * places would defeat its own purpose.
 */
function select(title, options) {
    if (!process.stdin.isTTY) return selectByNumber(title, options);

    return new Promise((resolve) => {
        let cursor = 0;
        /**
         * Physical terminal rows the last frame occupied.
         *
         * Counted rather than assumed. A row wider than the terminal wraps onto a second
         * row, and walking back up one row per option then lands the cursor mid-menu -
         * which is how every keypress came to leave another copy of the menu behind. fitRow
         * should prevent that, but the redraw must not depend on it being right.
         */
        let lastRows = 0;

        const render = () => {
            if (lastRows > 0) process.stdout.write(`\x1b[${lastRows}A\x1b[0J`);

            const width = Math.max(1, process.stdout.columns || 80);
            const rowsFor = (text) => Math.max(1, Math.ceil(text.length / width));
            let rows = 0;

            const titleText = `  ${title.trim()}`;
            process.stdout.write(`${c.bold(titleText)}\n`);
            rows += rowsFor(titleText);

            options.forEach((option, i) => {
                const marker = i === cursor ? " > " : "   ";
                const { label, hint } = fitRow(marker, option.label, option.hint);
                const plain = `${marker}${label}${hint ? `  ${hint}` : ""}`;
                const shown = i === cursor
                    ? `${c.cyan(marker)}${c.bold(label)}${hint ? `  ${c.dim(hint)}` : ""}`
                    : `${marker}${label}${hint ? `  ${c.dim(hint)}` : ""}`;
                process.stdout.write(`${shown}\n`);
                rows += rowsFor(plain);
            });

            lastRows = rows;
        };

        readline.emitKeypressEvents(process.stdin);
        process.stdin.setRawMode(true);
        process.stdin.resume();
        render();

        const onKey = (_str, key) => {
            if (key.name === "up") { cursor = (cursor - 1 + options.length) % options.length; render(); return; }
            if (key.name === "down") { cursor = (cursor + 1) % options.length; render(); return; }
            if (key.name === "return") { finish(options[cursor].value); return; }
            if (key.name === "escape" || (key.ctrl && key.name === "c") || key.name === "q") { finish(null); return; }
        };

        const finish = (value) => {
            process.stdin.off("keypress", onKey);
            process.stdin.setRawMode(false);
            process.stdin.pause();
            resolve(value);
        };

        process.stdin.on("keypress", onKey);
    });
}

async function selectByNumber(title, options) {
    console.log(c.bold(title));
    options.forEach((option, i) => {
        console.log(`  ${i + 1}) ${option.label}${option.hint ? `  ${c.dim(option.hint)}` : ""}`);
    });
    const answer = await ask("Number (or q to quit): ");
    if (answer.toLowerCase() === "q") return null;
    const index = Number.parseInt(answer, 10) - 1;
    if (Number.isNaN(index) || !options[index]) {
        console.log(c.red("Not one of the options."));
        return selectByNumber(title, options);
    }
    return options[index].value;
}

async function ask(question, fallback) {
    process.stdout.write(question);
    const answer = (await readLine()).trim();
    // A terminal echoes the Enter key; a pipe does not, and without this the next line of
    // output runs into the prompt.
    if (!process.stdin.isTTY) process.stdout.write("\n");
    return answer.length > 0 ? answer : (fallback ?? "");
}

async function askYesNo(question, defaultYes = true) {
    const answer = await ask(`${question} ${defaultYes ? "[Y/n]" : "[y/N]"} `);
    if (!answer) return defaultYes;
    return /^y/i.test(answer);
}

function banner(kit) {
    console.log();
    console.log(c.bold("  DBackup Recovery"));
    console.log(c.dim(`  ${describeKeys(kit)}`));
    console.log();
}

async function runWizard(startPath, kit) {
    banner(kit);

    console.log(c.dim(`  Looking in ${path.resolve(startPath)} ...`));
    let backups = scanForBackups(startPath);

    while (backups.length === 0) {
        console.log();
        console.log(c.yellow("  No backups found here."));
        console.log(c.dim("  Copy the backup (or its whole folder, for an incremental chain) next to this tool,"));
        console.log(c.dim("  or give the path to it below."));
        console.log();
        const answer = await ask("  Path to the backup or its folder (empty to quit): ");
        if (!answer) return;
        backups = scanForBackups(answer.replace(/^["']|["']$/g, ""));
        if (backups.length === 0) console.log(c.red(`  Nothing that looks like a backup at ${answer}`));
    }

    while (true) {
        console.log();
        const choice = await select(
            `  Found ${backups.length} backup(s):`,
            backups.map((backup, i) => ({
                label: backup.label,
                hint: describeBackup(backup),
                value: i,
            })).concat([{ label: c.dim("Quit"), value: null }])
        );
        if (choice === null || choice === undefined) return;

        const backup = backups[choice];
        if (backup.encrypted && kit.keys.length === 0) {
            const typed = await promptForKey();
            if (!typed) continue;
            kit.keys.push({ name: "the key you entered", hex: typed });
        }

        let hexKey;
        try {
            hexKey = backup.encrypted ? resolveKey(backup.path, kit.keys) : undefined;
        } catch (error) {
            console.log(c.red(`  ${error.message}`));
            continue;
        }

        await handleBackup(backup, hexKey);

        console.log();
        if (!(await askYesNo("  Do something else?", false))) return;
    }
}

/** A whole-file backup: one dump, or a TAR holding one per database. */
async function handleWholeFileBackup(backup, hexKey) {
    console.log();
    console.log(`  ${c.bold(backup.label)}  ${c.dim(describeBackup(backup))}`);

    let databases;
    if (backup.databaseNames.length > 1) {
        const action = await select("  What do you want?", [
            { label: "Restore everything", value: "all" },
            { label: "Only certain databases", value: "some" },
            { label: c.dim("Back"), value: null },
        ]);
        if (!action) return;
        if (action === "some") {
            databases = await selectMany("  Which databases?", backup.databaseNames);
            if (databases.length === 0) return;
        }
    }

    const outputDir = await askOutputDir();
    try {
        const written = await restoreWholeFile(backup.path, hexKey, outputDir, databases);
        console.log(c.green(`  Restored ${written.length} file(s) to ${outputDir}`));
        for (const file of written) console.log(c.dim(`    ${path.basename(file)}`));
    } catch (error) {
        console.log(c.red(`  ${error.message}`));
    }
}

/** The database names inside a v2 archive. Needs the key, since the index is sealed. */
function listArchiveDatabases(archivePath, hexKey) {
    const archive = openArchive(archivePath, hexKey);
    try {
        return archive.index.databases.map((db) => db.name);
    } finally {
        fs.closeSync(archive.fd);
    }
}

/**
 * Picks several out of a list by number.
 *
 * Not the arrow-key menu: that one returns a single choice, and a checkbox variant needs
 * raw mode, which is exactly what is missing over a pipe. Numbers work everywhere and read
 * the same in both.
 */
async function selectMany(title, options) {
    console.log();
    console.log(c.bold(title));
    options.forEach((option, i) => console.log(`  ${i + 1}) ${option}`));

    const answer = await ask("  Numbers, comma separated (empty for all): ");
    if (!answer) return [...options];

    const chosen = [];
    for (const part of answer.split(",").map((p) => p.trim()).filter(Boolean)) {
        const index = Number.parseInt(part, 10) - 1;
        if (Number.isNaN(index) || !options[index]) {
            console.log(c.red(`  '${part}' is not one of the options.`));
            return selectMany(title, options);
        }
        if (!chosen.includes(options[index])) chosen.push(options[index]);
    }
    return chosen;
}

/**
 * Where a restore lands, asked the same way for every kind of backup.
 *
 * One answer, one default. A database backup used to appear next to its own encrypted file
 * while a file backup went to `restored/`, which made the tool feel like two tools again.
 */
async function askOutputDir() {
    const answer = await ask(`  Restore into [${DEFAULT_OUTPUT_DIR}]: `);
    return answer ? path.resolve(answer.replace(/^["']|["']$/g, "")) : DEFAULT_OUTPUT_DIR;
}

async function promptForKey() {
    console.log();
    console.log(c.yellow("  This backup is encrypted and no master.key was found."));
    console.log(c.dim("  Paste the 64-character key from your Recovery Kit, or put master.key next to this tool."));
    const answer = await ask("  Key: ");
    if (!answer) return null;
    if (!isHexKey(answer)) {
        console.log(c.red("  That is not a 64-character hex key."));
        return null;
    }
    return answer.trim();
}

/** Asks what to do with the chosen backup and does it. */
async function handleBackup(backup, hexKey) {
    if (backup.kind === "file") return handleWholeFileBackup(backup, hexKey);

    const action = await select(`  ${backup.label}`, [
        { label: "Restore everything (latest state)", value: "all" },
        { label: "Show what is inside", value: "list" },
        ...(backup.kind === "chain" ? [{ label: "Pick an older state", value: "older" }] : []),
        ...(backup.databases > 0 ? [{ label: "Only certain databases", value: "databases" }] : []),
        ...(backup.directorySources > 0 ? [{ label: "Only certain files", value: "some" }] : []),
        { label: c.dim("Back"), value: null },
    ]);
    if (!action) return;

    let archivePath = backup.path;
    if (action === "older") {
        const pick = await select("  Which state?", backup.members.map((member) => ({
            label: path.basename(member.path),
            hint: `${formatDate(member.manifest.createdAt)}  ${member.manifest.chain.type}`,
            value: member.path,
        })));
        if (!pick) return;
        archivePath = pick;
    }

    if (action === "list") {
        console.log();
        try { commandList(archivePath, hexKey); } catch (error) { console.log(c.red(`  ${error.message}`)); }
        return;
    }

    let patterns = [];
    if (action === "databases") {
        let names;
        try {
            names = listArchiveDatabases(archivePath, hexKey);
        } catch (error) {
            console.log(c.red(`  ${error.message}`));
            return;
        }
        const chosen = await selectMany("  Which databases?", names);
        if (chosen.length === 0) return;
        // The extract matches databases under this prefix, so a choice is just a pattern -
        // and naming any of them keeps the archive's files out of the restore by itself.
        patterns = chosen.map((name) => `databases/${name}`);
    }

    if (action === "some") {
        console.log();
        console.log(c.dim("  Patterns accept * and **, and naming a folder takes everything in it."));
        console.log(c.dim("  Example: www/**  or  docs"));
        const answer = await ask("  Patterns (comma separated): ");
        patterns = answer.split(",").map((p) => p.trim()).filter(Boolean);
        if (patterns.length === 0) return;
    }

    const outputDir = await askOutputDir();

    console.log();
    try {
        await commandExtract(archivePath, outputDir, hexKey, patterns);
    } catch (error) {
        console.log(c.red(`  ${error.message}`));
    }
}

// ══════════════════════════════════════════════════════════════════════════════
// Commands
// ══════════════════════════════════════════════════════════════════════════════

/**
 * Resolves what the user pointed at into a single archive path.
 *
 * A folder is the common case, not an error: an incremental backup *is* a folder, and
 * "copy the backup somewhere safe" means copying it whole. Pointing the old tool at one
 * produced "not a DBackup v2 archive", which was true and useless.
 */
function resolveArchiveArgument(target) {
    const stat = statOrNull(target);
    if (!stat) throw new Error(`No such file or folder: ${target}`);
    if (stat.isFile()) return target;

    const backups = scanForBackups(target).filter((b) => b.kind !== "file");
    if (backups.length === 0) {
        throw new Error(`No DBackup archive found in ${path.resolve(target)}`);
    }
    if (backups.length > 1) {
        const names = backups.map((b) => `  ${b.label}  (${describeBackup(b)})`).join("\n");
        throw new Error(
            `${path.resolve(target)} holds ${backups.length} backups. Name the one you want, or run this ` +
            `tool without arguments to pick from a list:\n${names}`
        );
    }

    const chosen = backups[0];
    if (chosen.kind === "chain") {
        console.log(c.dim(
            `Incremental chain with ${chosen.members.length} archive(s). Using the newest snapshot, ` +
            `${path.basename(chosen.path)}, which rebuilds the current state from all of them.`
        ));
    }
    return chosen.path;
}

function commandList(archivePath, hexKey) {
    const archive = openArchive(archivePath, hexKey);
    try {
        const { manifest, index } = archive;
        const { chain, missing } = openChain(archivePath, index, hexKey);
        archive.chain = chain;
        console.log(`Archive:     ${path.basename(archivePath)}`);
        console.log(`Created:     ${manifest.createdAt}`);
        console.log(`Source:      ${manifest.sourceType}${manifest.engineVersion ? ` ${manifest.engineVersion}` : ""}`);
        console.log(`Encrypted:   ${manifest.encryption ? "yes" : "no"}`);
        console.log(`Compression: ${manifest.compression}`);
        console.log(`Total size:  ${formatBytes(manifest.totalSize)}`);

        if (manifest.chain) {
            console.log(`Backup type: ${manifest.chain.type} (position ${manifest.chain.index} in its chain)`);
        }
        if (index.deps.length > 0) {
            console.log(`\nNeeds ${index.deps.length} other archive(s) from the same folder:`);
            for (const name of index.deps) {
                console.log(`  ${missing.includes(name) ? "MISSING  " : "found    "}${name}`);
            }
            if (missing.length > 0) {
                console.error(
                    `\nWARNING: ${missing.length} archive(s) are missing. Files stored in them cannot be` +
                    ` restored. Put them in the same folder as this archive and try again.`
                );
                process.exitCode = 1;
            }
        }

        if (index.databases.length > 0) {
            console.log(`\nDatabases (${index.databases.length}):`);
            for (const db of index.databases) {
                console.log(`  ${db.name}  [${db.format}]  ${formatBytes(db.s)}`);
            }
        }

        for (const dir of index.directories) {
            console.log(`\nDirectory source: ${dir.label}`);
            console.log(`  id: ${dir.src}  files: ${dir.fileCount}  size: ${formatBytes(dir.totalSize)}`);
            for (const file of index.files.filter((f) => f.src === dir.src)) {
                // A link's size is always 0, so printing it says nothing. The target is the
                // content, so that is what belongs on the line.
                const shown = file.lnk !== undefined
                    ? `${file.p} -> ${file.lnk}`
                    : file.p;
                const size = file.lnk !== undefined ? "symlink" : formatBytes(file.s);
                console.log(`  ${size.padStart(10)}  ${file.m}  ${shown}`);
            }
        }
    } finally {
        for (const sibling of archive.chain.values()) fs.closeSync(sibling.fd);
        fs.closeSync(archive.fd);
    }
}

async function commandExtract(archivePath, outputDir, hexKey, patterns) {
    const archive = openArchive(archivePath, hexKey);
    try {
        // Resolved before anything is written, so a broken chain is reported by name up
        // front instead of surfacing halfway through as a confusing per-file failure.
        const { chain, missing } = openChain(archivePath, archive.index, hexKey);
        archive.chain = chain;
        if (missing.length > 0) {
            throw new Error(
                `This backup is part of an incremental chain and ${missing.length} archive(s) it needs are` +
                ` missing from this folder: ${missing.join(", ")}`
            );
        }

        let extracted = 0;
        let mismatches = 0;
        const total = archive.index.databases.length + archive.index.files.length;

        for (const db of archive.index.databases) {
            if (patterns.length > 0 && !matchesAny(`databases/${db.name}`, patterns)) continue;

            // A database name comes from the backed-up server and can hold path separators,
            // so it is flattened and the result checked like any file path below.
            const extension = safeNameSegment(DUMP_EXTENSIONS[db.format] || db.format);
            const target = path.resolve(outputDir, "databases", `${safeNameSegment(db.name)}.${extension}`);
            const root = path.resolve(outputDir);
            if (!target.startsWith(root + path.sep)) {
                console.error(`SKIPPED (unsafe name): ${db.name}`);
                continue;
            }

            const resolved = resolveEntry(archive, db.n, undefined);
            const result = await streamEntryToFile(resolved.target, resolved.entry, target, db.h);
            if (!result.ok) {
                console.error(`CHECKSUM MISMATCH: database ${db.name} (not written)`);
                mismatches++;
                continue;
            }
            console.log(`database  ${db.name} -> ${target}`);
            extracted++;
        }

        // Symbolic links are collected on the way past and created at the very end. That
        // order is a security property, not tidiness: path checks work on strings and never
        // ask the filesystem, so an archive holding "foo -> /etc" followed by a file "foo/x"
        // passes every check and still writes outside outputDir. With no link from this
        // archive present while files are being written, there is nothing to write through.
        const pendingSymlinks = [];

        for (const file of archive.index.files) {
            if (!matchesAny(file.p, patterns)) continue;

            // Refuse anything that would escape the output directory.
            const target = path.resolve(outputDir, file.src, file.p);
            const root = path.resolve(outputDir);
            if (target !== root && !target.startsWith(root + path.sep)) {
                console.error(`SKIPPED (unsafe path): ${file.p}`);
                continue;
            }

            // A symbolic link has no entry to resolve - its whole content is the target
            // string in the index.
            if (file.lnk !== undefined) {
                pendingSymlinks.push({ target, linkTarget: file.lnk });
                continue;
            }

            const resolved = resolveEntry(archive, file.n, file.a);

            if (resolved.entry.bundle) {
                // A bundle holds many small files (64 KB each at most) and is sliced by
                // offset, so random access needs it in memory - a few MB at worst.
                const content = readFileFromArchive(archive, file);
                if (file.h && crypto.createHash("sha256").update(content).digest("hex") !== file.h) {
                    console.error(`CHECKSUM MISMATCH: ${file.p}`);
                    mismatches++;
                }
                fs.mkdirSync(path.dirname(target), { recursive: true });
                fs.writeFileSync(target, content);
            } else {
                // Everything else streams: a single file here can be tens of gigabytes,
                // and a recovery tool that needs as much RAM as the file is no use.
                const result = await streamEntryToFile(resolved.target, resolved.entry, target, file.h);
                if (!result.ok) {
                    console.error(`CHECKSUM MISMATCH: ${file.p} (not written)`);
                    mismatches++;
                    continue;
                }
            }
            extracted++;
            reportProgress(extracted, total);
        }

        for (const link of pendingSymlinks) {
            fs.mkdirSync(path.dirname(link.target), { recursive: true });
            // Removed first: symlink() fails on an existing path. unlink takes the link
            // itself, never what it points at, so re-running cannot delete real data.
            try { fs.unlinkSync(link.target); } catch { /* not there, which is the normal case */ }
            fs.symlinkSync(link.linkTarget, link.target);
            extracted++;
            reportProgress(extracted, total);
        }

        clearProgress();
        console.log(`\nExtracted ${extracted} item(s) to ${path.resolve(outputDir)}`);
        if (mismatches > 0) {
            console.error(`WARNING: ${mismatches} file(s) did not match their recorded checksum.`);
            process.exitCode = 2;
        }
        if (extracted === 0) {
            console.error("Nothing matched. Run --list to see what the archive contains.");
            process.exitCode = 1;
        }
    } finally {
        for (const sibling of archive.chain.values()) fs.closeSync(sibling.fd);
        fs.closeSync(archive.fd);
    }
}

/** One rewritten line, so a large restore does not scroll thousands of filenames past. */
function reportProgress(done, total) {
    if (!process.stdout.isTTY) return;
    process.stdout.write(`\r  Restoring ${done}/${total} ...\x1b[K`);
}

function clearProgress() {
    if (process.stdout.isTTY) process.stdout.write("\r\x1b[K");
}

// ══════════════════════════════════════════════════════════════════════════════
// Entry point
// ══════════════════════════════════════════════════════════════════════════════

function usage() {
    console.log(`DBackup Recovery Tool

Run it with no arguments to be asked what to do:

  node dbackup-recover.js

Or drive it directly:

  node dbackup-recover.js --list    <archive|folder> [<hex_key>]
  node dbackup-recover.js --extract <archive|folder> <output_dir> [<hex_key>] [pattern...]
  node dbackup-recover.js --decrypt <backup.enc> [<hex_key>] [<output_dir>] [database...]

Everything is restored into ./restored unless another folder is named. A database backup
holding several databases is unpacked into one dump per database, not left as a .tar - name
the ones you want to restore just those:

  node dbackup-recover.js --decrypt AllDbs.tar.enc ./restored shop
  node dbackup-recover.js --extract backup.tar ./restored databases/shop

Run --list first to see which databases a backup contains.

The key is read from master.key next to this file when it is there, so it usually does not
need to be passed at all. Unencrypted backups need no key either.

Patterns accept * and **, and naming a folder selects everything inside it. Omit them to
restore the whole backup.

An incremental backup is a folder of archives. Point this tool at the folder and it picks
the newest snapshot, which rebuilds the current state out of all of them.`);
}

async function main() {
    const args = process.argv.slice(2);
    const kit = loadKeys();

    if (args.length === 0) {
        await runWizard(process.cwd(), kit);
        return;
    }

    if (args[0] === "--help" || args[0] === "-h") {
        usage();
        return;
    }

    if (args[0] === "--list") {
        if (!args[1]) throw new Error("Missing archive path");
        const archive = resolveArchiveArgument(args[1]);
        commandList(archive, isHexKey(args[2]) ? args[2].trim() : resolveKey(archive, kit.keys));
        return;
    }

    if (args[0] === "--extract") {
        if (!args[1] || !args[2]) throw new Error("Missing archive path or output directory");
        const rest = args.slice(3);
        const archive = resolveArchiveArgument(args[1]);
        const hexKey = isHexKey(rest[0]) ? rest.shift().trim() : resolveKey(archive, kit.keys);
        await commandExtract(archive, args[2], hexKey, rest);
        return;
    }

    if (args[0] === "--decrypt") {
        if (!args[1]) throw new Error("Missing backup path");
        const rest = args.slice(2);
        const hexKey = isHexKey(rest[0]) ? rest.shift().trim() : resolveKey(args[1], kit.keys);
        const outputDir = rest.length > 0 ? path.resolve(rest.shift()) : DEFAULT_OUTPUT_DIR;
        // Anything further names the databases to restore, mirroring how --extract takes
        // patterns after its output directory.
        const written = await restoreWholeFile(args[1], hexKey, outputDir, rest);
        console.log(`Restored ${written.length} file(s) to ${outputDir}`);
        for (const file of written) console.log(`  ${path.basename(file)}`);
        return;
    }

    usage();
    process.exitCode = 1;
}

// Only when started, not when required. Exporting the pure helpers below lets the test
// suite check the fiddly ones directly instead of driving a terminal, and changes nothing
// about how the kit runs this file.
if (require.main === module) {
    main().catch((error) => {
        console.error(`\n${c.red("Error:")} ${error.message}`);
        process.exitCode = 1;
    });
}

module.exports = { fitRow, looksLikeBackupContent, defaultDecryptedName, keyFor };
