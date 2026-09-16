import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "fs/promises";
import path from "path";
import os from "os";
import crypto from "crypto";
import { createArchive } from "@/lib/archive/writer";
import { readArchiveManifest, readArchiveIndex, openArchiveEntry } from "@/lib/archive/reader";
import { extractArchive } from "@/lib/archive/extract";
import { localFileSource, readAll } from "@/lib/archive/sources";
import { walkTarHeaders } from "@/lib/archive/tar-blocks";
import { entryKey } from "@/lib/archive/types";
import type { ArchiveSourceEntry, CompressionKind, DumpFormat } from "@/lib/archive/types";

const MASTER_KEY = Buffer.alloc(32, 0x3c);

let workDir: string;

beforeEach(async () => {
    workDir = await fs.mkdtemp(path.join(os.tmpdir(), "archive-db-test-"));
});

afterEach(async () => {
    await fs.rm(workDir, { recursive: true, force: true });
});

async function dump(name: string, content: Buffer): Promise<string> {
    const target = path.join(workDir, name);
    await fs.writeFile(target, content);
    return target;
}

const sha256 = (content: Buffer) => crypto.createHash("sha256").update(content).digest("hex");

describe("database-only archives", () => {
    const combos: { label: string; compression: "NONE" | CompressionKind; encrypted: boolean }[] = [
        { label: "plain, uncompressed", compression: "NONE", encrypted: false },
        { label: "plain, gzip", compression: "GZIP", encrypted: false },
        { label: "encrypted, uncompressed", compression: "NONE", encrypted: true },
        { label: "encrypted, brotli", compression: "BROTLI", encrypted: true },
    ];

    for (const combo of combos) {
        it(`records a plaintext checksum for every dump (${combo.label})`, async () => {
            const shop = Buffer.from("INSERT INTO orders VALUES (1);\n".repeat(200));
            const blog = crypto.randomBytes(128 * 1024);
            const entries: ArchiveSourceEntry[] = [
                { kind: "database", dbName: "shop", path: await dump("1.sql", shop), format: "sql" },
                // A natively compressed dump skips entry compression and still gets a checksum.
                { kind: "database", dbName: "blog", path: await dump("2.dump", blog), format: "custom", nativeCompression: true },
            ];

            const archivePath = path.join(workDir, "backup.tar");
            await createArchive(entries, archivePath, {
                sourceType: "postgres",
                compression: combo.compression,
                ...(combo.encrypted ? { encryption: { masterKey: MASTER_KEY, profileId: "p1" } } : {}),
            });

            const source = await localFileSource(archivePath);
            const manifest = await readArchiveManifest(source);
            const masterKey = combo.encrypted ? MASTER_KEY : undefined;
            const index = await readArchiveIndex(source, manifest, { masterKey });

            expect(manifest.counts).toMatchObject({ databases: 2, directorySources: 0, files: 0 });
            const expected = new Map([["shop", shop], ["blog", blog]]);
            for (const line of index.databases) {
                const content = expected.get(line.name)!;
                expect(line.h).toBe(sha256(content));
                expect(line.s).toBe(content.length);

                const entry = index.entries.get(entryKey(undefined, line.n))!;
                const restored = await readAll(await openArchiveEntry(source, manifest, entry, masterKey));
                expect(restored.equals(content)).toBe(true);
            }
        });
    }

    it("hands each dump back once its member is written, and the archive survives it being deleted", async () => {
        const contents = [Buffer.from("a".repeat(5000)), Buffer.from("b".repeat(7000)), Buffer.from("c".repeat(3000))];
        const entries: ArchiveSourceEntry[] = [];
        for (const [i, content] of contents.entries()) {
            entries.push({ kind: "database", dbName: `db${i}`, path: await dump(`${i}.sql`, content), format: "sql" });
        }

        const written: string[] = [];
        const archivePath = path.join(workDir, "backup.tar");
        await createArchive(entries, archivePath, {
            sourceType: "mysql",
            compression: "GZIP",
            encryption: { masterKey: MASTER_KEY, profileId: "p1" },
            concurrency: 3,
            onDatabaseDumpWritten: async (localPath) => {
                written.push(localPath);
                await fs.unlink(localPath);
            },
        });

        expect(written).toEqual(entries.map((e) => (e as { path: string }).path));

        const source = await localFileSource(archivePath);
        const manifest = await readArchiveManifest(source);
        const index = await readArchiveIndex(source, manifest, { masterKey: MASTER_KEY });
        for (const [i, line] of index.databases.entries()) {
            const entry = index.entries.get(entryKey(undefined, line.n))!;
            expect((await readAll(await openArchiveEntry(source, manifest, entry, MASTER_KEY))).equals(contents[i])).toBe(true);
        }
    });

    it("stores a database with path separators in its name as a single flat member", async () => {
        const archivePath = path.join(workDir, "backup.tar");
        await createArchive(
            [{ kind: "database", dbName: "../../escaped", path: await dump("x.sql", Buffer.from("SELECT 1;")), format: "sql" }],
            archivePath,
            { sourceType: "mysql", compression: "NONE" }
        );

        const members = (await walkTarHeaders(archivePath)).map((m) => m.name);
        expect(members).toContain("databases/_._.._escaped.sql");

        const outDir = path.join(workDir, "nested", "out");
        const result = await extractArchive(archivePath, outDir);
        expect(result.databaseFiles[0].path).toBe(path.join(outDir, "databases", "_._.._escaped.sql"));
        await expect(fs.access(path.join(workDir, "escaped.sql"))).rejects.toThrow();
    });

    const newFormats: { format: DumpFormat; member: string }[] = [
        { format: "bacpac", member: "databases/sales.bacpac" },
        { format: "rdb", member: "databases/sales.rdb" },
        { format: "sqlite", member: "databases/sales.sqlite" },
        { format: "bak", member: "databases/sales.bak" },
    ];
    for (const { format, member } of newFormats) {
        it(`names a ${format} dump with its own extension`, async () => {
            const archivePath = path.join(workDir, "backup.tar");
            await createArchive(
                [{ kind: "database", dbName: "sales", path: await dump("x", Buffer.from("payload")), format }],
                archivePath,
                { sourceType: "mssql", compression: "NONE" }
            );
            expect((await walkTarHeaders(archivePath)).map((m) => m.name)).toContain(member);
        });
    }
});
