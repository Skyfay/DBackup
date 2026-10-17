import { describe, expect, it } from "vitest";
import { tenantActions, tenantNote, type TenantHandlers } from "@/components/dashboard/tenants/tenant-columns";
import {
    addableAccounts,
    allowancesPatch,
    countOf,
    deleteRefusal,
    deletionLoss,
    heldBack,
    listText,
    providedSentence,
    removalText,
    sharedParts,
    troubledTenants,
    withSummaries,
    type TenantListRow,
} from "@/components/dashboard/tenants/tenant-words";
import { ALL_ALLOWED } from "@/lib/tenant/allowances";

const HOME: TenantListRow = {
    id: "default", name: "Platform", isHome: true, sharesWithCustomers: true, logo: null, members: 2, connections: 3, jobs: 4, createdAt: "2026-01-01T00:00:00.000Z", databases: 6, health: null,
    allowances: ALL_ALLOWED, provided: { destinations: 0, channels: 0 }, gives: { destinations: 2, channels: 1 }, onDemand: { perDay: null, own: 0 },
};
const ACME: TenantListRow = {
    id: "t-acme", name: "Acme", isHome: false, sharesWithCustomers: false, logo: null, members: 1, connections: 0, jobs: 1, createdAt: "2026-10-01T00:00:00.000Z", databases: 0, health: null,
    allowances: ALL_ALLOWED, provided: { destinations: 2, channels: 2 }, gives: { destinations: 0, channels: 0 }, onDemand: { perDay: null, own: 0 },
};

const noop = () => undefined;
const HANDLERS: TenantHandlers = { onOpen: noop, onEdit: noop, onDelete: noop, canManage: true };
const actionsOf = (row: TenantListRow, active: string | null, handlers = HANDLERS) => tenantActions(row, active, handlers).flatMap((group) => group.actions);
const idsOf = (row: TenantListRow, active: string | null) => actionsOf(row, active).map((action) => action.id);

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

    it("changes every tenant through Edit, the home tenant too, and only shows it to someone who may only see the tenants", () => {
        expect(idsOf(HOME, "default")).toEqual(["edit"]);
        expect(idsOf(ACME, "default")).toEqual(["open", "edit", "delete"]);
        expect(actionsOf(ACME, "default").find((action) => action.id === "edit")).toMatchObject({ label: "Edit", tone: "edit" });
        expect(idsOf(ACME, "default").some((id) => ["members", "rename", "sharing", "allowances", "on-demand"].includes(id))).toBe(false);

        const viewer: TenantHandlers = { onOpen: noop, onEdit: noop, canManage: false };
        expect(actionsOf(ACME, "default", viewer).map((action) => action.id)).toEqual(["open", "view"]);
    });

    it("names the facts of a tenant in its head", () => {
        expect(tenantNote(HOME)).toBe("Home · Shares with customers · 2 members · 4 jobs");
        expect(tenantNote(ACME)).toBe("1 member · 1 job");
    });
});

describe("what a tenant may add itself", () => {
    it("names nothing for a tenant that adds everything, and for the home tenant whatever it holds", () => {
        expect(heldBack(ACME)).toBeNull();
        expect(heldBack({ ...HOME, allowances: { ...ALL_ALLOWED, destinations: false } })).toBeNull();
    });

    it("names what a customer does not add, in short words on its tag and in full on hover", () => {
        expect(heldBack({ ...ACME, allowances: { ...ALL_ALLOWED, destinations: false } })).toEqual({ tag: "No own destinations", sentence: "Adds no destinations of its own." });
        expect(heldBack({ ...ACME, allowances: { ...ALL_ALLOWED, destinations: false, channels: false } })).toEqual({
            tag: "No own destinations, channels",
            sentence: "Adds no destinations or notification channels of its own.",
        });
    });

    it("says it adds nothing itself once every kind is off", () => {
        const none = { databases: false, directorySources: false, destinations: false, channels: false, apiKeys: false };

        expect(heldBack({ ...ACME, allowances: none })?.tag).toBe("Adds nothing itself");
    });

    it("saves only the kinds whose switch changed", () => {
        expect(allowancesPatch(ALL_ALLOWED, ALL_ALLOWED)).toEqual({});
        expect(allowancesPatch({ ...ALL_ALLOWED, channels: false }, { ...ALL_ALLOWED, destinations: false })).toEqual({ destinations: false, channels: true });
    });
});

describe("what other tenants share with a tenant", () => {
    it("counts the destinations and channels, leaving out a kind with none", () => {
        expect(sharedParts({ destinations: 2, channels: 1 })).toEqual(["2 destinations", "1 channel"]);
        expect(sharedParts({ destinations: 0, channels: 3 })).toEqual(["3 channels"]);
        expect(sharedParts({ destinations: 0, channels: 0 })).toEqual([]);
    });

    it("says it in a sentence in the dialog of what it may add, or that nothing is shared yet", () => {
        expect(providedSentence(ACME.provided)).toBe("2 destinations and 2 channels of other tenants");
        expect(providedSentence({ destinations: 1, channels: 0 })).toBe("1 destination of other tenants");
        expect(providedSentence(HOME.provided)).toBe("Nothing yet");
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
