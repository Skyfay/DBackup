// @vitest-environment node
/**
 * What a restore of files takes from the archive, whose index comes from the destination: the ids
 * of its sources, the names of its files, their modes and owners, and for Docker Volumes the
 * volume itself. None of them decides where the restore may write or what it grants there.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "fs/promises";
import path from "path";
import os from "os";
import { Readable } from "stream";
import { createReadStream } from "fs";
import { extract } from "tar-stream";
import { createGunzip } from "zlib";
import { createArchive } from "@/lib/archive/writer";
import type { SourceFileEntry } from "@/lib/archive/types";
import type { StorageAdapter, UploadOptions } from "@/lib/core/interfaces";
import { PermissionError, ValidationError } from "@/lib/logging/errors";

const prismaMock = {
    adapterConfig: { findUnique: vi.fn() },
    jobSource: { findUnique: vi.fn() },
    systemSetting: { findUnique: vi.fn().mockResolvedValue(null) },
    connectionShare: { count: vi.fn().mockResolvedValue(0) },
    // No run of History wrote these backups, see `recorded-encryption.ts`.
    execution: { findMany: vi.fn().mockResolvedValue([]) },
};
vi.mock("@/lib/prisma", () => ({ default: prismaMock }));
const registryGet = vi.fn();
vi.mock("@/lib/core/registry", () => ({ registry: { get: (...a: unknown[]) => registryGet(...a) } }));
vi.mock("@/lib/adapters/config-resolver", () => ({ resolveAdapterConfig: async (c: unknown) => c }));

const { streamFileRestore, restoreFilesToStorage } = await import("@/services/restore/file-restore");
const { writeTargetRefusal, NO_VOLUME_REFUSED } = await import("@/services/restore/restore-targets");
const { metadataFromIndex } = await import("@/lib/archive/types");
const { writeFile: writeVolumeFile } = await import("@/lib/adapters/storage/docker/write");

const MEMBER = { isPlatformAdmin: false, authMethod: "session", tenantId: "tenant-1", permissions: ["storage:restore"] } as const;
const MANAGER = { ...MEMBER, permissions: ["storage:restore", "destinations:write"] } as const;
const ADMIN = { isPlatformAdmin: true, authMethod: "session", tenantId: "default", permissions: [] } as const;

let workDir: string;
let archivePath: string;
let uploads: { remotePath: string; options?: UploadOptions }[];

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
        downloadRange: async (_c: unknown, _r: string, start: number, end: number) =>
            end < start ? Readable.from([]) : createReadStream(archivePath, { start, end }),
        upload: async (_c: unknown, _localPath: string, remotePath: string, _p: unknown, _l: unknown, options?: UploadOptions) => {
            uploads.push({ remotePath, options });
            return true;
        },
    } as unknown as StorageAdapter;
}

/** An unencrypted archive of one source with the given id, holding `docs/readme.md` as root with setuid. */
async function buildFixture(sourceId: string) {
    const sourceDir = path.join(workDir, "src");
    await fs.mkdir(path.join(sourceDir, "docs"), { recursive: true });
    await fs.writeFile(path.join(sourceDir, "docs/readme.md"), "# Readme\n");
    const files: SourceFileEntry[] = [{ path: "docs/readme.md", size: 9, mtime: "2026-10-26T00:00:00.000Z", mode: 0o104755, uid: 0, gid: 0 }];
    archivePath = path.join(workDir, "backup.tar");
    const { indexBytes } = await createArchive([{
        kind: "directory", jobSourceId: sourceId, label: "SFTP: /var/www", localPath: sourceDir, excludePatterns: [], files,
    }], archivePath, { sourceType: "directory-only", compression: "GZIP" });
    await fs.writeFile(archivePath + ".index", indexBytes);
    await fs.writeFile(archivePath + ".meta.json", JSON.stringify({ version: 1, archive: { formatVersion: 2, indexFile: ".index", encrypted: false } }));
}

beforeEach(async () => {
    vi.clearAllMocks();
    workDir = await fs.mkdtemp(path.join(os.tmpdir(), "restore-hardening-"));
    uploads = [];
    registryGet.mockReturnValue(makeAdapter());
    prismaMock.adapterConfig.findUnique.mockResolvedValue({
        id: "storage-1", type: "storage", adapterId: "test-storage", name: "Test Storage", config: "{}", tenantId: "tenant-1",
    });
});
afterEach(async () => { await fs.rm(workDir, { recursive: true, force: true }); });

const base = { storageConfigId: "storage-1", file: "backups/job1/backup.tar" };

describe("the origin of a restore of files", () => {
    beforeEach(() => {
        // The source the index names reads /var/www of this connection.
        prismaMock.jobSource.findUnique.mockResolvedValue({ id: "src-1", configId: "storage-1", path: "/var/www", config: { name: "SFTP" } });
    });

    it("is a source the request names, never one only the index names", async () => {
        await buildFixture("src-1");

        // A whole snapshot without a selection takes its sources from the index, so it writes like any other place.
        await expect(restoreFilesToStorage({ ...base, target: { kind: "origin" }, caller: MEMBER })).rejects.toBeInstanceOf(PermissionError);
        await expect(restoreFilesToStorage({ ...base, target: { kind: "storage", configId: "storage-1", basePath: "/var/www" }, caller: MEMBER }))
            .rejects.toBeInstanceOf(PermissionError);
        expect(uploads).toEqual([]);

        await restoreFilesToStorage({ ...base, selections: [{ src: "src-1" }], target: { kind: "origin" }, caller: MEMBER });
        expect(uploads.map((upload) => upload.remotePath)).toEqual(["/var/www/docs/readme.md"]);
    });

    it("gets the owners of the backup back, while every mode loses setuid, setgid and sticky", async () => {
        await buildFixture("src-1");
        await restoreFilesToStorage({ ...base, selections: [{ src: "src-1" }], target: { kind: "origin" }, caller: MEMBER });
        expect(uploads[0].options).toEqual({ mode: 0o755, uid: 0, gid: 0 });
    });
});

describe("a restore into another place than the origin", () => {
    it("lays the permission bits of the backup and never its owners", async () => {
        await buildFixture("src-1");
        prismaMock.jobSource.findUnique.mockResolvedValue({ configId: "storage-1", path: "/var/www" });
        await restoreFilesToStorage({ ...base, selections: [{ src: "src-1" }], target: { kind: "storage", configId: "storage-1", basePath: "/restores" }, caller: MANAGER });
        expect(uploads).toEqual([{ remotePath: "/restores/docs/readme.md", options: { mode: 0o755 } }]);
    });
});

describe("the metadata of an index line", () => {
    it("keeps the permission bits alone and the owners only for the origin", () => {
        const line = { k: "f" as const, src: "s", p: "x", s: 0, m: "", n: 1, mo: 0o107777, u: 0, g: 0 };
        expect(metadataFromIndex(line, false)).toEqual({ mode: 0o777 });
        expect(metadataFromIndex(line, true)).toEqual({ mode: 0o777, uid: 0, gid: 0 });
        expect(metadataFromIndex({ ...line, mo: undefined }, false)).toBeUndefined();
        expect(metadataFromIndex({ ...line, mo: -1 as number, u: 1.5 as number, g: "0" as unknown as number }, true)).toBeUndefined();
    });
});

describe("a file written into a Docker volume", () => {
    it("never carries setuid, setgid or sticky, whatever mode it is handed", async () => {
        const local = path.join(workDir, "file");
        await fs.writeFile(local, "x");
        const headers: { mode?: number }[] = [];
        const engine = {
            importPath: async (_id: string, _path: string, body: NodeJS.ReadableStream) => {
                const extractor = extract();
                extractor.on("entry", (header, stream, next) => { headers.push(header); stream.resume(); stream.on("end", next); });
                await new Promise<void>((resolve, reject) => { extractor.on("finish", resolve); extractor.on("error", reject); body.pipe(extractor); });
            },
        };
        await writeVolumeFile(engine as never, "c1", "data", "bin/tool", local, { mode: 0o106755, uid: 0, gid: 0 });
        expect(headers[0].mode).toBe(0o755);
    });
});

describe("a restore into Docker Volumes", () => {
    const docker = (basePath: string) => ({ connectionId: "d", adapterId: "docker-volume", tenantId: "default", config: { connectionMode: "ssh", sshHost: "h" }, basePath, origin: false });

    it("names its volume, or the first part of every path of the archive would pick one", () => {
        for (const basePath of ["/", "", "//", "./"]) {
            expect(writeTargetRefusal(docker(basePath), ADMIN), JSON.stringify(basePath)).toBe(NO_VOLUME_REFUSED);
        }
        expect(writeTargetRefusal(docker("nextcloud_data"), ADMIN)).toBeNull();
    });

    it("refuses a restore of files to the root of the Docker host before anything is written", async () => {
        await buildFixture("src-1");
        prismaMock.adapterConfig.findUnique.mockResolvedValue({
            id: "storage-1", type: "storage", adapterId: "docker-volume", name: "Docker", config: "{}", tenantId: "default", connectionMode: "ssh", sshHost: "h",
        });
        await expect(restoreFilesToStorage({ ...base, selections: [{ src: "src-1" }], target: { kind: "storage", configId: "storage-1", basePath: "/" }, caller: ADMIN }))
            .rejects.toBeInstanceOf(ValidationError);
        expect(uploads).toEqual([]);
    });
});

describe("a download of files", () => {
    it("names each member below one plain folder of its source, whatever id the index gives it", async () => {
        await buildFixture("../../../home/user");
        const stream = await streamFileRestore({ ...base, selections: [{ src: "../../../home/user" }], target: { kind: "download" } });
        const names: string[] = [];
        await new Promise<void>((resolve, reject) => {
            const extractor = extract();
            extractor.on("entry", (header, entry, next) => { names.push(header.name); entry.resume(); entry.on("end", next); });
            extractor.on("finish", resolve);
            extractor.on("error", reject);
            stream.pipe(createGunzip()).pipe(extractor);
        });
        expect(names).toEqual(["_._.._.._home_user/docs/readme.md"]);
    });
});
