/**
 * Platform > Tenants reads the rows of every tenant in the system scope, with their numbers and
 * network ranges. Someone of a platform group gets the rows of the tenants the group reaches, never
 * of a tenant they are only a member of.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ list: vi.fn(), reachedAmong: vi.fn(), switchable: vi.fn() }));

vi.mock("@/lib/logging/logger", () => ({
    logger: { child: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }) },
}));
vi.mock("@/lib/prisma", () => ({ default: {} }));
vi.mock("@/services/audit-service", () => ({ auditService: { log: vi.fn(), logFor: vi.fn() } }));
vi.mock("@/services/tenant/tenant-service", () => ({
    tenantService: { list: () => mocks.list(), switchable: (...args: unknown[]) => mocks.switchable(...args) },
}));
vi.mock("@/services/tenant/tenant-summaries", () => ({ tenantSummaries: vi.fn().mockResolvedValue([]) }));
vi.mock("@/services/user/platform-group-service", () => ({
    platformGroupService: { reachedAmong: (...args: unknown[]) => mocks.reachedAmong(...args), reaches: vi.fn(), reachesAll: vi.fn(), reachOf: vi.fn() },
}));

const { managedTenantRows } = await import("@/services/tenant/tenant-admin");

const ROWS = [{ id: "default", name: "Default" }, { id: "acme", name: "Acme" }, { id: "globex", name: "Globex", allowedNetworks: ["192.0.2.0/24"] }];

describe("the rows of Platform > Tenants", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.list.mockResolvedValue(ROWS);
        // The platform group reaches Acme alone, the account is also a member of Globex.
        mocks.reachedAmong.mockImplementation(async (_userId: string, ids: string[]) => ids.filter((id) => id === "acme"));
        mocks.switchable.mockResolvedValue([{ id: "acme" }, { id: "globex" }]);
    });

    it("leave out a tenant the viewer is only a member of, whose numbers a membership does not give", async () => {
        const rows = await managedTenantRows({ id: "w1", isPlatformAdmin: false });

        expect(rows.map((row) => row.id)).toEqual(["acme"]);
        expect(mocks.switchable).not.toHaveBeenCalled();
    });

    it("follow the reach a route read for an API key", async () => {
        expect((await managedTenantRows({ id: "w1", isPlatformAdmin: false, reach: ["globex"] })).map((row) => row.id)).toEqual(["globex"]);
    });

    it("hold every tenant for a platform admin", async () => {
        expect(await managedTenantRows({ id: "admin", isPlatformAdmin: true })).toHaveLength(3);
    });
});
