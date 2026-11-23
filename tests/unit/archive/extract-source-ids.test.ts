// @vitest-environment node
/**
 * The id of a directory source names its folder in an extraction, and the checks of links are keyed
 * by it. An index that gives a source an id like `x/../other` or `a/b` would put its files into
 * the folder of another source, past the link checks of that one, so such an id is refused.
 */
import { describe, it, expect, afterEach } from "vitest";
import fs from "fs/promises";
import os from "os";
import path from "path";
import { createArchive } from "@/lib/archive/writer";
import { extractArchiveFrom } from "@/lib/archive/extract";
import { localFileSource } from "@/lib/archive/sources";
import { serializeIndex } from "@/lib/archive/index-file";
import type { IndexLine } from "@/lib/archive/types";

const SRC = "job-source-1";
const dirs: string[] = [];

afterEach(async () => {
    for (const dir of dirs.splice(0)) await fs.rm(dir, { recursive: true, force: true });
});

/** An unencrypted archive of one file, and its index lines with the id of the source replaced. */
async function archiveWithSourceId(src: string) {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "extract-src-"));
    dirs.push(tmp);
    const root = path.join(tmp, "src");
    await fs.mkdir(root);
    await fs.writeFile(path.join(root, "a.txt"), "first file");
    const archive = path.join(tmp, "backup.tar");
    const { index } = await createArchive(
        [{ kind: "directory", jobSourceId: SRC, label: "src", localPath: root, excludePatterns: [], files: [{ path: "a.txt", size: 10, mtime: "2026-10-27T00:00:00.000Z" }] }],
        archive,
        { sourceType: "directory-only" }
    );
    const lines: IndexLine[] = [
        index.header,
        ...index.entries.values(),
        ...index.databases,
        ...index.directories.map((d) => ({ ...d, src })),
        ...index.files.map((f) => ({ ...f, src })),
    ];
    return { tmp, archive, sidecarBytes: await serializeIndex(lines) };
}

describe("the id of a directory source in an extraction", () => {
    it.each(["x/../job-source-2", "a/b", "a\\b", "..", "."])("refuses %j before anything is written", async (src) => {
        const { tmp, archive, sidecarBytes } = await archiveWithSourceId(src);
        const out = path.join(tmp, "out");

        await expect(extractArchiveFrom(await localFileSource(archive), out, { sidecarBytes })).rejects.toThrow(/Refusing|damaged/);
        await expect(fs.readdir(path.join(out, "sources")).catch(() => [])).resolves.toEqual([]);
    });

    it("still extracts a source with a plain id", async () => {
        const { tmp, archive, sidecarBytes } = await archiveWithSourceId(SRC);
        const out = path.join(tmp, "out");

        await extractArchiveFrom(await localFileSource(archive), out, { sidecarBytes });

        expect(await fs.readFile(path.join(out, "sources", SRC, "a.txt"), "utf-8")).toBe("first file");
    });
});
