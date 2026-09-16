import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "fs/promises";
import path from "path";
import os from "os";
import crypto from "crypto";
import { Readable } from "stream";
import { createReadStream } from "fs";
import { extract } from "tar-stream";
import { createGunzip } from "zlib";
import { createArchive } from "@/lib/archive/writer";
import type { ArchiveSourceEntry } from "@/lib/archive/types";
import type { StorageAdapter } from "@/lib/core/interfaces";

const MASTER_KEY = Buffer.alloc(32, 0x2d);
const PROFILE_ID = "profile-1";

const prismaMock = {
    adapterConfig: { findUnique: vi.fn() },
    jobSource: { findUnique: vi.fn().mockResolvedValue(null) },
    systemSetting: { findUnique: vi.fn().mockResolvedValue(null) },
};
vi.mock("@/lib/prisma", () => ({ default: prismaMock }));

const registryGet = vi.fn();
vi.mock("@/lib/core/registry", () => ({ registry: { get: (...a: unknown[]) => registryGet(...a) } }));
vi.mock("@/lib/adapters/config-resolver", () => ({ resolveAdapterConfig: async (c: unknown) => c }));
vi.mock("@/services/backup/encryption-service", () => ({ getProfileMasterKey: async () => MASTER_KEY }));

const { openArchiveDownload, planArchiveDownload, writeDatabaseDump, verifyingStream } = await import("@/services/restore/archive-download");
const { restoreFilesToStorage, streamFileRestore } = await import("@/services/restore/file-restore");

let workDir: string;
let archivePath: string;
let archiveDownloads: number;

const SHOP = Buffer.from("INSERT INTO orders VALUES (1);\n".repeat(4000));
const BLOG = Buffer.from("INSERT INTO posts VALUES (1);\n".repeat(50));
const README = Buffer.from("# Readme\n");

function makeAdapter(): StorageAdapter {
    return {
        id: "test-storage", type: "storage", name: "Test", configSchema: {} as never,
        list: vi.fn().mockResolvedValue([]), delete: vi.fn(), test: vi.fn(), upload: vi.fn(),
        read: async (_c: unknown, remotePath: string) =>
            remotePath.endsWith(".meta.json") ? await fs.readFile(archivePath + ".meta.json", "utf-8") : null,
        download: async (_c: unknown, remotePath: string, localPath: string) => {
            const suffix = remotePath.endsWith(".meta.json") ? ".meta.json" : remotePath.endsWith(".index") ? ".index" : "";
            if (!suffix) archiveDownloads++;
            await fs.copyFile(archivePath + suffix, localPath);
            return true;
        },
        downloadRange: async (_c: unknown, _r: string, start: number, end: number) => {
            if (end < start) return Readable.from([]);
            return createReadStream(archivePath, { start, end });
        },
    } as unknown as StorageAdapter;
}

async function buildFixture(opts: { encrypted: boolean; databases: string[]; withFiles?: boolean }) {
    const contents: Record<string, Buffer> = { shop: SHOP, blog: BLOG };
    const entries: ArchiveSourceEntry[] = [];
    for (const [i, name] of opts.databases.entries()) {
        const dump = path.join(workDir, `${i}.sql`);
        await fs.writeFile(dump, contents[name]);
        entries.push({ kind: "database", dbName: name, path: dump, format: "sql" });
    }
    if (opts.withFiles) {
        const sourceDir = path.join(workDir, "src");
        await fs.mkdir(sourceDir, { recursive: true });
        await fs.writeFile(path.join(sourceDir, "readme.md"), README);
        entries.push({
            kind: "directory", jobSourceId: "src-1", label: "SFTP: /var/www", localPath: sourceDir, excludePatterns: [],
            files: [{ path: "readme.md", size: README.length, mtime: "2026-07-22T10:00:00.000Z" }],
        });
    }

    archivePath = path.join(workDir, "nightly.tar");
    const { manifest, indexBytes } = await createArchive(entries, archivePath, {
        sourceType: "mysql",
        compression: "GZIP",
        ...(opts.encrypted ? { encryption: { masterKey: MASTER_KEY, profileId: PROFILE_ID } } : {}),
    });
    await fs.writeFile(archivePath + ".index", indexBytes);
    await fs.writeFile(archivePath + ".meta.json", JSON.stringify({
        version: 1,
        archive: {
            formatVersion: 2, indexFile: ".index", encrypted: opts.encrypted,
            ...(manifest.encryption
                ? { profileId: PROFILE_ID, kdfSalt: manifest.encryption.kdfSalt, noncePrefix: manifest.encryption.noncePrefix }
                : {}),
        },
    }));
}

async function readAllBytes(stream: NodeJS.ReadableStream): Promise<Buffer> {
    const chunks: Buffer[] = [];
    for await (const chunk of stream) chunks.push(Buffer.from(chunk as Buffer));
    return Buffer.concat(chunks);
}

async function readTarGz(stream: NodeJS.ReadableStream): Promise<Map<string, Buffer>> {
    const out = new Map<string, Buffer>();
    await new Promise<void>((resolve, reject) => {
        const extractor = extract();
        extractor.on("entry", (header, entryStream, next) => {
            const chunks: Buffer[] = [];
            entryStream.on("data", (c: Buffer) => chunks.push(c));
            entryStream.on("end", () => { out.set(header.name, Buffer.concat(chunks)); next(); });
        });
        extractor.on("finish", () => resolve());
        extractor.on("error", reject);
        stream.pipe(createGunzip()).pipe(extractor);
    });
    return out;
}

const download = (extra: Record<string, unknown>) => ({
    storageConfigId: "storage-1",
    file: "backups/job1/nightly.tar",
    target: { kind: "download" as const },
    ...extra,
});

beforeEach(async () => {
    vi.clearAllMocks();
    workDir = await fs.mkdtemp(path.join(os.tmpdir(), "archive-download-test-"));
    archiveDownloads = 0;
    registryGet.mockReturnValue(makeAdapter());
    prismaMock.adapterConfig.findUnique.mockResolvedValue({
        id: "storage-1", type: "storage", adapterId: "test-storage", name: "Test Storage", config: "{}",
    });
});

afterEach(async () => {
    await fs.rm(workDir, { recursive: true, force: true });
});

describe("downloading a single database", () => {
    for (const encrypted of [true, false]) {
        it(`serves the plain dump by byte range, named after the backup (${encrypted ? "encrypted" : "unencrypted"})`, async () => {
            await buildFixture({ encrypted, databases: ["shop", "blog"] });

            const result = await openArchiveDownload(download({ databases: ["blog"] }));
            const bytes = await readAllBytes(result.stream);

            expect(bytes.equals(BLOG)).toBe(true);
            expect(result.contentLength).toBe(BLOG.length);
            expect(result.fileName).toBe("nightly_blog.sql");
            expect(result.contentType).toBe("application/octet-stream");
            expect(archiveDownloads).toBe(0);
        });
    }

    it("tells the prepare step the dump's name and type before anything is sent", async () => {
        await buildFixture({ encrypted: true, databases: ["shop", "blog"] });

        const plan = await planArchiveDownload(download({ databases: ["shop"] }));

        expect(plan).toMatchObject({
            output: "dump", databaseCount: 1, fileCount: 0, totalBytes: SHOP.length,
            fileName: "nightly_shop.sql", contentType: "application/octet-stream",
        });
    });

    it("refuses a database the backup does not hold, by name", async () => {
        await buildFixture({ encrypted: false, databases: ["shop"] });

        await expect(planArchiveDownload(download({ databases: ["crm"] }))).rejects.toThrow(/does not contain the database\(s\): crm/);
        await expect(openArchiveDownload(download({ databases: ["crm"] }))).rejects.toThrow(/crm/);
    });

    it("never completes a dump whose bytes fail the recorded checksum", async () => {
        const verifier = verifyingStream(crypto.createHash("sha256").update("expected").digest("hex"));
        const received: Buffer[] = [];
        verifier.on("data", (c: Buffer) => received.push(c));
        const finished = new Promise<void>((resolve, reject) => { verifier.on("end", resolve); verifier.on("error", reject); });

        verifier.write(Buffer.from("first chunk "));
        verifier.write(Buffer.from("last chunk"));
        verifier.end();

        await expect(finished).rejects.toThrow(/checksum/);
        expect(Buffer.concat(received).toString()).toBe("first chunk ");
    });
});

describe("downloading several databases or a whole snapshot", () => {
    it("packs the chosen dumps into a tar.gz under databases/", async () => {
        await buildFixture({ encrypted: true, databases: ["shop", "blog"], withFiles: true });

        const result = await openArchiveDownload(download({ databases: ["shop", "blog"] }));
        const entries = await readTarGz(result.stream);

        expect([...entries.keys()].sort()).toEqual(["databases/blog.sql", "databases/shop.sql"]);
        expect(entries.get("databases/shop.sql")!.equals(SHOP)).toBe(true);
        expect(result.fileName).toBe("nightly-contents.tar.gz");
    });

    it("includes every dump and every file in the complete snapshot", async () => {
        await buildFixture({ encrypted: false, databases: ["shop", "blog"], withFiles: true });

        const entries = await readTarGz(await streamFileRestore(download({})));

        expect([...entries.keys()].sort()).toEqual(["databases/blog.sql", "databases/shop.sql", "src-1/readme.md"]);
    });

    it("keeps a files-only selection free of dumps", async () => {
        await buildFixture({ encrypted: false, databases: ["shop"], withFiles: true });

        const result = await openArchiveDownload(download({ selections: [{ src: "src-1" }] }));
        const entries = await readTarGz(result.stream);

        expect([...entries.keys()]).toEqual(["src-1/readme.md"]);
        expect(result.fileName).toBe("nightly-files.tar.gz");
    });

    it("refuses to write dumps into a storage destination", async () => {
        await buildFixture({ encrypted: false, databases: ["shop"] });

        await expect(restoreFilesToStorage({
            storageConfigId: "storage-1", file: "backups/job1/nightly.tar", databases: ["shop"],
            target: { kind: "storage", configId: "storage-1", basePath: "/restore" },
        })).rejects.toThrow(/can only be downloaded/);
    });
});

describe("decrypted download of a whole seekable backup", () => {
    it("resolves to the only dump of a single-database backup", async () => {
        await buildFixture({ encrypted: true, databases: ["shop"] });
        const out = path.join(workDir, "out");

        const { fileName } = await writeDatabaseDump({ storageConfigId: "storage-1", file: "backups/job1/nightly.tar" }, out);

        expect(fileName).toBe("nightly_shop.sql");
        expect((await fs.readFile(out)).equals(SHOP)).toBe(true);
    });

    it("asks which database is meant when the backup holds several", async () => {
        await buildFixture({ encrypted: true, databases: ["shop", "blog"] });

        await expect(writeDatabaseDump({ storageConfigId: "storage-1", file: "backups/job1/nightly.tar" }, path.join(workDir, "out")))
            .rejects.toThrow(/holds 2 database\(s\)\. Name the database/);
    });

    it("downloads the named database out of several", async () => {
        await buildFixture({ encrypted: true, databases: ["shop", "blog"] });
        const out = path.join(workDir, "out");

        await writeDatabaseDump({ storageConfigId: "storage-1", file: "backups/job1/nightly.tar", database: "blog" }, out);

        expect((await fs.readFile(out)).equals(BLOG)).toBe(true);
    });

    it("does not guess when the one database sits next to files", async () => {
        await buildFixture({ encrypted: false, databases: ["shop"], withFiles: true });

        await expect(writeDatabaseDump({ storageConfigId: "storage-1", file: "backups/job1/nightly.tar" }, path.join(workDir, "out")))
            .rejects.toThrow(/and files/);
    });

    it("deletes a dump that fails its checksum instead of leaving it to be served", async () => {
        // Unencrypted and uncompressed, so a flipped byte reaches the plaintext untouched and
        // only the recorded checksum can notice it.
        const dump = path.join(workDir, "blog.sql");
        await fs.writeFile(dump, BLOG);
        archivePath = path.join(workDir, "tampered.tar");
        const { indexBytes } = await createArchive(
            [{ kind: "database", dbName: "blog", path: dump, format: "sql" }],
            archivePath,
            { sourceType: "mysql", compression: "NONE" }
        );
        const raw = await fs.readFile(archivePath);
        raw[raw.indexOf(BLOG.subarray(0, 32))] ^= 0xff;
        await fs.writeFile(archivePath, raw);
        await fs.writeFile(archivePath + ".index", indexBytes);
        await fs.writeFile(archivePath + ".meta.json", JSON.stringify({ version: 1, archive: { formatVersion: 2, indexFile: ".index", encrypted: false } }));

        const out = path.join(workDir, "out");
        await expect(writeDatabaseDump({ storageConfigId: "storage-1", file: "backups/job1/tampered.tar" }, out))
            .rejects.toThrow(/checksum/);
        await expect(fs.access(out)).rejects.toThrow();
    });
});
