// @vitest-environment node
/**
 * Server Actions take whatever the browser sends, so each checks the shape of its input with Zod
 * before a service sees it: the keys of the Vault, the configuration restore from a destination and
 * the templates. An input of the wrong shape or size is refused, and nothing is stored.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
    createProfile: vi.fn(),
    importProfile: vi.fn(),
    recoverKey: vi.fn(),
    restoreFromStorage: vi.fn(),
    createRetention: vi.fn(),
    updateRetention: vi.fn(),
    createNaming: vi.fn(),
    createSchedule: vi.fn(),
    createNotification: vi.fn(),
    updateNotification: vi.fn(),
    createExclude: vi.fn(),
    updateExclude: vi.fn(),
}));

vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/logging/logger", () => ({ logger: { child: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }) } }));
vi.mock("@/lib/auth/access-control", () => ({
    checkPermission: async () => ({ id: "ada", isPlatformAdmin: true, tenantId: "default" }),
    checkPlatformAdmin: vi.fn(),
    hasPermission: async () => true,
    tenantRefusal: () => null,
}));
vi.mock("@/services/config/config-backup-targets", () => ({ getConfigBackupTargets: async () => ({ storageId: null, profileId: null, credentialIds: [] }) }));
vi.mock("@/services/storage/config-backup-access", () => ({ isConfigBackupFile: async () => false }));
vi.mock("@/services/backup/encryption-service", () => ({
    createEncryptionProfile: mocks.createProfile,
    importEncryptionProfile: mocks.importProfile,
}));
vi.mock("@/services/backup/key-recovery", () => ({ recoverEncryptionKey: mocks.recoverKey }));
vi.mock("@/services/backup/archive-index-service", () => ({ archiveIndexService: { clear: vi.fn() } }));
vi.mock("@/services/config/config-service", () => ({ ConfigService: class { restoreFromStorage = mocks.restoreFromStorage; } }));
vi.mock("@/services/adapters/adapter-audit", () => ({ connectionName: async () => "NAS" }));
vi.mock("@/services/system/settings-save", () => ({ PLATFORM_LOG: { tenantId: "default" } }));
vi.mock("@/services/audit-service", () => ({ auditService: { log: vi.fn(), logFor: vi.fn() } }));
vi.mock("@/lib/server/scheduler", () => ({ scheduler: { refresh: async () => undefined } }));
vi.mock("@/services/templates/template-audit", () => ({
    templateSnapshot: async () => null,
    templateUpdate: () => ({}),
    defaultNotificationTemplate: async () => null,
}));
vi.mock("@/services/templates/retention-policy-service", () => ({ createRetentionPolicy: mocks.createRetention, updateRetentionPolicy: mocks.updateRetention }));
vi.mock("@/services/templates/naming-template-service", () => ({ createNamingTemplate: mocks.createNaming }));
vi.mock("@/services/templates/schedule-preset-service", () => ({ createSchedulePreset: mocks.createSchedule }));
vi.mock("@/services/templates/notification-template-service", () => ({ createNotificationTemplate: mocks.createNotification, updateNotificationTemplate: mocks.updateNotification }));
vi.mock("@/services/templates/exclude-pattern-preset-service", () => ({ createExcludePatternPreset: mocks.createExclude, updateExcludePatternPreset: mocks.updateExclude }));

const encryption = await import("@/app/actions/backup/encryption");
const { restoreFromStorageAction } = await import("@/app/actions/backup/config-management");
const templates = await import("@/app/actions/templates");

const KEY = "ab".repeat(32);
const LONG = "x".repeat(5000);
/** What the browser can send in place of the types the actions declare. */
const loose = <T>(value: unknown) => value as T;

beforeEach(() => {
    vi.clearAllMocks();
    mocks.createProfile.mockResolvedValue({ id: "k1", name: "Nightly" });
    mocks.importProfile.mockResolvedValue({ id: "k2", name: "Imported" });
    mocks.recoverKey.mockResolvedValue({ status: "existing" });
    mocks.restoreFromStorage.mockResolvedValue("run-1");
    for (const create of [mocks.createRetention, mocks.updateRetention, mocks.createNaming, mocks.createSchedule, mocks.createNotification, mocks.updateNotification, mocks.createExclude, mocks.updateExclude]) {
        create.mockResolvedValue({ id: "t1", name: "Template" });
    }
});

describe("the keys of the Vault", () => {
    it("are not made, imported or recovered from an input of the wrong shape", async () => {
        const results = [
            await encryption.createEncryptionProfile("   "),
            await encryption.createEncryptionProfile(LONG),
            await encryption.createEncryptionProfile(loose<string>({ name: "Nightly" })),
            await encryption.importEncryptionProfile("Imported", "not a key"),
            await encryption.importEncryptionProfile("Imported", KEY, LONG),
            await encryption.recoverEncryptionKeyAction("nas", "nightly/shop.tar", "zz".repeat(32)),
            await encryption.recoverEncryptionKeyAction("nas", loose<string>(["nightly/shop.tar"]), KEY),
            await encryption.recoverEncryptionKeyAction("nas", "nightly/shop.tar", KEY, LONG),
        ];

        for (const result of results) expect(result.success).toBe(false);
        expect(mocks.createProfile).not.toHaveBeenCalled();
        expect(mocks.importProfile).not.toHaveBeenCalled();
        expect(mocks.recoverKey).not.toHaveBeenCalled();
    });

    it("are made from a name and a description the dialog sends, trimmed", async () => {
        expect((await encryption.createEncryptionProfile(" Nightly ", "")).success).toBe(true);
        expect(mocks.createProfile).toHaveBeenCalledWith("Nightly", undefined);
        expect((await encryption.importEncryptionProfile("Imported", ` ${KEY} `, "From the old server", ["old-1"])).success).toBe(true);
        expect(mocks.importProfile).toHaveBeenCalledWith("Imported", KEY, "From the old server", ["old-1"]);
    });
});

describe("the configuration restore from a destination", () => {
    it("starts with nothing but the parts it knows", async () => {
        const parts = { settings: true, adapters: true, jobs: true, users: true, sso: true, profiles: true };

        const odd = await restoreFromStorageAction("nas", "config-backups/config_backup_1.db.gz.enc", undefined, loose({ ...parts, users: "yes" }));
        const extra = await restoreFromStorageAction("nas", "config-backups/config_backup_1.db.gz.enc", undefined, loose({ ...parts, dropTables: true }));
        const noFile = await restoreFromStorageAction("nas", "");

        expect([odd.success, extra.success, noFile.success]).toEqual([false, false, false]);
        expect(mocks.restoreFromStorage).not.toHaveBeenCalled();

        expect((await restoreFromStorageAction("nas", "config-backups/config_backup_1.db.gz.enc", undefined, parts)).success).toBe(true);
    });
});

describe("the templates", () => {
    it("are not made or changed from an input of the wrong shape or size", async () => {
        const results = [
            await templates.createRetentionPolicy(loose({ name: "Keep 7", config: { mode: "SIMPLE", simple: { keepCount: -1 } } })),
            await templates.updateRetentionPolicy("r1", loose({ name: LONG })),
            await templates.createNamingTemplate(loose({ name: "Daily", pattern: { evil: true } })),
            await templates.createSchedulePreset(loose({ name: "", schedule: "0 3 * * *" })),
            await templates.createNotificationTemplate(loose({ name: "Ops", channels: [{ configId: "c1", events: "SUCCESS; rm -rf" }] })),
            await templates.updateNotificationTemplate("n1", loose({ channels: "c1" })),
            await templates.createExcludePatternPreset(loose({ name: "Caches", patterns: "*.tmp" })),
            await templates.updateExcludePatternPreset("e1", loose({ isDefault: "yes" })),
        ];

        for (const result of results) expect(result.success).toBe(false);
        for (const service of [mocks.createRetention, mocks.updateRetention, mocks.createNaming, mocks.createSchedule, mocks.createNotification, mocks.updateNotification, mocks.createExclude, mocks.updateExclude]) {
            expect(service).not.toHaveBeenCalled();
        }
    });

    it("are made and changed from what the dialogs send", async () => {
        expect((await templates.createRetentionPolicy({ name: "Keep 7", description: "", config: { mode: "SIMPLE", simple: { keepCount: 7 } } })).success).toBe(true);
        expect((await templates.createNotificationTemplate({ name: "Ops", channels: [{ configId: "c1", events: "SUCCESS|PARTIAL|FAILED" }] })).success).toBe(true);
        expect((await templates.createExcludePatternPreset({ name: "Caches", patterns: ["*.tmp"], groups: ["node"], excludedGroupPatterns: [] })).success).toBe(true);
        expect((await templates.updateExcludePatternPreset("e1", { isDefault: true })).success).toBe(true);

        expect(mocks.createNotification).toHaveBeenCalledWith({ name: "Ops", channels: [{ configId: "c1", events: "SUCCESS|PARTIAL|FAILED" }] });
        expect(mocks.updateExclude).toHaveBeenCalledWith("e1", { isDefault: true });
    });
});

describe("an error the actions answer with", () => {
    /** What a driver or the file system says, with an address and a path no browser should read. */
    const RAW = "connect ECONNREFUSED 10.0.0.7:5432 while opening /data/dbackup.db";
    const RETENTION = { name: "Keep 7", config: { mode: "SIMPLE" as const, simple: { keepCount: 7 } } };

    it("is the words of a refusal or a conflict, written for the user", async () => {
        const { ConflictError, ServiceError } = await import("@/lib/logging/errors");
        mocks.createProfile.mockRejectedValue(new ConflictError('An encryption profile with the name "Nightly" already exists.'));
        expect(await encryption.createEncryptionProfile("Nightly")).toEqual({ success: false, error: 'An encryption profile with the name "Nightly" already exists.' });

        mocks.createRetention.mockRejectedValue(new ServiceError("RetentionPolicyService", "createRetentionPolicy", 'A retention policy named "Keep 7" already exists.'));
        expect(await templates.createRetentionPolicy(RETENTION)).toEqual({ success: false, error: 'A retention policy named "Keep 7" already exists.' });
    });

    it("is a fixed sentence for anything else, never the words of the driver", async () => {
        mocks.createProfile.mockRejectedValue(new Error(RAW));
        mocks.createRetention.mockRejectedValue(new Error(RAW));
        mocks.restoreFromStorage.mockRejectedValue(new Error(RAW));

        const results = [
            await encryption.createEncryptionProfile("Nightly"),
            await templates.createRetentionPolicy(RETENTION),
            await restoreFromStorageAction("nas", "config-backups/config_backup_1.db.gz.enc"),
        ];
        for (const result of results) {
            expect(result.success).toBe(false);
            expect(result.error).toMatch(/server log has the details/);
            expect(result.error).not.toContain("10.0.0.7");
        }
    });
});
