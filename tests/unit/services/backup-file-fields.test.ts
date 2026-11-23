import { describe, it, expect } from "vitest";
import { describeBackupFromMetadata } from "@/services/storage/backup-file-fields";
import type { BackupMetadata } from "@/lib/core/interfaces";

function meta(overrides: Partial<BackupMetadata> = {}): BackupMetadata {
    return {
        jobName: "FileBackup",
        sourceName: "Scripts",
        sourceType: "local-filesystem",
        ...overrides,
    } as BackupMetadata;
}

describe("describeBackupFromMetadata", () => {
    it("reads compression and encryption from a seekable archive's own fields", () => {
        // A v2 archive compresses and encrypts each entry, so the whole-file fields stay unset
        // and the real state lives under `archive`. Reading only the top level showed every file
        // backup in the explorer as uncompressed and unencrypted while both were on.
        const derived = describeBackupFromMetadata("FileBackup_2026-07-25.tar", meta({
            archive: {
                formatVersion: 2,
                indexFile: ".index",
                encrypted: true,
                profileId: "profile-1",
                compression: "GZIP",
                files: 129,
            },
            combined: { databases: 0, directorySources: 1 },
        }));

        expect(derived.compression).toBe("GZIP");
        expect(derived.isEncrypted).toBe(true);
        expect(derived.encryptionProfileId).toBe("profile-1");
        expect(derived.hasFileIndex).toBe(true);
    });

    it("still prefers the whole-file fields where a backup has them", () => {
        // Database backups compress and encrypt the dump as a whole - the older shape, which
        // must keep working alongside the archive one.
        const derived = describeBackupFromMetadata("db_2026-07-25.sql.gz.enc", meta({
            compression: "BROTLI",
            encryption: { enabled: true, profileId: "profile-2" },
        } as Partial<BackupMetadata>));

        expect(derived.compression).toBe("BROTLI");
        expect(derived.encryptionProfileId).toBe("profile-2");
    });

    it("reports no compression when the backup genuinely has none", () => {
        // The guard for the two above: defaulting to a value would label every plain backup as
        // compressed, which is worse than the missing label it replaces.
        const derived = describeBackupFromMetadata("FileBackup.tar", meta({
            archive: { formatVersion: 2, indexFile: ".index", encrypted: false, files: 3 },
        }));

        expect(derived.compression).toBeUndefined();
        expect(derived.isEncrypted).toBe(false);
    });

    it("treats a .enc filename as encrypted even without metadata saying so", () => {
        const derived = describeBackupFromMetadata("db.sql.enc", meta());
        expect(derived.isEncrypted).toBe(true);
    });

    it("labels a directory-only backup by its source count", () => {
        const derived = describeBackupFromMetadata("FileBackup.tar", meta({
            combined: { databases: 0, directorySources: 2 },
        }));

        expect(derived.dbInfo).toEqual({ count: 0, label: "2 Directory Sources" });
    });

    it("labels a mixed backup with both halves", () => {
        const derived = describeBackupFromMetadata("Mixed.tar", meta({
            combined: { databases: 2, directorySources: 1 },
        }));

        expect(derived.dbInfo).toEqual({ count: 2, label: "2 DBs + 1 Dir" });
    });

    it("recognises a config backup by its filename", () => {
        const derived = describeBackupFromMetadata("config_backup_2026-07-25.tar.gz", meta({
            jobName: undefined,
            sourceName: undefined,
            sourceType: undefined,
        }));

        expect(derived.jobName).toBe("Config Backup");
        expect(derived.dbInfo).toEqual({ count: 1, label: "System Config" });
    });

    it("calls a backup written before incremental mode existed a full one", () => {
        expect(describeBackupFromMetadata("old.sql", meta()).backupType).toBe("full");
    });

    it("takes the backup type from the chain when the field itself is absent", () => {
        const derived = describeBackupFromMetadata("inc-001.tar", meta({
            chain: { id: "chain-1", type: "incremental", index: 1 },
        }));

        expect(derived.backupType).toBe("incremental");
    });

    it("keeps when the dumps of the run started, and nothing of a sidecar without it", () => {
        const stamped = describeBackupFromMetadata("db.tar", meta({ timestamp: "2026-11-02T01:20:00.000Z", dumpsStartedAt: "2026-11-02T01:00:00.000Z" }));
        expect(stamped).toMatchObject({ createdAt: "2026-11-02T01:20:00.000Z", dumpsStartedAt: "2026-11-02T01:00:00.000Z" });

        expect(describeBackupFromMetadata("db.tar", meta({ timestamp: "2026-11-02T01:20:00.000Z" }))).not.toHaveProperty("dumpsStartedAt");
        expect(describeBackupFromMetadata("db.tar", meta({ dumpsStartedAt: 42 }))).not.toHaveProperty("dumpsStartedAt");
    });
});
