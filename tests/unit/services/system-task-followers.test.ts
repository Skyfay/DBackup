import { beforeEach, describe, expect, it, vi } from "vitest";
import { prismaMock } from "@/lib/testing/prisma-mock";
import { ValidationError } from "@/lib/logging/errors";

const mocks = vi.hoisted(() => ({
    retention: vi.fn(),
    configBackup: vi.fn(),
}));

vi.mock("@/lib/core/registry", () => ({ registry: { get: vi.fn() } }));
vi.mock("@/lib/adapters", () => ({ registerAdapters: vi.fn() }));
vi.mock("@/lib/adapters/config-resolver", () => ({ resolveAdapterConfig: vi.fn() }));
vi.mock("@/services/system/update-service", () => ({ updateService: { checkForUpdates: vi.fn() } }));
vi.mock("@/services/system/healthcheck-service", () => ({ healthCheckService: { performHealthCheck: vi.fn() } }));
vi.mock("@/services/system/data-retention-service", () => ({ runDataRetention: (...args: unknown[]) => mocks.retention(...args) }));
vi.mock("@/services/notifications/system-notification-service", () => ({ notify: vi.fn(), getNotificationConfig: vi.fn() }));
vi.mock("@/lib/runner/config-runner", () => ({ runConfigBackup: (...args: unknown[]) => mocks.configBackup(...args) }));
vi.mock("@/services/system/stuck-execution-service", () => ({
    STUCK_TIMEOUT_SETTING: "execution.stuckTimeoutMinutes",
    DEFAULT_STUCK_TIMEOUT_MINUTES: 360,
    sweepStuckExecutions: vi.fn().mockResolvedValue({ checked: 2, cancelled: 0 }),
}));
vi.mock("@/lib/logging/logger", () => ({
    logger: { child: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }) },
}));

const { SystemTaskService, SYSTEM_TASKS } = await import("@/services/system/system-task-service");

/** The settings table in memory, so a write is what the next read returns. */
const store = new Map<string, string>();

describe("system tasks that follow a setting of another part", () => {
    const service = new SystemTaskService();

    beforeEach(() => {
        vi.clearAllMocks();
        store.clear();
        prismaMock.systemSetting.findUnique.mockImplementation((({ where }: { where: { key: string } }) =>
            Promise.resolve(store.has(where.key) ? { key: where.key, value: store.get(where.key) } : null)) as never);
        prismaMock.systemSetting.upsert.mockImplementation((({ where, update }: { where: { key: string }; update: { value: string } }) => {
            store.set(where.key, update.value);
            return Promise.resolve({});
        }) as never);
    });

    it("switches Check for updates with Look for new versions under General, both ways", async () => {
        store.set("general.checkForUpdates", "false");
        expect(await service.getTaskEnabled(SYSTEM_TASKS.CHECK_FOR_UPDATES)).toBe(false);

        await service.setTaskEnabled(SYSTEM_TASKS.CHECK_FOR_UPDATES, true);

        expect(store.get("general.checkForUpdates")).toBe("true");
        expect(store.has("task.system.check_for_updates.enabled")).toBe(false);
    });

    it("turns the stuck run watchdog off with the timeout Never and on again with the default", async () => {
        expect(await service.getTaskEnabled(SYSTEM_TASKS.STUCK_EXECUTION_CHECK)).toBe(true);

        await service.setTaskEnabled(SYSTEM_TASKS.STUCK_EXECUTION_CHECK, false);
        expect(store.get("execution.stuckTimeoutMinutes")).toBe("0");
        expect(await service.getTaskEnabled(SYSTEM_TASKS.STUCK_EXECUTION_CHECK)).toBe(false);

        await service.setTaskEnabled(SYSTEM_TASKS.STUCK_EXECUTION_CHECK, true);
        expect(store.get("execution.stuckTimeoutMinutes")).toBe("360");
    });

    it("keeps a timeout that is set when the watchdog is switched on", async () => {
        store.set("execution.stuckTimeoutMinutes", "120");

        await service.setTaskEnabled(SYSTEM_TASKS.STUCK_EXECUTION_CHECK, true);

        expect(store.get("execution.stuckTimeoutMinutes")).toBe("120");
    });

    it("keeps the schedule of the configuration backup under one key, so a schedule set under System tasks applies", async () => {
        store.set("config.backup.schedule", "0 3 * * *");

        await service.setTaskConfig(SYSTEM_TASKS.CONFIG_BACKUP, "30 2 * * *");

        expect(await service.getTaskConfig(SYSTEM_TASKS.CONFIG_BACKUP)).toBe("30 2 * * *");
        expect(store.has("task.system.config_backup.schedule")).toBe(false);
    });

    it("still reads a schedule an older version wrote to the key of the task", async () => {
        store.set("task.system.config_backup.schedule", "15 4 * * *");

        expect(await service.getTaskConfig(SYSTEM_TASKS.CONFIG_BACKUP)).toBe("15 4 * * *");
    });

    it("refuses a schedule the scheduler cannot read before writing anything", async () => {
        await expect(service.setTaskConfig(SYSTEM_TASKS.HEALTH_CHECK, "every morning")).rejects.toBeInstanceOf(ValidationError);
        await expect(service.setTaskConfig(SYSTEM_TASKS.HEALTH_CHECK, "61 * * * *")).rejects.toBeInstanceOf(ValidationError);

        expect(prismaMock.systemSetting.upsert).not.toHaveBeenCalled();
    });
});

describe("the last run of a system task", () => {
    const service = new SystemTaskService();

    beforeEach(() => {
        vi.clearAllMocks();
        store.clear();
        prismaMock.systemSetting.findUnique.mockImplementation((({ where }: { where: { key: string } }) =>
            Promise.resolve(store.has(where.key) ? { key: where.key, value: store.get(where.key) } : null)) as never);
        prismaMock.systemSetting.upsert.mockImplementation((({ where, update }: { where: { key: string }; update: { value: string } }) => {
            store.set(where.key, update.value);
            return Promise.resolve({});
        }) as never);
    });

    it("keeps how long it took and what it did, like how many records Clean old data removed", async () => {
        mocks.retention.mockResolvedValue({ auditLog: 4, healthChecks: 10, executionHistory: null });

        await service.runTask(SYSTEM_TASKS.CLEAN_OLD_LOGS);
        const run = await service.getTaskLastRun(SYSTEM_TASKS.CLEAN_OLD_LOGS);

        expect(run).toMatchObject({ ok: true, summary: "14 removed" });
        expect(run?.durationMs).toBeGreaterThanOrEqual(0);
        expect(service.isRunning(SYSTEM_TASKS.CLEAN_OLD_LOGS)).toBe(false);
    });

    it("keeps a failed run with its message and still hands the error to the scheduler", async () => {
        mocks.configBackup.mockRejectedValue(new Error("No destination is picked under Configuration backup"));

        await expect(service.runTask(SYSTEM_TASKS.CONFIG_BACKUP)).rejects.toThrow("No destination");

        expect(await service.getTaskLastRun(SYSTEM_TASKS.CONFIG_BACKUP)).toMatchObject({
            ok: false,
            summary: "No destination is picked under Configuration backup",
        });
    });

    it("names where the configuration backup went", async () => {
        mocks.configBackup.mockResolvedValue({ fileName: "config-backups/config_backup_x.json.gz.enc", destination: "NAS" });

        await service.runTask(SYSTEM_TASKS.CONFIG_BACKUP);

        expect(await service.getTaskLastRun(SYSTEM_TASKS.CONFIG_BACKUP)).toMatchObject({ ok: true, summary: "To NAS" });
    });

    it("shows only the start of a run that started after the last one ended", async () => {
        store.set("task.system.health_check.lastRun", JSON.stringify({ at: "2026-09-29T10:00:00.000Z", durationMs: 900, ok: false, summary: "old" }));
        store.set("task.system.health_check.lastRunAt", "2026-09-29T10:01:00.000Z");

        expect(await service.getTaskLastRun(SYSTEM_TASKS.HEALTH_CHECK)).toEqual({ at: "2026-09-29T10:01:00.000Z", durationMs: null, ok: true, summary: null });
    });
});
