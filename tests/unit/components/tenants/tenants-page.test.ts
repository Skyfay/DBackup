import { describe, expect, it } from "vitest";
import { tenantActions, tenantNote, type TenantHandlers } from "@/components/dashboard/tenants/tenant-columns";
import {
    addableAccounts,
    countOf,
    deleteRefusal,
    deletionLoss,
    listText,
    removalText,
    troubledTenants,
    withSummaries,
    type TenantListRow,
} from "@/components/dashboard/tenants/tenant-words";

const HOME: TenantListRow = { id: "default", name: "Platform", isHome: true, logo: null, members: 2, connections: 3, jobs: 4, createdAt: "2026-01-01T00:00:00.000Z", databases: 6, health: null };
const ACME: TenantListRow = { id: "t-acme", name: "Acme", isHome: false, logo: null, members: 1, connections: 0, jobs: 1, createdAt: "2026-10-01T00:00:00.000Z", databases: 0, health: null };

const noop = () => undefined;
const HANDLERS: TenantHandlers = { onOpen: noop, onRename: noop, onMembers: noop, onDelete: noop };
const idsOf = (row: TenantListRow, active: string | null) => tenantActions(row, active, HANDLERS).flatMap((group) => group.actions.map((action) => action.id));

describe("deleting a tenant on the Tenants page", () => {
    it("keeps the home tenant, which holds what the platform owns", () => {
        expect(deleteRefusal(HOME, "t-acme")).toMatch(/home tenant/);
        expect(idsOf(HOME, "t-acme")).not.toContain("delete");
    });

    it("keeps the tenant the viewer works in, until they open another one", () => {
        expect(deleteRefusal(ACME, "t-acme")).toMatch(/Open another one first/);
        expect(idsOf(ACME, "t-acme")).not.toContain("delete");
    });

    it("offers it for any other tenant", () => {
        expect(deleteRefusal(ACME, "default")).toBeNull();
        expect(idsOf(ACME, "default")).toContain("delete");
    });

    it("offers it for every tenant but the home tenant in All tenants, where the viewer works in none", () => {
        expect(idsOf(ACME, null)).toContain("delete");
        expect(idsOf(HOME, null)).not.toContain("delete");
    });

    it("lists the connections, jobs, keys and memberships it loses before it runs", () => {
        const loss = deletionLoss(HOME);

        expect(loss.map((line) => line.name)).toEqual([
            "3 connections",
            "4 jobs",
            "Encryption keys and saved logins",
            "Templates, API keys and the audit log",
            "2 memberships",
        ]);
        expect(loss.at(-1)?.detail).toBe("the accounts stay");
    });

    it("says what the server took with it after it ran", () => {
        expect(removalText({ name: "Acme", connections: 1, jobs: 2, runs: 140, keys: 1 })).toBe("Acme is deleted with 1 connection, 2 jobs, 140 runs and 1 encryption key.");
    });
});

describe("the menu of a tenant", () => {
    it("opens every tenant but the one the viewer works in", () => {
        expect(idsOf(ACME, "default")[0]).toBe("open");
        expect(idsOf(HOME, "default")).not.toContain("open");
    });

    it("opens every tenant from All tenants, the home tenant too", () => {
        expect(idsOf(HOME, null)[0]).toBe("open");
        expect(idsOf(ACME, null)[0]).toBe("open");
    });

    it("changes the members and the name of every tenant, the home tenant too", () => {
        expect(idsOf(HOME, "default")).toEqual(expect.arrayContaining(["members", "rename"]));
    });

    it("names the facts of a tenant in its head", () => {
        expect(tenantNote(HOME)).toBe("Home · 2 members · 4 jobs");
        expect(tenantNote(ACME)).toBe("1 member · 1 job");
    });
});

describe("Add member of a tenant", () => {
    it("offers only the accounts that do not work in the tenant yet", () => {
        const accounts = [
            { id: "u1", name: "Lena", email: "lena@example.com", platformAdmin: false },
            { id: "u2", name: "Manu", email: "manu@example.com", platformAdmin: true },
        ];
        const members = [{ id: "u2", name: "Manu", email: "manu@example.com", image: null, group: { id: "g1", name: "Admin" }, platformAdmin: true }];

        expect(addableAccounts({ accounts, members }).map((account) => account.id)).toEqual(["u1"]);
    });
});

describe("the numbers of the Tenants page", () => {
    it("gives each tenant the databases and the health of its summary, and none to a tenant without one", () => {
        const rows = withSummaries([HOME, ACME], [{ id: "t-acme", jobs: 1, databases: 4, health: "partial" }]);

        expect(rows.map((row) => [row.id, row.databases, row.health])).toEqual([["default", 0, null], ["t-acme", 4, "partial"]]);
    });

    it("names the tenants whose newest backup of a job failed apart from the ones that missed a copy", () => {
        const rows = [{ ...HOME, health: "failed" as const }, { ...ACME, health: "partial" as const }, { ...ACME, name: "Shop", health: null }];

        expect(troubledTenants(rows)).toEqual({ failed: ["Platform"], partial: ["Acme"] });
    });
});

describe("the words of the Tenants page", () => {
    it("counts in the singular and the plural", () => {
        expect(countOf(1, "job")).toBe("1 job");
        expect(countOf(0, "job")).toBe("0 jobs");
        expect(countOf(2, "entry", "entries")).toBe("2 entries");
    });

    it("joins a list with commas and a last and", () => {
        expect(listText([])).toBe("");
        expect(listText(["a"])).toBe("a");
        expect(listText(["a", "b"])).toBe("a and b");
        expect(listText(["a", "b", "c"])).toBe("a, b and c");
    });
});
