/**
 * A customer's restore of a shared Firebird or Azure SQL database is refused by the archive restore
 * too, before the connection is read, a dump staged or the target touched, whichever way it got
 * there. The provider's own restore of the same server goes on.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
    adapterId: "firebird",
    resolve: vi.fn(async () => ({ host: "fb.msp.internal", user: "SYSDBA", password: "pw" })),
    restoreOne: vi.fn(async () => undefined),
}));

vi.mock("@/lib/prisma", () => ({
    default: { adapterConfig: { findUnique: async () => ({ id: "shared-fb", name: "Shared Firebird", adapterId: mocks.adapterId, type: "database", tenantId: "default", config: "{}" }) } },
}));
vi.mock("@/lib/core/registry", () => ({ registry: { get: () => ({ id: mocks.adapterId, restoreOne: mocks.restoreOne }) } }));
vi.mock("@/lib/adapters/config-resolver", () => ({ resolveAdapterConfig: mocks.resolve }));
vi.mock("@/services/sharing/destination-access", () => ({ findDestination: async () => ({ row: { id: "msp-nas", name: "MSP NAS" } }) }));
vi.mock("@/services/tenant/shared-servers", () => ({ listedDatabases: async () => [] }));
vi.mock("@/services/restore/customer-databases", () => ({ assertTargetsConfirmed: async () => undefined }));
vi.mock("@/services/restore/temp-space", () => ({ reserveTempSpace: async () => ({ release: () => undefined }) }));
vi.mock("@/lib/transport", () => ({ createHost: () => ({ dispose: async () => undefined }), resolveTransport: () => ({}) }));
vi.mock("@/lib/logging/logger", () => ({
    logger: { child: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }) },
}));

const { restoreDatabases } = await import("@/services/restore/archive-restore-databases");

const archive = { index: { databases: [], entries: new Map() }, ranged: true } as never;
const INPUT = { storageConfigId: "msp-nas", file: "Shops/nightly.tar", scope: "databases" as const, targetSourceId: "shared-fb" };
const SHARED = { databaseName: "shop", provider: { tenantId: "default", name: "MSP", customer: "Acme" }, copyTenantId: "default", tenantId: "acme" };

describe("the archive restore of a shared database of an engine customers never restore", () => {
    beforeEach(() => vi.clearAllMocks());

    it.each([["firebird", "Firebird"], ["azure-sql", "Azure SQL Database"]])("refuses the customer's restore of %s before it reads the connection", async (adapterId, engine) => {
        mocks.adapterId = adapterId;

        await expect(restoreDatabases({ ...INPUT, shared: SHARED } as never, archive, ["shop"], undefined, [], [], { log: vi.fn() } as never))
            .rejects.toThrow(`A customer cannot restore a ${engine} database of a shared server`);
        expect(mocks.resolve).not.toHaveBeenCalled();
        expect(mocks.restoreOne).not.toHaveBeenCalled();
    });

    it("leaves the provider's own restore of the same server alone", async () => {
        mocks.adapterId = "firebird";

        await restoreDatabases(INPUT as never, archive, [], undefined, [], [], { log: vi.fn() } as never);

        expect(mocks.resolve).toHaveBeenCalledTimes(1);
    });
});
