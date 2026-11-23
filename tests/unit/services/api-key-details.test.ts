/**
 * The panel of a key lists the runs it started, found by the name the key had then. In All
 * tenants that matched the runs of a key of another tenant with the same name, so the runs are
 * looked up in the tenant of the key alone.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { prismaMock } from "@/lib/testing/prisma-mock";

vi.mock("@/services/system/data-retention-service", () => ({ getDataRetentionValues: async () => ({ auditLog: 90 }) }));

const { getApiKeyDetails } = await import("@/services/auth/api-key-details");

describe("the runs of an API key", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        prismaMock.apiKey.findUnique.mockResolvedValue({ id: "key-1", name: "CI", createdAt: new Date("2026-09-01T00:00:00Z"), tenantId: "acme" } as never);
        prismaMock.auditLog.findMany.mockResolvedValue([]);
        prismaMock.execution.findMany.mockResolvedValue([]);
    });

    it("are found in the tenant of the key, not by its name in every tenant", async () => {
        await getApiKeyDetails("key-1");

        expect(prismaMock.execution.findMany).toHaveBeenCalledWith(expect.objectContaining({
            where: expect.objectContaining({ tenantId: "acme", OR: [{ triggerLabel: "CI" }] }),
        }));
    });
});
