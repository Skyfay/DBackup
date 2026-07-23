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
import { BUNDLE_FILE_MAX_SIZE } from "@/lib/archive/format";
import type { ArchiveSourceEntry } from "@/lib/archive/types";
import type { StorageAdapter } from "@/lib/core/interfaces";

const MASTER_KEY = Buffer.alloc(32, 0x3e);
const PROFILE_ID = "profile-1";
const SOURCE_ID = "src-1";

const prismaMock = {
    adapterConfig: { findUnique: vi.fn() },
    jobSource: { findUnique: vi.fn() },
};
vi.mock("@/lib/prisma", () => ({ default: prismaMock }));

const registryGet = vi.fn();
vi.mock("@/lib/core/registry", () => ({ registry: { get: (...a: unknown[]) => registryGet(...a) } }));
vi.mock("@/lib/adapters/config-resolver", () => ({ resolveAdapterConfig: async (c: unknown) => c }));
vi.mock("@/services/backup/encryption-service", () => ({ getProfileMasterKey: async () => MASTER_KEY }));

const {
    streamFileRestore, restoreFilesToStorage, planFileRestore,
} = await import("@/services/restore/file-restore");

let workDir: string;
let archivePath: string;
let uploads: { remotePath: string; content: Buffer }[];
let rangeCalls: number;

const FIXTURE: Record<string, Buffer> = {
    "www/index.php": Buffer.from("<?php echo 'x'; ?>\n".repeat(5)),
    "www/assets/app.css": Buffer.from("body{}\n".repeat(20)),
    "www/assets/logo.png": crypto.randomBytes(BUNDLE_FILE_MAX_SIZE * 2),
    "docs/readme.md": Buffer.from("# Readme\n"),
};

/** Storage adapter serving the archive by range, and collecting restore uploads. */
function makeAdapter(): StorageAdapter {
    return {
        id: "test-storage", type: "storage", name: "Test", configSchema: {} as never,
        list: vi.fn(), delete: vi.fn(), test: vi.fn(),
        read: async (_c: unknown, remotePath: string) =>
            remotePath.endsWith(".meta.json") ? await fs.readFile(archivePath + ".meta.json", "utf-8") : null,
        download: async (_c: unknown, remotePath: string, localPath: string) => {
            const suffix = remotePath.endsWith(".meta.json") ? ".meta.json" : remotePath.endsWith(".index") ? ".index" : "";
            await fs.copyFile(archivePath + suffix, localPath);
            return true;
        },
        downloadRange: async (_c: unknown, _r: string, start: number, end: number) => {
            rangeCalls++;
            if (end < start) return Readable.from([]);
            return createReadStream(archivePath, { start, end });
        },
        upload: async (_c: unknown, localPath: string, remotePath: string) => {
            uploads.push({ remotePath, content: await fs.readFile(localPath) });
            return true;
        },
    } as unknown as StorageAdapter;
}

async function buildFixture(encrypted: boolean) {
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

    const entries: ArchiveSourceEntry[] = [{
        kind: "directory", jobSourceId: SOURCE_ID, label: "SFTP: /var/www",
        localPath: sourceDir, excludePatterns: [], files,
    }];

    archivePath = path.join(workDir, "backup.tar");
    const { manifest, indexBytes } = await createArchive(entries, archivePath, {
        sourceType: "directory-only",
        compression: "GZIP",
        ...(encrypted ? { encryption: { masterKey: MASTER_KEY, profileId: PROFILE_ID } } : {}),
    });

    await fs.writeFile(archivePath + ".index", indexBytes);
    await fs.writeFile(archivePath + ".meta.json", JSON.stringify({
        version: 1,
        archive: {
            formatVersion: 2,
            indexFile: ".index",
            encrypted,
            ...(manifest.encryption
                ? { profileId: PROFILE_ID, kdfSalt: manifest.encryption.kdfSalt, noncePrefix: manifest.encryption.noncePrefix }
                : {}),
        },
    }));
}

/** Unpacks the tar.gz that streamFileRestore() produces. */
async function readTarGz(stream: NodeJS.ReadableStream): Promise<Map<string, Buffer>> {
    const out = new Map<string, Buffer>();
    await new Promise<void>((resolve, reject) => {
        const extractor = extract();
        extractor.on("entry", (header, entryStream, next) => {
            const chunks: Buffer[] = [];
            entryStream.on("data", (c: Buffer) => chunks.push(c));
            entryStream.on("end", () => { out.set(header.name, Buffer.concat(chunks)); next(); });
            entryStream.on("error", reject);
        });
        extractor.on("finish", () => resolve());
        extractor.on("error", reject);
        stream.pipe(createGunzip()).pipe(extractor);
    });
    return out;
}

beforeEach(async () => {
    vi.clearAllMocks();
    workDir = await fs.mkdtemp(path.join(os.tmpdir(), "file-restore-test-"));
    uploads = [];
    rangeCalls = 0;

    const adapter = makeAdapter();
    registryGet.mockReturnValue(adapter);
    prismaMock.adapterConfig.findUnique.mockResolvedValue({
        id: "storage-1", type: "storage", adapterId: "test-storage", name: "Test Storage", config: "{}",
    });
});

afterEach(async () => {
    await fs.rm(workDir, { recursive: true, force: true });
});

const input = (paths: string[], target: Parameters<typeof planFileRestore>[0]["target"]) => ({
    storageConfigId: "storage-1",
    file: "backups/job1/backup.tar",
    selections: [{ src: SOURCE_ID, paths }],
    target,
});

describe("planFileRestore", () => {
    it("expands a folder selection into its files and reports the total size", async () => {
        await buildFixture(true);
        const plan = await planFileRestore(input(["www/assets"], { kind: "download" }));

        expect(plan.fileCount).toBe(2);
        expect(plan.totalBytes).toBe(FIXTURE["www/assets/app.css"].length + FIXTURE["www/assets/logo.png"].length);
        expect(plan.fullDownload).toBe(false);
    });

    it("rejects a backup that predates the seekable format", async () => {
        await buildFixture(false);
        // A pre-v2 backup has no `archive` block in its metadata at all.
        await fs.writeFile(archivePath + ".meta.json", JSON.stringify({ version: 1, sourceType: "mysql" }));

        await expect(planFileRestore(input(["www"], { kind: "download" })))
            .rejects.toThrow(/does not support file-level restore/i);
    });
});

describe("streamFileRestore", () => {
    for (const encrypted of [false, true]) {
        it(`streams the selection as a tar.gz (${encrypted ? "encrypted" : "plain"} archive)`, async () => {
            await buildFixture(encrypted);
            const files = await readTarGz(await streamFileRestore(input(["www"], { kind: "download" })));

            expect([...files.keys()].sort()).toEqual([
                `${SOURCE_ID}/www/assets/app.css`,
                `${SOURCE_ID}/www/assets/logo.png`,
                `${SOURCE_ID}/www/index.php`,
            ]);
            for (const [rel, expected] of Object.entries(FIXTURE)) {
                if (!rel.startsWith("www/")) continue;
                expect(files.get(`${SOURCE_ID}/${rel}`)!.equals(expected)).toBe(true);
            }
        });
    }

    it("restores a single file without pulling anything else", async () => {
        await buildFixture(true);
        const files = await readTarGz(await streamFileRestore(input(["docs/readme.md"], { kind: "download" })));

        expect([...files.keys()]).toEqual([`${SOURCE_ID}/docs/readme.md`]);
        expect(files.get(`${SOURCE_ID}/docs/readme.md`)!.equals(FIXTURE["docs/readme.md"])).toBe(true);
        // Ranged reads only - the archive was never downloaded whole.
        expect(rangeCalls).toBeGreaterThan(0);
    });

    it("rejects a selection that matches nothing", async () => {
        await buildFixture(true);
        await expect(streamFileRestore(input(["does/not/exist"], { kind: "download" })))
            .rejects.toThrow(/no files matched/i);
    });

    /** Drains a stream to completion, resolving on end and rejecting on error. */
    const drain = (stream: NodeJS.ReadableStream) => new Promise<void>((resolve, reject) => {
        stream.on("data", () => { /* discard */ });
        stream.on("end", resolve);
        stream.on("error", reject);
    });

    it("aborts the download when a file fails its checksum, instead of handing it over", async () => {
        // Unencrypted, so there is no AEAD tag - the recorded checksum is the only
        // integrity check. A corrupted file must fail the download, not stream through as a
        // success dressed up in a valid-looking tar.gz.
        await buildFixture(false);
        // Flip a byte inside the large (own-entry) file's payload, past the manifest.
        const raw = await fs.readFile(archivePath);
        raw[Math.floor(raw.length * 0.5)] ^= 0xff;
        await fs.writeFile(archivePath, raw);

        const stream = await streamFileRestore(input(["www"], { kind: "download" }));
        await expect(drain(stream)).rejects.toThrow();
    });

    it("does not crash the process when the stream fails mid-production", async () => {
        // A ranged read that dies partway (dropped connection, permission change) must
        // surface as a stream error the caller catches, never an unhandled 'error' that
        // takes the process down.
        await buildFixture(true);

        // Wrap the working adapter so the failure lands after the archive is open (the
        // first ranged read serves the manifest), i.e. mid-production once the stream has
        // already been returned to the caller - the exact case that must not crash.
        const base = makeAdapter();
        let rangeReads = 0;
        registryGet.mockReturnValue({
            ...base,
            downloadRange: async (c: unknown, r: string, start: number, end: number) => {
                rangeReads++;
                if (rangeReads >= 2) {
                    return new Readable({
                        read() {
                            this.push(Buffer.from("partial"));
                            this.destroy(new Error("ranged read dropped mid-stream"));
                        },
                    });
                }
                return base.downloadRange!(c, r, start, end);
            },
        } as unknown as StorageAdapter);

        const stream = await streamFileRestore(input(["www"], { kind: "download" }));
        await expect(drain(stream)).rejects.toThrow();
    });
});

describe("restoreFilesToStorage", () => {
    it("writes the selection back to its original source path", async () => {
        await buildFixture(true);
        prismaMock.jobSource.findUnique.mockResolvedValue({
            id: SOURCE_ID, configId: "storage-1", path: "/var/www", config: { name: "SFTP Server" },
        });

        const result = await restoreFilesToStorage(input(["www/assets"], { kind: "origin" }));

        expect(result.failed).toEqual([]);
        expect(result.restored).toBe(2);
        expect(uploads.map((u) => u.remotePath).sort()).toEqual([
            "/var/www/www/assets/app.css",
            "/var/www/www/assets/logo.png",
        ]);
        expect(uploads.find((u) => u.remotePath.endsWith("app.css"))!.content
            .equals(FIXTURE["www/assets/app.css"])).toBe(true);
    });

    it("writes the selection to a chosen storage destination", async () => {
        await buildFixture(true);
        const result = await restoreFilesToStorage(
            input(["docs"], { kind: "storage", configId: "storage-1", basePath: "/restores/run-1/" })
        );

        expect(result.restored).toBe(1);
        expect(uploads[0].remotePath).toBe("/restores/run-1/docs/readme.md");
        expect(uploads[0].content.equals(FIXTURE["docs/readme.md"])).toBe(true);
    });

    it("explains itself when the original directory source no longer exists", async () => {
        await buildFixture(true);
        prismaMock.jobSource.findUnique.mockResolvedValue(null);

        await expect(restoreFilesToStorage(input(["docs"], { kind: "origin" })))
            .rejects.toThrow(/deleted since this backup was taken/i);
    });

    it("records a per-file failure without aborting the rest of the restore", async () => {
        await buildFixture(true);
        const adapter = makeAdapter();
        let calls = 0;
        (adapter as unknown as { upload: unknown }).upload = async (_c: unknown, localPath: string, remotePath: string) => {
            calls++;
            if (calls === 1) throw new Error("disk full");
            uploads.push({ remotePath, content: await fs.readFile(localPath) });
            return true;
        };
        registryGet.mockReturnValue(adapter);

        const result = await restoreFilesToStorage(
            input(["www"], { kind: "storage", configId: "storage-1", basePath: "/out" })
        );

        expect(result.failed).toHaveLength(1);
        expect(result.failed[0].error).toMatch(/disk full/);
        expect(result.restored).toBe(2);
    });

    it("refuses a download target, which has its own streaming entry point", async () => {
        await buildFixture(true);
        await expect(restoreFilesToStorage(input(["www"], { kind: "download" })))
            .rejects.toThrow(/streamFileRestore/);
    });
});
