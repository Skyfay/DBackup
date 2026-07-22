#!/usr/bin/env node
/**
 * DBackup Recovery Tool - seekable archive format (manifest version 2)
 *
 * Standalone. Needs nothing but Node.js 18+ - no DBackup server, no database, no npm
 * install. This file is a complete, independent implementation of the archive format
 * documented in docs/developer-guide/reference/archive-format.md, so a backup stays
 * recoverable even if DBackup itself is gone. Keep it with your master key.
 *
 * Usage:
 *   node restore_archive.js --list    <archive> [<hex_key>]
 *   node restore_archive.js --extract <archive> <output_dir> [<hex_key>] [glob...]
 *
 * Examples:
 *   node restore_archive.js --list backup.tar
 *   node restore_archive.js --extract backup.tar ./out abc123... 'www/**'
 *
 * The key is only needed for encrypted archives. An unencrypted archive can also be
 * unpacked with plain `tar -xf`, followed by `gunzip` on the extracted files if the job
 * used compression.
 */

/* eslint-disable @typescript-eslint/no-require-imports */
// CommonJS on purpose: this file is extracted from the Recovery Kit into an arbitrary
// folder with no package.json, where Node treats a bare .js as CommonJS.
const fs = require("fs");
const path = require("path");
const zlib = require("zlib");
const crypto = require("crypto");

// ── Format constants (see the spec document) ──────────────────────────────
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

// ── Crypto ────────────────────────────────────────────────────────────────

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

// ── TAR reading ───────────────────────────────────────────────────────────

function readString(block, start, length) {
    const raw = block.subarray(start, start + length);
    const end = raw.indexOf(0);
    return raw.subarray(0, end === -1 ? raw.length : end).toString("utf-8");
}

function readOctal(block, start, length) {
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

        const size = readOctal(block, 124, 12);
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

function readAt(fd, offset, size) {
    const buffer = Buffer.alloc(size);
    if (size > 0) fs.readSync(fd, buffer, 0, size, offset);
    return buffer;
}

// ── Archive access ────────────────────────────────────────────────────────

function openArchive(archivePath, hexKey) {
    const fd = fs.openSync(archivePath, "r");
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
            `This archive uses format version ${manifest.version}. Use decrypt_backup.js for older backups.`
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

    return { fd, manifest, index, keys, chain: new Map() };
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

/** Returns the plaintext bytes of one physical entry, from this archive or a chain sibling. */
function readEntry(archive, ordinal, fromArchive) {
    const target = fromArchive ? archive.chain.get(fromArchive) : archive;
    if (!target) {
        throw new Error(`Archive '${fromArchive}' is part of this backup's chain but is not in this folder`);
    }

    const entry = target.index.entries.get(entryKey(undefined, ordinal))
        ?? archive.index.entries.get(entryKey(fromArchive, ordinal));
    if (!entry) throw new Error(`Index references missing entry ${ordinal}`);

    let payload = readAt(target.fd, entry.off, entry.size);
    if (entry.sealed) {
        payload = openEntry(payload, target.keys.dataKey, target.manifest.encryption.noncePrefix, entry.n);
    }
    return decompress(payload, entry.comp);
}

/** Returns the plaintext bytes of one logical file, slicing it out of a bundle if needed. */
function readFile(archive, fileLine) {
    const payload = readEntry(archive, fileLine.n, fileLine.a);
    if (fileLine.o === undefined || fileLine.l === undefined) return payload;
    return payload.subarray(fileLine.o, fileLine.o + fileLine.l);
}

// ── Matching ──────────────────────────────────────────────────────────────

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

// ── Commands ──────────────────────────────────────────────────────────────

function formatBytes(bytes) {
    const units = ["B", "KB", "MB", "GB", "TB"];
    let value = bytes;
    let unit = 0;
    while (value >= 1024 && unit < units.length - 1) { value /= 1024; unit++; }
    return `${value.toFixed(unit === 0 ? 0 : 1)} ${units[unit]}`;
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
                console.log(`  ${formatBytes(file.s).padStart(10)}  ${file.m}  ${file.p}`);
            }
        }
    } finally {
        for (const sibling of archive.chain.values()) fs.closeSync(sibling.fd);
        fs.closeSync(archive.fd);
    }
}

function commandExtract(archivePath, outputDir, hexKey, patterns) {
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

        for (const db of archive.index.databases) {
            if (patterns.length > 0 && !matchesAny(`databases/${db.name}`, patterns)) continue;
            const target = path.join(outputDir, "databases", `${db.name}.${db.format === "custom" ? "dump" : db.format}`);
            fs.mkdirSync(path.dirname(target), { recursive: true });
            fs.writeFileSync(target, readEntry(archive, db.n));
            console.log(`database  ${db.name} -> ${target}`);
            extracted++;
        }

        for (const file of archive.index.files) {
            if (!matchesAny(file.p, patterns)) continue;

            // Refuse anything that would escape the output directory.
            const target = path.resolve(outputDir, file.src, file.p);
            const root = path.resolve(outputDir);
            if (target !== root && !target.startsWith(root + path.sep)) {
                console.error(`SKIPPED (unsafe path): ${file.p}`);
                continue;
            }

            const content = readFile(archive, file);
            if (file.h) {
                const actual = crypto.createHash("sha256").update(content).digest("hex");
                if (actual !== file.h) {
                    console.error(`CHECKSUM MISMATCH: ${file.p}`);
                    mismatches++;
                }
            }

            fs.mkdirSync(path.dirname(target), { recursive: true });
            fs.writeFileSync(target, content);
            extracted++;
        }

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

// ── Entry point ───────────────────────────────────────────────────────────

function usage() {
    console.log(`DBackup Recovery Tool (seekable archive format)

  node restore_archive.js --list    <archive> [<hex_key>]
  node restore_archive.js --extract <archive> <output_dir> [<hex_key>] [pattern...]

The key is only needed for encrypted archives. Patterns accept * and **, and naming a
folder selects everything inside it. Omit patterns to extract the whole archive.

Incremental backups are stored as a chain in one folder. Point this tool at the snapshot
you want and keep the other archives in the same folder - it resolves them itself.`);
}

function main() {
    const args = process.argv.slice(2);
    if (args.length === 0 || args[0] === "--help" || args[0] === "-h") {
        usage();
        return;
    }

    const isHexKey = (value) => typeof value === "string" && /^[0-9a-fA-F]{64}$/.test(value.trim());

    try {
        if (args[0] === "--list") {
            if (!args[1]) throw new Error("Missing archive path");
            commandList(args[1], isHexKey(args[2]) ? args[2] : undefined);
            return;
        }

        if (args[0] === "--extract") {
            if (!args[1] || !args[2]) throw new Error("Missing archive path or output directory");
            const rest = args.slice(3);
            const hexKey = isHexKey(rest[0]) ? rest.shift() : undefined;
            commandExtract(args[1], args[2], hexKey, rest);
            return;
        }

        usage();
        process.exitCode = 1;
    } catch (error) {
        console.error(`\nError: ${error.message}`);
        process.exitCode = 1;
    }
}

main();
