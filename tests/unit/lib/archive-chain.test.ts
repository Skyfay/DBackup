import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "fs/promises";
import path from "path";
import os from "os";
import crypto from "crypto";
import { carryForward, fileKey, dependenciesOf, checkChainCompleteness } from "@/lib/archive/chain";
import { createArchive } from "@/lib/archive/writer";
import { readArchiveManifest, readArchiveIndex } from "@/lib/archive/reader";
import { localFileSource } from "@/lib/archive/sources";
import { entryKey } from "@/lib/archive/types";
import type { ArchiveIndex, ArchiveSourceEntry, IndexEntryLine, IndexFileLine } from "@/lib/archive/types";

const MASTER_KEY = Buffer.alloc(32, 0x4d);
const SRC = "src-1";

function makeIndex(
    files: IndexFileLine[],
    entries: IndexEntryLine[],
    deps: string[] = []
): ArchiveIndex {
    return {
        header: { k: "h", v: 2, createdAt: "2026-07-22T00:00:00.000Z", archive: "prev.tar" },
        entries: new Map(entries.map((e) => [entryKey(e.a, e.n), e])),
        databases: [],
        directories: [],
        files,
        deps,
    };
}

const entry = (n: number, a?: string): IndexEntryLine => ({
    k: "e", n, ...(a ? { a } : {}), member: `d/${String(n).padStart(6, "0")}`, off: n * 1024, size: 512,
});
const file = (p: string, n: number, a?: string): IndexFileLine => ({
    k: "f", src: SRC, p, s: 10, m: "2026-07-22T00:00:00.000Z", h: `h-${p}`, n, ...(a ? { a } : {}),
});

describe("carryForward", () => {
    it("points files that lived in the predecessor at the predecessor", () => {
        const previous = makeIndex([file("a.txt", 1), file("b.txt", 2)], [entry(1), entry(2)]);

        const carried = carryForward(previous, "full-1.tar", new Set([fileKey(SRC, "a.txt")]));

        expect(carried.files).toHaveLength(1);
        expect(carried.files[0]).toMatchObject({ p: "a.txt", n: 1, a: "full-1.tar" });
        expect(carried.entries).toEqual([{ ...entry(1), a: "full-1.tar" }]);
    });

    it("keeps a twice-carried file pointing at the original archive, not the middle one", () => {
        // This is what stops chains from nesting: snapshot 3 references the full directly.
        const previous = makeIndex(
            [file("old.txt", 1, "full-1.tar"), file("new.txt", 5)],
            [entry(1, "full-1.tar"), entry(5)],
            ["full-1.tar"]
        );

        const carried = carryForward(previous, "inc-2.tar", new Set([fileKey(SRC, "old.txt"), fileKey(SRC, "new.txt")]));

        expect(carried.files.find((f) => f.p === "old.txt")!.a).toBe("full-1.tar");
        expect(carried.files.find((f) => f.p === "new.txt")!.a).toBe("inc-2.tar");
        expect(dependenciesOf(carried.files)).toEqual(["full-1.tar", "inc-2.tar"]);
    });

    it("carries each referenced entry exactly once even when many files share it", () => {
        // Bundled small files all point at the same entry.
        const previous = makeIndex(
            [file("a.txt", 7), file("b.txt", 7), file("c.txt", 7)],
            [entry(7)]
        );

        const carried = carryForward(previous, "full-1.tar", new Set([
            fileKey(SRC, "a.txt"), fileKey(SRC, "b.txt"), fileKey(SRC, "c.txt"),
        ]));

        expect(carried.files).toHaveLength(3);
        expect(carried.entries).toHaveLength(1);
    });

    it("drops files that are not kept, and the entries only they referenced", () => {
        const previous = makeIndex([file("a.txt", 1), file("b.txt", 2)], [entry(1), entry(2)]);

        const carried = carryForward(previous, "full-1.tar", new Set([fileKey(SRC, "b.txt")]));

        expect(carried.files.map((f) => f.p)).toEqual(["b.txt"]);
        expect(carried.entries.map((e) => e.n)).toEqual([2]);
    });

    it("never mixes up files with the same path in different directory sources", () => {
        const previous = makeIndex(
            [file("shared.txt", 1), { ...file("shared.txt", 2), src: "src-2" }],
            [entry(1), entry(2)]
        );

        const carried = carryForward(previous, "full-1.tar", new Set([fileKey("src-2", "shared.txt")]));

        expect(carried.files).toHaveLength(1);
        expect(carried.files[0].src).toBe("src-2");
        expect(carried.files[0].n).toBe(2);
    });

    it("fails loudly when the predecessor index is inconsistent", () => {
        const previous = makeIndex([file("a.txt", 99)], [entry(1)]);

        expect(() => carryForward(previous, "full-1.tar", new Set([fileKey(SRC, "a.txt")])))
            .toThrow(/missing entry 99/);
    });

    it("returns nothing when nothing is kept", () => {
        const previous = makeIndex([file("a.txt", 1)], [entry(1)]);
        expect(carryForward(previous, "full-1.tar", new Set())).toEqual({ files: [], entries: [] });
    });
});

describe("checkChainCompleteness", () => {
    it("names the archives that are missing", () => {
        const index = makeIndex([], [], ["full-1.tar", "inc-2.tar"]);

        expect(checkChainCompleteness(index, new Set(["full-1.tar"]))).toEqual({
            complete: false,
            missing: ["inc-2.tar"],
        });
    });

    it("is complete when every dependency is present, and for a standalone full", () => {
        expect(checkChainCompleteness(makeIndex([], [], ["a.tar"]), new Set(["a.tar", "b.tar"])).complete).toBe(true);
        expect(checkChainCompleteness(makeIndex([], []), new Set()).complete).toBe(true);
    });
});

describe("writing a chained archive", () => {
    let workDir: string;

    beforeEach(async () => {
        workDir = await fs.mkdtemp(path.join(os.tmpdir(), "archive-chain-test-"));
    });
    afterEach(async () => {
        await fs.rm(workDir, { recursive: true, force: true });
    });

    it("records the chain block, the carried lines and the dependency list", async () => {
        const sourceDir = path.join(workDir, "src");
        await fs.mkdir(sourceDir, { recursive: true });
        const changed = crypto.randomBytes(2000);
        await fs.writeFile(path.join(sourceDir, "changed.bin"), changed);

        const entries: ArchiveSourceEntry[] = [{
            kind: "directory", jobSourceId: SRC, label: "T", localPath: sourceDir, excludePatterns: [],
            files: [{ path: "changed.bin", size: changed.length, mtime: "2026-07-22T10:00:00.000Z" }],
        }];

        const archivePath = path.join(workDir, "inc-2.tar");
        const { manifest } = await createArchive(entries, archivePath, {
            sourceType: "directory-only",
            compression: "GZIP",
            encryption: { masterKey: MASTER_KEY, profileId: "p1" },
            chain: {
                id: "chain-abc",
                type: "incremental",
                base: "full-1.tar",
                index: 1,
                carried: {
                    files: [file("unchanged.bin", 3, "full-1.tar")],
                    entries: [entry(3, "full-1.tar")],
                },
            },
        });

        expect(manifest.chain).toEqual({ id: "chain-abc", type: "incremental", base: "full-1.tar", index: 1 });

        const source = await localFileSource(archivePath);
        const readManifest = await readArchiveManifest(source);
        const index = await readArchiveIndex(source, readManifest, { masterKey: MASTER_KEY });

        expect(index.deps).toEqual(["full-1.tar"]);
        expect(index.files.map((f) => f.p).sort()).toEqual(["changed.bin", "unchanged.bin"]);

        // The carried file still points at the full, the new one at this archive.
        expect(index.files.find((f) => f.p === "unchanged.bin")!.a).toBe("full-1.tar");
        expect(index.files.find((f) => f.p === "changed.bin")!.a).toBeUndefined();

        // Both entries survive the round trip and stay separately addressable, even
        // though a local ordinal could collide with a carried one.
        expect(index.entries.get(entryKey("full-1.tar", 3))).toBeDefined();
        expect(index.entries.get(entryKey(undefined, 1))).toBeDefined();
    });

    it("writes no chain block and no deps for a standalone full", async () => {
        const sourceDir = path.join(workDir, "src");
        await fs.mkdir(sourceDir, { recursive: true });
        await fs.writeFile(path.join(sourceDir, "a.txt"), "hello");

        const archivePath = path.join(workDir, "full.tar");
        const { manifest, index } = await createArchive(
            [{
                kind: "directory", jobSourceId: SRC, label: "T", localPath: sourceDir, excludePatterns: [],
                files: [{ path: "a.txt", size: 5, mtime: "2026-07-22T10:00:00.000Z" }],
            }],
            archivePath,
            { sourceType: "directory-only", compression: "NONE" }
        );

        expect(manifest.chain).toBeUndefined();
        expect(index.deps).toEqual([]);
    });
});
