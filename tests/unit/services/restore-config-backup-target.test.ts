import { beforeEach, describe, expect, it, vi } from "vitest";
import { PermissionError } from "@/lib/logging/errors";
import { CONFIG_BACKUP_DESTINATION_LOCKED } from "@/lib/core/config-backup-locks";

/**
 * A full restore writes the directory sources of an archive into the storage of each directory
 * mapping. Into the destination of the configuration backup only a platform admin with a session
 * writes, the same as the file restore, so every restore asks before anything runs.
 */

const mocks = vi.hoisted(() => ({
    create: vi.fn(),
    transaction: vi.fn(),
    pipeline: vi.fn(),
    preflight: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
    default: {
        execution: { create: (...args: unknown[]) => mocks.create(...args) },
        // The storages of the mappings, read for who may write into them.
        adapterConfig: { findUnique: async ({ where }: { where: { id: string } }) => ({ id: where.id, adapterId: "sftp", tenantId: "default", config: "{}" }) },
        // The directory source read the folder `restored` of the storage of Acme.
        jobSource: { findUnique: async () => ({ configId: "acme-share", path: "restored" }) },
        $transaction: (...args: unknown[]) => mocks.transaction(...args),
    },
}));
vi.mock("@/services/config/config-backup-targets", () => ({
    getConfigBackupTargets: async () => ({ storageId: "home-nas", profileId: "config-key", credentialIds: ["nas-login"] }),
}));
vi.mock("@/services/restore/customer-databases", () => ({ assertCustomerDatabasesConfirmed: async () => [] }));
// A recorded run of the job of each source wrote these backups, see restore-recorded-origin.test.ts.
vi.mock("@/services/restore/recorded-origin", () => ({ archiveReadSource: async () => true }));
vi.mock("@/lib/adapters", () => ({ registerAdapters: vi.fn() }));
vi.mock("@/lib/logging/logger", () => ({
    logger: { child: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }) },
}));
vi.mock("@/services/restore/preflight", () => ({ preflightRestore: (...args: unknown[]) => mocks.preflight(...args) }));
vi.mock("@/services/restore/pipeline", () => ({ runRestorePipeline: (...args: unknown[]) => mocks.pipeline(...args) }));
vi.mock("@/lib/server/database-maintenance", () => ({ assertNoDatabaseMaintenance: vi.fn() }));

const { restoreService } = await import("@/services/restore/restore-service");

const ADMIN = { isPlatformAdmin: true, authMethod: "session", tenantId: "default" } as const;
const ADMIN_KEY = { isPlatformAdmin: true, authMethod: "apikey", tenantId: "default" } as const;
const MEMBER = { isPlatformAdmin: false, authMethod: "session", tenantId: "default" } as const;

const INTO_CONFIG_DESTINATION = {
    storageConfigId: "acme-s3",
    file: "Files/2026-10-20_files.tar",
    scope: "files" as const,
    directoryMapping: [{ entryId: "src-1", targetConfigId: "home-nas", targetPath: "config-backups", selected: true }],
};

describe("a full restore into the destination of the configuration backup", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.preflight.mockResolvedValue(undefined);
        mocks.pipeline.mockResolvedValue(undefined);
        mocks.create.mockResolvedValue({ id: "run-1" });
    });

    it("is refused for a member of a tenant before anything runs", async () => {
        const started = restoreService.restore(INTO_CONFIG_DESTINATION, MEMBER);

        await expect(started).rejects.toBeInstanceOf(PermissionError);
        await expect(restoreService.restore(INTO_CONFIG_DESTINATION, MEMBER)).rejects.toThrow(CONFIG_BACKUP_DESTINATION_LOCKED);
        expect(mocks.preflight).not.toHaveBeenCalled();
        expect(mocks.create).not.toHaveBeenCalled();
    });

    it("is refused for an API key of a platform admin", async () => {
        await expect(restoreService.restore(INTO_CONFIG_DESTINATION, ADMIN_KEY)).rejects.toThrow(CONFIG_BACKUP_DESTINATION_LOCKED);
        expect(mocks.create).not.toHaveBeenCalled();
    });

    it("is refused when the destination hides in a mapping that was left out of the pick", async () => {
        const input = {
            ...INTO_CONFIG_DESTINATION,
            directoryMapping: [
                { entryId: "src-1", targetConfigId: "home-nas", targetPath: "x", selected: false },
                { entryId: "src-1", targetConfigId: "acme-share", targetPath: "x", selected: true },
            ],
        };

        await expect(restoreService.restore(input, MEMBER)).rejects.toThrow(CONFIG_BACKUP_DESTINATION_LOCKED);
    });

    it("is refused when the destination is named as the target server", async () => {
        await expect(restoreService.restore({ storageConfigId: "acme-s3", file: "a.tar", targetSourceId: "home-nas" }, MEMBER))
            .rejects.toThrow(CONFIG_BACKUP_DESTINATION_LOCKED);
    });

    it("runs for a platform admin with a session", async () => {
        const result = await restoreService.restore(INTO_CONFIG_DESTINATION, ADMIN);

        expect(result.executionId).toBe("run-1");
        expect(mocks.preflight).toHaveBeenCalled();
    });

    it("runs for a member into the folder the source read on any other storage", async () => {
        const input = { ...INTO_CONFIG_DESTINATION, directoryMapping: [{ ...INTO_CONFIG_DESTINATION.directoryMapping[0], targetConfigId: "acme-share", targetPath: "restored" }] };

        await expect(restoreService.restore(input, MEMBER)).resolves.toMatchObject({ executionId: "run-1" });
    });

    it("is refused for a member into a config-backups folder of any other storage, where its files would read as configuration backups", async () => {
        const input = { ...INTO_CONFIG_DESTINATION, directoryMapping: [{ ...INTO_CONFIG_DESTINATION.directoryMapping[0], targetConfigId: "acme-share", targetPath: "shop/Config-Backups." }] };

        await expect(restoreService.restore(input, MEMBER)).rejects.toBeInstanceOf(PermissionError);
        expect(mocks.create).not.toHaveBeenCalled();
        await expect(restoreService.restore(input, ADMIN)).resolves.toMatchObject({ executionId: "run-1" });
    });

    it("is refused for a customer's restore of a shared database, whoever starts it", async () => {
        const shared = { storageConfigId: "acme-s3", file: "a.tar", scope: "databases" as const, targetSourceId: "home-nas", shared: { databaseName: "shop_acme" } };

        await expect(restoreService.restoreShared(shared, "acme")).rejects.toThrow(CONFIG_BACKUP_DESTINATION_LOCKED);
        // A directory mapping names a connection of no tenant of the restore, so it never gets that far.
        await expect(restoreService.restoreShared({ ...INTO_CONFIG_DESTINATION, shared: { databaseName: "shop_acme" } }, "acme")).rejects.toThrow("adapter 'home-nas' not found");
        expect(mocks.create).not.toHaveBeenCalled();
    });
});
