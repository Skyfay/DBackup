// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import { PermissionError } from "@/lib/logging/errors";

const mocks = vi.hoisted(() => ({
    checkPermission: vi.fn(),
    saveGeneral: vi.fn(),
    saveSignIn: vi.fn(),
    savePrivacy: vi.fn(),
    saveRetention: vi.fn(),
    saveRateLimits: vi.fn(),
    saveConfigBackup: vi.fn(),
    saveTask: vi.fn(),
    startTask: vi.fn(),
    audit: vi.fn(),
}));

vi.mock("@/lib/auth/access-control", () => ({ checkPermission: (...args: unknown[]) => mocks.checkPermission(...args) }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/services/audit-service", () => ({ auditService: { log: (...args: unknown[]) => mocks.audit(...args) } }));
vi.mock("@/services/system/system-settings-service", () => ({
    MAX_CONCURRENT_JOBS: 10,
    saveGeneralSettings: (...args: unknown[]) => mocks.saveGeneral(...args),
    saveSignInSettings: (...args: unknown[]) => mocks.saveSignIn(...args),
    savePrivacySettings: (...args: unknown[]) => mocks.savePrivacy(...args),
}));
vi.mock("@/services/system/data-retention-service", () => ({
    getDataRetentionValues: vi.fn(async () => ({})),
    updateDataRetentionSettings: (...args: unknown[]) => mocks.saveRetention(...args),
}));
vi.mock("@/services/system/rate-limit-settings-service", () => ({ saveRateLimitConfig: (...args: unknown[]) => mocks.saveRateLimits(...args) }));
vi.mock("@/services/config/config-backup-settings", () => ({
    MAX_CONFIG_BACKUPS_KEPT: 365,
    saveConfigBackupSettings: (...args: unknown[]) => mocks.saveConfigBackup(...args),
}));
vi.mock("@/services/system/system-task-settings", () => ({
    saveSystemTask: (...args: unknown[]) => mocks.saveTask(...args),
    startSystemTask: (...args: unknown[]) => mocks.startTask(...args),
}));
vi.mock("@/services/system/system-task-audit", () => ({
    taskName: () => "Health checks",
    taskSnapshot: vi.fn(async () => ({ name: "Health checks", values: { schedule: "* * * * *", runOnStartup: false, enabled: true } })),
    taskChanges: () => [],
}));
vi.mock("@/services/system/settings-audit", () => ({
    SETTINGS_AREAS: { GENERAL: "General", SIGN_IN: "Sign-in", PRIVACY: "Privacy", RATE_LIMITS: "Rate limits", CONFIG_BACKUP: "Config backup", INTEGRITY: "Integrity checks", DATA_RETENTION: "Data retention" },
    generalSettings: vi.fn(async () => ({ fields: {}, values: {} })),
    signInSettings: vi.fn(async () => ({ fields: {}, values: {} })),
    privacySettings: vi.fn(async () => ({ fields: {}, values: {} })),
    rateLimitSettings: vi.fn(async () => ({ fields: {}, values: {} })),
    configBackupSettings: vi.fn(async () => ({ fields: {}, values: {} })),
    integritySettings: vi.fn(async () => ({ fields: {}, values: {} })),
    settingsChanges: () => [],
    retentionChanges: () => [],
}));

const { saveGeneralSettingsAction, saveSignInSettingsAction } = await import("@/app/actions/settings/settings");
const { savePrivacySettingsAction } = await import("@/app/actions/settings/privacy-settings");
const { saveDataRetentionAction } = await import("@/app/actions/settings/data-retention");
const { updateRateLimitSettings } = await import("@/app/actions/settings/rate-limit-settings");
const { saveConfigBackupSettingsAction } = await import("@/app/actions/backup/config-backup-settings");
const { saveSystemTaskAction, runSystemTaskAction } = await import("@/app/actions/settings/system-tasks");

const GENERAL = { instanceName: "", timezone: "UTC", maxConcurrentJobs: 1, stuckTimeoutMinutes: 360, checkForUpdates: true, showQuickSetup: false };
const LIMIT = { points: 5, duration: 60 };
const CONFIG = { enabled: false, storageId: "", profileId: "", schedule: "0 3 * * *", includeStatistics: false, retention: 10 };

const SAVES = [
    ["General", () => saveGeneralSettingsAction(GENERAL)],
    ["Sign-in", () => saveSignInSettingsAction({ sessionDuration: 604800, passkeyLogin: true })],
    ["Privacy", () => savePrivacySettingsAction({ includeActorInMetadata: false })],
    ["Data retention", () => saveDataRetentionAction({ auditLog: 365 })],
    ["Rate limits", () => updateRateLimitSettings({ auth: LIMIT, api: LIMIT, mutation: LIMIT })],
    ["Configuration backup", () => saveConfigBackupSettingsAction(CONFIG)],
    ["a system task", () => saveSystemTaskAction("system.health_check", { enabled: false })],
    ["Run now", () => runSystemTaskAction("system.health_check")],
] as const;

describe("the actions of the Settings page", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.checkPermission.mockResolvedValue({ id: "admin", name: "Ada" });
        mocks.startTask.mockResolvedValue({ started: true });
    });

    it.each(SAVES)("refuses to save %s without the right to change the settings", async (_part, save) => {
        mocks.checkPermission.mockRejectedValue(new PermissionError("settings:write"));

        await expect(save()).rejects.toBeInstanceOf(PermissionError);

        expect(mocks.checkPermission).toHaveBeenCalledWith("settings:write");
        for (const service of [mocks.saveGeneral, mocks.saveSignIn, mocks.savePrivacy, mocks.saveRetention, mocks.saveRateLimits, mocks.saveConfigBackup, mocks.saveTask, mocks.startTask]) {
            expect(service).not.toHaveBeenCalled();
        }
    });

    it("refuses a task that does not exist, which could write any setting of the form task.x before", async () => {
        expect(await saveSystemTaskAction("anything.secret", { schedule: "* * * * *" })).toEqual({ success: false, error: "Unknown system task" });
        expect(await runSystemTaskAction("anything.secret")).toEqual({ success: false, error: "Unknown system task" });

        expect(mocks.saveTask).not.toHaveBeenCalled();
        expect(mocks.startTask).not.toHaveBeenCalled();
    });

    it("hands a refusal of the service back with its field, like a schedule that cannot be read", async () => {
        const { ValidationError } = await import("@/lib/logging/errors");
        mocks.saveTask.mockRejectedValue(new ValidationError("The scheduler cannot read the schedule \"soon\"", { field: "schedule" }));

        expect(await saveSystemTaskAction("system.health_check", { schedule: "soon" })).toEqual({
            success: false,
            error: "The scheduler cannot read the schedule \"soon\"",
            field: "schedule",
        });
    });

    it("answers Run now at once and writes who started the task", async () => {
        expect(await runSystemTaskAction("system.health_check")).toEqual({ success: true });

        expect(mocks.startTask).toHaveBeenCalledWith("system.health_check", "Ada");
        expect(mocks.audit).toHaveBeenCalledWith("admin", "EXECUTE", "SYSTEM", { task: "Health checks", name: "Health checks" }, "system.health_check");
    });
});
