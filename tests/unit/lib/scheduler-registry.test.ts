// @vitest-environment node
/**
 * The scheduler against the real node-cron: a refresh runs after every saved job or setting, and
 * the tasks of the last one have to leave the registry of node-cron, or every refresh adds the
 * tasks of every job once more and they pile up for as long as DBackup runs.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import cron from "node-cron";

vi.mock("@/lib/prisma", () => ({
    default: {
        job: {
            findMany: vi.fn().mockResolvedValue([
                { id: "job-1", name: "Nightly", schedule: "0 3 * * *", enabled: true, tenantId: "default", schedulePreset: null },
                { id: "job-2", name: "Hourly", schedule: "0 * * * *", enabled: true, tenantId: "acme", schedulePreset: null },
            ]),
        },
        systemSetting: { findUnique: vi.fn().mockResolvedValue(null) },
    },
}));
vi.mock("@/lib/runner", () => ({ runJob: vi.fn() }));
vi.mock("@/services/jobs/queue-snapshot", () => ({ queueJobsChanged: vi.fn() }));
vi.mock("@/services/system/system-task-service", () => ({
    systemTaskService: {
        getTaskEnabled: vi.fn().mockResolvedValue(true),
        getTaskConfig: vi.fn().mockResolvedValue("* * * * *"),
        getTaskRunOnStartup: vi.fn().mockResolvedValue(false),
        runTask: vi.fn(),
    },
    SYSTEM_TASKS: { HEALTH_CHECK: "health_check" },
}));

const { BackupScheduler } = await import("@/lib/server/scheduler");

afterEach(async () => {
    await Promise.all([...cron.getTasks().values()].map((task) => task.destroy()));
});

describe("the tasks of the scheduler", () => {
    it("stay as many as the jobs and system tasks however often it refreshes", async () => {
        const scheduler = new BackupScheduler();
        const before = cron.getTasks().size;

        await scheduler.refresh();
        const once = cron.getTasks().size;
        for (let refresh = 0; refresh < 5; refresh++) await scheduler.refresh();

        // Two jobs and one system task.
        expect(once - before).toBe(3);
        expect(cron.getTasks().size).toBe(once);
    });
});
