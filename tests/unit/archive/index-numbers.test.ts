// @vitest-environment node
/**
 * Every bound of a reader rests on a number of the index: `s` caps the inflation of an entry and
 * the temporary space of a restore, `off` and `size` the bytes a read fetches. The index comes from
 * the destination, so a missing, string, negative, fractional or infinite value there would turn a
 * bound off instead of tripping it. Such an index is refused as damaged before anything is read.
 */
import { describe, it, expect, vi } from "vitest";
import { Readable } from "stream";
import { gzipSync, brotliCompressSync } from "zlib";
import { lineNumbersProblem, parseIndex } from "@/lib/archive/index-file";
import { openArchiveEntry } from "@/lib/archive/reader";
import { bufferSource, readAll } from "@/lib/archive/sources";
import { byteLimit, DamagedBackupError } from "@/lib/archive/limits";
import { assertRange, cappedRange, openStorageArchiveSource } from "@/lib/archive/storage-source";
import type { ArchiveManifest, IndexEntryLine } from "@/lib/archive/types";
import type { StorageAdapter } from "@/lib/core/interfaces";

const header = JSON.stringify({ k: "h", v: 2, createdAt: "", archive: "x.tar" });
/** An index of the header and one more line, written as raw JSON so a value like 1e400 stays as it is. */
const indexWith = (line: string) => gzipSync(`${header}\n${line}\n`);

const ENTRY = { k: "e", n: 1, member: "d/000001", off: 512, size: 100 };
const DB = { k: "db", name: "shop", format: "sql", n: 1, s: 4096 };
const FILE = { k: "f", src: "s", p: "a.txt", s: 10, m: "", n: 1 };

const DAMAGED_LINES: [string, string][] = [
    ["an entry whose offset is a string", JSON.stringify({ ...ENTRY, off: "512" })],
    ["an entry without a size", JSON.stringify({ ...ENTRY, size: undefined })],
    ["an entry with a negative size", JSON.stringify({ ...ENTRY, size: -1 })],
    ["an entry with a fractional offset", JSON.stringify({ ...ENTRY, off: 1.5 })],
    ["an entry without an ordinal", JSON.stringify({ ...ENTRY, n: undefined })],
    ["a dump whose size is infinite", JSON.stringify(DB).replace('"s":4096', '"s":1e400')],
    ["a dump whose size is a string", JSON.stringify({ ...DB, s: "big" })],
    ["a dump without a size", JSON.stringify({ ...DB, s: undefined })],
    ["a dump past the safe range", JSON.stringify({ ...DB, s: 2 ** 60 })],
    ["a file without a size", JSON.stringify({ ...FILE, s: undefined })],
    ["a file with a null size", JSON.stringify({ ...FILE, s: null })],
    ["a file with a negative slice offset", JSON.stringify({ ...FILE, o: -5, l: 3 })],
    ["a file with a string slice length", JSON.stringify({ ...FILE, o: 0, l: "3" })],
    ["a file whose ordinal is a string", JSON.stringify({ ...FILE, n: "1" })],
];

describe("the numbers of an index", () => {
    it.each(DAMAGED_LINES)("refuses %s as damaged", async (_case, line) => {
        await expect(parseIndex(indexWith(line))).rejects.toBeInstanceOf(DamagedBackupError);
    });

    it("refuses a line that is no object", async () => {
        await expect(parseIndex(indexWith("null"))).rejects.toBeInstanceOf(DamagedBackupError);
        await expect(parseIndex(indexWith("[1,2]"))).rejects.toBeInstanceOf(DamagedBackupError);
    });

    it("takes whole numbers of at least 0, and a link without an ordinal", async () => {
        const index = await parseIndex(gzipSync([
            header,
            JSON.stringify({ ...ENTRY, off: 0 }),
            JSON.stringify({ ...DB, s: 0 }),
            JSON.stringify({ ...FILE, o: 0, l: 10 }),
            JSON.stringify({ k: "f", src: "s", p: "link", s: 0, m: "", lnk: "a.txt" }),
        ].join("\n")));
        expect(index.entries.size).toBe(1);
        expect(index.databases[0].s).toBe(0);
        expect(index.files).toHaveLength(2);
    });

    it("names the field it refuses", () => {
        expect(lineNumbersProblem({ ...DB, s: "big" })).toMatch(/'db' line whose 's'/);
        expect(lineNumbersProblem({ k: "d", fileCount: "x" })).toBeNull();
    });
});

const MANIFEST = { version: 2, encryption: undefined } as unknown as ArchiveManifest;

describe("a standalone entry without a valid declared size", () => {
    const payload = brotliCompressSync(Buffer.alloc(1024 * 1024));
    const entry: IndexEntryLine = { k: "e", n: 1, member: "d/000001", off: 0, size: payload.length, comp: "BROTLI" };

    it.each([undefined, Number.NaN, -1, Number.POSITIVE_INFINITY, "1024" as unknown as number])("is not read with %j", async (declared) => {
        const source = bufferSource(payload);
        const read = vi.spyOn(source, "read");
        await expect(openArchiveEntry(source, MANIFEST, entry, undefined, declared)).rejects.toBeInstanceOf(DamagedBackupError);
        expect(read).not.toHaveBeenCalled();
    });

    it("is read up to a valid one", async () => {
        const stream = await openArchiveEntry(bufferSource(payload), MANIFEST, entry, undefined, 1024 * 1024);
        expect((await readAll(stream)).length).toBe(1024 * 1024);
    });

    it("whose place in the archive is no number is not read either", async () => {
        const source = bufferSource(payload);
        const read = vi.spyOn(source, "read");
        const broken = { ...entry, off: Number.NaN } as IndexEntryLine;
        await expect(openArchiveEntry(source, MANIFEST, broken, undefined, 10)).rejects.toBeInstanceOf(DamagedBackupError);
        expect(read).not.toHaveBeenCalled();
    });
});

describe("a byte range that is none", () => {
    it("is refused by the cap of a ranged read and by the byte limit", () => {
        expect(() => cappedRange(Readable.from([Buffer.alloc(10)]), 0, Number.NaN)).toThrow(DamagedBackupError);
        expect(() => cappedRange(Readable.from([Buffer.alloc(10)]), Number.NaN, 10)).toThrow(DamagedBackupError);
        expect(() => assertRange(-1, 10)).toThrow(DamagedBackupError);
        expect(() => assertRange(10, 5)).toThrow(DamagedBackupError);
        expect(() => assertRange(10, 9)).not.toThrow();
        expect(() => byteLimit(Number.NaN, "x")).toThrow(DamagedBackupError);
        expect(() => byteLimit(-1, "x")).toThrow(DamagedBackupError);
    });

    it("never reaches the destination nor the fallback that fetches the whole archive", async () => {
        const adapter = {
            id: "fake",
            downloadRange: vi.fn(async () => Readable.from([Buffer.alloc(10)])),
            download: vi.fn(async () => true),
        } as unknown as StorageAdapter;
        const opened = await openStorageArchiveSource(adapter, {}, "x.tar", 100);

        await expect(opened.source.read(Number.NaN, 10)).rejects.toBeInstanceOf(DamagedBackupError);
        expect(adapter.downloadRange).not.toHaveBeenCalled();
        expect(adapter.download).not.toHaveBeenCalled();
        await opened.dispose();
    });
});
