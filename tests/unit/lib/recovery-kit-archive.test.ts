import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "fs/promises";
import path from "path";
import os from "os";
import crypto from "crypto";
import zlib from "zlib";
import { execFile } from "child_process";
import { promisify } from "util";
import { createArchive } from "@/lib/archive/writer";
import { BUNDLE_FILE_MAX_SIZE } from "@/lib/archive/format";
import type { ArchiveSourceEntry } from "@/lib/archive/types";

const execFileAsync = promisify(execFile);

const SCRIPT = path.resolve(process.cwd(), "scripts/dbackup-recover.js");
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
async function runScript(args: string[], cwd = os.tmpdir()): Promise<{ stdout: string; stderr: string; code: number }> {
    try {
        const { stdout, stderr } = await execFileAsync("node", [SCRIPT, ...args], {
            cwd,
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

describe("recovery kit: dbackup-recover.js", () => {
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

    it("restores a single database out of an archive, and nothing else", async () => {
        // Databases are addressed under a `databases/` prefix, so picking one keeps the
        // archive's directory sources out of the restore by itself.
        const archivePath = await buildArchive(true);
        const outDir = path.join(workDir, "out");

        const { code } = await runScript(["--extract", archivePath, outDir, KEY_HEX, "databases/appdb"]);

        expect(code).toBe(0);
        expect(await fs.readFile(path.join(outDir, "databases", "appdb.sql"), "utf-8")).toContain("CREATE TABLE t");
        await expect(fs.access(path.join(outDir, "src-1"))).rejects.toThrow();
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

    it("does not write a database dump whose checksum does not match", async () => {
        const archivePath = await buildArchive(false, "NONE");
        const raw = await fs.readFile(archivePath);
        const needle = raw.indexOf(Buffer.from("CREATE TABLE t (id INT);"));
        expect(needle, "expected to find the dump's payload").toBeGreaterThan(0);
        raw[needle] ^= 0xff;
        await fs.writeFile(archivePath, raw);

        const outDir = path.join(workDir, "out");
        const { stderr, code } = await runScript(["--extract", archivePath, outDir, KEY_HEX, "databases/appdb"]);

        expect(stderr).toMatch(/checksum mismatch: database appdb/i);
        expect(code).not.toBe(0);
        await expect(fs.access(path.join(outDir, "databases", "appdb.sql"))).rejects.toThrow();
    });

    it("keeps a database whose name holds path separators inside the output folder", async () => {
        const dumpPath = path.join(workDir, "evil.sql");
        await fs.writeFile(dumpPath, "SELECT 1;\n");
        const archivePath = path.join(workDir, "evil.tar");
        await createArchive(
            [{ kind: "database", dbName: "../../escaped", path: dumpPath, format: "sql" }],
            archivePath,
            { sourceType: "firebird", compression: "NONE" }
        );

        const outDir = path.join(workDir, "nested", "out");
        const { code } = await runScript(["--extract", archivePath, outDir]);

        expect(code).toBe(0);
        expect(await fs.readFile(path.join(outDir, "databases", "_._.._escaped.sql"), "utf-8")).toBe("SELECT 1;\n");
        await expect(fs.access(path.join(workDir, "escaped.sql"))).rejects.toThrow();
    });

    it("points a v1 archive at the mode that handles it", async () => {
        const fake = path.join(workDir, "v1.tar");
        const { createMultiDbTar } = await import("@/lib/adapters/database/common/tar-utils");
        const dump = path.join(workDir, "d.sql");
        await fs.writeFile(dump, "x");
        await createMultiDbTar([{ name: "d.sql", path: dump, dbName: "d", format: "sql" }], fake, { sourceType: "mysql" });

        const { stderr, code } = await runScript(["--list", fake]);
        expect(code).toBe(1);
        expect(stderr).toMatch(/--decrypt/);
    });
});

describe("recovery kit: a kit holding several keys", () => {
    const OTHER_KEY = Buffer.alloc(32, 0x9a);

    /** Lays out a kit folder the way the multi-profile download does. */
    async function buildKitFolder(entries: { name: string; file: string; key: Buffer; profileId?: string }[], withIndex = true) {
        const kitDir = path.join(workDir, "kit");
        await fs.mkdir(path.join(kitDir, "keys"), { recursive: true });
        for (const entry of entries) {
            await fs.writeFile(path.join(kitDir, "keys", entry.file), entry.key.toString("hex"));
        }
        if (withIndex) {
            await fs.writeFile(path.join(kitDir, "keys", "keys.json"), JSON.stringify({
                version: 1,
                keys: entries.map((e) => ({ profileId: e.profileId, name: e.name, file: e.file })),
            }));
        }
        return kitDir;
    }

    it("picks the key by the profile the backup records", async () => {
        // No trying: the archive names its profile, and the index maps it to a key.
        const archivePath = await buildArchive(true);
        const kitDir = await buildKitFolder([
            { name: "Unrelated", file: "Unrelated.key", key: OTHER_KEY, profileId: "other" },
            { name: "Production", file: "Production.key", key: MASTER_KEY, profileId: "p1" },
        ]);
        const outDir = path.join(workDir, "out");

        const { code } = await runScript(["--extract", archivePath, outDir], kitDir);

        expect(code).toBe(0);
        expect(await fs.readFile(path.join(outDir, "src-1", "docs/notes.txt")))
            .toEqual(FIXTURE["docs/notes.txt"]);
    });

    it("falls back to trying the keys when there is no index to look in", async () => {
        // A keys/ folder someone assembled by hand, or one whose index was lost.
        const archivePath = await buildArchive(true);
        const kitDir = await buildKitFolder([
            { name: "Unrelated", file: "a.key", key: OTHER_KEY },
            { name: "Production", file: "b.key", key: MASTER_KEY },
        ], false);
        const outDir = path.join(workDir, "out");

        const { code } = await runScript(["--extract", archivePath, outDir], kitDir);

        expect(code).toBe(0);
        expect(await fs.readFile(path.join(outDir, "src-1", "docs/notes.txt")))
            .toEqual(FIXTURE["docs/notes.txt"]);
    });

    it("says which keys it tried when none of them fit", async () => {
        const archivePath = await buildArchive(true);
        const kitDir = await buildKitFolder([
            { name: "Wrong One", file: "a.key", key: OTHER_KEY, profileId: "other" },
            { name: "Also Wrong", file: "b.key", key: Buffer.alloc(32, 0x5c), profileId: "another" },
        ]);

        const { stderr, code } = await runScript(["--list", archivePath], kitDir);

        expect(code).toBe(1);
        expect(stderr).toContain("Wrong One");
        expect(stderr).toContain("Also Wrong");
    });
});

describe("recovery kit: whole-file backups", () => {
    /** A database backup as the older pipeline writes it: one encrypted, compressed stream. */
    async function buildWholeFile({ encrypted = true } = {}) {
        const plain = Buffer.from("CREATE TABLE users (id INT);\n".repeat(50));
        const compressed = zlib.gzipSync(plain);
        const target = path.join(workDir, "MyDb_2026-07-20.sql.gz" + (encrypted ? ".enc" : ""));

        let encryption: Record<string, unknown> | undefined;
        if (encrypted) {
            const iv = crypto.randomBytes(16);
            const cipher = crypto.createCipheriv("aes-256-gcm", MASTER_KEY, iv);
            await fs.writeFile(target, Buffer.concat([cipher.update(compressed), cipher.final()]));
            encryption = {
                enabled: true, profileId: "p1", algorithm: "aes-256-gcm",
                iv: iv.toString("hex"), authTag: cipher.getAuthTag().toString("hex"),
            };
        } else {
            await fs.writeFile(target, compressed);
        }

        await fs.writeFile(`${target}.meta.json`, JSON.stringify({
            timestamp: "2026-07-20T03:00:00.000Z", compression: "GZIP", ...(encryption ? { encryption } : {}),
        }));
        return { target, plain };
    }

    it("decrypts and decompresses in one pass, leaving a usable dump", async () => {
        // The old tool left a .gz behind and told the user to gunzip it themselves.
        const { target, plain } = await buildWholeFile();
        const outDir = path.join(workDir, "out");

        const { code } = await runScript(["--decrypt", target, KEY_HEX, outDir]);

        expect(code).toBe(0);
        expect(await fs.readFile(path.join(outDir, "MyDb_2026-07-20.sql"))).toEqual(plain);
    });

    const DUMPS = { "shop.sql": "CREATE TABLE orders (id INT);\n", "blog.sql": "CREATE TABLE posts (id INT);\n" };

    /** A backup of several databases: one encrypted TAR holding a dump each. */
    async function buildMultiDb() {
        const { createMultiDbTar } = await import("@/lib/adapters/database/common/tar-utils");
        for (const [name, body] of Object.entries(DUMPS)) await fs.writeFile(path.join(workDir, name), body);

        const tarPath = path.join(workDir, "AllDbs_2026-07-20.tar");
        await createMultiDbTar(
            Object.keys(DUMPS).map((name) => ({ name, path: path.join(workDir, name), dbName: name.replace(".sql", ""), format: "sql" as const })),
            tarPath,
            { sourceType: "mysql" }
        );

        const plain = await fs.readFile(tarPath);
        const iv = crypto.randomBytes(16);
        const cipher = crypto.createCipheriv("aes-256-gcm", MASTER_KEY, iv);
        const encPath = path.join(workDir, "AllDbs_2026-07-20.tar.enc");
        await fs.writeFile(encPath, Buffer.concat([cipher.update(plain), cipher.final()]));
        await fs.writeFile(`${encPath}.meta.json`, JSON.stringify({
            compression: "NONE", multiDb: { format: "tar", databases: ["shop", "blog"] },
            encryption: { enabled: true, profileId: "p1", algorithm: "aes-256-gcm",
                iv: iv.toString("hex"), authTag: cipher.getAuthTag().toString("hex") },
        }));
        return encPath;
    }

    it("unpacks a multi-database backup into one dump per database", async () => {
        // These are a TAR of dumps. Handing back the .tar was one step short of the job,
        // and left the database half of the tool behaving unlike the file half.
        const encPath = await buildMultiDb();
        const outDir = path.join(workDir, "out");

        const { code } = await runScript(["--decrypt", encPath, KEY_HEX, outDir]);

        expect(code).toBe(0);
        for (const [name, body] of Object.entries(DUMPS)) {
            expect(await fs.readFile(path.join(outDir, name), "utf-8")).toBe(body);
        }
        // The archive it came out of is not left lying next to the dumps.
        await expect(fs.access(path.join(outDir, "AllDbs_2026-07-20.tar"))).rejects.toThrow();
    });

    it("restores a single named database out of a multi-database backup", async () => {
        const encPath = await buildMultiDb();
        const outDir = path.join(workDir, "out");

        const { code } = await runScript(["--decrypt", encPath, KEY_HEX, outDir, "shop"]);

        expect(code).toBe(0);
        expect(await fs.readFile(path.join(outDir, "shop.sql"), "utf-8")).toBe(DUMPS["shop.sql"]);
        await expect(fs.access(path.join(outDir, "blog.sql"))).rejects.toThrow();
    });

    it("names the databases it does have when asked for one it does not", async () => {
        const encPath = await buildMultiDb();

        const { stderr, code } = await runScript(["--decrypt", encPath, KEY_HEX, path.join(workDir, "out"), "payments"]);

        expect(code).toBe(1);
        expect(stderr).toContain("shop");
        expect(stderr).toContain("blog");
    });

    it("defaults to the same restore folder the file backups use", async () => {
        const { target } = await buildWholeFile();
        const runDir = path.join(workDir, "run");
        await fs.mkdir(runDir, { recursive: true });

        const { code } = await runScript(["--decrypt", target, KEY_HEX], runDir);

        expect(code).toBe(0);
        expect(await fs.access(path.join(runDir, "restored", "MyDb_2026-07-20.sql"))).toBeUndefined();
    });

    it("says what is missing when the metadata sidecar was left behind", async () => {
        const { target } = await buildWholeFile();
        await fs.rm(`${target}.meta.json`);

        const { stderr, code } = await runScript(["--decrypt", target, KEY_HEX, path.join(workDir, "out")]);

        expect(code).toBe(1);
        expect(stderr).toMatch(/meta\.json/);
    });

    it("writes nothing at all when the key is wrong", async () => {
        const { target } = await buildWholeFile();

        const outDir = path.join(workDir, "out");
        const { code } = await runScript(["--decrypt", target, Buffer.alloc(32, 0x02).toString("hex"), outDir]);

        expect(code).toBe(1);
        // A half-written file would look like a restore: GCM only authenticates at the end.
        await expect(fs.access(path.join(outDir, "MyDb_2026-07-20.sql"))).rejects.toThrow();
    });

    it("handles an unencrypted backup with no key", async () => {
        const { target, plain } = await buildWholeFile({ encrypted: false });

        const outDir = path.join(workDir, "out");
        const { code } = await runScript(["--decrypt", target, outDir]);

        expect(code).toBe(0);
        expect(await fs.readFile(path.join(outDir, "MyDb_2026-07-20.sql"))).toEqual(plain);
    });
});

describe("recovery kit: incremental chains", () => {
    const SRC = "src-1";

    /**
     * Builds full-1.tar plus inc-2.tar in the same folder, as DBackup lays them out.
     *
     * `encrypted: false` produces the same chain without an encryption profile - the case a
     * user hits when the job has no profile, where the kit must still resolve the chain
     * without being given a key.
     */
    async function buildChain({ encrypted = true }: { encrypted?: boolean } = {}) {
        const { carryForward, fileKey } = await import("@/lib/archive/chain");
        const encryption = encrypted ? { encryption: { masterKey: MASTER_KEY, profileId: "p1" } } : {};

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
                ...encryption,
                chain: { id: "c1", type: "full", index: 0 },
            }
        );

        const s2 = await stage({ "changed.bin": contents.changed });
        await createArchive(
            [{ kind: "directory", jobSourceId: SRC, label: "T", localPath: s2.dir, excludePatterns: [], files: s2.entries }],
            path.join(chainDir, "inc-2.tar"),
            {
                sourceType: "directory-only", compression: "GZIP",
                ...encryption,
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

    it("resolves an unencrypted chain with no key at all", async () => {
        // Encryption is optional, and the chain resolution must not quietly depend on it -
        // a job without an encryption profile has to be recoverable the same way.
        const { chainDir, contents } = await buildChain({ encrypted: false });
        const outDir = path.join(workDir, "out");

        const { code, stderr } = await runScript(["--extract", path.join(chainDir, "inc-2.tar"), outDir]);

        expect(stderr).toBe("");
        expect(code).toBe(0);
        expect(await fs.readFile(path.join(outDir, SRC, "kept.txt"))).toEqual(contents.kept);
        expect(await fs.readFile(path.join(outDir, SRC, "changed.bin"))).toEqual(contents.changed);
    });

    it("takes the chain folder, not just the one archive inside it", async () => {
        // What a user actually does: copy the whole chain-... folder next to the kit and
        // point at it. That used to fail with "no manifest.json found", which was true of
        // the folder and no help at all.
        const { chainDir, contents } = await buildChain();
        const outDir = path.join(workDir, "out");

        const { code, stdout } = await runScript(["--extract", chainDir, outDir, KEY_HEX]);

        expect(code).toBe(0);
        // Newest snapshot picked on its own, and it says which one it took.
        expect(stdout).toContain("inc-2.tar");
        expect(await fs.readFile(path.join(outDir, SRC, "kept.txt"))).toEqual(contents.kept);
        expect(await fs.readFile(path.join(outDir, SRC, "changed.bin"))).toEqual(contents.changed);
    });

    it("takes the chain folder for an unencrypted chain too", async () => {
        const { chainDir, contents } = await buildChain({ encrypted: false });
        const outDir = path.join(workDir, "out");

        const { code } = await runScript(["--extract", chainDir, outDir]);

        expect(code).toBe(0);
        expect(await fs.readFile(path.join(outDir, SRC, "kept.txt"))).toEqual(contents.kept);
    });

    it("names the backups instead of guessing when a folder holds several", async () => {
        const { chainDir } = await buildChain();
        const loose = await buildArchive(true);
        await fs.rename(loose, path.join(path.dirname(chainDir), "standalone.tar"));

        const { code, stderr } = await runScript(["--list", path.dirname(chainDir), KEY_HEX]);

        expect(code).toBe(1);
        expect(stderr).toContain("standalone.tar");
        expect(stderr).toContain("chain-2026-07-15");
    });

    it("reads the key from master.key instead of being handed it", async () => {
        // The kit has always shipped master.key and then told people to paste it on the
        // command line, which put it in shell history and in the process list.
        const { chainDir, contents } = await buildChain();
        const kitDir = path.join(workDir, "kit");
        await fs.mkdir(kitDir, { recursive: true });
        await fs.writeFile(path.join(kitDir, "master.key"), KEY_HEX);
        const outDir = path.join(workDir, "out");

        const { code } = await runScript(["--extract", chainDir, outDir], kitDir);

        expect(code).toBe(0);
        expect(await fs.readFile(path.join(outDir, SRC, "kept.txt"))).toEqual(contents.kept);
    });

    it("needs only the archives the snapshot actually references, not the whole chain", async () => {
        // deps is built from the file lines, so it names exactly the archives holding bytes
        // this snapshot points at. That is what --list reports, and what must be present.
        const { chainDir } = await buildChain();
        const { stdout } = await runScript(["--list", path.join(chainDir, "inc-2.tar"), KEY_HEX]);

        expect(stdout).toMatch(/Needs 1 other archive\(s\)/);
        expect(stdout).toContain("full-1.tar");
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
