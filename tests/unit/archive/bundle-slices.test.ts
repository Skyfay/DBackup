// @vitest-environment node
/**
 * A bundled file is a slice of the payload of its bundle, placed by the offset and length of its
 * index line. A line whose slice reaches past the payload restored a short file before, and lines
 * whose slices share bytes could write one bundle many times over. Both are a damaged index now, in
 * every reader of bundle slices. A length past the size is no damage: older versions wrote the size
 * when they collected a file and the length when they packed it, so a file that grew has a longer one.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "fs/promises";
import os from "os";
import path from "path";
import { createArchive } from "@/lib/archive/writer";
import { extractArchiveFrom } from "@/lib/archive/extract";
import { forEachSnapshotFile } from "@/lib/archive/chain-source";
import { archiveKeysFor, bundleSlice, bundleSliceOf, bundleSlices, openArchiveFile, readArchiveManifest } from "@/lib/archive/reader";
import { localFileSource, readAll } from "@/lib/archive/sources";
import { serializeIndex } from "@/lib/archive/index-file";
import { DamagedBackupError } from "@/lib/archive/limits";
import type { ArchiveIndex, IndexFileLine, IndexLine } from "@/lib/archive/types";

const SRC = "src-1";
const MASTER_KEY = Buffer.alloc(32, 7);

const line = (over: Partial<IndexFileLine>): IndexFileLine => ({ k: "f", src: SRC, p: "a.txt", s: 10, m: "", n: 1, o: 0, l: 10, ...over });

let workDir: string;
beforeEach(async () => { workDir = await fs.mkdtemp(path.join(os.tmpdir(), "bundle-slices-")); });
afterEach(async () => { await fs.rm(workDir, { recursive: true, force: true }); });

/** An encrypted archive of two small files, which the writer packs into one bundle. */
async function bundledArchive() {
    const root = path.join(workDir, "src");
    await fs.mkdir(root);
    await fs.writeFile(path.join(root, "a.txt"), "first file");
    await fs.writeFile(path.join(root, "b.txt"), "second file");
    const archive = path.join(workDir, "backup.tar");
    const { index } = await createArchive([{
        kind: "directory", jobSourceId: SRC, label: "src", localPath: root, excludePatterns: [],
        files: [
            { path: "a.txt", size: 10, mtime: "2026-11-07T00:00:00.000Z" },
            { path: "b.txt", size: 11, mtime: "2026-11-07T00:00:00.000Z" },
        ],
    }], archive, { sourceType: "directory-only", encryption: { masterKey: MASTER_KEY, profileId: "p" } });
    const source = await localFileSource(archive);
    const manifest = await readArchiveManifest(source);
    const entry = [...index.entries.values()].find((e) => e.bundle);
    expect(entry, "the writer bundles the two files").toBeDefined();
    return { source, manifest, index };
}

/** The index with the second file's line changed. */
const damage = (index: ArchiveIndex, over: Partial<IndexFileLine>): ArchiveIndex => ({
    ...index,
    files: index.files.map((file) => (file.p === "b.txt" ? { ...file, ...over } : file)),
});

describe("the place of a bundled file", () => {
    it("is the slice the line gives", () => {
        expect(bundleSliceOf(line({ o: 4, l: 10 }), 14)).toEqual({ start: 4, end: 14 });
        expect(bundleSlice(Buffer.from("xxxxfirst file"), line({ o: 4, l: 10 })).toString()).toBe("first file");
    });

    it.each<[string, Partial<IndexFileLine>]>([
        ["a slice past the payload", { o: 10 }],
        ["no offset", { o: undefined }],
        ["no length", { l: undefined }],
        ["a negative offset", { o: -1 }],
        ["an offset that is no integer", { o: 1.5 }],
    ])("is refused as damaged for %s", (_name, over) => {
        expect(() => bundleSlice(Buffer.alloc(14), line(over))).toThrow(DamagedBackupError);
    });

    it("is read in full when the file grew between collecting and packing it, as older versions wrote it", () => {
        expect(bundleSlice(Buffer.from("first file, grown"), line({ s: 10, l: 17 })).toString()).toBe("first file, grown");
    });

    it("is refused as damaged when files of one bundle share bytes, so no index writes a bundle many times over", () => {
        const payload = Buffer.from("first filesecond file");
        expect(bundleSlices(payload, [line({ o: 0, l: 10 }), line({ p: "b.txt", o: 10, l: 11 })]).map(String)).toEqual(["first file", "second file"]);
        expect(() => bundleSlices(payload, [line({ o: 0, l: 21 }), line({ p: "b.txt", o: 10, l: 11 })])).toThrow(DamagedBackupError);
        expect(() => bundleSlices(payload, Array.from({ length: 3 }, (_, i) => line({ p: `${i}.txt`, o: 0, l: 21 })))).toThrow(DamagedBackupError);
    });
});

describe.each<[string, Partial<IndexFileLine>]>([
    ["a slice past the payload", { o: 1000 }],
])("a bundled file with %s", (_name, over) => {
    it("fails a restore through the read core before a file of the bundle is visited", async () => {
        const { source, manifest, index } = await bundledArchive();
        const damaged = damage(index, over);
        const visited: string[] = [];
        const snapshot = {
            source, manifest, index: damaged, masterKey: MASTER_KEY,
            chain: { adapter: {} as never, config: {} as never, snapshotPath: "backup.tar", resolveMasterKey: async () => MASTER_KEY },
        };

        for (const concurrency of [1, 4]) {
            await expect(forEachSnapshotFile(snapshot, damaged.files.map((file) => ({ file })), async (file, content) => {
                visited.push(file.p);
                content.resume();
            }, concurrency)).rejects.toBeInstanceOf(DamagedBackupError);
        }
        expect(visited).toEqual([]);
    });

    it("fails a read of the single file", async () => {
        const { source, manifest, index } = await bundledArchive();
        const damaged = damage(index, over);
        const file = damaged.files.find((f) => f.p === "b.txt")!;

        await expect(openArchiveFile(source, manifest, damaged, file, MASTER_KEY).then(readAll)).rejects.toBeInstanceOf(DamagedBackupError);
    });

    it("fails an extraction before a file of the bundle is written", async () => {
        const { source, manifest, index } = await bundledArchive();
        const damaged = damage(index, over);
        const keys = archiveKeysFor(manifest, MASTER_KEY)!;
        const lines: IndexLine[] = [damaged.header, ...damaged.entries.values(), ...damaged.databases, ...damaged.directories, ...damaged.files];
        const sidecarBytes = await serializeIndex(lines, { indexKey: keys.indexKey, noncePrefix: keys.noncePrefix });
        const out = path.join(workDir, "out");

        await expect(extractArchiveFrom(source, out, { masterKey: MASTER_KEY, sidecarBytes })).rejects.toBeInstanceOf(DamagedBackupError);
        await expect(fs.readdir(path.join(out, "sources", SRC)).catch(() => [])).resolves.toEqual([]);
    });
});

describe("a bundled file that shares bytes with another of its bundle", () => {
    it("fails a restore through the read core and an extraction before a file of the bundle is visited", async () => {
        const { source, manifest, index } = await bundledArchive();
        const damaged = damage(index, { o: 0 });
        const visited: string[] = [];
        const snapshot = {
            source, manifest, index: damaged, masterKey: MASTER_KEY,
            chain: { adapter: {} as never, config: {} as never, snapshotPath: "backup.tar", resolveMasterKey: async () => MASTER_KEY },
        };
        await expect(forEachSnapshotFile(snapshot, damaged.files.map((file) => ({ file })), async (file, content) => {
            visited.push(file.p);
            content.resume();
        }, 1)).rejects.toBeInstanceOf(DamagedBackupError);
        expect(visited).toEqual([]);

        const keys = archiveKeysFor(manifest, MASTER_KEY)!;
        const lines: IndexLine[] = [damaged.header, ...damaged.entries.values(), ...damaged.databases, ...damaged.directories, ...damaged.files];
        const sidecarBytes = await serializeIndex(lines, { indexKey: keys.indexKey, noncePrefix: keys.noncePrefix });
        await expect(extractArchiveFrom(source, path.join(workDir, "out"), { masterKey: MASTER_KEY, sidecarBytes })).rejects.toBeInstanceOf(DamagedBackupError);
    });
});

describe("a backup DBackup wrote with a bundle", () => {
    it("still reads every bundled file in full", async () => {
        const { source, manifest, index } = await bundledArchive();
        const read = await Promise.all(index.files.map(async (file) => (await readAll(await openArchiveFile(source, manifest, index, file, MASTER_KEY))).toString()));

        expect(read.sort()).toEqual(["first file", "second file"]);
    });
});
