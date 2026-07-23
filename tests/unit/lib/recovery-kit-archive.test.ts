import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "fs/promises";
import path from "path";
import os from "os";
import crypto from "crypto";
import { execFile } from "child_process";
import { promisify } from "util";
import { createArchive } from "@/lib/archive/writer";
import { BUNDLE_FILE_MAX_SIZE } from "@/lib/archive/format";
import type { ArchiveSourceEntry } from "@/lib/archive/types";

const execFileAsync = promisify(execFile);

const SCRIPT = path.resolve(process.cwd(), "scripts/restore_archive.js");
const MASTER_KEY = Buffer.alloc(32, 0x6b);
const KEY_HEX = MASTER_KEY.toString("hex");

let workDir: string;

const FIXTURE: Record<string, Buffer> = {
    "www/index.php": Buffer.from("<?php echo 'recovered'; ?>\n"),
    "www/assets/app.css": Buffer.from("body{color:red}\n".repeat(30)),
    "www/assets/large.bin": crypto.randomBytes(BUNDLE_FILE_MAX_SIZE * 2),
    "docs/notes.txt": Buffer.from("secret notes\n"),
};

beforeEach(async () => {
    workDir = await fs.mkdtemp(path.join(os.tmpdir(), "recovery-kit-test-"));
});

afterEach(async () => {
    await fs.rm(workDir, { recursive: true, force: true });
});

async function buildArchive(encrypted: boolean, compression: "NONE" | "GZIP" | "BROTLI" = "GZIP") {
    const sourceDir = path.join(workDir, "src");
    await fs.mkdir(sourceDir, { recursive: true });

    const files = [];
    for (const [rel, content] of Object.entries(FIXTURE)) {
        const target = path.join(sourceDir, rel);
        await fs.mkdir(path.dirname(target), { recursive: true });
        await fs.writeFile(target, content);
        files.push({
            path: rel,
            size: content.length,
            mtime: "2026-07-22T10:00:00.000Z",
            checksum: crypto.createHash("sha256").update(content).digest("hex"),
        });
    }

    const dumpPath = path.join(workDir, "appdb.sql");
    await fs.writeFile(dumpPath, "CREATE TABLE t (id INT);\n".repeat(10));

    const entries: ArchiveSourceEntry[] = [
        { kind: "database", dbName: "appdb", path: dumpPath, format: "sql" },
        {
            kind: "directory", jobSourceId: "src-1", label: "SFTP: /var/www",
            localPath: sourceDir, excludePatterns: [], files,
        },
    ];

    const archivePath = path.join(workDir, "backup.tar");
    await createArchive(entries, archivePath, {
        sourceType: "mysql",
        engineVersion: "8.0.32",
        compression,
        ...(encrypted ? { encryption: { masterKey: MASTER_KEY, profileId: "p1" } } : {}),
    });
    return archivePath;
}

/**
 * Runs the recovery script the way a user in a disaster would: a bare Node process, in an
 * unrelated working directory, with no DBackup environment variables at all.
 */
async function runScript(args: string[]): Promise<{ stdout: string; stderr: string; code: number }> {
    try {
        const { stdout, stderr } = await execFileAsync("node", [SCRIPT, ...args], {
            cwd: os.tmpdir(),
            // Deliberately minimal: proves the script needs no DBackup environment at all.
            env: { PATH: process.env.PATH ?? "" } as unknown as NodeJS.ProcessEnv,
            maxBuffer: 32 * 1024 * 1024,
        });
        return { stdout, stderr, code: 0 };
    } catch (e: unknown) {
        const err = e as { stdout?: string; stderr?: string; code?: number };
        return { stdout: err.stdout ?? "", stderr: err.stderr ?? "", code: err.code ?? 1 };
    }
}

describe("recovery kit: restore_archive.js", () => {
    it("lists an encrypted archive's contents with only the master key", async () => {
        const archivePath = await buildArchive(true);
        const { stdout, code } = await runScript(["--list", archivePath, KEY_HEX]);

        expect(code).toBe(0);
        expect(stdout).toContain("Encrypted:   yes");
        expect(stdout).toContain("appdb");
        expect(stdout).toContain("SFTP: /var/www");
        for (const rel of Object.keys(FIXTURE)) {
            expect(stdout).toContain(rel);
        }
    });

    it("extracts every file byte-identically from an encrypted archive", async () => {
        const archivePath = await buildArchive(true);
        const outDir = path.join(workDir, "out");
        const { stderr, code } = await runScript(["--extract", archivePath, outDir, KEY_HEX]);

        expect(stderr).toBe("");
        expect(code).toBe(0);

        for (const [rel, expected] of Object.entries(FIXTURE)) {
            const actual = await fs.readFile(path.join(outDir, "src-1", rel));
            expect(actual.equals(expected), `mismatch for ${rel}`).toBe(true);
        }
        expect(await fs.readFile(path.join(outDir, "databases", "appdb.sql"), "utf-8"))
            .toContain("CREATE TABLE t");
    });

    it("extracts only what a pattern selects", async () => {
        const archivePath = await buildArchive(true);
        const outDir = path.join(workDir, "out");
        await runScript(["--extract", archivePath, outDir, KEY_HEX, "www/assets/**"]);

        expect(await fs.readFile(path.join(outDir, "src-1", "www/assets/app.css")))
            .toEqual(FIXTURE["www/assets/app.css"]);
        await expect(fs.access(path.join(outDir, "src-1", "docs/notes.txt"))).rejects.toThrow();
    });

    it("treats a folder name as everything inside it", async () => {
        const archivePath = await buildArchive(true);
        const outDir = path.join(workDir, "out");
        await runScript(["--extract", archivePath, outDir, KEY_HEX, "docs"]);

        expect(await fs.readFile(path.join(outDir, "src-1", "docs/notes.txt")))
            .toEqual(FIXTURE["docs/notes.txt"]);
        await expect(fs.access(path.join(outDir, "src-1", "www"))).rejects.toThrow();
    });

    for (const compression of ["NONE", "BROTLI"] as const) {
        it(`handles ${compression} compression`, async () => {
            const archivePath = await buildArchive(true, compression);
            const outDir = path.join(workDir, "out");
            await runScript(["--extract", archivePath, outDir, KEY_HEX, "docs/notes.txt"]);

            expect(await fs.readFile(path.join(outDir, "src-1", "docs/notes.txt")))
                .toEqual(FIXTURE["docs/notes.txt"]);
        });
    }

    it("works on an unencrypted archive without a key", async () => {
        const archivePath = await buildArchive(false);
        const outDir = path.join(workDir, "out");
        const { code } = await runScript(["--extract", archivePath, outDir]);

        expect(code).toBe(0);
        expect(await fs.readFile(path.join(outDir, "src-1", "docs/notes.txt")))
            .toEqual(FIXTURE["docs/notes.txt"]);
    });

    it("refuses an encrypted archive without a key, and says why", async () => {
        const archivePath = await buildArchive(true);
        const { stderr, code } = await runScript(["--list", archivePath]);

        expect(code).toBe(1);
        expect(stderr).toMatch(/encrypted.*master key/i);
    });

    it("refuses a wrong key rather than producing garbage", async () => {
        const archivePath = await buildArchive(true);
        const { stderr, code } = await runScript(["--list", archivePath, Buffer.alloc(32, 0x01).toString("hex")]);

        expect(code).toBe(1);
        expect(stderr).toMatch(/authentication failed/i);
    });

    it("reports a corrupted archive instead of writing damaged files", async () => {
        const archivePath = await buildArchive(true, "NONE");
        const raw = await fs.readFile(archivePath);
        // Flip a byte inside the payload region, past the manifest.
        raw[Math.floor(raw.length / 2)] ^= 0xff;
        await fs.writeFile(archivePath, raw);

        const { stderr, code } = await runScript(["--extract", archivePath, path.join(workDir, "out"), KEY_HEX]);
        expect(code).not.toBe(0);
        expect(stderr).toMatch(/authentication failed|checksum mismatch/i);
    });

    it("leaves no half-written file behind when a large entry fails to authenticate", async () => {
        // Streaming writes plaintext before the authentication tag at the end of the entry
        // can be checked, so the output only becomes visible once it verified. Anything
        // else would leave a partial file that looks like a restored one.
        const archivePath = await buildArchive(true, "NONE");
        const raw = await fs.readFile(archivePath);
        raw[Math.floor(raw.length / 2)] ^= 0xff;
        await fs.writeFile(archivePath, raw);

        const outDir = path.join(workDir, "out");
        await runScript(["--extract", archivePath, outDir, KEY_HEX]);

        const leftovers: string[] = [];
        const walk = async (dir: string) => {
            for (const e of await fs.readdir(dir, { withFileTypes: true }).catch(() => [])) {
                const abs = path.join(dir, e.name);
                if (e.isDirectory()) await walk(abs);
                else if (e.name.endsWith(".partial")) leftovers.push(abs);
            }
        };
        await walk(outDir);
        expect(leftovers).toEqual([]);
    });

    it("does not write a streamed file whose checksum does not match", async () => {
        // The index records the plaintext hash. If the bytes that come out disagree, the
        // file is wrong even when the archive authenticates - so it must not be presented
        // as recovered.
        const archivePath = await buildArchive(false, "NONE");
        const raw = await fs.readFile(archivePath);
        // large.bin is past the bundling threshold, so it is its own streamed entry.
        const needle = raw.indexOf(Buffer.from(FIXTURE["www/assets/large.bin"].subarray(0, 32)));
        expect(needle, "expected to find the large file's payload").toBeGreaterThan(0);
        raw[needle + 16] ^= 0xff;
        await fs.writeFile(archivePath, raw);

        const outDir = path.join(workDir, "out");
        const { stderr } = await runScript(["--extract", archivePath, outDir, KEY_HEX]);

        expect(stderr).toMatch(/checksum mismatch/i);
        await expect(fs.access(path.join(outDir, "src-1", "www/assets/large.bin"))).rejects.toThrow();
    });

    it("rejects a v1 archive with a pointer to the older tool", async () => {
        const fake = path.join(workDir, "v1.tar");
        const { createMultiDbTar } = await import("@/lib/adapters/database/common/tar-utils");
        const dump = path.join(workDir, "d.sql");
        await fs.writeFile(dump, "x");
        await createMultiDbTar([{ name: "d.sql", path: dump, dbName: "d", format: "sql" }], fake, { sourceType: "mysql" });

        const { stderr, code } = await runScript(["--list", fake]);
        expect(code).toBe(1);
        expect(stderr).toMatch(/decrypt_backup\.js/);
    });
});

describe("recovery kit: incremental chains", () => {
    const SRC = "src-1";

    /** Builds full-1.tar plus inc-2.tar in the same folder, as DBackup lays them out. */
    async function buildChain() {
        const { carryForward, fileKey } = await import("@/lib/archive/chain");

        const chainDir = path.join(workDir, "chain-2026-07-15");
        await fs.mkdir(chainDir, { recursive: true });

        const stage = async (files: Record<string, Buffer>) => {
            const dir = await fs.mkdtemp(path.join(workDir, "stage-"));
            const entries = [];
            for (const [rel, content] of Object.entries(files)) {
                await fs.writeFile(path.join(dir, rel), content);
                entries.push({
                    path: rel, size: content.length, mtime: "2026-07-22T10:00:00.000Z",
                    checksum: crypto.createHash("sha256").update(content).digest("hex"),
                });
            }
            return { dir, entries };
        };

        const contents = { kept: Buffer.from("KEPT SINCE THE FULL\n"), changed: crypto.randomBytes(3000) };

        const s1 = await stage({ "kept.txt": contents.kept, "changed.bin": Buffer.from("OLD") });
        const full = await createArchive(
            [{ kind: "directory", jobSourceId: SRC, label: "T", localPath: s1.dir, excludePatterns: [], files: s1.entries }],
            path.join(chainDir, "full-1.tar"),
            {
                sourceType: "directory-only", compression: "GZIP",
                encryption: { masterKey: MASTER_KEY, profileId: "p1" },
                chain: { id: "c1", type: "full", index: 0 },
            }
        );

        const s2 = await stage({ "changed.bin": contents.changed });
        await createArchive(
            [{ kind: "directory", jobSourceId: SRC, label: "T", localPath: s2.dir, excludePatterns: [], files: s2.entries }],
            path.join(chainDir, "inc-2.tar"),
            {
                sourceType: "directory-only", compression: "GZIP",
                encryption: { masterKey: MASTER_KEY, profileId: "p1" },
                chain: {
                    id: "c1", type: "incremental", base: "full-1.tar", index: 1,
                    carried: carryForward(full.index, "full-1.tar", new Set([fileKey(SRC, "kept.txt")])),
                },
            }
        );

        return { chainDir, contents };
    }

    it("lists a snapshot and reports which archives of the chain it needs", async () => {
        const { chainDir } = await buildChain();
        const { stdout, code } = await runScript(["--list", path.join(chainDir, "inc-2.tar"), KEY_HEX]);

        expect(code).toBe(0);
        expect(stdout).toContain("incremental (position 1");
        expect(stdout).toContain("found    full-1.tar");
        expect(stdout).toContain("kept.txt");
        expect(stdout).toContain("changed.bin");
    });

    it("extracts a snapshot from across the chain, offline and with only the key", async () => {
        const { chainDir, contents } = await buildChain();
        const outDir = path.join(workDir, "out");

        const { code, stderr } = await runScript(["--extract", path.join(chainDir, "inc-2.tar"), outDir, KEY_HEX]);

        expect(stderr).toBe("");
        expect(code).toBe(0);
        // kept.txt lives in full-1.tar, changed.bin in inc-2.tar - both come back intact.
        expect(await fs.readFile(path.join(outDir, SRC, "kept.txt"))).toEqual(contents.kept);
        expect(await fs.readFile(path.join(outDir, SRC, "changed.bin"))).toEqual(contents.changed);
    });

    it("names the missing archive instead of restoring a partial snapshot", async () => {
        const { chainDir } = await buildChain();
        await fs.unlink(path.join(chainDir, "full-1.tar"));

        const { stderr, code } = await runScript([
            "--extract", path.join(chainDir, "inc-2.tar"), path.join(workDir, "out"), KEY_HEX,
        ]);

        expect(code).not.toBe(0);
        expect(stderr).toMatch(/full-1\.tar/);
        expect(stderr).toMatch(/incremental chain/i);
    });
});
