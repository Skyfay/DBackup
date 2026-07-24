/**
 * Packing entries ahead of the writer.
 *
 * Compressing an entry is independent work and now runs with a bounded look-ahead, but the
 * tar itself must still be written one entry after another: the byte offsets recorded in the
 * index come from that order, and they are what makes a single file retrievable by range
 * later. A reordering bug here would not fail loudly - it would produce an archive whose
 * index points at the wrong bytes, which only surfaces when someone restores.
 *
 * So the load-bearing assertion is equivalence: the same sources packed with a look-ahead
 * must yield the same layout, entry for entry, as packing them strictly one at a time.
 */
import { describe, it, expect, afterAll } from "vitest";
import { createArchive } from "@/lib/archive/writer";
import { readArchiveIndex, readArchiveFile, readArchiveManifest } from "@/lib/archive/reader";
import { localFileSource } from "@/lib/archive/sources";
import type { ArchiveSourceEntry, SourceFileEntry } from "@/lib/archive/types";
import crypto from "crypto";
import fs from "fs/promises";
import path from "path";
import os from "os";

const scratch: string[] = [];

afterAll(async () => {
    for (const dir of scratch) await fs.rm(dir, { recursive: true, force: true }).catch(() => { });
});

/**
 * A source with enough entries that a look-ahead of 8 genuinely runs ahead, mixing sizes so
 * both the bundled small-file path and the streamed large-file path are exercised.
 */
async function stageSource(): Promise<{ root: string; files: SourceFileEntry[]; contents: Record<string, Buffer> }> {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "pack-src-"));
    scratch.push(root);

    const contents: Record<string, Buffer> = {};
    for (let i = 0; i < 12; i++) contents[`small/file-${i}.txt`] = Buffer.from(`small content ${i}\n`.repeat(10));
    for (let i = 0; i < 4; i++) contents[`large/blob-${i}.bin`] = crypto.randomBytes(200_000);

    const files: SourceFileEntry[] = [];
    for (const [rel, content] of Object.entries(contents)) {
        const abs = path.join(root, rel);
        await fs.mkdir(path.dirname(abs), { recursive: true });
        await fs.writeFile(abs, content);
        files.push({
            path: rel,
            size: content.length,
            mtime: new Date("2026-07-01T00:00:00.000Z").toISOString(),
            checksum: crypto.createHash("sha256").update(content).digest("hex"),
        });
    }
    return { root, files, contents };
}

async function build(
    root: string,
    files: SourceFileEntry[],
    opts: { concurrency: number; encrypted?: boolean; masterKey?: Buffer }
) {
    const outDir = await fs.mkdtemp(path.join(os.tmpdir(), "pack-out-"));
    scratch.push(outDir);
    const archivePath = path.join(outDir, "backup.tar");

    const entries: ArchiveSourceEntry[] = [{
        kind: "directory", jobSourceId: "src-1", label: "Test Source",
        localPath: root, excludePatterns: [], files,
    }];

    const result = await createArchive(entries, archivePath, {
        sourceType: "directory-only",
        compression: "GZIP",
        concurrency: opts.concurrency,
        ...(opts.encrypted ? { encryption: { masterKey: opts.masterKey!, profileId: "prof-1" } } : {}),
    });

    return { archivePath, result };
}

describe("packing entries ahead of the writer", () => {
    it("produces the same layout as strictly serial packing", async () => {
        const { root, files } = await stageSource();

        const serial = await build(root, files, { concurrency: 1 });
        const parallel = await build(root, files, { concurrency: 8 });

        // Same physical members, same order, same offsets and sizes. This is what a
        // reordering or an off-by-one in the look-ahead would break.
        expect([...parallel.result.index.entries.entries()]).toEqual([...serial.result.index.entries.entries()]);
        expect(parallel.result.index.files).toEqual(serial.result.index.files);
        expect(parallel.result.manifest.totalSize).toBe(serial.result.manifest.totalSize);
        expect(parallel.result.manifest.counts).toEqual(serial.result.manifest.counts);
    });

    it("returns every file's original bytes when packed with a look-ahead", async () => {
        const { root, files, contents } = await stageSource();
        const { archivePath, result } = await build(root, files, { concurrency: 8 });

        const source = await localFileSource(archivePath);
        const manifest = await readArchiveManifest(source);
        const index = await readArchiveIndex(source, manifest, {});

        for (const [rel, content] of Object.entries(contents)) {
            const line = index.files.find((f) => f.p === rel);
            expect(line, `index is missing ${rel}`).toBeTruthy();
            const bytes = await readArchiveFile(source, manifest, index, line!);
            expect(bytes.equals(content), `content mismatch for ${rel}`).toBe(true);
        }
        expect(result.index.files).toHaveLength(files.length);
    });

    it("keeps layout and contents intact for an encrypted archive", async () => {
        // Encryption seals each entry at write time, i.e. on the sequential path - the
        // look-ahead must not disturb the per-entry nonce/ordinal pairing.
        const { root, files, contents } = await stageSource();
        const masterKey = crypto.randomBytes(32);

        const serial = await build(root, files, { concurrency: 1, encrypted: true, masterKey });
        const parallel = await build(root, files, { concurrency: 8, encrypted: true, masterKey });

        expect([...parallel.result.index.entries.entries()]).toEqual([...serial.result.index.entries.entries()]);

        const source = await localFileSource(parallel.archivePath);
        const manifest = await readArchiveManifest(source);
        const index = await readArchiveIndex(source, manifest, { masterKey });
        for (const [rel, content] of Object.entries(contents)) {
            const line = index.files.find((f) => f.p === rel)!;
            const bytes = await readArchiveFile(source, manifest, index, line, masterKey);
            expect(bytes.equals(content), `content mismatch for ${rel}`).toBe(true);
        }
    });

    it("reports progress once per entry, in order, ending at the total", async () => {
        const { root, files } = await stageSource();
        const outDir = await fs.mkdtemp(path.join(os.tmpdir(), "pack-progress-"));
        scratch.push(outDir);

        const seen: { done: number; total: number; label: string }[] = [];
        const result = await createArchive(
            [{ kind: "directory", jobSourceId: "src-1", label: "T", localPath: root, excludePatterns: [], files }],
            path.join(outDir, "backup.tar"),
            {
                sourceType: "directory-only", compression: "GZIP", concurrency: 4,
                onProgress: (done, total, label) => seen.push({ done, total, label }),
            }
        );

        // One report per physical member, counting up without gaps despite the look-ahead.
        expect(seen).toHaveLength(result.manifest.counts.entries);
        expect(seen.map((s) => s.done)).toEqual(seen.map((_, i) => i + 1));
        expect(seen.at(-1)!.done).toBe(seen.at(-1)!.total);
        expect(seen.every((s) => s.label.length > 0)).toBe(true);
    });

    it("fails the archive when an entry cannot be read, instead of crashing the process", async () => {
        // A look-ahead failure lands on a promise nobody is awaiting yet. Unhandled, it would
        // take the whole backup process down rather than failing this one run.
        const { root, files } = await stageSource();
        const outDir = await fs.mkdtemp(path.join(os.tmpdir(), "pack-fail-"));
        scratch.push(outDir);

        // Remove a file the plan expects, after planning has already recorded it.
        await fs.rm(path.join(root, "large/blob-3.bin"));

        await expect(
            createArchive(
                [{ kind: "directory", jobSourceId: "src-1", label: "T", localPath: root, excludePatterns: [], files }],
                path.join(outDir, "backup.tar"),
                { sourceType: "directory-only", compression: "GZIP", concurrency: 8 }
            )
        ).rejects.toThrow();
    });
});
