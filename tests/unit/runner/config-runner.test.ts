// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";
import { Readable, Writable, PassThrough } from "stream";
import { ConfigurationError } from "@/lib/logging/errors";

const mocks = vi.hoisted(() => ({
    settings: vi.fn(),
    adapterConfig: vi.fn(),
    profile: vi.fn(),
    copy: vi.fn(),
    upload: vi.fn(),
    list: vi.fn(),
    delete: vi.fn(),
    notify: vi.fn(),
    writeFile: vi.fn(),
    unlink: vi.fn(),
    appendEntry: vi.fn(),
    removeEntries: vi.fn(),
}));

vi.mock("@/lib/logging/logger", () => ({
    logger: { child: () => ({ info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() }) },
}));
vi.mock("@/lib/prisma", () => ({
    default: {
        systemSetting: { findMany: (...args: unknown[]) => mocks.settings(...args) },
        adapterConfig: { findUnique: (...args: unknown[]) => mocks.adapterConfig(...args) },
        encryptionProfile: { findUnique: (...args: unknown[]) => mocks.profile(...args) },
    },
}));
vi.mock("@/lib/core/registry", () => ({
    registry: { get: () => ({ upload: mocks.upload, list: mocks.list, delete: mocks.delete }) },
}));
vi.mock("@/lib/adapters/config-resolver", () => ({ resolveAdapterConfig: vi.fn(async () => ({ bucket: "test" })) }));
vi.mock("@/services/config/database-copy", () => ({ createConfigCopy: (...args: unknown[]) => mocks.copy(...args) }));
vi.mock("@/lib/temp-dir", () => ({ getTempDir: () => "/tmp" }));
vi.mock("zlib", () => ({ createGzip: () => new PassThrough() }));
vi.mock("@/lib/crypto/stream", () => ({
    createEncryptionStream: () => ({ stream: new PassThrough(), getAuthTag: () => Buffer.alloc(16, 2), iv: Buffer.alloc(16, 1) }),
}));
vi.mock("@/lib/crypto", () => ({ decrypt: () => "aa".repeat(32) }));
vi.mock("@/services/notifications/system-notification-service", () => ({ notify: (...args: unknown[]) => mocks.notify(...args) }));
vi.mock("@/services/storage/storage-service", () => ({
    storageService: {
        appendStorageListCacheEntry: (...args: unknown[]) => mocks.appendEntry(...args),
        removeStorageListCacheEntries: (...args: unknown[]) => mocks.removeEntries(...args),
    },
}));
vi.mock("fs", () => {
    const fsMock = {
        createReadStream: () => Readable.from([Buffer.from("SQLite format 3\u0000")]),
        createWriteStream: () => new Writable({ write: (_chunk, _encoding, callback) => callback() }),
        promises: {
            stat: vi.fn(async () => ({ size: 2048 })),
            writeFile: (...args: unknown[]) => mocks.writeFile(...args),
            unlink: (...args: unknown[]) => mocks.unlink(...args),
        },
    };
    return { ...fsMock, default: fsMock };
});

const { runConfigBackup } = await import("@/lib/runner/config-runner");

function settings(values: Record<string, string>) {
    mocks.settings.mockResolvedValue(Object.entries(values).map(([key, value]) => ({ key, value })));
}

const ON = { "config.backup.enabled": "true", "config.backup.storageId": "nas", "config.backup.profileId": "key-1" };

describe("the configuration backup, a copy of the whole database", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.adapterConfig.mockResolvedValue({ id: "nas", name: "NAS", adapterId: "local-filesystem" });
        mocks.profile.mockResolvedValue({ id: "key-1", secretKey: "encrypted" });
        mocks.copy.mockResolvedValue({ file: "/tmp/dbackup-database-copy.db", sizeBytes: 4096 });
        mocks.upload.mockResolvedValue(undefined);
        mocks.list.mockResolvedValue([]);
        mocks.delete.mockResolvedValue(undefined);
        mocks.notify.mockResolvedValue(undefined);
        mocks.writeFile.mockResolvedValue(undefined);
        mocks.unlink.mockResolvedValue(undefined);
        mocks.appendEntry.mockResolvedValue(undefined);
        mocks.removeEntries.mockResolvedValue(undefined);
    });

    it("does nothing while it is off", async () => {
        settings({ "config.backup.enabled": "false" });

        expect(await runConfigBackup()).toEqual({ skipped: "Off under Configuration backup" });
        expect(mocks.copy).not.toHaveBeenCalled();
    });

    it("fails without a destination, so the run shows as failed", async () => {
        settings({ "config.backup.enabled": "true", "config.backup.profileId": "key-1" });

        await expect(runConfigBackup()).rejects.toBeInstanceOf(ConfigurationError);
        expect(mocks.copy).not.toHaveBeenCalled();
    });

    it("fails without an encryption key, since the file holds every login", async () => {
        settings({ "config.backup.enabled": "true", "config.backup.storageId": "nas" });

        await expect(runConfigBackup()).rejects.toThrow("No encryption key is picked");
        expect(mocks.copy).not.toHaveBeenCalled();
    });

    it("fails when the picked key no longer exists", async () => {
        settings(ON);
        mocks.profile.mockResolvedValue(null);

        await expect(runConfigBackup()).rejects.toThrow("no longer exists");
        expect(mocks.upload).not.toHaveBeenCalled();
    });

    it("uploads the encrypted copy with metadata that says it is one, and removes every temp file", async () => {
        settings(ON);

        const result = await runConfigBackup();

        expect(mocks.copy).toHaveBeenCalledWith({ includeHistory: false });
        const [, localFile, remoteFile] = mocks.upload.mock.calls[0];
        expect(remoteFile).toMatch(/^config-backups\/config_backup_.+\.db\.gz\.enc$/);
        expect(localFile).toMatch(/^\/tmp\/config_backup_.+\.db\.gz\.enc$/);
        expect(mocks.upload.mock.calls[1][2]).toBe(`${remoteFile}.meta.json`);

        const meta = JSON.parse(mocks.writeFile.mock.calls[0][1] as string);
        expect(meta).toMatchObject({
            kind: "database",
            compression: "GZIP",
            sourceType: "SYSTEM",
            encryption: { enabled: true, profileId: "key-1", algorithm: "aes-256-gcm", iv: "01".repeat(16), authTag: "02".repeat(16) },
        });
        expect(result).toEqual({ fileName: remoteFile, destination: "NAS" });
        expect(mocks.notify).toHaveBeenCalledWith(expect.objectContaining({ eventType: "config_backup", data: expect.objectContaining({ fileName: remoteFile, encrypted: true }) }));
        expect(mocks.unlink.mock.calls.map(([file]) => file)).toEqual(expect.arrayContaining(["/tmp/dbackup-database-copy.db", localFile, `${localFile}.meta.json`]));
    });

    it("keeps the history in the copy with Include the history", async () => {
        settings({ ...ON, "config.backup.includeStatistics": "true" });

        await runConfigBackup();

        expect(mocks.copy).toHaveBeenCalledWith({ includeHistory: true });
    });

    it("removes the copy also when the upload fails", async () => {
        settings(ON);
        mocks.upload.mockRejectedValue(new Error("NAS is offline"));

        await expect(runConfigBackup()).rejects.toThrow("NAS is offline");
        expect(mocks.unlink).toHaveBeenCalledWith("/tmp/dbackup-database-copy.db");
    });

    it("names the schedule as who started it, like a job the scheduler runs", async () => {
        settings(ON);

        await runConfigBackup();

        const meta = JSON.parse(mocks.writeFile.mock.calls[0][1] as string);
        expect(meta.trigger).toEqual({ type: "Scheduler", actor: "Scheduler" });
        expect(meta.timestamp).toBe(meta.createdAt);
    });

    it("names the person behind Back up now", async () => {
        settings(ON);

        await runConfigBackup({ type: "Manual", label: "Ada" });

        expect(JSON.parse(mocks.writeFile.mock.calls[0][1] as string).trigger).toEqual({ type: "Manual", actor: "Ada" });
    });

    it("leaves the name out when Privacy says so", async () => {
        settings({ ...ON, "privacy.includeActorInMetadata": "false" });

        await runConfigBackup({ type: "Api", label: "CI deploy" });

        expect(JSON.parse(mocks.writeFile.mock.calls[0][1] as string).trigger).toEqual({ type: "Api" });
    });

    it("puts the new file into the listing of the Backups page at once", async () => {
        settings(ON);

        const { fileName } = (await runConfigBackup({ type: "Manual", label: "Ada" })) as { fileName: string };

        expect(mocks.appendEntry).toHaveBeenCalledWith("nas", expect.objectContaining({
            name: fileName.replace("config-backups/", ""),
            path: fileName,
            size: 2048,
            sourceType: "SYSTEM",
            jobName: "Config Backup",
            isEncrypted: true,
            trigger: { type: "Manual", actor: "Ada" },
        }));
    });

    it("still reports the backup when the listing cannot be updated", async () => {
        settings(ON);
        mocks.appendEntry.mockRejectedValue(new Error("database is locked"));

        await expect(runConfigBackup()).resolves.toMatchObject({ destination: "NAS" });
    });

    it("keeps as many files as set and deletes the oldest by their path with their metadata", async () => {
        settings({ ...ON, "config.backup.retention": "2" });
        // A listing names each file by itself and gives its folder in the path.
        const file = (name: string) => ({ name, path: `config-backups/${name}` });
        mocks.list.mockResolvedValue([
            file("config_backup_2026-09-28.db.gz.enc"),
            file("config_backup_2026-09-29.db.gz.enc"),
            file("config_backup_2026-09-27.json.gz.enc"),
            file("config_backup_2026-09-27.json.gz.enc.meta.json"),
            file("config_backup_2026-09-30.db.gz.enc"),
        ]);

        await runConfigBackup();

        expect(mocks.delete.mock.calls.map(([, path]) => path)).toEqual([
            "config-backups/config_backup_2026-09-28.db.gz.enc",
            "config-backups/config_backup_2026-09-28.db.gz.enc.meta.json",
            "config-backups/config_backup_2026-09-27.json.gz.enc",
            "config-backups/config_backup_2026-09-27.json.gz.enc.meta.json",
        ]);
        expect(mocks.removeEntries).toHaveBeenCalledWith("nas", [
            "config-backups/config_backup_2026-09-28.db.gz.enc",
            "config-backups/config_backup_2026-09-27.json.gz.enc",
        ]);
    });

    it("leaves a file it could not delete in the listing", async () => {
        settings({ ...ON, "config.backup.retention": "1" });
        const file = (name: string) => ({ name, path: `config-backups/${name}` });
        mocks.list.mockResolvedValue([file("config_backup_2026-09-29.db.gz.enc"), file("config_backup_2026-09-30.db.gz.enc")]);
        mocks.delete.mockRejectedValue(new Error("permission denied"));

        await runConfigBackup();

        expect(mocks.removeEntries).not.toHaveBeenCalled();
    });

    it("still reports the backup when the retention cannot list the destination", async () => {
        settings(ON);
        mocks.list.mockRejectedValue(new Error("listing failed"));

        await expect(runConfigBackup()).resolves.toMatchObject({ destination: "NAS" });
    });
});
