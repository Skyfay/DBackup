import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
    create: vi.fn(),
    transaction: vi.fn(),
    pipeline: vi.fn(),
    preflight: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
    default: {
        execution: { create: (...args: unknown[]) => mocks.create(...args) },
        adapterConfig: {
            findUnique: async () => ({ id: "shared-mysql", name: "Shared MySQL", adapterId: "mysql", type: "database", tenantId: "default", config: "{}" }),
        },
        $transaction: (...args: unknown[]) => mocks.transaction(...args),
    },
}));
vi.mock("@/lib/adapters/config-resolver", () => ({
    resolveAdapterConfig: async () => ({ host: "db7.msp.internal", port: 3306, user: "dbackup", password: "pw-1234" }),
}));
vi.mock("@/services/sharing/destination-access", () => ({
    findDestination: async () => ({ row: { id: "msp-nas", name: "MSP NAS" }, mode: { kind: "own" }, tenantId: "default" }),
}));
vi.mock("@/services/tenant/shared-servers", () => ({ listedDatabases: async () => [{ name: "shop_acme" }, { name: "wiki_initech" }] }));
vi.mock("@/services/restore/customer-databases", () => ({ assertCustomerDatabasesConfirmed: async () => [] }));
vi.mock("@/lib/adapters", () => ({ registerAdapters: vi.fn() }));
vi.mock("@/lib/logging/logger", () => ({
    logger: { child: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }) },
}));
vi.mock("@/services/restore/preflight", () => ({ preflightRestore: (...args: unknown[]) => mocks.preflight(...args) }));
vi.mock("@/services/restore/pipeline", () => ({ runRestorePipeline: (...args: unknown[]) => mocks.pipeline(...args) }));
vi.mock("@/lib/server/database-maintenance", () => ({ assertNoDatabaseMaintenance: vi.fn() }));

const { restoreService } = await import("@/services/restore/restore-service");
const { SharedRestoreRefused } = await import("@/services/restore/refused-restore");

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
        mocks.preflight.mockResolvedValue(undefined);
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

    it("leaves both runs, failed, when the checks before the start refuse it, the customer's with the reason in its words", async () => {
        mocks.preflight.mockRejectedValue(new Error("Running restore of a newer database version (8.0.36-0ubuntu0.22.04.1) on an older server (8.0.30) is not recommended. This can cause severe incompatibility issues."));

        const refused = await restoreService.restoreShared({
            ...INPUT,
            triggerInfo: { type: "Manual", label: "Ana" },
            shared: { databaseName: "acme_shop", provider: { tenantId: "default", name: "Skyfay Hosting", customer: "Acme" } },
        }, "acme").catch((error: unknown) => error);

        expect(refused).toBeInstanceOf(SharedRestoreRefused);
        expect(mocks.transaction).toHaveBeenCalledTimes(1);
        expect(mocks.pipeline).not.toHaveBeenCalled();
        const [customer, provider] = mocks.create.mock.calls.map((call) => call[0].data);
        expect(customer).toMatchObject({ tenantId: "acme", type: "Restore", status: "Failed", path: null, triggerLabel: "Ana" });
        const customerLog = JSON.parse(customer.logs).map((entry: { message: string }) => entry.message);
        expect(customerLog).toEqual([
            "Starting restore of acme_shop",
            "The restore was refused before it started: Running restore of a newer database version (8.0.36) on an older server (8.0.30) is not recommended. This can cause severe incompatibility issues.",
            "Skyfay Hosting sees the full run in its History.",
        ]);
        expect(provider).toMatchObject({ tenantId: "default", status: "Failed", path: INPUT.file, triggerLabel: "Acme · Ana" });
        expect(provider.logs).toContain("8.0.36-0ubuntu0.22.04.1");
        expect(JSON.parse(provider.metadata)).toEqual(expect.objectContaining({ followsRun: customer.id, stage: "Failed" }));
        expect((refused as InstanceType<typeof SharedRestoreRefused>).executionId).toBe(customer.id);
    });

    it("names nothing of the server in the customer's run when the server refused to prepare the database", async () => {
        mocks.preflight.mockRejectedValue(new Error("Cannot prepare restore for 'acme_shop': Access denied for user 'dbackup'@'10.20.0.9' on db7.msp.internal:3306, wiki_initech is locked"));

        await restoreService.restoreShared({ ...INPUT, shared: { databaseName: "acme_shop", provider: { tenantId: "default", name: "Skyfay Hosting", customer: "Acme" } } }, "acme").catch(() => null);

        const [customer, provider] = mocks.create.mock.calls.map((call) => call[0].data);
        for (const hidden of ["db7.msp.internal", "3306", "dbackup", "10.20.0.9", "wiki_initech", "Shared_MySQL_nightly"]) expect(customer.logs).not.toContain(hidden);
        expect(customer.logs).toContain("Cannot prepare restore for 'acme_shop'");
        expect(provider.logs).toContain("'dbackup'@'10.20.0.9' on db7.msp.internal:3306");
    });

    it("refuses an ordinary restore as before, without a run", async () => {
        mocks.preflight.mockRejectedValue(new Error("Incompatible database types"));

        await expect(restoreService.restore(INPUT)).rejects.toThrow("Incompatible database types");
        expect(mocks.create).not.toHaveBeenCalled();
    });

    it("keeps the archive in the run of an ordinary restore", async () => {
        await restoreService.restore(INPUT);

        const data = mocks.create.mock.calls[0][0].data;
        expect(data.path).toBe(INPUT.file);
        expect(data.logs).toContain("2026-10-15_0214_Shared_MySQL_nightly.tar");
    });
});
