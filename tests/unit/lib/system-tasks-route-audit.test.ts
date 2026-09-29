// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
    ctx: { userId: "u1", permissions: ["settings:write"], isSuperAdmin: false, authMethod: "session" },
    settings: new Map<string, { schedule: string; runOnStartup: boolean; enabled: boolean }>(),
    logFor: vi.fn(),
    runTask: vi.fn(),
}));

vi.mock("@/lib/logging/logger", () => ({
    logger: { child: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }) },
}));
vi.mock("@/lib/auth/access-control", () => ({
    getAuthContext: vi.fn(async () => mocks.ctx),
    checkPermissionWithContext: vi.fn(),
}));
vi.mock("next/headers", () => ({ headers: vi.fn().mockResolvedValue(new Headers()) }));
vi.mock("@/lib/server/scheduler", () => ({ scheduler: { refresh: vi.fn().mockResolvedValue(undefined) } }));
vi.mock("@/services/audit-service", () => ({ auditService: { logFor: (...args: unknown[]) => mocks.logFor(...args) } }));
vi.mock("@/lib/prisma", () => ({ default: { user: { findUnique: vi.fn().mockResolvedValue({ name: "Ada" }) } } }));
// A task stored in memory, so a change is what the next read returns.
vi.mock("@/services/system/system-task-service", () => {
    const task = (id: string) => mocks.settings.get(id) ?? { schedule: "0 0 * * *", runOnStartup: true, enabled: true };
    return {
        SYSTEM_TASKS: { CLEAN_OLD_LOGS: "system.clean_audit_logs" },
        DEFAULT_TASK_CONFIG: { "system.clean_audit_logs": { label: "Clean Old Data" } },
        systemTaskService: {
            getTaskConfig: async (id: string) => task(id).schedule,
            getTaskRunOnStartup: async (id: string) => task(id).runOnStartup,
            getTaskEnabled: async (id: string) => task(id).enabled,
            setTaskConfig: async (id: string, schedule: string) => void mocks.settings.set(id, { ...task(id), schedule }),
            setTaskRunOnStartup: async (id: string, runOnStartup: boolean) => void mocks.settings.set(id, { ...task(id), runOnStartup }),
            setTaskEnabled: async (id: string, enabled: boolean) => void mocks.settings.set(id, { ...task(id), enabled }),
            runTask: (...args: unknown[]) => mocks.runTask(...args),
        },
    };
});

const { POST, PUT } = await import("@/app/api/settings/system-tasks/route");

const request = (method: string, body: unknown) => new NextRequest("http://localhost/api/settings/system-tasks", { method, body: JSON.stringify(body) });

describe("the audit entries of system tasks", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.settings.clear();
    });

    it("writes a new schedule by the name of the task with the schedule before and after", async () => {
        await POST(request("POST", { taskId: "system.clean_audit_logs", schedule: "0 4 * * *" }));

        expect(mocks.logFor).toHaveBeenCalledWith(mocks.ctx, "UPDATE", "SYSTEM", {
            task: "Clean Old Data",
            name: "Clean Old Data",
            changes: [{ field: "Schedule", from: "0 0 * * *", to: "0 4 * * *" }],
        }, "system.clean_audit_logs");
    });

    it("writes switching a task off as that", async () => {
        await POST(request("POST", { taskId: "system.clean_audit_logs", enabled: false }));

        expect(mocks.logFor).toHaveBeenCalledWith(mocks.ctx, "UPDATE", "SYSTEM", { task: "Clean Old Data", name: "Clean Old Data", enabled: false }, "system.clean_audit_logs");
    });

    it("names a task that was started by hand", async () => {
        mocks.runTask.mockResolvedValue("exec-1");

        await PUT(request("PUT", { taskId: "system.clean_audit_logs" }));

        expect(mocks.logFor).toHaveBeenCalledWith(mocks.ctx, "EXECUTE", "SYSTEM", { task: "Clean Old Data", name: "Clean Old Data" }, "system.clean_audit_logs");
    });
});
