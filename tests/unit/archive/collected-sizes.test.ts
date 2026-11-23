// @vitest-environment node
/**
 * The size of a collected file comes from the file as it lies in the collection folder, never from
 * the listing of the source, which a customer's server writes. The archive decides on it what it
 * bundles, and a restore stops a file at its `s`.
 */
import { describe, it, expect, afterEach } from "vitest";
import fs from "fs/promises";
import path from "path";
import os from "os";
import { brotliCompressSync, constants, gzipSync } from "zlib";
import { createArchive } from "@/lib/archive/writer";
import { extractArchive } from "@/lib/archive/extract";
import { BUNDLE_FILE_MAX_SIZE } from "@/lib/archive/format";
import type { ArchiveSourceEntry, SourceFileEntry } from "@/lib/archive/types";
import { checkCollectedEntries } from "@/lib/runner/steps/collected-entries";
import { BROTLI_QUALITY, compressBuffer } from "@/lib/crypto/compression";
import type { DirectoryFileEntry } from "@/lib/core/interfaces";

const SRC = "job-source-1";
const MASTER_KEY = Buffer.alloc(32, 9);
const dirs: string[] = [];

async function tempDir(): Promise<string> {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "collected-sizes-"));
    dirs.push(dir);
    return dir;
}

afterEach(async () => {
    for (const dir of dirs.splice(0)) await fs.rm(dir, { recursive: true, force: true });
});

function sourceEntry(localPath: string, files: SourceFileEntry[]): ArchiveSourceEntry[] {
    return [{ kind: "directory", jobSourceId: SRC, label: "src", localPath, excludePatterns: [], files }];
}

const file = (p: string, size: number): SourceFileEntry => ({ path: p, size, mtime: "2026-10-27T00:00:00.000Z" });

describe("the size of a collected file", () => {
    it("is the size the hash read, whatever the listing reported", async () => {
        const root = await tempDir();
        await fs.writeFile(path.join(root, "big.bin"), Buffer.alloc(200 * 1024, 1));
        const listed: DirectoryFileEntry = { relativePath: "big.bin", size: 10, lastModified: new Date() } as DirectoryFileEntry;

        const checked = await checkCollectedEntries(root, [listed], { concurrency: 1 });

        expect(checked.hashed[0].size).toBe(200 * 1024);
    });

    it("never puts a file larger than a bundle takes into one, even when its entry says it is small", async () => {
        const tmp = await tempDir();
        const root = path.join(tmp, "src");
        await fs.mkdir(root);
        await fs.writeFile(path.join(root, "small.txt"), "small");
        // A listing that lies, or a file that grew after it was planned.
        await fs.writeFile(path.join(root, "liar.bin"), Buffer.alloc(BUNDLE_FILE_MAX_SIZE * 4, 2));
        const skipped: string[] = [];

        const { index } = await createArchive(
            sourceEntry(root, [file("small.txt", 5), file("liar.bin", 10)]),
            path.join(tmp, "backup.tar"),
            {
                sourceType: "directory-only",
                encryption: { masterKey: MASTER_KEY, profileId: "p" },
                onFileSkipped: (_src, p) => skipped.push(p),
            }
        );

        expect(skipped).toEqual(["liar.bin"]);
        expect(index.files.map((f) => f.p)).toEqual(["small.txt"]);
        const out = path.join(tmp, "out");
        await extractArchive(path.join(tmp, "backup.tar"), out, { masterKey: MASTER_KEY });
        expect(await fs.readFile(path.join(out, "sources", SRC, "small.txt"), "utf-8")).toBe("small");
    });

    it("records a file that grew since it was listed with its real size, so it restores whole", async () => {
        const tmp = await tempDir();
        const root = path.join(tmp, "src");
        await fs.mkdir(root);
        const content = Buffer.alloc(300 * 1024, 3);
        await fs.writeFile(path.join(root, "grew.log"), content);

        for (const compression of ["NONE", "GZIP"] as const) {
            const archive = path.join(tmp, `backup-${compression}.tar`);
            const { index } = await createArchive(sourceEntry(root, [file("grew.log", 100)]), archive, { sourceType: "directory-only", compression });
            expect(index.files[0].s).toBe(content.length);

            const out = path.join(tmp, `out-${compression}`);
            await extractArchive(archive, out);
            expect((await fs.readFile(path.join(out, "sources", SRC, "grew.log"))).equals(content)).toBe(true);
        }
    });
});

describe("the compression of a bundle", () => {
    it("runs off the event loop and writes the same bytes as before", async () => {
        const input = Buffer.from("a bundle of small files ".repeat(4000));
        const brotli = brotliCompressSync(input, { params: { [constants.BROTLI_PARAM_QUALITY]: BROTLI_QUALITY } });

        const pending = compressBuffer(input, "BROTLI");
        expect(pending).toBeInstanceOf(Promise);
        expect((await pending).equals(brotli)).toBe(true);
        expect((await compressBuffer(input, "GZIP")).equals(gzipSync(input))).toBe(true);
        expect(await compressBuffer(input, "NONE")).toBe(input);
    });
});
