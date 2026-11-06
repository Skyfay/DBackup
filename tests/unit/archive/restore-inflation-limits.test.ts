// @vitest-environment node
/**
 * What a crafted archive can make a restore inflate. Everything in a backup comes from whoever
 * writes the destination, and every tenant restores in the one process they share, so a bundle
 * flag, a declared size or an index of a few KB must never inflate past what the writer produces.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "fs/promises";
import os from "os";
import path from "path";
import crypto from "crypto";
import { Readable } from "stream";
import { pipeline } from "stream/promises";
import { brotliCompressSync, gzipSync } from "zlib";
import { createArchive } from "@/lib/archive/writer";
import { openArchiveEntry, readArchiveIndex, readArchiveManifest } from "@/lib/archive/reader";
import { bufferSource, localFileSource, readAll } from "@/lib/archive/sources";
import { parseIndex } from "@/lib/archive/index-file";
import { forEachSnapshotFile } from "@/lib/archive/chain-source";
import { extractArchive } from "@/lib/archive/extract";
import {
    assertIndexStoredSize, BUNDLE_READ_LIMIT, byteLimit, DamagedBackupError, INDEX_MAX_LINE_BYTES, INDEX_MAX_LINES,
    INDEX_MAX_STORED_BYTES, LEGACY_INFLATE_FLOOR, LEGACY_INFLATE_RATIO, legacyInflateLimit,
} from "@/lib/archive/limits";
import { BUNDLE_FILE_MAX_SIZE, BUNDLE_TARGET_SIZE } from "@/lib/archive/format";
import { entryKey, type ArchiveIndex, type ArchiveManifest, type IndexEntryLine, type IndexFileLine } from "@/lib/archive/types";
import { vi } from "vitest";

// The destination of the sidecar writes a sparse file of the size the test asks for.
const sidecar = vi.hoisted(() => ({ size: 0 }));
vi.mock("@/services/sharing/destination-access", () => ({
    openDestination: async () => ({
        adapter: {
            download: async (_c: unknown, _r: string, local: string) => {
                const { open } = await import("fs/promises");
                const handle = await open(local, "w");
                await handle.truncate(sidecar.size);
                await handle.close();
                return true;
            },
        },
        config: {},
    }),
}));

const MANIFEST: ArchiveManifest = {
    version: 2, createdAt: "2026-10-26T00:00:00.000Z", sourceType: "directory-only", compression: "GZIP",
    counts: { databases: 0, directorySources: 1, files: 1, entries: 1 }, totalSize: 0, indexMember: "index",
};

/** A tiny Brotli stream of many MB of zeros, the shape of a decompression bomb. */
function bomb(bytes: number): Buffer {
    return brotliCompressSync(Buffer.alloc(bytes));
}

const entryOf = (payload: Buffer, over: Partial<IndexEntryLine> = {}): IndexEntryLine => ({
    k: "e", n: 1, member: "d/000001", off: 0, size: payload.length, comp: "BROTLI", ...over,
});

let workDir: string;
beforeEach(async () => { workDir = await fs.mkdtemp(path.join(os.tmpdir(), "inflate-limit-")); });
afterEach(async () => { await fs.rm(workDir, { recursive: true, force: true }); });

describe("a bundle", () => {
    it("is refused as damaged once it inflates past what the writer ever packs into one", async () => {
        const payload = bomb(64 * 1024 * 1024);
        expect(payload.length).toBeLessThan(64 * 1024);

        await expect(readAll(await openArchiveEntry(bufferSource(payload), MANIFEST, entryOf(payload, { bundle: true }))))
            .rejects.toThrow(/^The backup is damaged: /);
    });

    it("fails the restore of its files instead of holding it in memory", async () => {
        const payload = bomb(64 * 1024 * 1024);
        const entry = entryOf(payload, { bundle: true });
        const file: IndexFileLine = { k: "f", src: "s", p: "a.txt", s: 10, m: "", n: 1, o: 0, l: 10 };
        const index: ArchiveIndex = {
            header: { k: "h", v: 2, createdAt: "", archive: "x.tar" },
            entries: new Map([[entryKey(undefined, 1), entry]]),
            databases: [], directories: [], files: [file], deps: [],
        };
        const visited: string[] = [];
        await expect(forEachSnapshotFile(
            { source: bufferSource(payload), manifest: MANIFEST, index, chain: {} as never },
            [{ file }],
            async (line) => { visited.push(line.p); },
        )).rejects.toBeInstanceOf(DamagedBackupError);
        expect(visited).toEqual([]);
    });

    it("of the largest size the writer makes still reads", async () => {
        const largest = BUNDLE_TARGET_SIZE - 1 + BUNDLE_FILE_MAX_SIZE;
        expect(BUNDLE_READ_LIMIT).toBeGreaterThan(largest);
        const payload = gzipSync(Buffer.alloc(largest, 7));
        const read = await readAll(await openArchiveEntry(bufferSource(payload), MANIFEST, entryOf(payload, { bundle: true, comp: "GZIP" })));
        expect(read.length).toBe(largest);
    });
});

describe("a standalone entry", () => {
    it("stops inflating at the size its index line declares, long before its end", async () => {
        // 16 MB against a declared 1 KB proves the stop as well as more would, and builds in a fraction of the time.
        const payload = bomb(16 * 1024 * 1024);
        const stream = await openArchiveEntry(bufferSource(payload), MANIFEST, entryOf(payload), undefined, 1024);
        let seen = 0;
        stream.on("data", (chunk: Buffer) => { seen += chunk.length; });
        await expect(pipeline(stream, async function* (source) { for await (const _ of source) { /* drain */ } }))
            .rejects.toThrow(/The backup is damaged/);
        expect(seen).toBeLessThanOrEqual(1024);
    });

    it("passes exactly its declared size", async () => {
        const content = crypto.randomBytes(5000);
        const payload = gzipSync(content);
        const read = await readAll(await openArchiveEntry(bufferSource(payload), MANIFEST, entryOf(payload, { comp: "GZIP" }), undefined, content.length));
        expect(read.equals(content)).toBe(true);
    });

    it("of a file that lies about its size fails the extraction and keeps no file of it", async () => {
        const sourceDir = path.join(workDir, "src");
        await fs.mkdir(sourceDir, { recursive: true });
        const content = crypto.randomBytes(200_000);
        await fs.writeFile(path.join(sourceDir, "big.bin"), content);
        const archivePath = path.join(workDir, "backup.tar");
        const { indexBytes } = await createArchive([{
            kind: "directory", jobSourceId: "src-1", label: "Test", localPath: sourceDir, excludePatterns: [],
            files: [{ path: "big.bin", size: content.length, mtime: "2026-10-26T00:00:00.000Z" }],
        }], archivePath, { sourceType: "directory-only", compression: "GZIP" });

        // The index of the destination says the file is 100 bytes.
        const lines = (await import("zlib")).gunzipSync(indexBytes).toString("utf-8").split("\n").filter(Boolean)
            .map((line) => JSON.parse(line))
            .map((line) => (line.k === "f" ? { ...line, s: 100 } : line));
        const forged = gzipSync(lines.map((line) => JSON.stringify(line)).join("\n") + "\n");

        await expect(extractArchive(archivePath, path.join(workDir, "out"), { sidecarBytes: forged }))
            .rejects.toThrow(/The backup is damaged/);
        const written = await fs.readFile(path.join(workDir, "out", "sources", "src-1", "big.bin")).catch(() => Buffer.alloc(0));
        expect(written.length).toBeLessThanOrEqual(100);
    });
});

describe("a backup DBackup wrote", () => {
    it("still restores in full, bundles and large files alike", async () => {
        const sourceDir = path.join(workDir, "src");
        await fs.mkdir(sourceDir, { recursive: true });
        const files: Record<string, Buffer> = { "small.txt": Buffer.from("small\n"), "big.bin": crypto.randomBytes(3 * 1024 * 1024) };
        for (const [name, content] of Object.entries(files)) await fs.writeFile(path.join(sourceDir, name), content);
        const archivePath = path.join(workDir, "backup.tar");
        await createArchive([{
            kind: "directory", jobSourceId: "src-1", label: "Test", localPath: sourceDir, excludePatterns: [],
            files: Object.entries(files).map(([name, content]) => ({ path: name, size: content.length, mtime: "2026-10-26T00:00:00.000Z" })),
        }], archivePath, { sourceType: "directory-only", compression: "BROTLI", encryption: { masterKey: Buffer.alloc(32, 1), profileId: "p" } });

        await extractArchive(archivePath, path.join(workDir, "out"), { masterKey: Buffer.alloc(32, 1) });
        for (const [name, content] of Object.entries(files)) {
            expect((await fs.readFile(path.join(workDir, "out", "sources", "src-1", name))).equals(content)).toBe(true);
        }
        const source = await localFileSource(archivePath);
        const manifest = await readArchiveManifest(source);
        expect((await readArchiveIndex(source, manifest, { masterKey: Buffer.alloc(32, 1) })).files).toHaveLength(2);
    });
});

describe("the index", () => {
    const header = JSON.stringify({ k: "h", v: 2, createdAt: "", archive: "x.tar" });

    it("is refused as damaged when it is stored larger than any writer stores one", () => {
        expect(() => assertIndexStoredSize(INDEX_MAX_STORED_BYTES + 1)).toThrow(DamagedBackupError);
        expect(() => assertIndexStoredSize(INDEX_MAX_STORED_BYTES)).not.toThrow();
    });

    it("is refused as damaged with a line longer than any line the writer writes", async () => {
        const long = `{"k":"x","pad":"${"a".repeat(INDEX_MAX_LINE_BYTES + 10)}"}`;
        await expect(parseIndex(gzipSync(`${header}\n${long}\n`))).rejects.toThrow(/The backup is damaged: .*line longer/);
    });

    it("is refused as damaged with a single line of gigabytes, before it is held in memory", async () => {
        // About 4 KB stored, 64 MB of one line once inflated.
        const bytes = gzipSync(Buffer.concat([Buffer.from(`${header}\n`), Buffer.alloc(64 * 1024 * 1024, 0x61)]));
        await expect(parseIndex(bytes)).rejects.toThrow(/line longer/);
    });

    it("is refused as damaged with more lines than any backup has", async () => {
        const bytes = gzipSync(Buffer.concat([Buffer.from(`${header}\n`), Buffer.alloc(INDEX_MAX_LINES + 1, 0x0a)]));
        await expect(parseIndex(bytes)).rejects.toThrow(/more than .* lines/);
    }, 30_000);

    it("with a line that is no JSON fails its parse and never the process", async () => {
        // A throw inside a loop over `readline` also escaped as an uncaught exception, which ends
        // the server of every tenant. Vitest fails the run on one, so this passing is the check.
        const uncaught: unknown[] = [];
        const onUncaught = (error: unknown) => { uncaught.push(error); };
        process.on("uncaughtException", onUncaught);
        try {
            await expect(parseIndex(gzipSync(`${header}\n{not json\n`))).rejects.toThrow(SyntaxError);
            await new Promise((resolve) => setTimeout(resolve, 50));
        } finally {
            process.off("uncaughtException", onUncaught);
        }
        expect(uncaught).toEqual([]);
    });

    it("of a real backup parses as before", async () => {
        const file = JSON.stringify({ k: "f", src: "s", p: "dir/a.txt", s: 1, m: "", n: 1 });
        const index = await parseIndex(gzipSync(`${header}\n${file}\n`));
        expect(index.files.map((f) => f.p)).toEqual(["dir/a.txt"]);
    });
});

describe("a backup of the older whole-file format", () => {
    it("may inflate to a bound of its compressed size, never without one", () => {
        expect(legacyInflateLimit(10)).toBe(LEGACY_INFLATE_FLOOR);
        expect(legacyInflateLimit(10 * 1024 * 1024 * 1024)).toBe(10 * 1024 * 1024 * 1024 * LEGACY_INFLATE_RATIO);
    });

    it("stops at that bound with an error that names the backup as damaged", async () => {
        const limit = 1000;
        const chunks: Buffer[] = [];
        await expect(pipeline(
            Readable.from([Buffer.alloc(600), Buffer.alloc(600)]),
            byteLimit(limit, "the decompressed dump"),
            async function* (source) { for await (const chunk of source) chunks.push(chunk as Buffer); },
        )).rejects.toThrow("The backup is damaged: the decompressed dump holds more than the 1000 bytes it may");
        expect(Buffer.concat(chunks).length).toBeLessThanOrEqual(limit);
    });
});

describe("the sidecar of an index", () => {
    it("is not read into memory when it is larger than any writer stores one", async () => {
        sidecar.size = INDEX_MAX_STORED_BYTES + 1;
        const { archiveIndexService } = await import("@/services/backup/archive-index-service");
        expect(await archiveIndexService.fetchSidecar("dest-1", "job/backup.tar", ".index")).toBeNull();

        sidecar.size = 64;
        expect((await archiveIndexService.fetchSidecar("dest-1", "job/backup.tar", ".index"))?.length).toBe(64);
    });
});
