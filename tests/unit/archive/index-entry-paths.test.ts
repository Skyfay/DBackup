// @vitest-environment node
/**
 * The path of every file line is plain once the index is parsed. The checks of symbolic links
 * count the parts of a path as written, while a join resolves a `..` inside it, so `a/../b` was
 * checked at one place and written at another. DBackup and the Recovery Kit refuse such an index.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "fs/promises";
import fsSync from "fs";
import os from "os";
import path from "path";
import { createRequire } from "module";
import { gzipSync } from "zlib";
import { pack } from "tar-stream";
import { entryPathProblem, parseIndex } from "@/lib/archive/index-file";

const require_ = createRequire(import.meta.url);
const kit = require_(path.resolve(process.cwd(), "scripts/dbackup-recover.js")) as {
    entryPathProblem: (entryPath: unknown) => string | null;
    openArchive: (archivePath: string, hexKey?: string) => { fd: number; index: { files: { p: string }[] } };
};

const REFUSED = ["a/../b", "../x", "x/..", "./x", "a/./b", "a//b", "/etc/passwd", "a\\..\\b", "..\\x", "\\x", "a/", "", "a\0b"];
const PLAIN = ["a/b", "..x", "x..", "a/.hidden/b", "a\\b", "file name.txt", "a/..b/c"];

const header = JSON.stringify({ k: "h", v: 2, createdAt: "", archive: "x.tar" });
const ndjson = (p: string) => `${header}\n${JSON.stringify({ k: "f", src: "s", p, s: 0, m: "", lnk: "target" })}\n`;

describe("a path of the index", () => {
    it.each(REFUSED)("%j is refused by DBackup and the Recovery Kit alike", async (p) => {
        expect(entryPathProblem(p)).not.toBeNull();
        expect(kit.entryPathProblem(p)).toBe(entryPathProblem(p));
        await expect(parseIndex(gzipSync(ndjson(p)))).rejects.toThrow(/^The backup is damaged: its index names /);
    });

    it.each(PLAIN)("%j is a plain path both read", async (p) => {
        expect(entryPathProblem(p)).toBeNull();
        expect(kit.entryPathProblem(p)).toBeNull();
        expect((await parseIndex(gzipSync(ndjson(p)))).files[0].p).toBe(p);
    });
});

describe("the Recovery Kit", () => {
    let workDir: string;
    beforeEach(async () => { workDir = await fs.mkdtemp(path.join(os.tmpdir(), "kit-paths-")); });
    afterEach(async () => { await fs.rm(workDir, { recursive: true, force: true }); });

    /** An unencrypted archive whose index holds one link at `linkPath`. */
    async function archiveWith(linkPath: string): Promise<string> {
        const manifest = Buffer.from(JSON.stringify({
            version: 2, createdAt: "", sourceType: "directory-only", compression: "NONE",
            counts: { databases: 0, directorySources: 1, files: 1, entries: 0, symlinks: 1 }, totalSize: 0, indexMember: "index",
        }));
        const index = gzipSync(`${header}\n${JSON.stringify({ k: "d", src: "s", label: "x", fileCount: 1, totalSize: 0, excludePatterns: [] })}\n`
            + JSON.stringify({ k: "f", src: "s", p: linkPath, s: 0, m: "", lnk: "x" }) + "\n");
        const tar = pack();
        tar.entry({ name: "manifest.json" }, manifest);
        tar.entry({ name: "index" }, index);
        tar.finalize();
        const chunks: Buffer[] = [];
        for await (const chunk of tar) chunks.push(chunk as Buffer);
        const target = path.join(workDir, "backup.tar");
        await fs.writeFile(target, Buffer.concat(chunks));
        return target;
    }

    it("refuses an archive whose index names a link at a path that climbs", async () => {
        const archive = await archiveWith("up/../escape");
        expect(() => kit.openArchive(archive)).toThrow(/The backup is damaged: its index names/);
    });

    it("opens the same archive with a plain path", async () => {
        const opened = kit.openArchive(await archiveWith("up/escape"));
        expect(opened.index.files.map((f) => f.p)).toEqual(["up/escape"]);
        fsSync.closeSync(opened.fd);
    });
});
