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
