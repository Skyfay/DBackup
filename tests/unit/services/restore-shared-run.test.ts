import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
    create: vi.fn(),
    transaction: vi.fn(),
    pipeline: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
    default: {
        execution: { create: (...args: unknown[]) => mocks.create(...args) },
        $transaction: (...args: unknown[]) => mocks.transaction(...args),
    },
}));
vi.mock("@/lib/adapters", () => ({ registerAdapters: vi.fn() }));
vi.mock("@/lib/logging/logger", () => ({
    logger: { child: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }) },
}));
vi.mock("@/services/restore/preflight", () => ({ preflightRestore: vi.fn() }));
vi.mock("@/services/restore/pipeline", () => ({ runRestorePipeline: (...args: unknown[]) => mocks.pipeline(...args) }));
vi.mock("@/lib/server/database-maintenance", () => ({ assertNoDatabaseMaintenance: vi.fn() }));

const { restoreService } = await import("@/services/restore/restore-service");

const INPUT = {
    storageConfigId: "msp-nas",
    file: "Shared MySQL/2026-10-15_0214_Shared_MySQL_nightly.tar",
    scope: "databases" as const,
    targetSourceId: "shared-mysql",
    databaseMapping: [{ originalName: "acme_shop", targetName: "acme_shop", selected: true }],
};

describe("the run of a restore a customer starts on a shared server", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.create.mockResolvedValue({ id: "run-1" });
        mocks.transaction.mockImplementation(async (runs: Promise<unknown>[]) => Promise.all(runs));
        mocks.pipeline.mockResolvedValue(undefined);
    });

    it("names the database alone, never the archive of the server or its path", async () => {
        await restoreService.restoreShared({ ...INPUT, shared: { databaseName: "acme_shop" } }, "acme");

        const data = mocks.create.mock.calls[0][0].data;
        expect(data).toMatchObject({ tenantId: "acme", type: "Restore", path: null });
        expect(data.logs).toContain("Starting restore of acme_shop");
        expect(data.logs).not.toContain("Shared_MySQL_nightly");
    });

    it("gives the tenant of the server a run of its own with the archive, started by the customer's person and linked to the customer's run", async () => {
        await restoreService.restoreShared({
            ...INPUT,
            triggerInfo: { type: "Manual", label: "Ana" },
            shared: { databaseName: "acme_shop", provider: { tenantId: "default", name: "Skyfay Hosting", customer: "Acme" } },
        }, "acme");

        // Both runs or none.
        expect(mocks.transaction).toHaveBeenCalledTimes(1);
        const [customer, provider] = mocks.create.mock.calls.map((call) => call[0].data);
        expect(customer).toMatchObject({ tenantId: "acme", type: "Restore", status: "Running", path: null, triggerType: "Manual", triggerLabel: "Ana" });
        expect(customer.logs).not.toContain("Shared_MySQL_nightly");
        expect(provider).toMatchObject({ tenantId: "default", type: "Restore", status: "Running", path: INPUT.file, triggerType: "Manual", triggerLabel: "Acme · Ana" });
        expect(provider.logs).toContain("Starting restore of acme_shop for Acme out of 2026-10-15_0214_Shared_MySQL_nightly.tar");
        expect(JSON.parse(provider.metadata)).toEqual(expect.objectContaining({ restoreOf: { database: "acme_shop", customer: "Acme" }, followsRun: customer.id }));
        // The pipeline writes both.
        expect(mocks.pipeline).toHaveBeenCalledWith(customer.id, expect.anything(), { id: provider.id, provider: "Skyfay Hosting", customer: "Acme" });
    });

    it("writes one run for a restore that names no provider", async () => {
        await restoreService.restoreShared({ ...INPUT, shared: { databaseName: "acme_shop" } }, "acme");

        expect(mocks.transaction).not.toHaveBeenCalled();
        expect(mocks.create).toHaveBeenCalledTimes(1);
        expect(mocks.pipeline).toHaveBeenCalledWith("run-1", expect.anything(), null);
    });

    it("keeps the archive in the run of an ordinary restore", async () => {
        await restoreService.restore(INPUT);

        const data = mocks.create.mock.calls[0][0].data;
        expect(data.path).toBe(INPUT.file);
        expect(data.logs).toContain("2026-10-15_0214_Shared_MySQL_nightly.tar");
    });
});
