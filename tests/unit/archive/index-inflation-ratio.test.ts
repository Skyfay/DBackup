// @vitest-environment node
/**
 * How far the index of a backup may inflate and what of it stays in memory. The index comes from
 * whoever writes the destination, so a stored index of a few MB must never inflate to the full cap
 * of gigabytes, and a field no writer writes must never stay with the parsed index.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "fs/promises";
import os from "os";
import path from "path";
import { gzipSync, gunzipSync } from "zlib";
import { createArchive } from "@/lib/archive/writer";
import { indexTextBytes, parseIndex } from "@/lib/archive/index-file";
import {
    INDEX_INFLATE_FLOOR, INDEX_INFLATE_RATIO, INDEX_MAX_INFLATED_BYTES, INDEX_MAX_LINE_BYTES, indexInflateLimit,
} from "@/lib/archive/limits";
import type { SourceFileEntry } from "@/lib/archive/types";

const header = JSON.stringify({ k: "h", v: 2, createdAt: "", archive: "x.tar" });

let workDir: string;
beforeEach(async () => { workDir = await fs.mkdtemp(path.join(os.tmpdir(), "index-ratio-")); });
afterEach(async () => { await fs.rm(workDir, { recursive: true, force: true }); });

describe("the inflated index", () => {
    it("may grow to a bound of its stored size, at least the floor and never past the cap", () => {
        expect(indexInflateLimit(0)).toBe(INDEX_INFLATE_FLOOR);
        expect(indexInflateLimit(4 * 1024 * 1024)).toBe(4 * 1024 * 1024 * INDEX_INFLATE_RATIO);
        expect(indexInflateLimit(200 * 1024 * 1024)).toBe(INDEX_MAX_INFLATED_BYTES);
    });

    it("of a small stored index that inflates far past what any writer compresses is refused as damaged", async () => {
        // Lines just below the longest a line may be, of one letter each. About 100 KB stored,
        // 128 MB once inflated, which the cap of 2 GB alone let through.
        const line = `{"k":"x","pad":"${"a".repeat(INDEX_MAX_LINE_BYTES - 64)}"}\n`;
        const bytes = gzipSync(Buffer.from(`${header}\n${line.repeat(128)}`), { level: 9 });
        expect(bytes.length).toBeLessThan(INDEX_INFLATE_FLOOR / INDEX_INFLATE_RATIO * 4);

        await expect(parseIndex(bytes)).rejects.toThrow(/The backup is damaged: its index inflates past/);
    });

    it("of a large backup DBackup wrote, with links under a path of thousands of characters, still parses", async () => {
        // Links to one target under one long folder compress the most of any index measured,
        // about 127 to 1 at paths close to the longest Linux allows.
        const folder = Array.from({ length: 80 }, (_, i) => `very-long-directory-name-of-a-deep-tree-${i}`).join("/");
        const files: SourceFileEntry[] = Array.from({ length: 20_000 }, (_, i) => ({
            path: `${folder}/app-${i % 50}/module-${i}.js`, size: 0, mtime: "2026-10-27T04:00:00.000Z", linkTarget: "../shared/index.js",
        }));
        const { indexBytes } = await createArchive(
            [{ kind: "directory", jobSourceId: "src-1", label: "Projects", localPath: workDir, excludePatterns: [], files }],
            path.join(workDir, "out.tar"),
            { sourceType: "directory-only", compression: "GZIP" }
        );
        const inflated = gunzipSync(indexBytes).length;
        expect(inflated).toBeGreaterThan(INDEX_INFLATE_FLOOR);
        expect(inflated / indexBytes.length).toBeGreaterThan(64);

        const index = await parseIndex(indexBytes);

        expect(index.files).toHaveLength(20_000);
        expect(indexTextBytes(index)).toBe(inflated);
    }, 60_000);
});

describe("a parsed index line", () => {
    it("keeps only the fields of its kind", async () => {
        const lines = [
            JSON.stringify({ k: "h", v: 2, createdAt: "", archive: "x.tar", pad: "x".repeat(1000) }),
            JSON.stringify({ k: "e", n: 1, member: "f/1", off: 0, size: 1, extra: [1, 2, 3] }),
            JSON.stringify({ k: "db", name: "app", format: "sql", n: 2, s: 1, junk: { deep: true } }),
            JSON.stringify({ k: "d", src: "s", label: "L", fileCount: 1, totalSize: 1, excludePatterns: [], more: "y" }),
            JSON.stringify({ k: "f", src: "s", p: "a.txt", s: 1, m: "", n: 1, h: "abc", mo: 420, unknown: "z".repeat(1000) }),
            JSON.stringify({ k: "deps", archives: ["a.tar"], other: 1 }),
        ];

        const index = await parseIndex(gzipSync(`${lines.join("\n")}\n`));

        expect(index.header).toEqual({ k: "h", v: 2, createdAt: "", archive: "x.tar" });
        expect([...index.entries.values()]).toEqual([{ k: "e", n: 1, member: "f/1", off: 0, size: 1 }]);
        expect(index.databases).toEqual([{ k: "db", name: "app", format: "sql", n: 2, s: 1 }]);
        expect(index.directories).toEqual([{ k: "d", src: "s", label: "L", fileCount: 1, totalSize: 1, excludePatterns: [] }]);
        expect(index.files).toEqual([{ k: "f", src: "s", p: "a.txt", s: 1, m: "", n: 1, h: "abc", mo: 420 }]);
        expect(index.deps).toEqual(["a.tar"]);
    });

    it("of a kind no writer writes, or one named like a property of every object, is skipped", async () => {
        const lines = [header, JSON.stringify({ k: "toString", p: "a" }), JSON.stringify({ k: "zz", p: "b" })];

        const index = await parseIndex(gzipSync(`${lines.join("\n")}\n`));

        expect(index.files).toEqual([]);
        expect(index.header.archive).toBe("x.tar");
    });
});
