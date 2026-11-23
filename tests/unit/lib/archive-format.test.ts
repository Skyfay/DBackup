import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "fs/promises";
import path from "path";
import os from "os";
import crypto from "crypto";
import { execFile } from "child_process";
import { promisify } from "util";
import { createArchive } from "@/lib/archive/writer";
import {
    readArchiveManifest,
    readArchiveIndex,
    readArchiveFile,
    openArchiveEntry,
    groupFilesByEntry,
} from "@/lib/archive/reader";
import { extractArchive } from "@/lib/archive/extract";
import { localFileSource, readAll } from "@/lib/archive/sources";
import { buildUstarHeader, tarPadding, TAR_TRAILER, walkTarHeaders } from "@/lib/archive/tar-blocks";
import { gunzipSync, gzipSync } from "zlib";
import { MANIFEST_MEMBER, INDEX_MEMBER, BUNDLE_FILE_MAX_SIZE } from "@/lib/archive/format";
import { entryKey } from "@/lib/archive/types";
import type { ArchiveSourceEntry, CompressionKind, SourceFileEntry } from "@/lib/archive/types";

const execFileAsync = promisify(execFile);

const MASTER_KEY = Buffer.alloc(32, 0x5a);
const PROFILE_ID = "profile-1234";

/** Path segments and names that must never appear in cleartext in an encrypted archive. */
const SECRET_PATH = "kunden/acme-gmbh/kuendigung.pdf";
const SECRET_DB = "hr_gehaltsdaten";

let workDir: string;
let sourceDir: string;

beforeEach(async () => {
    workDir = await fs.mkdtemp(path.join(os.tmpdir(), "archive-test-"));
    sourceDir = path.join(workDir, "src");
    await fs.mkdir(sourceDir, { recursive: true });
});

afterEach(async () => {
    await fs.rm(workDir, { recursive: true, force: true });
});

interface FixtureFile {
    relPath: string;
    content: Buffer;
}

async function writeSourceTree(files: FixtureFile[]): Promise<SourceFileEntry[]> {
    const entries: SourceFileEntry[] = [];
    for (const file of files) {
        const target = path.join(sourceDir, file.relPath);
        await fs.mkdir(path.dirname(target), { recursive: true });
        await fs.writeFile(target, file.content);
        entries.push({
            path: file.relPath,
            size: file.content.length,
            mtime: "2026-07-22T10:00:00.000Z",
            checksum: crypto.createHash("sha256").update(file.content).digest("hex"),
        });
    }
    return entries;
}

async function writeDump(name: string, content: Buffer): Promise<string> {
    const target = path.join(workDir, name);
    await fs.writeFile(target, content);
    return target;
}

/** Small files bundle, the large one always gets its own entry. */
function standardFixture(): FixtureFile[] {
    return [
        { relPath: "www/index.php", content: Buffer.from("<?php echo 'hello'; ?>\n".repeat(20)) },
        { relPath: SECRET_PATH, content: Buffer.from("vertrauliche Kuendigung\n".repeat(30)) },
        { relPath: "www/assets/app.css", content: Buffer.from("body{margin:0}\n".repeat(50)) },
        { relPath: "www/empty.txt", content: Buffer.alloc(0) },
        { relPath: "big/payload.bin", content: crypto.randomBytes(BUNDLE_FILE_MAX_SIZE * 3) },
    ];
}

async function buildArchive(opts: {
    compression?: "NONE" | CompressionKind;
    encrypted: boolean;
    files?: FixtureFile[];
    withDatabase?: boolean;
}) {
    const fixture = opts.files ?? standardFixture();
    const files = await writeSourceTree(fixture);

    const entries: ArchiveSourceEntry[] = [];
    if (opts.withDatabase !== false) {
        entries.push({
            kind: "database",
            dbName: SECRET_DB,
            path: await writeDump("dump.sql", Buffer.from("CREATE TABLE gehalt (betrag INT);\n".repeat(40))),
            format: "sql",
        });
    }
    entries.push({
        kind: "directory",
        jobSourceId: "src-uuid-1",
        label: "SFTP Server: /var/www",
        localPath: sourceDir,
        excludePatterns: ["*.log"],
        files,
    });

    const archivePath = path.join(workDir, "backup.tar");
    const result = await createArchive(entries, archivePath, {
        sourceType: opts.withDatabase === false ? "directory-only" : "mysql",
        engineVersion: "8.0.32",
        compression: opts.compression ?? "NONE",
        ...(opts.encrypted ? { encryption: { masterKey: MASTER_KEY, profileId: PROFILE_ID } } : {}),
    });

    return { archivePath, result, fixture };
}

describe("createArchive / read back", () => {
    const combos: { label: string; compression: "NONE" | CompressionKind; encrypted: boolean }[] = [
        { label: "plain, uncompressed", compression: "NONE", encrypted: false },
        { label: "plain, gzip", compression: "GZIP", encrypted: false },
        { label: "encrypted, uncompressed", compression: "NONE", encrypted: true },
        { label: "encrypted, gzip", compression: "GZIP", encrypted: true },
        { label: "encrypted, brotli", compression: "BROTLI", encrypted: true },
    ];

    for (const combo of combos) {
        it(`round-trips every file and database (${combo.label})`, async () => {
            const { archivePath, fixture } = await buildArchive(combo);

            const source = await localFileSource(archivePath);
            const manifest = await readArchiveManifest(source);
            const masterKey = combo.encrypted ? MASTER_KEY : undefined;
            const index = await readArchiveIndex(source, manifest, { masterKey });

            expect(manifest.version).toBe(2);
            expect(manifest.compression).toBe(combo.compression);
            expect(!!manifest.encryption).toBe(combo.encrypted);
            expect(index.files).toHaveLength(fixture.length);
            expect(index.databases.map((d) => d.name)).toEqual([SECRET_DB]);
            expect(index.directories[0].excludePatterns).toEqual(["*.log"]);

            for (const expected of fixture) {
                const line = index.files.find((f) => f.p === expected.relPath);
                expect(line, `missing index line for ${expected.relPath}`).toBeDefined();
                expect(line!.s).toBe(expected.content.length);

                const actual = await readArchiveFile(source, manifest, index, line!, masterKey);
                expect(actual.equals(expected.content)).toBe(true);
                // The recorded checksum has to describe the plaintext, not the stored bytes.
                expect(crypto.createHash("sha256").update(actual).digest("hex")).toBe(line!.h);
            }

            const dbLine = index.databases[0];
            const dbEntry = index.entries.get(entryKey(undefined, dbLine.n))!;
            const dumpBytes = await readAll(await openArchiveEntry(source, manifest, dbEntry, masterKey, dbLine.s));
            expect(dumpBytes.toString("utf-8")).toContain("CREATE TABLE gehalt");
        });
    }

    it("records byte-exact offsets that match the physical archive", async () => {
        const { archivePath } = await buildArchive({ compression: "GZIP", encrypted: true });

        const source = await localFileSource(archivePath);
        const manifest = await readArchiveManifest(source);
        const index = await readArchiveIndex(source, manifest, { masterKey: MASTER_KEY });

        const located = new Map((await walkTarHeaders(archivePath)).map((m) => [m.name, m]));
        const raw = await fs.readFile(archivePath);

        for (const entry of index.entries.values()) {
            const member = located.get(entry.member);
            expect(member, `member ${entry.member} not found in archive`).toBeDefined();
            expect(entry.off).toBe(member!.offset);
            expect(entry.size).toBe(member!.size);
            // And the range actually holds the entry's bytes.
            expect(raw.subarray(entry.off, entry.off + entry.size)).toHaveLength(entry.size);
        }
    });

    it("writes a sidecar that is byte-identical to the embedded index member", async () => {
        const { archivePath, result } = await buildArchive({ compression: "GZIP", encrypted: true });

        const located = (await walkTarHeaders(archivePath)).find((m) => m.name === INDEX_MEMBER)!;
        const raw = await fs.readFile(archivePath);
        const embedded = raw.subarray(located.offset, located.offset + located.size);

        expect(embedded.equals(result.indexBytes)).toBe(true);

        // And the embedded copy alone is enough to browse, which is the disaster fallback
        // for a lost sidecar.
        const source = await localFileSource(archivePath);
        const manifest = await readArchiveManifest(source);
        const fromEmbedded = await readArchiveIndex(source, manifest, { masterKey: MASTER_KEY });
        expect(fromEmbedded.files.map((f) => f.p).sort()).toEqual(result.index.files.map((f) => f.p).sort());
    });
});

describe("encrypted archives leak nothing in cleartext", () => {
    it("keeps paths, database names and plaintext checksums out of the manifest and tar headers", async () => {
        const { archivePath, result } = await buildArchive({ compression: "GZIP", encrypted: true });

        const raw = await fs.readFile(archivePath);
        const members = await walkTarHeaders(archivePath);
        const manifestMember = members.find((m) => m.name === MANIFEST_MEMBER)!;
        const manifestJson = raw.subarray(manifestMember.offset, manifestMember.offset + manifestMember.size).toString("utf-8");

        // 1. Member names are opaque - a tar listing must reveal nothing.
        for (const member of members) {
            if (member.name === MANIFEST_MEMBER || member.name === INDEX_MEMBER) continue;
            expect(member.name).toMatch(/^d\/\d{6}$/);
        }

        // 2. The cleartext manifest carries no user data.
        expect(manifestJson).not.toContain(SECRET_DB);
        expect(manifestJson).not.toContain("acme-gmbh");
        expect(manifestJson).not.toContain("index.php");
        for (const file of result.index.files) {
            if (file.h) expect(manifestJson).not.toContain(file.h);
        }

        // 3. Nothing sensitive survives anywhere in the raw bytes, headers or payloads.
        const asText = raw.toString("latin1");
        expect(asText).not.toContain(SECRET_DB);
        expect(asText).not.toContain("acme-gmbh");
        expect(asText).not.toContain("kuendigung.pdf");
        expect(asText).not.toContain("vertrauliche Kuendigung");
        expect(asText).not.toContain("CREATE TABLE gehalt");
        for (const file of result.index.files) {
            if (file.h) expect(asText).not.toContain(file.h);
        }
    });

    it("refuses to open the index with the wrong master key", async () => {
        const { archivePath } = await buildArchive({ compression: "GZIP", encrypted: true });

        const source = await localFileSource(archivePath);
        const manifest = await readArchiveManifest(source);

        await expect(readArchiveIndex(source, manifest, { masterKey: Buffer.alloc(32, 0x99) }))
            .rejects.toThrow(/authentication failed/i);
        await expect(readArchiveIndex(source, manifest)).rejects.toThrow(/no master key/i);
    });

    it("refuses to open an entry whose bytes were tampered with", async () => {
        const { archivePath } = await buildArchive({ compression: "NONE", encrypted: true });

        const source = await localFileSource(archivePath);
        const manifest = await readArchiveManifest(source);
        const index = await readArchiveIndex(source, manifest, { masterKey: MASTER_KEY });
        const file = index.files.find((f) => f.p === "big/payload.bin")!;
        const entry = index.entries.get(entryKey(file.a, file.n!))!;

        const raw = await fs.readFile(archivePath);
        raw[entry.off + 10] ^= 0xff;
        await fs.writeFile(archivePath, raw);

        const tampered = await localFileSource(archivePath);
        await expect(readArchiveFile(tampered, manifest, index, file, MASTER_KEY))
            .rejects.toThrow(/authentication failed/i);
    });
});

describe("unencrypted archives stay recoverable with plain tar", () => {
    it("uses real member paths and unpacks with system tar", async () => {
        const { archivePath, fixture } = await buildArchive({ compression: "NONE", encrypted: false });

        const extractDir = path.join(workDir, "out");
        await fs.mkdir(extractDir);
        await execFileAsync("tar", ["-xf", archivePath, "-C", extractDir]);

        for (const file of fixture) {
            const extracted = await fs.readFile(path.join(extractDir, "sources", "src-uuid-1", file.relPath));
            expect(extracted.equals(file.content)).toBe(true);
        }
        expect(await fs.readFile(path.join(extractDir, "databases", `${SECRET_DB}.sql`), "utf-8"))
            .toContain("CREATE TABLE gehalt");
    });

    it("appends the compression extension so members are self-describing", async () => {
        const { archivePath } = await buildArchive({ compression: "GZIP", encrypted: false });

        const names = (await walkTarHeaders(archivePath)).map((m) => m.name);
        expect(names).toContain(`databases/${SECRET_DB}.sql.gz`);
        expect(names).toContain("sources/src-uuid-1/www/index.php.gz");

        // And the member really is gzip, so `gunzip` finishes the job.
        const raw = await fs.readFile(archivePath);
        const member = (await walkTarHeaders(archivePath)).find((m) => m.name.endsWith("index.php.gz"))!;
        expect(raw.subarray(member.offset, member.offset + 2)).toEqual(Buffer.from([0x1f, 0x8b]));
    });

    it("never bundles, so every file keeps its own member", async () => {
        const { archivePath, result } = await buildArchive({ compression: "NONE", encrypted: false });

        expect(result.manifest.bundled).toBeUndefined();
        for (const entry of result.index.entries.values()) {
            expect(entry.bundle).toBeUndefined();
        }
        expect(result.manifest.counts.entries).toBe(result.manifest.counts.files + result.manifest.counts.databases);
        void archivePath;
    });
});

describe("files already in a compressed format are stored as-is", () => {
    /** Random bytes stand in for real media: there is nothing in them for a compressor to find. */
    const MIXED: FixtureFile[] = [
        { relPath: "media/holiday.jpg", content: crypto.randomBytes(BUNDLE_FILE_MAX_SIZE * 2) },
        { relPath: "media/clip.mp4", content: crypto.randomBytes(BUNDLE_FILE_MAX_SIZE * 2) },
        { relPath: "www/notes.txt", content: Buffer.from("the same line over and over\n".repeat(8000)) },
    ];

    it("skips compression per file while its neighbours stay compressed", async () => {
        const { archivePath, result } = await buildArchive({
            compression: "GZIP",
            encrypted: true,
            files: MIXED,
            withDatabase: false,
        });

        const entryFor = (relPath: string) => {
            const line = result.index.files.find((f) => f.p === relPath)!;
            return result.index.entries.get(entryKey(line.a, line.n!))!;
        };

        expect(entryFor("media/holiday.jpg").comp).toBeUndefined();
        expect(entryFor("media/clip.mp4").comp).toBeUndefined();
        expect(entryFor("www/notes.txt").comp).toBe("GZIP");

        // A mixed archive still has to read back exactly, which is the whole point of `comp`
        // being per entry rather than per archive.
        const source = await localFileSource(archivePath);
        const manifest = await readArchiveManifest(source);
        const index = await readArchiveIndex(source, manifest, { masterKey: MASTER_KEY });
        for (const file of MIXED) {
            const line = index.files.find((f) => f.p === file.relPath)!;
            const actual = await readArchiveFile(source, manifest, index, line, MASTER_KEY);
            expect(actual.equals(file.content), file.relPath).toBe(true);
        }
    });

    it("names the member without a compression extension, so plain tar yields a usable file", async () => {
        const { archivePath } = await buildArchive({
            compression: "GZIP",
            encrypted: false,
            files: MIXED,
            withDatabase: false,
        });

        const names = (await walkTarHeaders(archivePath)).map((m) => m.name);
        expect(names).toContain("sources/src-uuid-1/media/holiday.jpg");
        expect(names).toContain("sources/src-uuid-1/www/notes.txt.gz");
        // A `.gz` on a member that was never gzipped is the failure this guards against:
        // `tar -xf` followed by `gunzip` would fail on a file that needed neither.
        expect(names).not.toContain("sources/src-uuid-1/media/holiday.jpg.gz");

        const extractDir = path.join(workDir, "out");
        await fs.mkdir(extractDir);
        await execFileAsync("tar", ["-xf", archivePath, "-C", extractDir]);
        const extracted = await fs.readFile(path.join(extractDir, "sources", "src-uuid-1", "media", "holiday.jpg"));
        expect(extracted.equals(MIXED[0].content)).toBe(true);
    });

    it("leaves small files in their bundle, which stays compressed as a whole", async () => {
        const files: FixtureFile[] = [
            { relPath: "thumbs/small.jpg", content: crypto.randomBytes(4 * 1024) },
            { relPath: "www/tiny.txt", content: Buffer.from("repeat\n".repeat(500)) },
        ];
        const { result } = await buildArchive({ compression: "GZIP", encrypted: true, files, withDatabase: false });

        const thumb = result.index.files.find((f) => f.p === "thumbs/small.jpg")!;
        expect(thumb.o, "small files belong in a bundle regardless of their format").toBeDefined();
        expect(result.index.entries.get(entryKey(thumb.a, thumb.n!))!.comp).toBe("GZIP");
    });

    it("reports what it skipped, and nothing when the job has no compression", async () => {
        const compressed = await buildArchive({
            compression: "GZIP",
            encrypted: true,
            files: MIXED,
            withDatabase: false,
        });
        expect(compressed.result.skippedCompression.files).toBe(2);
        expect(compressed.result.skippedCompression.bytes).toBe(
            MIXED[0].content.length + MIXED[1].content.length
        );

        const plain = await buildArchive({
            compression: "NONE",
            encrypted: true,
            files: MIXED,
            withDatabase: false,
        });
        expect(plain.result.skippedCompression).toEqual({ files: 0, bytes: 0 });
    });
});

describe("small-file bundling", () => {
    it("packs small files together and gives large files their own entry", async () => {
        const { result } = await buildArchive({ compression: "GZIP", encrypted: true });

        expect(result.manifest.bundled).toBe(true);

        const bundled = result.index.files.filter((f) => f.o !== undefined);
        const standalone = result.index.files.filter((f) => f.o === undefined);

        expect(bundled.map((f) => f.p).sort()).toEqual(
            [SECRET_PATH, "www/assets/app.css", "www/empty.txt", "www/index.php"].sort()
        );
        expect(standalone.map((f) => f.p)).toEqual(["big/payload.bin"]);

        // All four small files share a single physical entry.
        expect(new Set(bundled.map((f) => f.n)).size).toBe(1);
        expect(result.manifest.counts.entries).toBeLessThan(result.manifest.counts.files);
    });

    it("starts a new bundle once the target size is reached", async () => {
        const files: FixtureFile[] = [];
        // 160 files of 48 KB is ~7.5 MB of payload, comfortably over one 4 MB bundle.
        for (let i = 0; i < 160; i++) {
            files.push({ relPath: `many/file-${i}.bin`, content: crypto.randomBytes(48 * 1024) });
        }

        const { archivePath, result } = await buildArchive({
            compression: "NONE",
            encrypted: true,
            files,
            withDatabase: false,
        });

        const bundles = [...result.index.entries.values()].filter((e) => e.bundle);
        expect(bundles.length).toBeGreaterThan(1);

        // Every file still reads back correctly across the bundle boundary.
        const source = await localFileSource(archivePath);
        const manifest = await readArchiveManifest(source);
        const index = await readArchiveIndex(source, manifest, { masterKey: MASTER_KEY });

        for (const expected of [files[0], files[80], files[159]]) {
            const line = index.files.find((f) => f.p === expected.relPath)!;
            const actual = await readArchiveFile(source, manifest, index, line, MASTER_KEY);
            expect(actual.equals(expected.content)).toBe(true);
        }
    });

    it("groups files so each physical entry is fetched once", async () => {
        const { result } = await buildArchive({ compression: "GZIP", encrypted: true });

        const grouped = groupFilesByEntry(result.index.files);
        expect(grouped.size).toBeLessThan(result.index.files.length);
        for (const group of grouped.values()) {
            const offsets = group.map((f) => f.o ?? 0);
            expect(offsets).toEqual([...offsets].sort((a, b) => a - b));
        }
    });
});

describe("edge cases", () => {
    it("handles a directory-only archive with no database source", async () => {
        const { archivePath } = await buildArchive({ compression: "GZIP", encrypted: true, withDatabase: false });

        const source = await localFileSource(archivePath);
        const manifest = await readArchiveManifest(source);

        expect(manifest.sourceType).toBe("directory-only");
        expect(manifest.counts.databases).toBe(0);
        expect((await readArchiveIndex(source, manifest, { masterKey: MASTER_KEY })).databases).toEqual([]);
    });

    it("handles an empty directory source", async () => {
        const { archivePath, result } = await buildArchive({
            compression: "GZIP",
            encrypted: true,
            files: [],
            withDatabase: false,
        });

        expect(result.manifest.counts.files).toBe(0);
        expect(result.manifest.counts.entries).toBe(0);

        const source = await localFileSource(archivePath);
        const manifest = await readArchiveManifest(source);
        expect((await readArchiveIndex(source, manifest, { masterKey: MASTER_KEY })).files).toEqual([]);
    });

    it("extracts everything, and only the selection when one is given", async () => {
        const { archivePath, fixture } = await buildArchive({ compression: "GZIP", encrypted: true });

        const allDir = path.join(workDir, "all");
        const all = await extractArchive(archivePath, allDir, { masterKey: MASTER_KEY });

        expect(all.databaseFiles).toHaveLength(1);
        expect(all.directoryRoots).toHaveLength(1);
        for (const file of fixture) {
            const extracted = await fs.readFile(path.join(all.directoryRoots[0].path, file.relPath));
            expect(extracted.equals(file.content)).toBe(true);
        }

        // Databases only - an omitted field means "none of this kind", never "all".
        const dbOnlyDir = path.join(workDir, "dbonly");
        const dbOnly = await extractArchive(archivePath, dbOnlyDir, {
            masterKey: MASTER_KEY,
            selection: { databaseNames: [SECRET_DB] },
        });
        expect(dbOnly.databaseFiles).toHaveLength(1);
        expect(dbOnly.directoryRoots).toHaveLength(0);
        await expect(fs.access(path.join(dbOnlyDir, "sources"))).rejects.toThrow();
    });

    it("refuses to extract a file whose path escapes the target directory", async () => {
        // An archive whose index genuinely names an escaping path. Without the guard this
        // turns a restore into an arbitrary file write on the DBackup host.
        const escapeTarget = path.join(workDir, "escaped.txt");
        await fs.writeFile(escapeTarget, "pwned");

        // The writer refuses to pack such a name, so the index is forged afterwards the way a
        // tampered archive would carry it: the last member is rewritten with `..` in the path.
        await fs.mkdir(path.join(sourceDir, "aa"), { recursive: true });
        await fs.writeFile(path.join(sourceDir, "aa", "escaped.txt"), "evil!");
        const archivePath = path.join(workDir, "evil.tar");
        const { indexBytes } = await createArchive(
            [{
                kind: "directory",
                jobSourceId: "src-uuid-1",
                label: "evil",
                localPath: sourceDir,
                excludePatterns: [],
                files: [{ path: "aa/escaped.txt", size: 5, mtime: "2026-07-22T10:00:00.000Z" }],
            }],
            archivePath,
            { sourceType: "directory-only", compression: "NONE" }
        );
        const written = await fs.readFile(archivePath);
        const prefix = written.subarray(0, written.length - 512 - indexBytes.length - tarPadding(indexBytes.length).length - TAR_TRAILER.length);
        const forged = gzipSync(Buffer.from(gunzipSync(indexBytes).toString("utf-8").replace('"p":"aa/escaped.txt"', '"p":"../escaped.txt"')));
        await fs.writeFile(archivePath, Buffer.concat([prefix, buildUstarHeader(INDEX_MEMBER, forged.length), forged, tarPadding(forged.length), TAR_TRAILER]));

        // Refused either as a damaged index or at the extraction, never written outside.
        await expect(extractArchive(archivePath, path.join(workDir, "slip")))
            .rejects.toThrow(/outside the target directory|damaged/i);
        expect(await fs.readFile(escapeTarget, "utf-8")).toBe("pwned");
    });

    it("rejects a file that is not a v2 archive", async () => {
        const notAnArchive = path.join(workDir, "random.bin");
        await fs.writeFile(notAnArchive, crypto.randomBytes(4096));

        await expect(readArchiveManifest(await localFileSource(notAnArchive))).rejects.toThrow(/not a v2 archive/i);
    });
});

describe("createArchive - a source read failure fails the backup, not the process", () => {
    it("rejects when reading a source entry errors mid-stream", async () => {
        // The read succeeds at stat but errors when the stream is consumed - reproduced with
        // an entry whose path is a directory (stat ok, createReadStream emits EISDIR). Sized
        // above the bundling threshold so it becomes its own streamed entry rather than a
        // buffered bundle. With encryption the failing read sits upstream of the seal
        // transform, so a plain .pipe() would strand the 'error' and crash the backup
        // process; the pipeline-based chain must reject cleanly instead.
        await fs.mkdir(path.join(sourceDir, "as_file"), { recursive: true });

        const files: SourceFileEntry[] = [{
            path: "as_file",
            size: BUNDLE_FILE_MAX_SIZE * 3,
            mtime: "2026-07-22T10:00:00.000Z",
            checksum: "0".repeat(64),
        }];

        const entries: ArchiveSourceEntry[] = [{
            kind: "directory", jobSourceId: "src-uuid-1", label: "SFTP",
            localPath: sourceDir, excludePatterns: [], files,
        }];

        await expect(createArchive(entries, path.join(workDir, "out.tar"), {
            sourceType: "directory-only",
            compression: "NONE",
            encryption: { masterKey: MASTER_KEY, profileId: PROFILE_ID },
        })).rejects.toThrow();
    });
});
