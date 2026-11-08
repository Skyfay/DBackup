import { describe, it, expect, vi, beforeEach } from "vitest";
import { explicitScope, type TenantScope } from "@/lib/tenant/context";

/**
 * Work outside a request names its scope: the scheduler reads the jobs of every tenant and starts a
 * due job in the tenant of that job, and the queue reads the waiting runs of every tenant and starts
 * each one in the tenant of its run. A run started in another scope would write its records, open its
 * destinations and send its notifications as the wrong tenant.
 */

const seen = vi.hoisted(() => ({ runJob: [] as (TenantScope | undefined)[], perform: [] as { id: string; scope: TenantScope | undefined }[], reads: [] as (TenantScope | undefined)[] }));

vi.mock("@/lib/prisma", () => ({
    default: {
        job: {
            findMany: vi.fn(async () => {
                seen.reads.push(explicitScope());
                return [
                    { id: "job-home", name: "Home job", schedule: "0 1 * * *", tenantId: "default", schedulePreset: null },
                    { id: "job-acme", name: "Acme job", schedule: "0 2 * * *", tenantId: "acme", schedulePreset: null },
                ];
            }),
        },
        systemSetting: { findUnique: vi.fn().mockResolvedValue(null) },
        execution: {
            findMany: vi.fn(async (args: { where: { status: string } }) => {
                seen.reads.push(explicitScope());
                return args.where.status === "Running"
                    ? []
                    : [
                        { id: "run-acme", jobId: "job-acme", tenantId: "acme" },
                        { id: "run-globex", jobId: "job-globex", tenantId: "globex" },
                    ];
            }),
        },
    },
}));

vi.mock("@/lib/runner", () => ({
    runJob: vi.fn(async () => { seen.runJob.push(explicitScope()); }),
    performExecution: vi.fn(async (id: string) => { seen.perform.push({ id, scope: explicitScope() }); }),
}));

vi.mock("@/services/system/system-task-service", () => ({
    systemTaskService: {
        getTaskConfig: vi.fn().mockResolvedValue(null),
        getTaskEnabled: vi.fn().mockResolvedValue(false),
        getTaskRunOnStartup: vi.fn().mockResolvedValue(false),
        runTask: vi.fn().mockResolvedValue(undefined),
    },
    SYSTEM_TASKS: {},
}));
vi.mock("@/services/jobs/queue-snapshot", () => ({ queueJobsChanged: vi.fn() }));
vi.mock("@/lib/server/shutdown", () => ({ isShutdownRequested: () => false }));
vi.mock("@/lib/logging/logger", () => ({
    logger: { child: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }) },
}));

const scheduled = vi.hoisted(() => [] as (() => void)[]);
vi.mock("node-cron", () => ({
    default: {
        validate: vi.fn().mockReturnValue(true),
        schedule: vi.fn((_cron: string, callback: () => void) => {
            scheduled.push(callback);
            return { stop: vi.fn(), destroy: vi.fn() };
        }),
    },
}));

import { BackupScheduler } from "@/lib/server/scheduler";
import { processQueue } from "@/lib/execution/queue-manager";

beforeEach(() => {
    seen.runJob.length = 0;
    seen.perform.length = 0;
    seen.reads.length = 0;
    scheduled.length = 0;
});

describe("the scheduler and the queue run each job in its own tenant", () => {
    it("reads the jobs of every tenant and starts a due job in the tenant of that job", async () => {
        await new BackupScheduler().refresh();
        expect(seen.reads).toEqual([{ kind: "system" }]);

        expect(scheduled).toHaveLength(2);
        for (const fire of scheduled) fire();
        await vi.waitFor(() => expect(seen.runJob).toHaveLength(2));
        expect(seen.runJob).toEqual([
            { kind: "tenant", tenantId: "default" },
            { kind: "tenant", tenantId: "acme" },
        ]);
    });

    it("reads the waiting runs of every tenant and starts each run in the tenant of its run", async () => {
        vi.mocked((await import("@/lib/prisma")).default.systemSetting.findUnique).mockResolvedValueOnce({ key: "maxConcurrentJobs", value: "2" } as never);
        await processQueue();
        expect(seen.reads.every((scope) => scope?.kind === "system")).toBe(true);
        expect(seen.perform).toEqual([
            { id: "run-acme", scope: { kind: "tenant", tenantId: "acme" } },
            { id: "run-globex", scope: { kind: "tenant", tenantId: "globex" } },
        ]);
    });
});
