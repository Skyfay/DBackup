import { describe, expect, it } from "vitest";
import {
    NOBODY,
    changeText,
    dayAllowed,
    dayStart,
    endedAssignments,
    giveChanges,
    heldAfter,
    holdingOf,
    holdingText,
    howOf,
    matchesQuick,
    movedText,
    onDemandText,
    ownerKey,
    quickCounts,
    ruleFor,
    ruleGives,
    ruleLosses,
    rulePreview,
    startLimit,
    startOf,
} from "@/components/dashboard/explorer/assignment-model";
import type { AssignmentRow, DatabaseOwnerRow, RuleRow, SourceAssignments } from "@/services/tenant/database-assignments";

const NOW = new Date("2026-10-15T12:00:00Z");

const acme = { id: "t-acme", name: "Acme" };
const beta = { id: "t-beta", name: "Beta" };

function rule(id: string, pattern: string, tenant: { id: string; name: string }, priority = 0, validFrom = "2026-10-01T00:00:00Z"): RuleRow {
    return { id, pattern, tenantId: tenant.id, tenantName: tenant.name, priority, validFrom, onDemandPerDay: null };
}

function assignment(id: string, databaseName: string, tenant: { id: string; name: string }, validFrom: string, validUntil: string | null = null, byName: string | null = "Manu"): AssignmentRow {
    return { id, databaseName, tenantId: tenant.id, tenantName: tenant.name, validFrom, validUntil, byName, movedTo: null, movedFrom: null, onDemandPerDay: null };
}

function database(name: string, owner: DatabaseOwnerRow["owner"] = null): DatabaseOwnerRow {
    return { name, sizeInBytes: 1024, owner, backups: 3 };
}

const byRule = (tenant: { id: string; name: string }, since = "2026-10-01T00:00:00Z") => ({ tenantId: tenant.id, tenantName: tenant.name, via: "rule" as const, since, onDemandPerDay: null });
const byName = (tenant: { id: string; name: string }, since = "2026-10-05T00:00:00Z") => ({ tenantId: tenant.id, tenantName: tenant.name, via: "assignment" as const, since, onDemandPerDay: null });

/** A server with a shop rule for Acme, a wider one for Beta and one database Beta holds by name. */
function server(): SourceAssignments {
    const rules = [rule("r-shop", "shop_*", acme, 10), rule("r-all", "*", beta, 0)];
    return {
        databases: [
            database("shop_a", byRule(acme)),
            database("shop_b", byName(beta)),
            database("crm", byRule(beta)),
        ],
        assignments: [
            assignment("a-2", "shop_b", beta, "2026-10-05T00:00:00Z"),
            assignment("a-1", "shop_b", acme, "2026-09-01T00:00:00Z", "2026-10-05T00:00:00Z"),
        ],
        rules,
        customers: [acme, beta],
        backupDates: {},
    };
}

describe("who a database of a shared server belongs to", () => {
    it("files a database nobody else has under Nobody else", () => {
        expect(ownerKey(database("internal"))).toBe(NOBODY);
        expect(ownerKey(database("shop_a", byRule(acme)))).toBe("t-acme");
    });

    it("names the rule that gives a database, the highest priority first", () => {
        const data = server();
        expect(ruleFor(data.rules, "shop_a", NOW)?.id).toBe("r-shop");
        expect(ruleFor(data.rules, "crm", NOW)?.id).toBe("r-all");
    });

    it("says how a tenant holds a database: by name and by whom, by a rule, taken back, or never given", () => {
        const data = server();
        expect(howOf(data.databases[0], data, NOW)).toEqual({ kind: "rule", pattern: "shop_*", since: "2026-10-01T00:00:00Z", onDemandPerDay: null });
        expect(howOf(data.databases[1], data, NOW)).toEqual({ kind: "assignment", since: "2026-10-05T00:00:00Z", byName: "Manu", from: null, onDemandPerDay: null });
        const taken = { ...data, assignments: [assignment("a-9", "logs", acme, "2026-09-01T00:00:00Z", "2026-10-10T00:00:00Z")] };
        expect(howOf(database("logs"), taken, NOW)).toEqual({ kind: "taken-back", at: "2026-10-10T00:00:00Z", before: "Acme" });
        expect(howOf(database("internal"), data, NOW)).toEqual({ kind: "nobody" });
    });

    it("tells where a database moved to, with the tenant that took it along", () => {
        const data = server();
        const to = { sourceId: "new", serverName: "New MySQL", databaseName: "shop2" };
        const moved = { ...data, assignments: [{ ...assignment("a-9", "shop", acme, "2026-09-01T00:00:00Z", "2026-10-10T00:00:00Z"), movedTo: to }] };
        expect(howOf(database("shop"), moved, NOW)).toEqual({ kind: "moved", at: "2026-10-10T00:00:00Z", to, before: "Acme" });
        expect(movedText(to, "shop")).toBe("to New MySQL as shop2");
        expect(movedText({ ...to, databaseName: "shop" }, "shop")).toBe("to New MySQL");
    });

    it("says how many backups on demand a tenant may start, and nothing while it may start none", () => {
        expect(onDemandText(3)).toBe("Backups on demand, 3 a day");
        expect(onDemandText(null)).toBeNull();
    });

    it("lets the older of two rules of equal priority win, like the service orders them", () => {
        const rules = [rule("r-old", "a*", acme, 5), rule("r-new", "*", beta, 5)];
        expect(ruleFor(rules, "app", NOW)?.id).toBe("r-old");
    });

    it("ignores a rule that has not started yet", () => {
        expect(ruleFor([rule("r-later", "*", acme, 0, "2026-11-01T00:00:00Z")], "app", NOW)).toBeNull();
    });

    it("counts the databases given to a tenant and the ones only the server's tenant sees, for the quick filters", () => {
        const databases = [...server().databases, database("internal")];
        expect(quickCounts(databases)).toEqual({ all: 4, given: 3, nobody: 1 });
        expect(databases.filter((row) => matchesQuick(row, "nobody")).map((row) => row.name)).toEqual(["internal"]);
    });

    it("says in the picker what a tenant holds of the server now and held before", () => {
        const data = server();
        const range = (from: string, until: string) => `${from.slice(5, 10)} to ${until.slice(5, 10)}`;
        expect(holdingText(holdingOf(beta.id, data), range)).toBe("Has crm and shop_b of this server");
        // Acme held shop_b by name until Beta got it, and has shop_a through a rule now.
        expect(holdingText(holdingOf(acme.id, data), range)).toBe("Has shop_a of this server · held shop_b 09-01 to 10-05");
        expect(holdingText(holdingOf("t-new", data), range)).toBe("No database of this server yet");
    });
});

describe("how early a new assignment may start", () => {
    it("starts now while someone holds the name, who keeps the backups of before", () => {
        expect(startLimit(server().assignments, "shop_b", NOW)).toEqual({ kind: "current", from: NOW, holder: "Beta" });
    });

    it("never starts before the time of the one before ended", () => {
        const assignments = [assignment("a-1", "logs", acme, "2026-09-01T00:00:00Z", "2026-10-10T08:00:00Z"), assignment("a-0", "logs", beta, "2026-08-01T00:00:00Z", "2026-09-01T00:00:00Z")];
        expect(startLimit(assignments, "logs", NOW)).toEqual({ kind: "previous", from: new Date("2026-10-10T08:00:00Z"), holder: "Acme" });
    });

    it("has no limit for a name nobody had", () => {
        expect(startLimit(server().assignments, "crm", NOW)).toEqual({ kind: "none" });
    });

    it("reads a picked calendar day in the time zone of the viewer", () => {
        const day = new Date(2026, 9, 3);
        expect(dayStart(day, "UTC").toISOString()).toBe("2026-10-03T00:00:00.000Z");
        expect(dayStart(day, "Europe/Zurich").toISOString()).toBe("2026-10-02T22:00:00.000Z");
    });

    it("offers today and earlier days, never a later one or one before the limit", () => {
        expect(dayAllowed(new Date(2026, 9, 15), "UTC", NOW)).toBe(true);
        expect(dayAllowed(new Date(2026, 9, 16), "UTC", NOW)).toBe(false);
        expect(dayAllowed(new Date(2026, 8, 1), "UTC", NOW)).toBe(true);
        const limit = new Date("2026-10-10T08:00:00Z");
        // The day the limit falls on still works, the start moves to the limit.
        expect(dayAllowed(new Date(2026, 9, 10), "UTC", NOW, limit)).toBe(true);
        expect(dayAllowed(new Date(2026, 9, 9), "UTC", NOW, limit)).toBe(false);
    });

    it("starts at the picked day, at the limit when the day begins before it, and now without a day", () => {
        expect(startOf(null, "UTC", NOW)).toBeUndefined();
        expect(startOf(new Date(2026, 9, 3), "UTC", NOW)?.toISOString()).toBe("2026-10-03T00:00:00.000Z");
        const limit = new Date("2026-10-10T08:00:00Z");
        expect(startOf(new Date(2026, 9, 10), "UTC", NOW, limit)).toEqual(limit);
        // Someone holds it by name, so the next one starts now whatever day was picked.
        expect(startOf(new Date(2026, 9, 3), "UTC", NOW, NOW)).toBeUndefined();
        // Today starts at midnight, which lies before now.
        expect(startOf(new Date(2026, 9, 15), "UTC", NOW)?.toISOString()).toBe("2026-10-15T00:00:00.000Z");
    });
});

describe("what a rule gives and what removing it takes", () => {
    it("lists the databases a rule gives now and where each goes once it is gone", () => {
        const data = server();
        expect(ruleLosses(data, "r-shop", NOW)).toEqual([{ name: "shop_a", next: { tenantName: "Beta", pattern: "*" } }]);
        expect(ruleLosses(data, "r-all", NOW)).toEqual([{ name: "crm", next: null }]);
    });

    it("leaves out a database assigned by name, which stays where it is", () => {
        expect(ruleLosses(server(), "r-shop", NOW).map((loss) => loss.name)).not.toContain("shop_b");
    });

    it("names the databases each rule gives now", () => {
        expect(ruleGives(server(), NOW)).toEqual(new Map([["r-shop", ["shop_a"]], ["r-all", ["crm"]]]));
    });

    it("shows which databases a new rule gets and which stay where they are", () => {
        const data = server();
        const effects = rulePreview(data, { pattern: "*", tenantId: acme.id, priority: 20 }, NOW);
        expect(effects).toEqual([
            { name: "shop_a", outcome: "gains" },
            { name: "shop_b", outcome: "keeps", reason: "stays with Beta, assigned by name" },
            { name: "crm", outcome: "gains" },
        ]);
    });

    it("lets an older rule of the same priority keep its databases", () => {
        const effects = rulePreview(server(), { pattern: "crm", tenantId: acme.id, priority: 0 }, NOW);
        expect(effects).toEqual([{ name: "crm", outcome: "keeps", reason: "stays with Beta, rule * ranks higher" }]);
    });

    it("says when the tenant has a database through another rule already", () => {
        const effects = rulePreview(server(), { pattern: "shop_a", tenantId: acme.id, priority: 0 }, NOW);
        expect(effects).toEqual([{ name: "shop_a", outcome: "keeps", reason: "Acme has it already, rule shop_*" }]);
    });

    it("matches nothing for an empty pattern", () => {
        expect(rulePreview(server(), { pattern: "  ", tenantId: acme.id, priority: 0 }, NOW)).toEqual([]);
    });
});

describe("giving several databases to one tenant at once", () => {
    it("gives every picked database by name from the same start, and leaves the ones it holds by name already", () => {
        const data = server();
        const start = new Date("2026-10-10T00:00:00Z");
        expect(giveChanges(data.databases, beta.id, start)).toEqual({
            changes: [{ databaseName: "shop_a", tenantId: beta.id, validFrom: start }, { databaseName: "crm", tenantId: beta.id, validFrom: start }],
            unchanged: ["shop_b"],
        });
        expect(giveChanges([data.databases[0]], acme.id, undefined).changes).toEqual([{ databaseName: "shop_a", tenantId: acme.id }]);
    });

    it("counts what the tenant holds once they are given", () => {
        const data = server();
        expect(heldAfter([...data.databases, database("internal")], ["internal"], acme.id)).toBe(2);
    });
});

describe("the history and the words of a change", () => {
    it("keeps the ended assignments, the latest end first", () => {
        const assignments = [
            assignment("a-3", "x", acme, "2026-10-01T00:00:00Z"),
            assignment("a-2", "y", beta, "2026-08-01T00:00:00Z", "2026-09-01T00:00:00Z"),
            assignment("a-1", "x", beta, "2026-07-01T00:00:00Z", "2026-10-01T00:00:00Z"),
        ];
        expect(endedAssignments(assignments).map((row) => row.id)).toEqual(["a-1", "a-2"]);
    });

    it("says who a database belongs to after a change", () => {
        expect(changeText("shop_a", "Acme")).toBe("shop_a belongs to Acme now");
        expect(changeText("shop_a", null)).toBe("shop_a belongs to nobody else now");
    });
});
