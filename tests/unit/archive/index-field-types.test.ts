// @vitest-environment node
/**
 * The index comes from the destination, and its text is all the cache of parsed indexes weighs. A
 * line keeps only the fields of its kind, and each of them only with the type the writer gives it:
 * a few KB of fields full of empty objects or lists would otherwise turn into tens of millions of
 * objects on the heap of the process every tenant shares.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "fs/promises";
import os from "os";
import path from "path";
import { gzipSync } from "zlib";
import { indexToLines, knownLineFields, parseIndex } from "@/lib/archive/index-file";
import { DamagedBackupError, INDEX_MAX_LIST_ITEMS } from "@/lib/archive/limits";
import { createArchive } from "@/lib/archive/writer";
import { readArchiveIndex, readArchiveManifest } from "@/lib/archive/reader";
import { localFileSource } from "@/lib/archive/sources";
import { entryKey } from "@/lib/archive/types";

const header = JSON.stringify({ k: "h", v: 2, createdAt: "", archive: "x.tar" });
const indexWith = (...lines: string[]) => gzipSync(`${[header, ...lines].join("\n")}\n`);

const ENTRY = { k: "e", n: 1, member: "d/000001", off: 512, size: 100 };
const DB = { k: "db", name: "shop", format: "sql", n: 1, s: 4096 };
const DIR = { k: "d", src: "s", label: "Files", fileCount: 1, totalSize: 10, excludePatterns: ["*.log"] };
const FILE = { k: "f", src: "s", p: "a.txt", s: 10, m: "2026-10-27T00:00:00.000Z", n: 1 };
const EMPTY_OBJECTS = Array.from({ length: 1000 }, () => ({}));

const DAMAGED_LINES: [string, object][] = [
    ["exclude patterns full of empty objects", { ...DIR, excludePatterns: EMPTY_OBJECTS }],
    ["exclude patterns full of empty lists", { ...DIR, excludePatterns: Array.from({ length: 1000 }, () => []) }],
    ["exclude patterns that are one string", { ...DIR, excludePatterns: "*.log" }],
    ["exclude patterns that are an object", { ...DIR, excludePatterns: { 0: "*.log" } }],
    ["more exclude patterns than a list may hold", { ...DIR, excludePatterns: Array.from({ length: INDEX_MAX_LIST_ITEMS + 1 }, () => "") }],
    ["a source without exclude patterns", { ...DIR, excludePatterns: undefined }],
    ["a source whose label is an object", { ...DIR, label: {} }],
    ["a source whose file count is a list", { ...DIR, fileCount: [] }],
    ["a chain whose archives are objects", { k: "deps", archives: EMPTY_OBJECTS }],
    ["a chain whose archives are one string", { k: "deps", archives: "full.tar" }],
    ["a chain without its archives", { k: "deps" }],
    ["a file whose mtime is an object", { ...FILE, m: {} }],
    ["a file whose checksum is a list", { ...FILE, h: [] }],
    ["a file whose link target is a number", { ...FILE, lnk: 5 }],
    ["a file whose mode is a string", { ...FILE, mo: "755" }],
    ["a file whose owner is an object", { ...FILE, u: {} }],
    ["a file whose archive is null", { ...FILE, a: null }],
    ["a dump whose checksum is a list", { ...DB, h: [] }],
    ["a dump whose name is an object", { ...DB, name: {} }],
    ["a dump whose format is a list", { ...DB, format: ["sql"] }],
    ["an entry whose member is an object", { ...ENTRY, member: {} }],
    ["an entry whose seal flag is an object", { ...ENTRY, sealed: {} }],
    ["an entry whose compression is a list", { ...ENTRY, comp: ["GZIP"] }],
    ["a header whose archive is an object", { k: "h", v: 2, createdAt: "", archive: {} }],
];

describe("the fields of an index line", () => {
    it.each(DAMAGED_LINES)("refuses %s as damaged", async (_case, line) => {
        await expect(parseIndex(indexWith(JSON.stringify(line)))).rejects.toBeInstanceOf(DamagedBackupError);
    });

    it("names the line and field it refuses", () => {
        expect(() => knownLineFields({ ...DIR, excludePatterns: [{}] })).toThrow(/'d' line whose 'excludePatterns' is no list/);
        expect(() => knownLineFields({ ...FILE, m: {} })).toThrow(/'f' line whose 'm' is no string/);
    });

    it("still drops a field no writer writes and skips a kind no writer writes", async () => {
        const index = await parseIndex(indexWith(
            JSON.stringify({ ...FILE, extra: EMPTY_OBJECTS }),
            JSON.stringify({ k: "future", payload: EMPTY_OBJECTS }),
        ));
        expect(index.files).toEqual([FILE]);
    });

    it("keeps every field of its type, lists of strings included", async () => {
        const link = { k: "f", src: "s", p: "l", s: 0, m: "", lnk: "a.txt", mo: 511, u: 0, g: 0 };
        const index = await parseIndex(indexWith(
            JSON.stringify({ k: "deps", archives: ["full.tar", "inc-1.tar"] }),
            JSON.stringify({ ...ENTRY, a: "full.tar", sealed: true, comp: "GZIP", bundle: true }),
            JSON.stringify({ ...DB, h: "ab" }),
            JSON.stringify({ ...DIR, excludePatterns: [] }),
            JSON.stringify(DIR),
            JSON.stringify(link),
        ));
        expect(index.deps).toEqual(["full.tar", "inc-1.tar"]);
        expect(index.entries.get(entryKey("full.tar", 1))).toEqual({ ...ENTRY, a: "full.tar", sealed: true, comp: "GZIP", bundle: true });
        expect(index.databases).toEqual([{ ...DB, h: "ab" }]);
        expect(index.directories.map((d) => d.excludePatterns)).toEqual([[], ["*.log"]]);
        expect(index.files).toEqual([link]);
    });
});

describe("every index the writer writes", () => {
    let workDir: string;
    const MASTER_KEY = Buffer.alloc(32, 0x5a);

    beforeEach(async () => {
        workDir = await fs.mkdtemp(path.join(os.tmpdir(), "index-field-types-"));
    });
    afterEach(async () => {
        await fs.rm(workDir, { recursive: true, force: true });
    });

    it.each([
        ["unencrypted", undefined],
        ["encrypted and bundled", { masterKey: MASTER_KEY, profileId: "p1" }],
    ])("parses back as written, %s, as an incremental with its chain", async (_case, encryption) => {
        const sourceDir = path.join(workDir, "src");
        await fs.mkdir(path.join(sourceDir, "sub"), { recursive: true });
        await fs.writeFile(path.join(sourceDir, "a.txt"), "hello");
        await fs.writeFile(path.join(sourceDir, "sub", "b.bin"), Buffer.alloc(200 * 1024, 7));
        const dump = path.join(workDir, "shop.sql");
        await fs.writeFile(dump, "CREATE TABLE t (id int);");

        const archivePath = path.join(workDir, "inc-2.tar");
        const { index: written } = await createArchive(
            [
                { kind: "database", dbName: "shop", path: dump, format: "sql" },
                {
                    kind: "directory", jobSourceId: "src-1", label: "Files", localPath: sourceDir,
                    excludePatterns: ["*.log", "node_modules/", "with space"],
                    files: [
                        { path: "a.txt", size: 5, mtime: "2026-10-27T10:00:00.000Z", checksum: "c1", mode: 0o644, uid: 1000, gid: 1000 },
                        { path: "sub/b.bin", size: 200 * 1024, mtime: "2026-10-27T10:00:00.000Z" },
                        { path: "link", size: 0, mtime: "2026-10-27T10:00:00.000Z", linkTarget: "a.txt" },
                    ],
                },
            ],
            archivePath,
            {
                sourceType: "mysql",
                compression: "GZIP",
                ...(encryption ? { encryption } : {}),
                chain: {
                    id: "chain-1", type: "incremental", base: "inc-1.tar", index: 2,
                    carried: {
                        files: [
                            { k: "f", src: "src-1", p: "old.txt", s: 3, m: "2026-10-25T10:00:00.000Z", h: "c0", n: 4, a: "full.tar" },
                            { k: "f", src: "src-1", p: "mid.txt", s: 2, m: "2026-10-26T10:00:00.000Z", n: 2, a: "inc-1.tar", o: 0, l: 2 },
                        ],
                        entries: [
                            { k: "e", n: 4, a: "full.tar", member: "d/000004", off: 2048, size: 40, comp: "GZIP" },
                            { k: "e", n: 2, a: "inc-1.tar", member: "d/000002", off: 1024, size: 60, bundle: true },
                        ],
                    },
                },
            }
        );

        const source = await localFileSource(archivePath);
        const read = await readArchiveIndex(source, await readArchiveManifest(source), encryption ? { masterKey: MASTER_KEY } : undefined);

        expect(read.deps).toEqual(["full.tar", "inc-1.tar"]);
        expect(read.directories[0].excludePatterns).toEqual(["*.log", "node_modules/", "with space"]);
        expect(indexToLines(read)).toEqual(indexToLines(written));
    });
});
