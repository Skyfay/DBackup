import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Mocks ──────────────────────────────────────────────────────────────────────

const { mockPrisma, mockStorageAdapter } = vi.hoisted(() => {
    const mockPrisma = {
        systemSetting: { findUnique: vi.fn() },
        adapterConfig: { findUnique: vi.fn() },
        encryptionProfile: { findUnique: vi.fn() },
    };
    const mockStorageAdapter = {
        upload: vi.fn().mockResolvedValue(undefined),
        list: vi.fn().mockResolvedValue([]),
        delete: vi.fn().mockResolvedValue(undefined),
    };
    return { mockPrisma, mockStorageAdapter };
});

vi.mock("@/lib/logging/logger", () => ({
    logger: {
        child: vi.fn().mockReturnValue({
            info: vi.fn(),
            debug: vi.fn(),
            warn: vi.fn(),
            error: vi.fn(),
        }),
    },
}));

vi.mock("@/lib/logging/errors", async (importOriginal) => {
    const actual = await importOriginal<typeof import("@/lib/logging/errors")>();
    return {
        ...actual,
        wrapError: vi.fn((e) => e),
    };
});

vi.mock("@/lib/prisma", () => ({ default: mockPrisma }));

vi.mock("@/lib/core/registry", () => ({
    registry: { get: vi.fn().mockReturnValue(mockStorageAdapter) },
}));

vi.mock("@/lib/adapters/config-resolver", () => ({
    resolveAdapterConfig: vi.fn().mockResolvedValue({ bucket: "test" }),
}));

vi.mock("@/services/config/config-service", () => ({
    ConfigService: class {
        export() { return Promise.resolve({ jobs: [], sources: [] }); }
    },
}));

vi.mock("@/lib/temp-dir", () => ({
    getTempDir: vi.fn().mockReturnValue("/tmp"),
}));

vi.mock("@/lib/crypto/stream", () => ({
    createEncryptionStream: vi.fn().mockImplementation(() => ({
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        stream: new (require("stream").PassThrough)(),
        getAuthTag: vi.fn().mockReturnValue(Buffer.alloc(16)),
        iv: Buffer.alloc(12),
    })),
}));

vi.mock("@/services/notifications/system-notification-service", () => ({
    notify: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/lib/crypto", () => ({
    decrypt: vi.fn().mockReturnValue("aabbccddeeff00112233445566778899aabbccddeeff00112233445566778899"),
}));

// Intercept the pipeline at the promisified wrapper level
vi.mock("@/lib/runner/config-runner", async (importOriginal) => {
    const actual = await importOriginal<typeof import("@/lib/runner/config-runner")>();
    return actual;
});

vi.mock("fs", async (importOriginal) => {
    const actual = await importOriginal<typeof import("fs")>();
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { PassThrough } = require("stream");
    return {
        ...actual,
        default: {
            ...actual,
            createWriteStream: vi.fn(() => new PassThrough()),
            promises: {
                stat: vi.fn().mockResolvedValue({ size: 1024 }),
                writeFile: vi.fn().mockResolvedValue(undefined),
                unlink: vi.fn().mockResolvedValue(undefined),
            },
        },
        createWriteStream: vi.fn(() => new PassThrough()),
        promises: {
            stat: vi.fn().mockResolvedValue({ size: 1024 }),
            writeFile: vi.fn().mockResolvedValue(undefined),
            unlink: vi.fn().mockResolvedValue(undefined),
        },
    };
});

// ── Import SUT ─────────────────────────────────────────────────────────────────
import { runConfigBackup } from "@/lib/runner/config-runner";
import { registry } from "@/lib/core/registry";
import { decrypt } from "@/lib/crypto";
import fs from "fs";
import { resolveAdapterConfig } from "@/lib/adapters/config-resolver";

// ── Helpers ────────────────────────────────────────────────────────────────────

function _mockSetting(key: string, value: string | null) {
    mockPrisma.systemSetting.findUnique.mockImplementation(
        ({ where }: { where: { key: string } }) => {
            if (where.key === key) return Promise.resolve(value ? { key, value } : null);
            return Promise.resolve(null);
        }
    );
}

// ── Tests ──────────────────────────────────────────────────────────────────────

describe("runConfigBackup - early exits", () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it("returns early when config.backup.enabled is not 'true'", async () => {
        mockPrisma.systemSetting.findUnique.mockResolvedValue({ key: "config.backup.enabled", value: "false" });

        expect(await runConfigBackup()).toEqual({ skipped: "Off under Configuration backup" });

        // Storage should never be touched
        expect(mockStorageAdapter.upload).not.toHaveBeenCalled();
    });

    it("returns early when config.backup.enabled setting is absent", async () => {
        mockPrisma.systemSetting.findUnique.mockResolvedValue(null);

        await runConfigBackup();

        expect(mockStorageAdapter.upload).not.toHaveBeenCalled();
    });

    it("fails when it is on without a destination, so the run shows as failed", async () => {
        mockPrisma.systemSetting.findUnique.mockImplementation(({ where }: { where: { key: string } }) => {
            if (where.key === "config.backup.enabled") return Promise.resolve({ key: "config.backup.enabled", value: "true" });
            // All others return null including storageId
            return Promise.resolve(null);
        });

        await expect(runConfigBackup()).rejects.toThrow("No destination is picked under Configuration backup");

        expect(mockStorageAdapter.upload).not.toHaveBeenCalled();
    });

    it("throws ConfigurationError when storage adapter config is not found", async () => {
        mockPrisma.systemSetting.findUnique.mockImplementation(({ where }: { where: { key: string } }) => {
            if (where.key === "config.backup.enabled") return Promise.resolve({ key: "config.backup.enabled", value: "true" });
            if (where.key === "config.backup.storageId") return Promise.resolve({ key: "config.backup.storageId", value: "nonexistent-id" });
            return Promise.resolve(null);
        });

        // adapterConfig not found
        mockPrisma.adapterConfig.findUnique.mockResolvedValue(null);

        await expect(runConfigBackup()).rejects.toThrow();
    });

    it("throws ConfigurationError when secrets are included but no encryption profile is set", async () => {
        mockPrisma.systemSetting.findUnique.mockImplementation(({ where }: { where: { key: string } }) => {
            const map: Record<string, string> = {
                "config.backup.enabled": "true",
                "config.backup.storageId": "storage-1",
                "config.backup.includeSecrets": "true",
                // No profileId
            };
            return Promise.resolve(map[where.key] ? { key: where.key, value: map[where.key] } : null);
        });

        mockPrisma.adapterConfig.findUnique.mockResolvedValue({ id: "storage-1", adapterId: "local", name: "Local" });

        await expect(runConfigBackup()).rejects.toThrow();
    });
});

describe("runConfigBackup - retention", () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it("calls delete for files beyond retention count", async () => {
        // Provide full required settings
        mockPrisma.systemSetting.findUnique.mockImplementation(({ where }: { where: { key: string } }) => {
            const map: Record<string, string> = {
                "config.backup.enabled": "true",
                "config.backup.storageId": "storage-1",
                "config.backup.retention": "2",
            };
            return Promise.resolve(map[where.key] ? { key: where.key, value: map[where.key] } : null);
        });

        mockPrisma.adapterConfig.findUnique.mockResolvedValue({ id: "storage-1", adapterId: "local", name: "Local" });

        // 3 existing backups - oldest should be deleted (keep only 2)
        mockStorageAdapter.list.mockResolvedValue([
            { name: "config-backups/config_backup_2026-01-01T00-00-00Z.json.gz" },
            { name: "config-backups/config_backup_2026-02-01T00-00-00Z.json.gz" },
            { name: "config-backups/config_backup_2026-03-01T00-00-00Z.json.gz" },
        ]);

        await runConfigBackup();

        // At least one delete call for the oldest backup
        expect(mockStorageAdapter.delete).toHaveBeenCalled();
    });

    it("does not delete anything when files are within retention limit", async () => {
        mockPrisma.systemSetting.findUnique.mockImplementation(({ where }: { where: { key: string } }) => {
            const map: Record<string, string> = {
                "config.backup.enabled": "true",
                "config.backup.storageId": "storage-1",
                "config.backup.retention": "5",
            };
            return Promise.resolve(map[where.key] ? { key: where.key, value: map[where.key] } : null);
        });

        mockPrisma.adapterConfig.findUnique.mockResolvedValue({ id: "storage-1", adapterId: "local", name: "Local" });

        // Only 2 files, limit is 5 - nothing should be deleted (plus the one just uploaded = 3)
        mockStorageAdapter.list.mockResolvedValue([
            { name: "config-backups/config_backup_2026-01-01T00-00-00Z.json.gz" },
            { name: "config-backups/config_backup_2026-02-01T00-00-00Z.json.gz" },
        ]);

        await runConfigBackup();

        expect(mockStorageAdapter.delete).not.toHaveBeenCalled();
    });
});

// ── Helper: map multiple settings at once ─────────────────────────────────────
function mockSettings(map: Record<string, string>) {
    mockPrisma.systemSetting.findUnique.mockImplementation(({ where }: { where: { key: string } }) => {
        const value = map[where.key];
        return Promise.resolve(value ? { key: where.key, value } : null);
    });
}

// ── Standard storage setup reused across suites ───────────────────────────────
function setupStorage() {
    mockPrisma.adapterConfig.findUnique.mockResolvedValue({
        id: "storage-1",
        adapterId: "local",
        name: "Local Storage",
    });
}

describe("runConfigBackup - adapter registration error", () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it("throws ConfigurationError when adapter class is not registered (line 56)", async () => {
        mockSettings({
            "config.backup.enabled": "true",
            "config.backup.storageId": "storage-1",
        });
        setupStorage();
        vi.mocked(registry.get).mockReturnValueOnce(null as any);

        await expect(runConfigBackup()).rejects.toThrow();
    });
});

describe("runConfigBackup - config resolver error", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.mocked(registry.get).mockReturnValue(mockStorageAdapter as any);
    });

    it("logs error but continues when resolveAdapterConfig throws (line 64)", async () => {
        mockSettings({
            "config.backup.enabled": "true",
            "config.backup.storageId": "storage-1",
        });
        setupStorage();
        vi.mocked(resolveAdapterConfig).mockRejectedValueOnce(new Error("Config parse error"));

        // Should not throw - error is caught, backup proceeds with empty config
        await runConfigBackup();

        expect(mockStorageAdapter.upload).toHaveBeenCalled();
    });
});

describe("runConfigBackup - encryption profile paths", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.mocked(registry.get).mockReturnValue(mockStorageAdapter as any);
        vi.mocked(resolveAdapterConfig).mockResolvedValue({ bucket: "test" } as any);
    });

    it("applies encryption when profile is found and decrypted successfully (lines 74-85, 121-125, 140)", async () => {
        mockSettings({
            "config.backup.enabled": "true",
            "config.backup.storageId": "storage-1",
            "config.backup.profileId": "profile-1",
        });
        setupStorage();
        mockPrisma.encryptionProfile.findUnique.mockResolvedValue({
            id: "profile-1",
            name: "Test Profile",
            secretKey: "encrypted-key-value",
        });

        await runConfigBackup();

        // Encryption stream was activated - upload filename should contain .enc
        expect(mockStorageAdapter.upload).toHaveBeenCalledWith(
            expect.anything(),
            expect.any(String),
            expect.stringContaining(".enc"),
        );
    });

    it("throws EncryptionError when profile key decryption fails (lines 83-84)", async () => {
        mockSettings({
            "config.backup.enabled": "true",
            "config.backup.storageId": "storage-1",
            "config.backup.profileId": "profile-1",
        });
        setupStorage();
        mockPrisma.encryptionProfile.findUnique.mockResolvedValue({
            id: "profile-1",
            name: "Test Profile",
            secretKey: "bad-key",
        });
        vi.mocked(decrypt).mockImplementationOnce(() => {
            throw new Error("Decryption failed");
        });

        await expect(runConfigBackup()).rejects.toThrow();
    });

    it("warns and continues without encryption when profile is not found and secrets not included (lines 88-89)", async () => {
        mockSettings({
            "config.backup.enabled": "true",
            "config.backup.storageId": "storage-1",
            "config.backup.profileId": "profile-1",
            // includeSecrets not set
        });
        setupStorage();
        mockPrisma.encryptionProfile.findUnique.mockResolvedValue(null);

        // Should not throw, backup proceeds without encryption
        await runConfigBackup();

        expect(mockStorageAdapter.upload).toHaveBeenCalled();
        // Upload path should NOT contain .enc
        const uploadCall = vi.mocked(mockStorageAdapter.upload).mock.calls[0];
        expect(uploadCall[2]).not.toContain(".enc");
    });

    it("throws ConfigurationError when profile is not found but secrets are included (line 90)", async () => {
        mockSettings({
            "config.backup.enabled": "true",
            "config.backup.storageId": "storage-1",
            "config.backup.profileId": "profile-1",
            "config.backup.includeSecrets": "true",
        });
        setupStorage();
        mockPrisma.encryptionProfile.findUnique.mockResolvedValue(null);

        await expect(runConfigBackup()).rejects.toThrow();
    });

    it("exports secrets when includeSecrets=true with a working encryption profile (line 99 true-branch)", async () => {
        mockSettings({
            "config.backup.enabled": "true",
            "config.backup.storageId": "storage-1",
            "config.backup.profileId": "profile-1",
            "config.backup.includeSecrets": "true",
        });
        setupStorage();
        mockPrisma.encryptionProfile.findUnique.mockResolvedValue({
            id: "profile-1",
            name: "Test Profile",
            secretKey: "encrypted-key-value",
        });

        await runConfigBackup();

        // Both encryption and secrets are active - upload should include .enc
        expect(mockStorageAdapter.upload).toHaveBeenCalledWith(
            expect.anything(),
            expect.any(String),
            expect.stringContaining(".enc"),
        );
    });
});

describe("runConfigBackup - temp cleanup failure", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.mocked(registry.get).mockReturnValue(mockStorageAdapter as any);
        vi.mocked(resolveAdapterConfig).mockResolvedValue({ bucket: "test" } as any);
    });

    it("logs warn but does not throw when temp file unlink fails (line 204)", async () => {
        mockSettings({
            "config.backup.enabled": "true",
            "config.backup.storageId": "storage-1",
        });
        setupStorage();
        vi.mocked(fs.promises.unlink).mockRejectedValueOnce(new Error("ENOENT: no such file"));

        // Should complete without throwing
        await runConfigBackup();

        expect(mockStorageAdapter.upload).toHaveBeenCalled();
    });
});

describe("runConfigBackup - retention error handling", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.mocked(registry.get).mockReturnValue(mockStorageAdapter as any);
        vi.mocked(resolveAdapterConfig).mockResolvedValue({ bucket: "test" } as any);
    });

    it("logs error and does not throw when adapter.list throws during retention (line 241)", async () => {
        mockSettings({
            "config.backup.enabled": "true",
            "config.backup.storageId": "storage-1",
            "config.backup.retention": "2",
        });
        setupStorage();
        mockStorageAdapter.list.mockRejectedValueOnce(new Error("Storage unavailable"));

        // Retention errors are swallowed
        await runConfigBackup();
    });

    it("logs error per file but continues when adapter.delete throws during retention (line 233)", async () => {
        mockSettings({
            "config.backup.enabled": "true",
            "config.backup.storageId": "storage-1",
            "config.backup.retention": "1",
        });
        setupStorage();
        mockStorageAdapter.list.mockResolvedValue([
            { name: "config-backups/config_backup_2026-03-01T00-00-00Z.json.gz" },
            { name: "config-backups/config_backup_2026-01-01T00-00-00Z.json.gz" },
        ]);
        // First delete (the backup file) fails
        mockStorageAdapter.delete.mockRejectedValueOnce(new Error("Delete failed"));

        // Should not throw - per-file delete errors are caught individually
        await runConfigBackup();
    });

    it("skips retention cleanup when retention count is zero (line 208 false-branch)", async () => {
        mockSettings({
            "config.backup.enabled": "true",
            "config.backup.storageId": "storage-1",
            "config.backup.retention": "0",
        });
        setupStorage();

        await runConfigBackup();

        // adapter.list should never be called when retention is disabled
        expect(mockStorageAdapter.list).not.toHaveBeenCalled();
    });
});
