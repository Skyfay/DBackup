import { beforeEach, describe, expect, it, vi } from "vitest";
import type { RunnerContext } from "@/lib/runner/types";
import type { NotificationPayload } from "@/lib/notifications/types";

const mocks = vi.hoisted(() => ({ send: vi.fn() }));

vi.mock("fs/promises", () => ({ default: { access: vi.fn(), unlink: vi.fn(), rm: vi.fn() }, access: vi.fn(), unlink: vi.fn(), rm: vi.fn() }));
vi.mock("@/lib/prisma", () => ({ default: { execution: { update: vi.fn().mockResolvedValue({}) } } }));
vi.mock("@/lib/core/registry", () => ({ registry: { get: () => ({ send: (...args: unknown[]) => mocks.send(...args) }) } }));
vi.mock("@/lib/adapters/config-resolver", () => ({ resolveAdapterConfig: vi.fn().mockResolvedValue({}) }));
vi.mock("@/services/notifications/notification-log-service", () => ({ recordNotificationLog: vi.fn() }));
vi.mock("@/lib/notifications/brand", () => ({ loadNotificationBrand: vi.fn().mockResolvedValue({ instanceName: null, baseUrl: null, timeZone: "UTC" }) }));
vi.mock("@/services/dashboard-service", () => ({ refreshStorageStatsCache: vi.fn().mockResolvedValue(undefined) }));
// The tenant picked no channels of its own, so only the job tells about the run.
vi.mock("@/services/notifications/tenant-notification-settings", () => ({ tenantHearsAbout: async () => false }));

const { stepFinalize } = await import("@/lib/runner/steps/04-completion");

function runOf(tenantId: string): RunnerContext {
    return {
        jobId: "job-1",
        job: {
            id: "job-1",
            name: "Nightly",
            tenantId,
            notificationEvents: "ALWAYS",
            source: { id: "src-1", adapterId: "mysql", name: "Shop", type: "database" },
            destinations: [],
            notifications: [{ id: "n1", adapterId: "discord", name: "Ops chat", config: "{}", tenantId }],
        },
        execution: { id: "exec-1" },
        logs: [],
        log: vi.fn(),
        updateProgress: vi.fn(),
        setStage: vi.fn(),
        updateDetail: vi.fn(),
        updateStageProgress: vi.fn(),
        destinations: [],
        metadata: { count: 1, names: ["shop"] },
        status: "Failed",
        startedAt: new Date(Date.now() - 5000),
    } as unknown as RunnerContext;
}

describe("the notification of a run", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.send.mockResolvedValue(true);
    });

    it("links to the run and the job in the tenant of the job, so they open there from any other tenant", async () => {
        await stepFinalize(runOf("t-acme"));

        const payload = mocks.send.mock.calls[0][2] as NotificationPayload;
        expect(payload.actions?.map((action) => action.href)).toEqual([
            "/dashboard/history/run?id=exec-1&from=history&tenant=t-acme",
            "/dashboard/jobs?job=job-1&tenant=t-acme",
        ]);
    });
});
