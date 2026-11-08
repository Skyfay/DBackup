import { describe, expect, it } from "vitest";
import { followMoves, matchesPattern, movedAwayAt, ownerAt, type AssignmentFact, type RuleFact } from "@/lib/tenant/database-owner";

const day = (iso: string) => new Date(`${iso}T00:00:00.000Z`);

const assignment = (overrides: Partial<AssignmentFact>): AssignmentFact => ({
    databaseName: "shop",
    tenantId: "acme",
    validFrom: day("2026-01-01"),
    validUntil: null,
    // Given when it starts, unless a test backdates it.
    createdAt: overrides.validFrom ?? day("2026-01-01"),
    ...overrides,
});

const rule = (overrides: Partial<RuleFact>): RuleFact => ({
    pattern: "shop_*",
    tenantId: "acme",
    priority: 0,
    validFrom: day("2026-01-01"),
    createdAt: day("2026-01-01"),
    ...overrides,
});

describe("who a database of a shared server belongs to", () => {
    it("belongs to nobody without an assignment or a rule", () => {
        expect(ownerAt([], [], "shop", day("2026-05-01"))).toBeNull();
    });

    it("belongs to the customer of its assignment from the day it started", () => {
        const assignments = [assignment({ validFrom: day("2026-03-01") })];
        expect(ownerAt(assignments, [], "shop", day("2026-02-28"))).toBeNull();
        expect(ownerAt(assignments, [], "shop", day("2026-03-01"))).toBe("acme");
    });

    it("keeps the backups of a reused name with the customer who had it then", () => {
        // Acme deleted its shop, later Globex created a database with the same name.
        const assignments = [
            assignment({ tenantId: "acme", validFrom: day("2026-01-01"), validUntil: day("2026-04-01") }),
            assignment({ tenantId: "globex", validFrom: day("2026-06-01") }),
        ];
        expect(ownerAt(assignments, [], "shop", day("2026-03-15"))).toBe("acme");
        expect(ownerAt(assignments, [], "shop", day("2026-05-01"))).toBeNull();
        expect(ownerAt(assignments, [], "shop", day("2026-07-01"))).toBe("globex");
    });

    it("gives a name that matches a rule to the customer of the rule", () => {
        expect(ownerAt([], [rule({})], "shop_eu", day("2026-05-01"))).toBe("acme");
        expect(ownerAt([], [rule({})], "blog", day("2026-05-01"))).toBeNull();
    });

    it("prefers an assignment of the name over every rule", () => {
        const assignments = [assignment({ databaseName: "shop_eu", tenantId: "globex" })];
        expect(ownerAt(assignments, [rule({ priority: 100 })], "shop_eu", day("2026-05-01"))).toBe("globex");
    });

    it("takes the rule with the highest priority, of equal ones the oldest", () => {
        const rules = [
            rule({ pattern: "shop_*", tenantId: "acme", priority: 1, createdAt: day("2026-01-02") }),
            rule({ pattern: "shop_e*", tenantId: "globex", priority: 5 }),
            rule({ pattern: "*_eu", tenantId: "initech", priority: 5, createdAt: day("2026-01-03") }),
        ];
        expect(ownerAt([], rules, "shop_eu", day("2026-05-01"))).toBe("globex");
        expect(ownerAt([], rules, "shop_us", day("2026-05-01"))).toBe("acme");
    });

    it("applies a rule only to backups from the day it started", () => {
        expect(ownerAt([], [rule({ validFrom: day("2026-05-01") })], "shop_eu", day("2026-04-30"))).toBeNull();
    });

    it("loses a renamed database to nobody, so it shows as unassigned", () => {
        expect(ownerAt([assignment({})], [], "shop_renamed", day("2026-05-01"))).toBeNull();
    });
});

describe("the pattern of a rule", () => {
    it("matches like a file glob, the whole name and with its case", () => {
        expect(matchesPattern("kunde1_*", "kunde1_shop")).toBe(true);
        expect(matchesPattern("kunde1_*", "kunde10_shop")).toBe(false);
        expect(matchesPattern("kunde1_*", "Kunde1_shop")).toBe(false);
        expect(matchesPattern("*", ".hidden")).toBe(true);
    });

    it("matches nothing when it is empty, and never negates", () => {
        expect(matchesPattern("  ", "shop")).toBe(false);
        expect(matchesPattern("!shop", "blog")).toBe(false);
    });
});

describe("a database that moved to another server", () => {
    const moved = [assignment({ validUntil: day("2026-04-01"), movedToSourceId: "new" })];
    const rules = [rule({ pattern: "shop", tenantId: "globex" })];

    it("belongs to nobody on the old server from the move on, even where a rule matches it", () => {
        expect(ownerAt(moved, rules, "shop", day("2026-03-31"))).toBe("acme");
        expect(movedAwayAt(moved, "shop", day("2026-04-01"))).toEqual(moved[0]);
        expect(ownerAt(moved, rules, "shop", day("2026-05-01"))).toBeNull();
    });

    it("comes back to the rules once the name is given by name again and taken back", () => {
        const again = [...moved, assignment({ tenantId: "initech", validFrom: day("2026-05-01"), validUntil: day("2026-06-01") })];
        expect(ownerAt(again, rules, "shop", day("2026-07-01"))).toBe("globex");
    });

    it("leads a backup made before the move to the database at its new place, also over several moves", () => {
        const placed = [
            { ...assignment({ validUntil: day("2026-04-01"), movedToSourceId: "b" }), sourceId: "a", movedToDatabase: "shop2" },
            { ...assignment({ databaseName: "shop2", validFrom: day("2026-04-01"), validUntil: day("2026-06-01"), movedToSourceId: "c" }), sourceId: "b", movedToDatabase: null },
            { ...assignment({ databaseName: "shop2", validFrom: day("2026-06-01") }), sourceId: "c" },
        ];
        expect(followMoves(placed, "acme", { sourceId: "a", databaseName: "shop" }, day("2026-02-01"))).toEqual({ sourceId: "c", databaseName: "shop2" });
        expect(followMoves(placed, "acme", { sourceId: "b", databaseName: "shop2" }, day("2026-05-01"))).toEqual({ sourceId: "c", databaseName: "shop2" });
        // The assignment of another customer leads nowhere.
        expect(followMoves(placed, "globex", { sourceId: "a", databaseName: "shop" }, day("2026-02-01"))).toEqual({ sourceId: "a", databaseName: "shop" });
    });
});

describe("who held a database stays settled", () => {
    it("never lets an assignment that starts in the past take backups from the customer a rule gave them to then", () => {
        const rules = [rule({ pattern: "shop_*", tenantId: "retail", createdAt: day("2026-01-01") })];
        // Given to Acme in June with a start in January.
        const backdated = [assignment({ databaseName: "shop_x", tenantId: "acme", validFrom: day("2026-01-01"), createdAt: day("2026-06-01") })];
        expect(ownerAt(backdated, rules, "shop_x", day("2026-03-01"))).toBe("retail");
        expect(ownerAt(backdated, rules, "shop_x", day("2026-06-02"))).toBe("acme");
    });

    it("lets an assignment that starts in the past reach the times nobody held the database", () => {
        const backdated = [assignment({ tenantId: "acme", validFrom: day("2026-01-01"), createdAt: day("2026-06-01") })];
        expect(ownerAt(backdated, [], "shop", day("2026-03-01"))).toBe("acme");
    });

    it("never lets a new rule of a higher priority take the backups of an older rule's time", () => {
        const rules = [
            rule({ pattern: "shop_*", tenantId: "retail", priority: 0, createdAt: day("2026-01-01") }),
            rule({ pattern: "shop_x", tenantId: "acme", priority: 10, validFrom: day("2026-01-01"), createdAt: day("2026-06-01") }),
        ];
        expect(ownerAt([], rules, "shop_x", day("2026-03-01"))).toBe("retail");
        expect(ownerAt([], rules, "shop_x", day("2026-07-01"))).toBe("acme");
    });

    it("keeps the backups of a deleted tenant with nobody instead of the rule below it", () => {
        // Acme held shop_x by name until it was deleted on June 1, a rule gives shop_* to Retail.
        const rules = [rule({ pattern: "shop_*", tenantId: "retail" })];
        const deleted = [assignment({ databaseName: "shop_x", tenantId: "deleted-acme", validFrom: day("2026-02-01"), validUntil: day("2026-06-01") })];
        expect(ownerAt(deleted, rules, "shop_x", day("2026-03-01"))).toBe("deleted-acme");
        expect(ownerAt(deleted, rules, "shop_x", day("2026-07-01"))).toBe("retail");
    });

    it("keeps a database taken back with nobody, whatever a rule matches", () => {
        const rules = [rule({ pattern: "shop_*", tenantId: "retail" })];
        const takenBack = [
            assignment({ databaseName: "shop_x", tenantId: "acme", validFrom: day("2026-02-01"), validUntil: day("2026-04-01") }),
            assignment({ databaseName: "shop_x", tenantId: null, validFrom: day("2026-04-01") }),
        ];
        expect(ownerAt(takenBack, rules, "shop_x", day("2026-03-01"))).toBe("acme");
        expect(ownerAt(takenBack, rules, "shop_x", day("2026-05-01"))).toBeNull();
    });

    it("keeps the backups of an ended rule with its customer and gives none after the end", () => {
        const rules = [
            rule({ pattern: "shop_*", tenantId: "acme", priority: 5, validUntil: day("2026-04-01") }),
            rule({ pattern: "*", tenantId: "retail", priority: 0 }),
        ];
        expect(ownerAt([], rules, "shop_x", day("2026-03-01"))).toBe("acme");
        expect(ownerAt([], rules, "shop_x", day("2026-05-01"))).toBe("retail");
    });

    it("keeps a time nobody held with the first claim that reached back over it", () => {
        // A rule made in May gave blog to Acme from January, an assignment made in June gives it to Globex from January.
        const rules = [rule({ pattern: "blog", tenantId: "acme", validFrom: day("2026-01-01"), createdAt: day("2026-05-01") })];
        const later = [assignment({ databaseName: "blog", tenantId: "globex", validFrom: day("2026-01-01"), createdAt: day("2026-06-01") })];
        expect(ownerAt(later, rules, "blog", day("2026-02-10"))).toBe("acme");
        expect(ownerAt(later, rules, "blog", day("2026-06-02"))).toBe("globex");
    });

    it("never hands the backups of a deleted tenant's backdated rule to a rule made after it", () => {
        const rules = [
            rule({ pattern: "report", tenantId: "doomed", validFrom: day("2026-01-01"), createdAt: day("2026-05-01"), validUntil: day("2026-07-01") }),
            rule({ pattern: "report", tenantId: "initech", priority: 10, validFrom: day("2026-01-01"), createdAt: day("2026-07-02") }),
        ];
        expect(ownerAt([], rules, "report", day("2026-02-10"))).toBe("doomed");
        expect(ownerAt([], rules, "report", day("2026-07-10"))).toBe("initech");
    });

    it("breaks a tie of two rules of the same priority and age by their id", () => {
        const rules = [rule({ id: "b", tenantId: "globex" }), rule({ id: "a", tenantId: "acme" })];
        expect(ownerAt([], rules, "shop_x", day("2026-03-01"))).toBe("acme");
    });
});
