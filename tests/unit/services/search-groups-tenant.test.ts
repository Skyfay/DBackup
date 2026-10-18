import { beforeEach, describe, expect, it, vi } from "vitest";
import { prismaMock } from "@/lib/testing/prisma-mock";

vi.mock("@/services/tenant/membership-service", () => ({ peopleOf: () => ({}), roleIn: () => ({}) }));

const { groups } = await import("@/services/search/search-admin");

describe("the groups the search finds", () => {
    beforeEach(() => vi.clearAllMocks());

    it("carry their tenant in All tenants, so a group opens in its tenant", async () => {
        prismaMock.group.findMany.mockResolvedValue([{ id: "g1", name: "Operators", tenantId: "acme", memberships: [{ userId: "u1" }, { userId: "u1" }] }] as never);

        expect(await groups("oper", null)).toEqual([{ kind: "group", id: "g1", name: "Operators", people: 1, tenantId: "acme" }]);
        expect(prismaMock.group.findMany).toHaveBeenCalledWith(expect.objectContaining({ select: expect.objectContaining({ tenantId: true }) }));
    });

    it("carry their tenant inside a tenant too", async () => {
        prismaMock.group.findMany.mockResolvedValue([{ id: "g1", name: "Operators", tenantId: "acme", _count: { memberships: 2 } }] as never);

        expect(await groups("oper", "acme")).toEqual([{ kind: "group", id: "g1", name: "Operators", people: 2, tenantId: "acme" }]);
    });
});
