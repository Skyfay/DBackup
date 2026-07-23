/**
 * Round-trip of the archive format against awkward real-world inputs, using the *external*
 * tools the recovery promises name.
 *
 * Two claims can only be checked by running them: that an unencrypted archive extracts
 * with plain `tar -xf`, and that the standalone recovery kit reads what the writer emits.
 * Reviewing the writer cannot prove either - a header field that is wrong in a way both
 * our writer and our reader agree on stays invisible until someone needs their data back
 * and DBackup is not around. Hence real `tar` and a real `node` subprocess.
 *
 * The inputs are chosen to stress ustar: paths beyond 100 characters, unicode, spaces and
 * shell metacharacters, empty files, dotfiles.
 */
import { describe, it, expect, afterAll } from "vitest";
import { createArchive } from "@/lib/archive/writer";
import { readArchiveIndex, readArchiveFile, readArchiveManifest } from "@/lib/archive/reader";
import { localFileSource } from "@/lib/archive/sources";
import type { ArchiveSourceEntry, SourceFileEntry } from "@/lib/archive/types";
import { execFile } from "child_process";
import { promisify } from "util";
import crypto from "crypto";
import fs from "fs/promises";
import path from "path";
import os from "os";

const execFileAsync = promisify(execFile);
const scratch: string[] = [];

/** Skip rather than fail where tar is absent - the format itself is covered elsewhere. */
const hasTar = await execFileAsync("tar", ["--version"]).then(() => true, () => false);

afterAll(async () => {
    for (const dir of scratch) await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
});

/** Names chosen to stress ustar: >100 chars, unicode, spaces, dots, deep nesting. */
const AWKWARD: Record<string, string> = {
    "plain.txt": "hello",
    "empty.txt": "",
    "unicode/äöü-日本語-emoji-🎉.txt": "unicode content",
    "with spaces/and (parens)/file [1].txt": "spaces",
    ["deep/" + "a".repeat(80) + "/" + "b".repeat(80) + "/long-name-file.txt"]: "long path over 100 chars",
    "dotfile/.hidden": "hidden",
    "big.bin": "X".repeat(300_000),
};

async function stageSource(): Promise<{ root: string; files: SourceFileEntry[] }> {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "rt-src-"));
    scratch.push(root);
    const files: SourceFileEntry[] = [];
    for (const [rel, content] of Object.entries(AWKWARD)) {
        const abs = path.join(root, rel);
        await fs.mkdir(path.dirname(abs), { recursive: true });
        await fs.writeFile(abs, content);
        files.push({
            path: rel,
            size: Buffer.byteLength(content),
            mtime: new Date("2026-07-01T00:00:00.000Z").toISOString(),
            checksum: crypto.createHash("sha256").update(content).digest("hex"),
        });
    }
    return { root, files };
}

async function buildArchive(opts: { encrypted?: boolean; compression?: "NONE" | "GZIP" } = {}) {
    const { root, files } = await stageSource();
    const outDir = await fs.mkdtemp(path.join(os.tmpdir(), "rt-out-"));
    scratch.push(outDir);
    const archivePath = path.join(outDir, "backup.tar");

    const entries: ArchiveSourceEntry[] = [{
        kind: "directory",
        jobSourceId: "src-1",
        label: "Test Source",
        localPath: root,
        excludePatterns: [],
        files,
    }];

    const masterKey = crypto.randomBytes(32);
    const result = await createArchive(entries, archivePath, {
        sourceType: "directory-only",
        compression: opts.compression ?? "NONE",
        ...(opts.encrypted ? { encryption: { masterKey, profileId: "prof-1" } } : {}),
    });

    return { archivePath, result, masterKey, outDir, files };
}

describe.skipIf(!hasTar)("archive round-trip through external tools", () => {
    it("unencrypted, uncompressed: plain `tar -xf` extracts every file byte-identically", async () => {
        // The vendor-independence promise for the unencrypted case.
        const { archivePath } = await buildArchive();
        const extractDir = await fs.mkdtemp(path.join(os.tmpdir(), "rt-tar-"));
        scratch.push(extractDir);

        await execFileAsync("tar", ["-xf", archivePath, "-C", extractDir]);

        for (const [rel, content] of Object.entries(AWKWARD)) {
            const candidates = [
                path.join(extractDir, "sources", "src-1", rel),
                path.join(extractDir, "s", "src-1", rel),
            ];
            let found: string | null = null;
            for (const c of candidates) {
                if (await fs.access(c).then(() => true, () => false)) { found = c; break; }
            }
            expect(found, `tar did not extract ${rel}`).toBeTruthy();
            expect(await fs.readFile(found!, "utf-8")).toBe(content);
        }
    });

    it("unencrypted + gzip per entry: the reader returns the original bytes", async () => {
        const { archivePath, masterKey } = await buildArchive({ compression: "GZIP" });
        const source = await localFileSource(archivePath);
        const manifest = await readArchiveManifest(source);
        const index = await readArchiveIndex(source, manifest, { masterKey });

        for (const [rel, content] of Object.entries(AWKWARD)) {
            const line = index.files.find((f) => f.p === rel);
            expect(line, `index is missing ${rel}`).toBeTruthy();
            const bytes = await readArchiveFile(source, manifest, index, line!, masterKey);
            expect(bytes.toString("utf-8"), `content mismatch for ${rel}`).toBe(content);
        }
    });

    it("encrypted: every file round-trips and the index hides the paths", async () => {
        const { archivePath, masterKey } = await buildArchive({ encrypted: true, compression: "GZIP" });
        const source = await localFileSource(archivePath);
        const manifest = await readArchiveManifest(source);
        const index = await readArchiveIndex(source, manifest, { masterKey });

        for (const [rel, content] of Object.entries(AWKWARD)) {
            const line = index.files.find((f) => f.p === rel);
            expect(line, `index is missing ${rel}`).toBeTruthy();
            const bytes = await readArchiveFile(source, manifest, index, line!, masterKey);
            expect(bytes.toString("utf-8"), `content mismatch for ${rel}`).toBe(content);
        }

        // No cleartext path may appear in the raw archive bytes.
        const raw = await fs.readFile(archivePath);
        expect(raw.includes(Buffer.from("plain.txt"))).toBe(false);
        expect(raw.includes(Buffer.from("日本語"))).toBe(false);
    });

    it("recorded offsets and sizes match the file on disk", async () => {
        const { archivePath, masterKey } = await buildArchive({ compression: "GZIP" });
        const source = await localFileSource(archivePath);
        const manifest = await readArchiveManifest(source);
        const index = await readArchiveIndex(source, manifest, { masterKey });
        const stat = await fs.stat(archivePath);

        for (const [, entry] of index.entries) {
            expect(entry.off, "negative offset").toBeGreaterThanOrEqual(0);
            expect(entry.off + entry.size, `entry ${entry.member} runs past EOF`).toBeLessThanOrEqual(stat.size);
        }
    });

    it("the recovery kit lists and extracts the unencrypted archive", async () => {
        const { archivePath, outDir } = await buildArchive({ compression: "GZIP" });
        const kit = path.resolve(process.cwd(), "scripts/restore_archive.js");

        const listed = await execFileAsync("node", [kit, "--list", archivePath], { maxBuffer: 32 * 1024 * 1024 });
        for (const rel of Object.keys(AWKWARD)) {
            expect(listed.stdout, `recovery kit --list is missing ${rel}`).toContain(rel);
        }

        const target = path.join(outDir, "kit-extract");
        await execFileAsync("node", [kit, "--extract", archivePath, target], { maxBuffer: 32 * 1024 * 1024 });

        const walk = async (dir: string): Promise<string[]> => {
            const out: string[] = [];
            for (const e of await fs.readdir(dir, { withFileTypes: true })) {
                const abs = path.join(dir, e.name);
                if (e.isDirectory()) out.push(...await walk(abs));
                else out.push(abs);
            }
            return out;
        };
        const extracted = await walk(target);
        for (const [rel, content] of Object.entries(AWKWARD)) {
            const file = extracted.find((f) => f.endsWith(rel));
            expect(file, `recovery kit did not extract ${rel}`).toBeTruthy();
            expect(await fs.readFile(file!, "utf-8"), `content mismatch for ${rel}`).toBe(content);
        }
    });
});
