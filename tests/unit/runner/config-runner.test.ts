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
    read: vi.fn(),
    delete: vi.fn(),
    resolve: vi.fn(),
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
        adapterConfig: { findFirst: (...args: unknown[]) => mocks.adapterConfig(...args) },
        encryptionProfile: { findFirst: (...args: unknown[]) => mocks.profile(...args) },
    },
}));
vi.mock("@/lib/core/registry", () => ({
    registry: { get: () => ({ upload: mocks.upload, list: mocks.list, read: mocks.read, delete: mocks.delete }) },
}));
vi.mock("@/lib/adapters/config-resolver", () => ({ resolveAdapterConfig: (...args: unknown[]) => mocks.resolve(...args) }));
vi.mock("@/services/config/database-copy", async (importOriginal) => ({
    ...(await importOriginal<typeof import("@/services/config/database-copy")>()),
    createConfigCopy: (...args: unknown[]) => mocks.copy(...args),
}));
vi.mock("@/lib/temp-dir", () => ({ getTempDir: () => "/tmp" }));
vi.mock("@/lib/private-temp-dir", () => ({
    privateTempPath: async (name: string) => `/tmp/dbackup-private-abc/${name}`,
    PRIVATE_FILE_MODE: 0o600,
}));
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
        mocks.upload.mockResolvedValue(true);
        mocks.list.mockResolvedValue([]);
        // Every file the runner wrote carries metadata that marks it a configuration backup.
        mocks.read.mockResolvedValue(JSON.stringify({ kind: "database", sourceType: "SYSTEM" }));
        mocks.delete.mockResolvedValue(undefined);
        mocks.resolve.mockResolvedValue({ bucket: "test" });
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

    it("takes its destination and key from the home tenant only, never from a customer", async () => {
        settings(ON);
        mocks.profile.mockResolvedValue(null);

        await expect(runConfigBackup()).rejects.toThrow("no longer exists");
        expect(mocks.adapterConfig).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ tenantId: "default" }) }));
        expect(mocks.profile).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ tenantId: "default" }) }));
    });

    it("uploads the encrypted copy with metadata that says it is one, and removes every temp file", async () => {
        settings(ON);

        const result = await runConfigBackup();

        expect(mocks.copy).toHaveBeenCalledWith({ includeHistory: true });
        const [, localFile, remoteFile] = mocks.upload.mock.calls[0];
        expect(remoteFile).toMatch(/^config-backups\/config_backup_.+\.db\.gz\.enc$/);
        // A temp name nobody can guess, never one that only the time tells, in the private folder.
        expect(localFile).toMatch(/^\/tmp\/dbackup-private-abc\/[0-9a-f-]{36}-config_backup_.+\.db\.gz\.enc$/);
        expect(mocks.writeFile).toHaveBeenCalledWith(`${localFile}.meta.json`, expect.any(String), { mode: 0o600 });
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

    it("leaves the history out only once Include the history is switched off", async () => {
        settings({ ...ON, "config.backup.includeStatistics": "false" });

        await runConfigBackup();

        expect(mocks.copy).toHaveBeenCalledWith({ includeHistory: false });
    });

    it("removes the copy also when the upload fails", async () => {
        settings(ON);
        mocks.upload.mockRejectedValue(new Error("NAS is offline"));

        await expect(runConfigBackup()).rejects.toThrow("NAS is offline");
        expect(mocks.unlink).toHaveBeenCalledWith("/tmp/dbackup-database-copy.db");
    });

    it("fails without notifying when the destination did not store the file", async () => {
        settings(ON);
        mocks.upload.mockResolvedValue(false);

        await expect(runConfigBackup()).rejects.toThrow("The configuration backup could not be stored on NAS");
        expect(mocks.upload).toHaveBeenCalledTimes(1);
        expect(mocks.notify).not.toHaveBeenCalled();
        expect(mocks.appendEntry).not.toHaveBeenCalled();
    });

    it("fails without notifying when the destination did not store the metadata, and removes the file without it", async () => {
        settings(ON);
        mocks.upload.mockResolvedValueOnce(true).mockResolvedValueOnce(false);

        await expect(runConfigBackup()).rejects.toThrow("The metadata of the configuration backup could not be stored on NAS");
        const remoteFile = mocks.upload.mock.calls[0][2];
        expect(mocks.delete).toHaveBeenCalledWith({ bucket: "test" }, remoteFile);
        expect(mocks.notify).not.toHaveBeenCalled();
        expect(mocks.appendEntry).not.toHaveBeenCalled();
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

    it("counts only its own files, so nothing else in the folder is deleted or pushes a backup out", async () => {
        settings({ ...ON, "config.backup.retention": "2" });
        const file = (name: string) => ({ name, path: `config-backups/${name}` });
        mocks.list.mockResolvedValue([
            file("config_backup_2026-09-28.db.gz.enc"),
            file("config_backup_2026-09-29.db.gz.enc"),
            // A backup of a job that wrote here, named so it sorts after the real ones.
            file("config_backup_2026-12-31.tar"),
            file("config_backup_2026-12-31.tar.meta.json"),
            // Names that only hold the prefix, and a file of the prefix without metadata.
            file("old-config_backup_2026-12-30.db.gz.enc"),
            file("notes.txt"),
            file("config_backup_2026-12-29.db.gz.enc"),
        ]);
        mocks.read.mockImplementation(async (_config: unknown, path: string) => {
            if (path.includes("2026-12-31")) return JSON.stringify({ jobId: "job-1", sourceType: "mysql" });
            if (path.includes("2026-12-29")) return null;
            return JSON.stringify({ kind: "database", sourceType: "SYSTEM" });
        });

        await runConfigBackup();

        // The folder holds two of its own files, as many as it keeps, so nothing goes.
        expect(mocks.delete).not.toHaveBeenCalled();
    });

    it("deletes the oldest of its own files once there are more than it keeps, past files that are not its own", async () => {
        settings({ ...ON, "config.backup.retention": "1" });
        const file = (name: string) => ({ name, path: `config-backups/${name}` });
        mocks.list.mockResolvedValue([
            file("config_backup_2026-09-28.db.gz.enc"),
            file("config_backup_2026-09-29.db.gz.enc"),
            file("config_backup_2026-12-31.tar"),
        ]);
        mocks.read.mockImplementation(async (_config: unknown, path: string) =>
            JSON.stringify(path.includes("2026-12-31") ? { jobId: "job-1" } : { kind: "database", sourceType: "SYSTEM" }));

        await runConfigBackup();

        expect(mocks.delete.mock.calls.map(([, path]) => path)).toEqual([
            "config-backups/config_backup_2026-09-28.db.gz.enc",
            "config-backups/config_backup_2026-09-28.db.gz.enc.meta.json",
        ]);
    });

    it("fails before it uploads when the settings of the destination cannot be used", async () => {
        settings(ON);
        mocks.resolve.mockRejectedValue(new Error("Failed to parse or decrypt adapter config"));

        await expect(runConfigBackup()).rejects.toBeInstanceOf(ConfigurationError);
        expect(mocks.copy).not.toHaveBeenCalled();
        expect(mocks.upload).not.toHaveBeenCalled();
    });

    it("still reports the backup when the retention cannot list the destination", async () => {
        settings(ON);
        mocks.list.mockRejectedValue(new Error("listing failed"));

        await expect(runConfigBackup()).resolves.toMatchObject({ destination: "NAS" });
    });
});
