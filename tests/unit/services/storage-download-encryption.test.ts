/**
 * A download of a backup, as it is or decrypted, never hands over a plain file where the run that
 * wrote the backup encrypted it. The files at the destination say nothing that counts here, since
 * whoever writes there can swap the archive and its sidecars for plain ones.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "fs/promises";
import { existsSync } from "fs";
import os from "os";
import path from "path";
import { createArchive } from "@/lib/archive/writer";

const MASTER_KEY = Buffer.alloc(32, 0x5a);
const PROFILE_ID = "key-shop";
const FILE = "Shop/Shop_2026-11-01.tar";

const prismaMock = vi.hoisted(() => ({
    execution: { findMany: vi.fn() },
    job: { findUnique: vi.fn() },
    adapterConfig: { findUnique: vi.fn() },
    jobSource: { findUnique: vi.fn() },
}));
vi.mock("@/lib/prisma", () => ({ default: prismaMock }));
vi.mock("@/lib/adapters", () => ({ registerAdapters: vi.fn() }));
const destination = vi.hoisted(() => ({ adapter: null as unknown }));
vi.mock("@/services/sharing/destination-access", () => ({
    openDestination: async () => ({ adapter: destination.adapter, config: {} }),
    findDestination: vi.fn(),
    openRow: vi.fn(),
}));
vi.mock("@/lib/archive/storage-source", async (importOriginal) => ({
    ...(await importOriginal<typeof import("@/lib/archive/storage-source")>()),
    resolveStorageAdapter: async () => ({ adapter: destination.adapter, config: {} }),
}));
vi.mock("@/services/backup/encryption-service", () => ({ getProfileMasterKey: async () => MASTER_KEY, getEncryptionProfiles: async () => [] }));

const { storageService } = await import("@/services/storage/storage-service");
const { EncryptionDowngradeError } = await import("@/services/restore/recorded-encryption");

let workDir: string;
let downloads: string[];

/** A backup of one database at the destination, its index and metadata beside it. */
async function writeBackup(encrypted: boolean) {
    const dump = path.join(workDir, "shop.sql");
    await fs.writeFile(dump, "INSERT INTO orders VALUES (1);");
    const tarPath = path.join(workDir, FILE);
    await fs.mkdir(path.dirname(tarPath), { recursive: true });
    const { manifest, indexBytes } = await createArchive([{ kind: "database", dbName: "shop", path: dump, format: "sql" }], tarPath, {
        sourceType: "mysql",
        ...(encrypted ? { encryption: { masterKey: MASTER_KEY, profileId: PROFILE_ID } } : {}),
    });
    await fs.writeFile(`${tarPath}.index`, indexBytes);
    await fs.writeFile(`${tarPath}.meta.json`, JSON.stringify({
        version: 1,
        jobId: "job-shop",
        archive: {
            formatVersion: 2, indexFile: ".index", encrypted,
            ...(manifest.encryption ? { profileId: PROFILE_ID, kdfSalt: manifest.encryption.kdfSalt, noncePrefix: manifest.encryption.noncePrefix } : {}),
        },
    }));
}

/** The run of History that wrote the backup to this destination, encrypted. */
function encryptedRun() {
    prismaMock.execution.findMany.mockResolvedValue([{
        id: "run-1",
        metadata: JSON.stringify({
            archive: { formatVersion: 2, indexFile: ".index", encrypted: true, profileId: PROFILE_ID },
            destinations: [{ configId: "nas", path: FILE, status: "success" }],
        }),
    }]);
}

beforeEach(async () => {
    vi.clearAllMocks();
    workDir = await fs.mkdtemp(path.join(os.tmpdir(), "download-encryption-"));
    downloads = [];
    prismaMock.execution.findMany.mockResolvedValue([]);
    prismaMock.job.findUnique.mockResolvedValue(null);
    prismaMock.jobSource.findUnique.mockResolvedValue(null);
    destination.adapter = {
        id: "nas-fs",
        read: async (_c: unknown, remote: string) => fs.readFile(path.join(workDir, remote), "utf-8").catch(() => null),
        download: async (_c: unknown, remote: string, local: string) => {
            downloads.push(remote);
            return fs.copyFile(path.join(workDir, remote), local).then(() => true, () => false);
        },
    };
});

afterEach(async () => {
    await fs.rm(workDir, { recursive: true, force: true });
});

describe("a download of a plain file where its run wrote an encrypted backup", () => {
    it("is refused as it is, and the downloaded copy is removed", async () => {
        await writeBackup(false);
        encryptedRun();
        const local = path.join(workDir, "download");

        await expect(storageService.downloadFile("nas", FILE, local, false)).rejects.toBeInstanceOf(EncryptionDowngradeError);
        expect(existsSync(local)).toBe(false);
    });

    it("is refused decrypted, from the archive and without the sidecar that would call it plain", async () => {
        await writeBackup(false);
        encryptedRun();

        await expect(storageService.downloadFile("nas", FILE, path.join(workDir, "dump"), true)).rejects.toThrow(/written encrypted, but the file at the destination is not encrypted/);
        await fs.rm(path.join(workDir, `${FILE}.meta.json`));
        // Without the sidecar the archive itself shows it is plain.
        await expect(storageService.downloadFile("nas", FILE, path.join(workDir, "dump-2"), true)).rejects.toBeInstanceOf(EncryptionDowngradeError);
        expect(existsSync(path.join(workDir, "dump-2"))).toBe(false);
    });

    it("names the missing sidecar of an encrypted backup instead of calling it replaced", async () => {
        await writeBackup(true);
        encryptedRun();
        await fs.rm(path.join(workDir, `${FILE}.meta.json`));

        const refused = await storageService.downloadFile("nas", FILE, path.join(workDir, "dump"), true).catch((error: unknown) => error);
        expect(refused).not.toBeInstanceOf(EncryptionDowngradeError);
        expect(String((refused as Error).message)).toMatch(/metadata file \(\.meta\.json\) of this backup cannot be read/);
        expect(existsSync(path.join(workDir, "dump"))).toBe(false);
    });

    it("reads a backup without a sidecar as before when no run recorded it encrypted", async () => {
        await writeBackup(true);
        await fs.rm(path.join(workDir, `${FILE}.meta.json`));

        await expect(storageService.downloadFile("nas", FILE, path.join(workDir, "raw"), true)).resolves.toEqual({ success: true, isZip: false });
        expect(existsSync(path.join(workDir, "raw"))).toBe(true);
    });

    it("hands over the encrypted backup its run wrote, and a plain one no run of History knows", async () => {
        await writeBackup(true);
        encryptedRun();
        await expect(storageService.downloadFile("nas", FILE, path.join(workDir, "as-is"), false)).resolves.toEqual({ success: true, isZip: false });

        await writeBackup(false);
        prismaMock.execution.findMany.mockResolvedValue([]);
        await expect(storageService.downloadFile("nas", FILE, path.join(workDir, "plain"), false)).resolves.toEqual({ success: true, isZip: false });
    });
});
