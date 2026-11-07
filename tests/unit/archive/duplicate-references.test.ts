// @vitest-environment node
/**
 * An entry that is no bundle holds the bytes of one file. An index whose file lines point several
 * files at one such entry restored only the first of them before, and the rest silently not. It is
 * a damaged index now, refused before anything of the selection is read or written.
 */
import { describe, it, expect, afterEach } from "vitest";
import fs from "fs/promises";
import os from "os";
import path from "path";
import { createArchive } from "@/lib/archive/writer";
import { extractArchiveFrom } from "@/lib/archive/extract";
import { forEachSnapshotFile } from "@/lib/archive/chain-source";
import { assertSingleReferences } from "@/lib/archive/reader";
import { localFileSource } from "@/lib/archive/sources";
import { serializeIndex } from "@/lib/archive/index-file";
import { DamagedBackupError } from "@/lib/archive/limits";
import { entryKey, type ArchiveIndex, type IndexEntryLine, type IndexFileLine, type IndexLine } from "@/lib/archive/types";

const SRC = "job-source-1";
const dirs: string[] = [];

afterEach(async () => {
    for (const dir of dirs.splice(0)) await fs.rm(dir, { recursive: true, force: true });
});

/** An unencrypted archive of two files, each its own entry, and its index with the second file pointed at the entry of the first. */
async function archiveWithSharedEntry() {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "dup-ref-"));
    dirs.push(tmp);
    const root = path.join(tmp, "src");
    await fs.mkdir(root);
    await fs.writeFile(path.join(root, "a.txt"), "first file");
    await fs.writeFile(path.join(root, "b.txt"), "second file");
    const archive = path.join(tmp, "backup.tar");
    const files = [
        { path: "a.txt", size: 10, mtime: "2026-10-27T00:00:00.000Z" },
        { path: "b.txt", size: 11, mtime: "2026-10-27T00:00:00.000Z" },
    ];
    const { index } = await createArchive(
        [{ kind: "directory", jobSourceId: SRC, label: "src", localPath: root, excludePatterns: [], files }],
        archive,
        { sourceType: "directory-only" }
    );
    const [first, second] = index.files;
    const damaged: ArchiveIndex = { ...index, files: [first, { ...second, n: first.n }] };
    return { tmp, archive, index: damaged };
}

describe("an entry referenced by several files of the index", () => {
    it("is refused when the entry is no bundle", () => {
        const entries = new Map<string, IndexEntryLine>([[entryKey(undefined, 1), { k: "e", n: 1, member: "m", off: 0, size: 1 }]]);
        const files = [{ n: 1, p: "a" }, { n: 1, p: "b" }] as IndexFileLine[];
        expect(() => assertSingleReferences(entries, files)).toThrow(DamagedBackupError);
        expect(() => assertSingleReferences(entries, files.slice(0, 1))).not.toThrow();

        const bundle = new Map<string, IndexEntryLine>([[entryKey(undefined, 1), { k: "e", n: 1, member: "m", off: 0, size: 1, bundle: true }]]);
        expect(() => assertSingleReferences(bundle, files)).not.toThrow();
    });

    it("fails a restore through the read core before the first file is visited", async () => {
        const { archive, index } = await archiveWithSharedEntry();
        const source = await localFileSource(archive);
        const visited: string[] = [];
        const snapshot = {
            source,
            manifest: { version: 2 } as never,
            index,
            chain: { adapter: {} as never, config: {} as never, snapshotPath: "backup.tar", resolveMasterKey: async () => Buffer.alloc(0) },
        };

        await expect(forEachSnapshotFile(snapshot, index.files.map((file) => ({ file })), async (file, content) => {
            visited.push(file.p);
            content.resume();
        })).rejects.toThrow(/The backup is damaged: its index points 2 files at entry/);
        expect(visited).toEqual([]);
    });

    it("fails an extraction before anything is written", async () => {
        const { tmp, archive, index } = await archiveWithSharedEntry();
        const lines: IndexLine[] = [index.header, ...index.entries.values(), ...index.databases, ...index.directories, ...index.files];
        const out = path.join(tmp, "out");

        await expect(extractArchiveFrom(await localFileSource(archive), out, { sidecarBytes: await serializeIndex(lines) }))
            .rejects.toBeInstanceOf(DamagedBackupError);
        await expect(fs.readdir(path.join(out, "sources", SRC)).catch(() => [])).resolves.toEqual([]);
    });
});
