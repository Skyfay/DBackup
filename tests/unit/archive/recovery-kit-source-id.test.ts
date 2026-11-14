// @vitest-environment node
/**
 * The Recovery Kit writes every directory source into one folder of its own below the output
 * folder, named by the source id of the index. A tampered index that names `..` as a source id
 * moved a link to another place than the one its target was measured from, and a link left in the
 * output folder by an earlier run was written through. Nothing of a backup lands outside the
 * output folder.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "fs/promises";
import fsSync from "fs";
import os from "os";
import path from "path";
import { execFile } from "child_process";
import { promisify } from "util";
import { gzipSync } from "zlib";
import { pack } from "tar-stream";
import { createArchive } from "@/lib/archive/writer";

const execFileAsync = promisify(execFile);
const SCRIPT = path.resolve(process.cwd(), "scripts/dbackup-recover.js");
const MTIME = "2026-01-01T00:00:00.000Z";

let workDir: string;
beforeEach(async () => { workDir = await fs.mkdtemp(path.join(os.tmpdir(), "kit-source-id-")); });
afterEach(async () => { await fs.rm(workDir, { recursive: true, force: true }); });

async function runScript(args: string[], cwd: string): Promise<{ stdout: string; stderr: string; code: number }> {
    try {
        const { stdout, stderr } = await execFileAsync("node", [SCRIPT, ...args], { cwd, env: { PATH: process.env.PATH ?? "" } as unknown as NodeJS.ProcessEnv });
        return { stdout, stderr, code: 0 };
    } catch (e: unknown) {
        const err = e as { stdout?: string; stderr?: string; code?: number };
        return { stdout: err.stdout ?? "", stderr: err.stderr ?? "", code: err.code ?? 1 };
    }
}

/** An unencrypted archive with the given index lines, as someone who writes the destination can make it. */
async function tamperedArchive(name: string, lines: object[]): Promise<string> {
    const manifest = Buffer.from(JSON.stringify({
        version: 2, createdAt: "", sourceType: "directory-only", compression: "NONE",
        counts: { databases: 0, directorySources: 1, files: lines.length, entries: 0, symlinks: lines.length }, totalSize: 0, indexMember: "index",
    }));
    const header = { k: "h", v: 2, createdAt: "", archive: name };
    const index = gzipSync([header, ...lines].map((line) => JSON.stringify(line)).join("\n") + "\n");
    const tar = pack();
    tar.entry({ name: "manifest.json" }, manifest);
    tar.entry({ name: "index" }, index);
    tar.finalize();
    const chunks: Buffer[] = [];
    for await (const chunk of tar) chunks.push(chunk as Buffer);
    const archivePath = path.join(workDir, name);
    await fs.writeFile(archivePath, Buffer.concat(chunks));
    return archivePath;
}

/** A real archive of one source `s` that holds the file `l/written.txt`. */
async function honestArchive(): Promise<string> {
    const sourceDir = path.join(workDir, "source");
    await fs.mkdir(path.join(sourceDir, "l"), { recursive: true });
    await fs.writeFile(path.join(sourceDir, "l/written.txt"), "dummy-content\n");
    const archivePath = path.join(workDir, "honest.tar");
    await createArchive([{
        kind: "directory", jobSourceId: "s", label: "SFTP: /srv", localPath: sourceDir, excludePatterns: [],
        files: [{ path: "l/written.txt", size: 14, mtime: MTIME }],
    }], archivePath, { sourceType: "directory-only" });
    return archivePath;
}

describe("recovering a backup whose index was edited on the destination", () => {
    it("refuses an index whose source id climbs out of the folder of its source", async () => {
        const kit = path.join(workDir, "kit");
        await fs.mkdir(kit);
        const archive = await tamperedArchive("a.tar", [
            { k: "f", src: "..", p: "restored/s/l", s: 0, m: MTIME, lnk: "../.." },
            { k: "f", src: "s", p: "l/planted-dir/link2", s: 0, m: MTIME, lnk: "x" },
        ]);

        const { stderr, code } = await runScript(["--extract", archive, "restored"], kit);

        expect(code).not.toBe(0);
        expect(stderr).toContain("its index names a source that is no plain folder name");
        expect(fsSync.existsSync(path.join(kit, "restored/s/l"))).toBe(false);
        expect(fsSync.existsSync(path.join(kit, "planted-dir"))).toBe(false);
    });

    it.each(["..", ".", "", "a/b", "a\\b", "/abs"])("refuses the source id %j on a directory line too", async (src) => {
        const archive = await tamperedArchive("d.tar", [
            { k: "d", src, label: "x", fileCount: 0, totalSize: 0, excludePatterns: [] },
        ]);

        const { stderr, code } = await runScript(["--list", archive], workDir);

        expect(code).not.toBe(0);
        expect(stderr).toContain("its index names a source that is no plain folder name");
    });

    it("writes no file through a link that an earlier extraction left in the output folder", async () => {
        const kit = path.join(workDir, "kit");
        await fs.mkdir(path.join(kit, "restored/s"), { recursive: true });
        // What the first run of the attack left behind: a link that points at the parent of the output folder.
        await fs.symlink("../..", path.join(kit, "restored/s/l"));
        const archive = await honestArchive();

        const { stderr } = await runScript(["--extract", archive, "restored"], kit);

        expect(stderr).toContain("SKIPPED (a link in the output folder leads out of it): l/written.txt");
        expect(fsSync.existsSync(path.join(kit, "written.txt"))).toBe(false);
        expect((await fs.readdir(kit)).sort()).toEqual(["restored"]);
    });

    it("lays no link through a link that already leads out of the output folder", async () => {
        const kit = path.join(workDir, "kit");
        await fs.mkdir(path.join(kit, "restored/s"), { recursive: true });
        await fs.symlink("../..", path.join(kit, "restored/s/l"));
        const archive = await tamperedArchive("b.tar", [
            { k: "f", src: "s", p: "l/planted-dir/link2", s: 0, m: MTIME, lnk: "x" },
        ]);

        await runScript(["--extract", archive, "restored"], kit);

        expect((await fs.readdir(kit)).sort()).toEqual(["restored"]);
    });

    it("still extracts a backup with a plain source id into the folder of that source", async () => {
        const kit = path.join(workDir, "kit");
        await fs.mkdir(kit);
        const archive = await honestArchive();

        const { stderr, code } = await runScript(["--extract", archive, "restored"], kit);

        expect(stderr).toBe("");
        expect(code).toBe(0);
        expect(await fs.readFile(path.join(kit, "restored/s/l/written.txt"), "utf-8")).toBe("dummy-content\n");
    });
});
