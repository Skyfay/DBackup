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
import { PermissionError, ValidationError } from "@/lib/logging/errors";

const MASTER_KEY = Buffer.alloc(32, 0x3e);
const PROFILE_ID = "profile-1";
const SOURCE_ID = "src-1";

const prismaMock = {
    adapterConfig: { findUnique: vi.fn() },
    jobSource: { findUnique: vi.fn() },
    // getMaxConcurrentFiles reads this; unset means the code's default (4) is used.
    systemSetting: { findUnique: vi.fn().mockResolvedValue(null) },
    // Whether the tenant of the destination shares it with customers.
    connectionShare: { count: vi.fn().mockResolvedValue(0) },
    // No run of History wrote these backups, see `recorded-encryption.ts`.
    execution: { findMany: vi.fn().mockResolvedValue([]) },
};
vi.mock("@/lib/prisma", () => ({ default: prismaMock }));

const registryGet = vi.fn();
vi.mock("@/lib/core/registry", () => ({ registry: { get: (...a: unknown[]) => registryGet(...a) } }));
vi.mock("@/lib/adapters/config-resolver", () => ({ resolveAdapterConfig: async (c: unknown) => c }));
vi.mock("@/services/backup/encryption-service", () => ({ getProfileMasterKey: async () => MASTER_KEY }));

const {
    streamFileRestore, restoreFilesToStorage, planFileRestore,
} = await import("@/services/restore/file-restore");
const { EncryptionDowngradeError } = await import("@/services/restore/recorded-encryption");
const { openChainArchive } = await import("@/lib/archive/chain-source");

let workDir: string;
let archivePath: string;
let uploads: { remotePath: string; content: Buffer; restoreRelativePath?: string }[];
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
        upload: async (_c: unknown, localPath: string, remotePath: string, _p?: unknown, _l?: unknown, options?: { restoreRelativePath?: string }) => {
            uploads.push({ remotePath, content: await fs.readFile(localPath), restoreRelativePath: options?.restoreRelativePath });
            return true;
        },
    } as unknown as StorageAdapter;
}

async function buildFixture(encrypted: boolean, fixture: Record<string, Buffer> = FIXTURE) {
    const sourceDir = path.join(workDir, "src");
    await fs.mkdir(sourceDir, { recursive: true });

    const files = [];
    for (const [rel, content] of Object.entries(fixture)) {
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
    prismaMock.execution.findMany.mockResolvedValue([]);
    workDir = await fs.mkdtemp(path.join(os.tmpdir(), "file-restore-test-"));
    uploads = [];
    rangeCalls = 0;

    const adapter = makeAdapter();
    registryGet.mockReturnValue(adapter);
    prismaMock.adapterConfig.findUnique.mockResolvedValue({
        id: "storage-1", type: "storage", adapterId: "test-storage", name: "Test Storage", config: "{}", tenantId: "tenant-1",
    });
});

afterEach(async () => {
    await fs.rm(workDir, { recursive: true, force: true });
});

/** Someone who may change the connection the files go to, which a restore into another place than the origin needs. */
const MANAGER = { isPlatformAdmin: false, authMethod: "session", tenantId: "tenant-1", permissions: ["storage:restore", "destinations:write"] } as const;

const input = (paths: string[], target: Parameters<typeof planFileRestore>[0]["target"]) => ({
    storageConfigId: "storage-1",
    file: "backups/job1/backup.tar",
    selections: [{ src: SOURCE_ID, paths }],
    target,
    caller: MANAGER,
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
            .rejects.toThrow(/predates the seekable archive format/i);
    });
});

describe("openArchiveForRestore", () => {
    it("reads the index sidecar in the same view as the archive, the tenant the path is in", async () => {
        await buildFixture(true);
        const { openArchiveForRestore } = await import("@/services/restore/file-restore");
        const { archiveIndexService } = await import("@/services/backup/archive-index-service");
        const fetchSidecar = vi.spyOn(archiveIndexService, "fetchSidecar");

        const opened = await openArchiveForRestore("storage-1", "backups/job1/backup.tar", undefined, "tenant-1");
        await opened.dispose();

        expect(fetchSidecar).toHaveBeenCalledWith("storage-1", "backups/job1/backup.tar", ".index", "tenant-1");
        fetchSidecar.mockRestore();
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
            .rejects.toThrow(/nothing matched/i);
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
    it("lays no link whose target is absolute or climbs out of the folder it restores into, and names each one", async () => {
        const sourceDir = path.join(workDir, "src");
        await fs.mkdir(path.join(sourceDir, "conf"), { recursive: true });
        await fs.writeFile(path.join(sourceDir, "conf/app.ini"), "ini");
        archivePath = path.join(workDir, "backup.tar");
        const link = (rel: string, target: string) => ({ path: rel, size: 0, mtime: "2026-07-22T10:00:00.000Z", linkTarget: target });
        const { indexBytes } = await createArchive([{
            kind: "directory", jobSourceId: SOURCE_ID, label: "SFTP: /var/www", localPath: sourceDir, excludePatterns: [],
            files: [
                { path: "conf/app.ini", size: 3, mtime: "2026-07-22T10:00:00.000Z" },
                link("conf/db", "/app/data/db"),
                link("conf/up", "../../app/data"),
                link("conf/same", "./app.ini"),
            ],
        }], archivePath, { sourceType: "directory-only" });
        await fs.writeFile(archivePath + ".index", indexBytes);
        await fs.writeFile(archivePath + ".meta.json", JSON.stringify({ version: 1, archive: { formatVersion: 2, indexFile: ".index", encrypted: false } }));
        const links: { remotePath: string; target: string; options?: unknown }[] = [];
        registryGet.mockReturnValue({ ...makeAdapter(), createSymlink: async (_c: unknown, remotePath: string, target: string, options?: unknown) => { links.push({ remotePath, target, options }); } });

        const result = await restoreFilesToStorage(input(["conf"], { kind: "storage", configId: "storage-1", basePath: "/restores/run-1/" }));

        // With the part below the folder of the restore, which the destination keeps it inside.
        expect(links).toEqual([{ remotePath: "/restores/run-1/conf/same", target: "./app.ini", options: { restoreRelativePath: "conf/same" } }]);
        expect(result.failed.map((entry) => entry.path)).toEqual(["conf/db", "conf/up"]);
        expect(result.failed[0].error).toContain("its target is absolute or leads out of the folder the restore writes into");
        expect(result.restored).toBe(2);
    });

    it("writes and links nothing below a link of the same backup, which a real folder never holds, and names each one", async () => {
        const sourceDir = path.join(workDir, "src");
        await fs.mkdir(path.join(sourceDir, "x/y"), { recursive: true });
        await fs.writeFile(path.join(sourceDir, "x/y/f.txt"), "f");
        await fs.writeFile(path.join(sourceDir, "x/ok.txt"), "o");
        archivePath = path.join(workDir, "backup.tar");
        const link = (rel: string, target: string) => ({ path: rel, size: 0, mtime: "2026-07-22T10:00:00.000Z", linkTarget: target });
        // Each link alone stays inside, laid one after the other `x/y/z` lands in the folder and points above it.
        const { indexBytes } = await createArchive([{
            kind: "directory", jobSourceId: SOURCE_ID, label: "SFTP: /var/www", localPath: sourceDir, excludePatterns: [],
            files: [
                { path: "x/ok.txt", size: 1, mtime: "2026-07-22T10:00:00.000Z" },
                { path: "x/y/f.txt", size: 1, mtime: "2026-07-22T10:00:00.000Z" },
                link("x/y", ".."),
                link("x/Y/z", ".."),
            ],
        }], archivePath, { sourceType: "directory-only" });
        await fs.writeFile(archivePath + ".index", indexBytes);
        await fs.writeFile(archivePath + ".meta.json", JSON.stringify({ version: 1, archive: { formatVersion: 2, indexFile: ".index", encrypted: false } }));
        const links: { remotePath: string; target: string }[] = [];
        registryGet.mockReturnValue({ ...makeAdapter(), createSymlink: async (_c: unknown, remotePath: string, target: string) => { links.push({ remotePath, target }); } });

        const result = await restoreFilesToStorage(input(["x"], { kind: "storage", configId: "storage-1", basePath: "/restores/run-1/" }));

        expect(uploads.map((upload) => upload.remotePath)).toEqual(["/restores/run-1/x/ok.txt"]);
        expect(links).toEqual([{ remotePath: "/restores/run-1/x/y", target: ".." }]);
        expect(result.failed.map((entry) => entry.path).sort()).toEqual(["x/Y/z", "x/y/f.txt"]);
        expect(result.failed[0].error).toContain("runs through a symbolic link of the same backup");
    });

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
        // The part below the folder of the restore, which the destination keeps the write inside.
        expect(uploads[0].restoreRelativePath).toBe("docs/readme.md");
        expect(uploads[0].content.equals(FIXTURE["docs/readme.md"])).toBe(true);
    });

    it("asks about the connection of the origin before writing, and writes nothing when it is refused", async () => {
        await buildFixture(true);
        prismaMock.jobSource.findUnique.mockResolvedValue({
            id: SOURCE_ID, configId: "storage-1", path: "/var/www", config: { name: "SFTP Server" },
        });
        const checkTargets = vi.fn(async () => { throw new Error("This destination holds the configuration backup."); });

        await expect(restoreFilesToStorage({ ...input(["www/assets"], { kind: "origin" }), checkTargets }))
            .rejects.toThrow("This destination holds the configuration backup.");
        expect(checkTargets).toHaveBeenCalledWith(["storage-1"]);
        expect(uploads).toEqual([]);
    });

    it("asks about a chosen destination the same way", async () => {
        await buildFixture(true);
        const checkTargets = vi.fn(async () => undefined);

        await restoreFilesToStorage({ ...input(["docs"], { kind: "storage", configId: "storage-1", basePath: "/restores" }), checkTargets });

        expect(checkTargets).toHaveBeenCalledWith(["storage-1"]);
        expect(uploads).toHaveLength(1);
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

describe("what a file restore may write, by who restores", () => {
    const MEMBER = { isPlatformAdmin: false, authMethod: "session", tenantId: "tenant-1", permissions: ["storage:restore"] } as const;
    const ADMIN = { isPlatformAdmin: true, authMethod: "session", tenantId: "default", permissions: [] } as const;
    const dockerRow = (config: Record<string, unknown>) => ({
        id: "storage-1", type: "storage", adapterId: "docker-volume", name: "Docker", config: "{}", tenantId: "default", ...config,
    });

    it("refuses Docker Volumes of the server as a target to a member, and writes nothing", async () => {
        await buildFixture(true);
        prismaMock.adapterConfig.findUnique.mockResolvedValue(dockerRow({}));

        await expect(restoreFilesToStorage({ ...input(["docs"], { kind: "storage", configId: "storage-1", basePath: "nextcloud_data" }), caller: { ...MEMBER, tenantId: "default" } }))
            .rejects.toBeInstanceOf(PermissionError);
        expect(uploads).toEqual([]);

        await restoreFilesToStorage({ ...input(["docs"], { kind: "storage", configId: "storage-1", basePath: "nextcloud_data" }), caller: ADMIN });
        expect(uploads.map((upload) => upload.remotePath)).toEqual(["nextcloud_data/docs/readme.md"]);
    });

    it("writes the volume the backup read over SSH, and refuses another volume to a member", async () => {
        await buildFixture(true);
        // The resolved config is the row here, see the mock of the config resolver.
        prismaMock.adapterConfig.findUnique.mockResolvedValue(dockerRow({ connectionMode: "ssh", sshHost: "docker.lan", sshUsername: "ops", tenantId: "tenant-1" }));
        prismaMock.jobSource.findUnique.mockResolvedValue({ configId: "storage-1", path: "nextcloud_data" });

        await expect(restoreFilesToStorage({ ...input(["docs"], { kind: "storage", configId: "storage-1", basePath: "postgres_data" }), caller: MEMBER }))
            .rejects.toBeInstanceOf(PermissionError);
        expect(uploads).toEqual([]);

        await restoreFilesToStorage({ ...input(["docs"], { kind: "storage", configId: "storage-1", basePath: "nextcloud_data" }), caller: MEMBER });
        expect(uploads.map((upload) => upload.remotePath)).toEqual(["nextcloud_data/docs/readme.md"]);
    });

    it("refuses a target folder that leaves its connection before anything is read", async () => {
        await buildFixture(true);

        await expect(restoreFilesToStorage({ ...input(["docs"], { kind: "storage", configId: "storage-1", basePath: "restores/../../home/ops/.ssh" }), caller: ADMIN }))
            .rejects.toBeInstanceOf(ValidationError);
        expect(uploads).toEqual([]);
    });

    it("names a .meta.json, a backup, its index and a file of the configuration backup as failed for a member and writes the rest", async () => {
        await buildFixture(true, {
            "Shop/Shop_2026-10-01.tar.meta.json": Buffer.from(JSON.stringify({ locked: false })),
            "Shop/Shop_2026-10-01.tar": Buffer.from("not a backup"),
            "Shop/Shop_2026-10-01.tar.index": Buffer.from("not an index"),
            "config-backups/config_backup_2026-10-01.db.gz.enc": Buffer.from("not a backup"),
            "Shop/notes.txt": Buffer.from("kept"),
        });
        const selection = ["Shop", "config-backups"];
        // A destination that holds backups, where a file named like one would replace one.
        prismaMock.adapterConfig.findUnique.mockResolvedValue({
            id: "storage-1", type: "storage", adapterId: "test-storage", name: "Test Storage", config: "{}", tenantId: "tenant-1", storageRole: "DESTINATION",
        } as never);
        // A member who may change the connection, so the folder is no question here, only the names.
        const result = await restoreFilesToStorage({ ...input(selection, { kind: "storage", configId: "storage-1", basePath: "/restores" }), caller: MANAGER });

        expect(uploads.map((upload) => upload.remotePath)).toEqual(["/restores/Shop/notes.txt"]);
        expect(result.failed.map((entry) => entry.path).sort()).toEqual([
            "Shop/Shop_2026-10-01.tar", "Shop/Shop_2026-10-01.tar.index", "Shop/Shop_2026-10-01.tar.meta.json", "config-backups/config_backup_2026-10-01.db.gz.enc",
        ]);

        uploads = [];
        const admin = await restoreFilesToStorage({ ...input(selection, { kind: "storage", configId: "storage-1", basePath: "/restores" }), caller: ADMIN });
        expect(admin.failed).toEqual([]);
        expect(uploads).toHaveLength(5);
    });

    it("refuses a member who may not change the connection a place other than the origin, and writes nothing", async () => {
        await buildFixture(true);
        prismaMock.jobSource.findUnique.mockResolvedValue({ configId: "storage-1", path: "/var/www" });

        await expect(restoreFilesToStorage({ ...input(["docs"], { kind: "storage", configId: "storage-1", basePath: "/backups/Shop" }), caller: MEMBER }))
            .rejects.toBeInstanceOf(PermissionError);
        expect(uploads).toEqual([]);

        // The folder the source read, or one inside it, goes back for anyone who may restore.
        await restoreFilesToStorage({ ...input(["docs"], { kind: "storage", configId: "storage-1", basePath: "/var/www/old" }), caller: MEMBER });
        expect(uploads.map((upload) => upload.remotePath)).toEqual(["/var/www/old/docs/readme.md"]);
    });
});

describe("a plain archive where its run wrote an encrypted one", () => {
    /** The run of History that wrote the archive to this destination, encrypted. */
    const encryptedRun = () => prismaMock.execution.findMany.mockResolvedValue([{
        id: "run-1",
        metadata: JSON.stringify({
            archive: { formatVersion: 2, indexFile: ".index", encrypted: true, profileId: PROFILE_ID },
            destinations: [{ configId: "storage-1", path: "backups/job1/backup.tar", status: "success" }],
        }),
    }]);

    it("is neither read nor restored, since someone who writes the destination laid it there", async () => {
        await buildFixture(false);
        encryptedRun();

        await expect(planFileRestore(input(["www"], { kind: "download" }))).rejects.toBeInstanceOf(EncryptionDowngradeError);
        await expect(restoreFilesToStorage(input(["docs"], { kind: "origin" }))).rejects.toThrow(/written encrypted, but the file at the destination is not encrypted/);
        expect(uploads).toEqual([]);
    });

    it("is read as before while the run that wrote it did not encrypt, or no run of History knows it", async () => {
        await buildFixture(false);
        const plan = await planFileRestore(input(["www"], { kind: "download" }));
        expect(plan.fileCount).toBe(3);

        prismaMock.execution.findMany.mockResolvedValue([{
            id: "run-1",
            metadata: JSON.stringify({
                archive: { formatVersion: 2, indexFile: ".index", encrypted: false },
                destinations: [{ configId: "storage-1", path: "backups/job1/backup.tar", status: "success" }],
            }),
        }]);
        expect((await planFileRestore(input(["www"], { kind: "download" }))).fileCount).toBe(3);
    });

    it("opens an encrypted archive whatever its run says", async () => {
        await buildFixture(true);
        encryptedRun();
        expect((await planFileRestore(input(["www"], { kind: "download" }))).fileCount).toBe(3);
    });

    it("refuses a plain archive in the chain of an encrypted one", async () => {
        await buildFixture(false);
        const options = { adapter: makeAdapter(), config: {} as never, snapshotPath: "backups/job1/backup.tar", resolveMasterKey: async () => MASTER_KEY };

        await expect(openChainArchive({ ...options, requireEncryption: true }, "backup.tar")).rejects.toThrow(/not encrypted, unlike the backup it belongs to/);
        const opened = await openChainArchive(options, "backup.tar");
        expect(opened.manifest.encryption).toBeUndefined();
        await opened.dispose();
    });
});

describe("the files a restore stages before it uploads them", () => {
    // An upload like rsync -a carries the mode of the staged file to the destination, so the file
    // takes the default mode (this archive records none), the 0700 folder keeps it from other users.
    it("lie in the private folder of 0700 with the default mode, since rsync -a carries the mode over", async () => {
        await buildFixture(true);
        const staged: { folder: string; folderMode: number; mode: number }[] = [];
        const adapter = makeAdapter();
        const upload = adapter.upload;
        adapter.upload = (async (config: unknown, localPath: string, remotePath: string) => {
            const folder = path.dirname(localPath);
            staged.push({ folder: path.basename(folder), folderMode: (await fs.stat(folder)).mode & 0o777, mode: (await fs.stat(localPath)).mode & 0o777 });
            return upload(config as never, localPath, remotePath);
        }) as StorageAdapter["upload"];
        registryGet.mockReturnValue(adapter);

        await restoreFilesToStorage(input(["docs"], { kind: "storage", configId: "storage-1", basePath: "/restores/run-1/" }));

        expect(staged).toHaveLength(1);
        expect(staged[0].folder).toMatch(/^dbackup-private-/);
        if (process.platform !== "win32") {
            // The mode a new file takes under the umask of this process.
            await fs.writeFile(path.join(workDir, "plain"), "x");
            const plainMode = (await fs.stat(path.join(workDir, "plain"))).mode & 0o777;
            expect(staged[0]).toEqual(expect.objectContaining({ folderMode: 0o700, mode: plainMode }));
            expect(staged[0].mode).not.toBe(0o600);
        }
    });
});
