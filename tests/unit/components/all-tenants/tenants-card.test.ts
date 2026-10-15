import { describe, expect, it } from "vitest";
import { tenantOverviewRows, tenantsLine } from "@/components/dashboard/widgets/tenants-model";

const TENANTS = [
    { id: "default", name: "Home" },
    { id: "acme", name: "Acme GmbH" },
    { id: "globex", name: "Globex" },
    { id: "initech", name: "Initech" },
    { id: "umbrella", name: "Umbrella" },
];

describe("the card Tenants of the Overview in All tenants", () => {
    it("lists the tenants whose newest backup of a job failed first, then those that missed a copy, then the rest by name", () => {
        const rows = tenantOverviewRows(TENANTS, [
            { id: "default", jobs: 2, databases: 3, health: null },
            { id: "acme", jobs: 4, databases: 12, health: "partial" },
            { id: "globex", jobs: 1, databases: 1, health: "failed" },
            { id: "initech", jobs: 5, databases: 8, health: "failed" },
            { id: "umbrella", jobs: 0, databases: 0, health: null },
        ]);

        expect(rows.map((row) => row.name)).toEqual(["Globex", "Initech", "Acme GmbH", "Home", "Umbrella"]);
        expect(rows[2]).toEqual({ id: "acme", name: "Acme GmbH", jobs: 4, databases: 12, health: "partial" });
    });

    it("counts nothing for a tenant without a summary yet, like one created a moment ago", () => {
        expect(tenantOverviewRows([{ id: "new", name: "New tenant" }], [])).toEqual([{ id: "new", name: "New tenant", jobs: 0, databases: 0, health: null }]);
    });

    it("says how many tenants there are and how many need a look", () => {
        const rows = (healths: ("failed" | "partial" | null)[]) => tenantOverviewRows(
            healths.map((_, index) => ({ id: `t${index}`, name: `Tenant ${index}` })),
            healths.map((health, index) => ({ id: `t${index}`, jobs: 1, databases: 1, health })),
        );

        expect(tenantsLine(rows([null, null]))).toBe("2 tenants · all backups healthy");
        expect(tenantsLine(rows(["failed", null, null]))).toBe("3 tenants · 1 needs a look");
        expect(tenantsLine(rows(["failed", "partial"]))).toBe("2 tenants · 2 need a look");
        expect(tenantsLine([])).toBe("0 tenants");
    });
});
