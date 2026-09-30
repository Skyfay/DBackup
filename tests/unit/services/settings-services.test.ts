import { beforeEach, describe, expect, it, vi } from "vitest";
import { prismaMock } from "@/lib/testing/prisma-mock";
import { ValidationError } from "@/lib/logging/errors";

const mocks = vi.hoisted(() => ({
    emailLoginDisabled: vi.fn(),
    taskEnabled: vi.fn(),
    taskConfig: vi.fn(),
    setTaskEnabled: vi.fn(),
    setTaskConfig: vi.fn(),
    setRunOnStartup: vi.fn(),
    isRunning: vi.fn(),
    runTask: vi.fn(),
}));

vi.mock("@/lib/auth/env-flags", () => ({ isEmailLoginDisabled: () => mocks.emailLoginDisabled() }));
vi.mock("@/lib/server/scheduler", () => ({ scheduler: { refresh: vi.fn().mockResolvedValue(undefined) } }));
vi.mock("@/services/system/stuck-execution-service", () => ({ STUCK_TIMEOUT_SETTING: "execution.stuckTimeoutMinutes", DEFAULT_STUCK_TIMEOUT_MINUTES: 360 }));
vi.mock("@/services/system/system-task-service", () => ({
    systemTaskService: {
        getTaskEnabled: (...args: unknown[]) => mocks.taskEnabled(...args),
        getTaskConfig: (...args: unknown[]) => mocks.taskConfig(...args),
        setTaskEnabled: (...args: unknown[]) => mocks.setTaskEnabled(...args),
        setTaskConfig: (...args: unknown[]) => mocks.setTaskConfig(...args),
        setTaskRunOnStartup: (...args: unknown[]) => mocks.setRunOnStartup(...args),
        isRunning: (...args: unknown[]) => mocks.isRunning(...args),
        runTask: (...args: unknown[]) => mocks.runTask(...args),
    },
}));
vi.mock("@/lib/logging/logger", () => ({
    logger: { child: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }) },
}));

const { saveSignInSettings } = await import("@/services/system/system-settings-service");
const { saveConfigBackupSettings } = await import("@/services/config/config-backup-settings");
const { saveSystemTask, startSystemTask } = await import("@/services/system/system-task-settings");

const CONFIG = { enabled: true, storageId: "nas", profileId: "key-1", schedule: "0 3 * * *", includeStatistics: false, retention: 10 };

describe("sign-in settings", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        prismaMock.systemSetting.findMany.mockResolvedValue([] as never);
        prismaMock.$transaction.mockResolvedValue([] as never);
    });

    it("keeps the passkey button while DISABLE_EMAIL_LOGIN and no provider leave it the only way in", async () => {
        mocks.emailLoginDisabled.mockReturnValue(true);
        prismaMock.ssoProvider.count.mockResolvedValue(0);

        await expect(saveSignInSettings({ sessionDuration: 604800, passkeyLogin: false })).rejects.toBeInstanceOf(ValidationError);
        expect(prismaMock.$transaction).not.toHaveBeenCalled();
    });

    it("turns the passkey button off while a sign-in provider is on", async () => {
        mocks.emailLoginDisabled.mockReturnValue(true);
        prismaMock.ssoProvider.count.mockResolvedValue(1);

        await saveSignInSettings({ sessionDuration: 604800, passkeyLogin: false });

        expect(prismaMock.$transaction).toHaveBeenCalledTimes(1);
    });
});

describe("configuration backup settings", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        prismaMock.adapterConfig.findUnique.mockResolvedValue({ type: "storage", storageRole: "DESTINATION" } as never);
        prismaMock.encryptionProfile.findUnique.mockResolvedValue({ id: "key-1" } as never);
        prismaMock.$transaction.mockResolvedValue([] as never);
    });

    it("needs a destination to be switched on", async () => {
        await expect(saveConfigBackupSettings({ ...CONFIG, storageId: "" })).rejects.toMatchObject({ field: "storageId" });
        expect(prismaMock.$transaction).not.toHaveBeenCalled();
    });

    it("needs an encryption key to be switched on, since the file holds every login", async () => {
        await expect(saveConfigBackupSettings({ ...CONFIG, profileId: "" })).rejects.toMatchObject({ field: "profileId" });
        expect(prismaMock.$transaction).not.toHaveBeenCalled();
    });

    it("refuses a schedule the scheduler cannot read", async () => {
        await expect(saveConfigBackupSettings({ ...CONFIG, schedule: "at three" })).rejects.toMatchObject({ field: "schedule" });
    });

    it("saves its switch and schedule through the system task that follows them", async () => {
        await saveConfigBackupSettings({ ...CONFIG, schedule: "30 2 * * *" });

        expect(mocks.setTaskConfig).toHaveBeenCalledWith("system.config_backup", "30 2 * * *");
        expect(mocks.setTaskEnabled).toHaveBeenCalledWith("system.config_backup", true);
    });
});

describe("system task settings", () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it("switches the configuration backup on only with a destination", async () => {
        prismaMock.systemSetting.findUnique.mockResolvedValue(null);

        await expect(saveSystemTask("system.config_backup", { enabled: true })).rejects.toBeInstanceOf(ValidationError);
        expect(mocks.setTaskEnabled).not.toHaveBeenCalled();
    });

    it("saves only the fields it gets, like the switch of a row", async () => {
        await saveSystemTask("system.health_check", { enabled: false });

        expect(mocks.setTaskEnabled).toHaveBeenCalledWith("system.health_check", false);
        expect(mocks.setTaskConfig).not.toHaveBeenCalled();
        expect(mocks.setRunOnStartup).not.toHaveBeenCalled();
    });

    it("does not start a task a second time while it runs", async () => {
        mocks.isRunning.mockReturnValue(true);

        expect(await startSystemTask("system.update_db_versions", "Ada")).toEqual({ started: false, reason: "Database versions is running already." });
        expect(mocks.runTask).not.toHaveBeenCalled();
    });

    it("answers at once while a long task goes on", async () => {
        mocks.isRunning.mockReturnValue(false);
        mocks.runTask.mockReturnValue(new Promise(() => {}));

        expect(await startSystemTask("system.update_db_versions", "Ada")).toEqual({ started: true });
        expect(mocks.runTask).toHaveBeenCalledWith("system.update_db_versions", "Manual", "Ada");
    });
});
