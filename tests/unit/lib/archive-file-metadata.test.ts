/**
 * Permissions and ownership through the archive chain.
 *
 * A restored file that a program has to read back - a container volume above all - is only
 * usable if its mode and owner survive the round trip. Postgres refuses a data directory
 * that is not 0700 and owned by its own user, and MySQL and Redis check the same way.
 *
 * The fields are optional at every step, so half of what is proven here is that a source
 * reporting nothing produces exactly the archive it produced before they existed.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "fs/promises";
import path from "path";
import os from "os";
import { carryForward, fileKey } from "@/lib/archive/chain";
import { createArchive } from "@/lib/archive/writer";
import { readArchiveIndex, readArchiveManifest } from "@/lib/archive/reader";
import { localFileSource } from "@/lib/archive/sources";
import { entryKey, metadataFromIndex, metadataToIndex } from "@/lib/archive/types";
import type {
    ArchiveIndex,
    ArchiveSourceEntry,
    FileMetadata,
    IndexEntryLine,
    IndexFileLine,
    SourceFileEntry,
} from "@/lib/archive/types";

const SRC = "src-1";

function makeIndex(files: IndexFileLine[], entries: IndexEntryLine[]): ArchiveIndex {
    return {
        header: { k: "h", v: 2, createdAt: "2026-08-02T00:00:00.000Z", archive: "prev.tar" },
        entries: new Map(entries.map((e) => [entryKey(e.a, e.n), e])),
        databases: [],
        directories: [],
        files,
        deps: [],
    };
}

const entry = (n: number): IndexEntryLine => ({
    k: "e", n, member: `d/${String(n).padStart(6, "0")}`, off: n * 1024, size: 512,
});

const file = (p: string, n: number, meta: Partial<IndexFileLine> = {}): IndexFileLine => ({
    k: "f", src: SRC, p, s: 10, m: "2026-08-02T00:00:00.000Z", h: `h-${p}`, n, ...meta,
});

describe("metadata field mapping", () => {
    it("leaves a field out entirely rather than writing null", () => {
        // The index is one JSON line per file in an archive that can hold a million of
        // them. `"mo":null` on every line is pure weight, and a reader that checks for
        // `undefined` would not see it as absent either.
        expect(metadataToIndex({})).toEqual({});
        expect(JSON.stringify(metadataToIndex({}))).toBe("{}");
        expect(metadataToIndex({ mode: 0o600 })).toEqual({ mo: 0o600 });
        expect(Object.keys(metadataToIndex({ mode: 0o600 }))).toEqual(["mo"]);
    });

    it("survives a round trip in both directions", () => {
        const meta: FileMetadata = { mode: 0o750, uid: 1234, gid: 5678 };
        expect(metadataFromIndex(file("a", 1, metadataToIndex(meta)), true)).toEqual(meta);
    });

    it("reports undefined for a line written before the fields existed", () => {
        // Not an empty object: a restore from any archive written so far has to reach
        // upload() with exactly the arguments it always did, and `{}` is not `undefined`
        // to a test - or to an adapter that branches on the options being present.
        expect(metadataFromIndex(file("a", 1), true)).toBeUndefined();
    });

    it("keeps mode 0 apart from an absent mode", () => {
        // 0 is a real mode and falsy, so anything written with a truthiness check would
        // drop it. A file with no permission bits at all is unusual but not invalid.
        expect(metadataToIndex({ mode: 0, uid: 0, gid: 0 })).toEqual({ mo: 0, u: 0, g: 0 });
        expect(metadataFromIndex(file("a", 1, { mo: 0, u: 0, g: 0 }), true)).toEqual({ mode: 0, uid: 0, gid: 0 });
    });
});

describe("carryForward metadata", () => {
    it("prefers what the source reports now over what the predecessor recorded", () => {
        // A chmod changes no content, so the file is carried rather than re-stored. Without
        // this the chain would keep serving the mode from whenever the bytes last changed.
        const previous = makeIndex([file("app.conf", 1, { mo: 0o644, u: 0, g: 0 })], [entry(1)]);
        const fresh = new Map<string, FileMetadata>([
            [fileKey(SRC, "app.conf"), { mode: 0o600, uid: 999, gid: 999 }],
        ]);

        const carried = carryForward(previous, "full-1.tar", new Set([fileKey(SRC, "app.conf")]), fresh);

        expect(carried.files[0]).toMatchObject({ mo: 0o600, u: 999, g: 999, a: "full-1.tar" });
    });

    it("leaves the recorded mtime alone while refreshing the metadata", () => {
        // Carrying forward is decided by content identity, and the existing snapshot
        // semantics tie the recorded mtime to the bytes. Only the metadata is refreshed.
        const previous = makeIndex([file("app.conf", 1, { mo: 0o644 })], [entry(1)]);
        const fresh = new Map<string, FileMetadata>([[fileKey(SRC, "app.conf"), { mode: 0o600 }]]);

        const carried = carryForward(previous, "full-1.tar", new Set([fileKey(SRC, "app.conf")]), fresh);

        expect(carried.files[0].m).toBe("2026-08-02T00:00:00.000Z");
        expect(carried.files[0].h).toBe("h-app.conf");
    });

    it("changes nothing when the source reports no metadata", () => {
        // Every adapter other than Docker is in this case, so it is the one that decides
        // whether this release is a no-op for existing jobs.
        const previous = makeIndex([file("a.txt", 1, { mo: 0o644, u: 33, g: 33 })], [entry(1)]);

        const withoutMap = carryForward(previous, "full-1.tar", new Set([fileKey(SRC, "a.txt")]));
        const withEmptyMap = carryForward(previous, "full-1.tar", new Set([fileKey(SRC, "a.txt")]), new Map());

        expect(withoutMap.files[0]).toMatchObject({ mo: 0o644, u: 33, g: 33 });
        expect(withEmptyMap.files[0]).toMatchObject({ mo: 0o644, u: 33, g: 33 });
    });

    it("merges per field, so a partial report cannot erase the rest", () => {
        const previous = makeIndex([file("a.txt", 1, { mo: 0o644, u: 33, g: 33 })], [entry(1)]);
        const fresh = new Map<string, FileMetadata>([[fileKey(SRC, "a.txt"), { uid: 1000 }]]);

        const carried = carryForward(previous, "full-1.tar", new Set([fileKey(SRC, "a.txt")]), fresh);

        expect(carried.files[0]).toMatchObject({ mo: 0o644, u: 1000, g: 33 });
    });

    it("ignores metadata for a file that is not being carried", () => {
        const previous = makeIndex([file("a.txt", 1), file("b.txt", 2)], [entry(1), entry(2)]);
        const fresh = new Map<string, FileMetadata>([
            [fileKey(SRC, "a.txt"), { mode: 0o600 }],
            [fileKey(SRC, "b.txt"), { mode: 0o600 }],
        ]);

        const carried = carryForward(previous, "full-1.tar", new Set([fileKey(SRC, "a.txt")]), fresh);

        expect(carried.files).toHaveLength(1);
        expect(carried.files[0].p).toBe("a.txt");
    });
});

describe("archive round trip", () => {
    let workDir: string;

    beforeEach(async () => {
        workDir = await fs.mkdtemp(path.join(os.tmpdir(), "dbackup-meta-"));
    });
    afterEach(async () => {
        await fs.rm(workDir, { recursive: true, force: true });
    });

    /**
     * Writes an archive and reads its index back off disk, rather than trusting the object
     * createArchive returns. The index is serialized to JSON lines and parsed again in
     * between, which is where an undefined field could turn into a null one.
     */
    async function writeArchive(files: SourceFileEntry[]): Promise<ArchiveIndex> {
        const sourceDir = path.join(workDir, "src");
        await fs.mkdir(sourceDir, { recursive: true });
        for (const f of files) {
            if (f.linkTarget) continue;
            await fs.writeFile(path.join(sourceDir, f.path), "x".repeat(f.size));
        }

        const archivePath = path.join(workDir, "full.tar");
        const entries: ArchiveSourceEntry[] = [
            { kind: "directory", jobSourceId: SRC, label: "T", localPath: sourceDir, excludePatterns: [], files },
        ];
        await createArchive(entries, archivePath, { sourceType: "directory-only" });

        const source = await localFileSource(archivePath);
        return readArchiveIndex(source, await readArchiveManifest(source));
    }

    it("carries mode, uid and gid from the source entry into the index", async () => {
        const index = await writeArchive([
            { path: "data.bin", size: 12, mtime: "2026-08-02T10:00:00.000Z", mode: 0o600, uid: 1234, gid: 5678 },
        ]);

        const line = index.files.find((f) => f.p === "data.bin")!;
        expect(line).toMatchObject({ mo: 0o600, u: 1234, g: 5678 });
        expect(metadataFromIndex(line, true)).toEqual({ mode: 0o600, uid: 1234, gid: 5678 });
    });

    it("writes no metadata keys at all for a source that reports none", async () => {
        // The regression guard for every existing directory source: the index has to come
        // out byte-identical in shape to what it was before these fields existed.
        const index = await writeArchive([
            { path: "plain.bin", size: 8, mtime: "2026-08-02T10:00:00.000Z" },
        ]);

        const line = index.files.find((f) => f.p === "plain.bin")!;
        expect(line).not.toHaveProperty("mo");
        expect(line).not.toHaveProperty("u");
        expect(line).not.toHaveProperty("g");
    });

    it("keeps metadata through the small-file bundling path", async () => {
        // Files under the bundle threshold take a different branch in the writer that
        // builds its index lines separately, so it can drift from the single-file one.
        const files = Array.from({ length: 6 }, (_, i) => ({
            path: `tiny-${i}.txt`,
            size: 4,
            mtime: "2026-08-02T10:00:00.000Z",
            mode: 0o640,
            uid: 2000 + i,
            gid: 3000,
        }));

        const index = await writeArchive(files);

        for (let i = 0; i < 6; i++) {
            const line = index.files.find((f) => f.p === `tiny-${i}.txt`)!;
            expect(line).toMatchObject({ mo: 0o640, u: 2000 + i, g: 3000 });
        }
    });
});
