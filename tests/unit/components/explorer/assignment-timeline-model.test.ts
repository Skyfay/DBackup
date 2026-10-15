import { describe, expect, it } from "vitest";
import { backupsIn, changesThisYear, daysHeld, heldBy, holdLines, holdSegments, monthsIn, percentAt, rangeOf } from "@/components/dashboard/explorer/assignment-timeline-model";
import type { AssignmentRow, DatabaseOwnerRow, RuleRow } from "@/services/tenant/database-assignments";

const NOW = new Date("2026-10-15T12:00:00Z");
const at = (iso: string) => new Date(iso).getTime();

const acme = { id: "t-acme", name: "Acme" };
const beta = { id: "t-beta", name: "Beta" };

function assignment(databaseName: string, tenant: { id: string; name: string }, validFrom: string, validUntil: string | null = null): AssignmentRow {
    return { id: `${databaseName}-${validFrom}`, databaseName, tenantId: tenant.id, tenantName: tenant.name, validFrom, validUntil, byName: "Manu", movedTo: null, movedFrom: null, onDemandPerDay: null };
}

function rule(id: string, pattern: string, tenant: { id: string; name: string }, validFrom: string, priority = 0): RuleRow {
    return { id, pattern, tenantId: tenant.id, tenantName: tenant.name, priority, validFrom, onDemandPerDay: null };
}

const database = (name: string): DatabaseOwnerRow => ({ name, sizeInBytes: null, owner: null, backups: 0 });

/**
 * wp_staging went to Beta by name in April and came back in July. acme_shop is Acme's by name since
 * February, and the rule acme_* gives every other acme_ database to Acme from October.
 */
const DATA = {
    databases: [database("acme_crm"), database("acme_shop"), database("wp_staging"), database("billing")],
    assignments: [
        assignment("wp_staging", beta, "2026-04-01T00:00:00Z", "2026-07-01T00:00:00Z"),
        assignment("acme_shop", acme, "2026-02-02T00:00:00Z"),
        assignment("old_blog", beta, "2026-03-01T00:00:00Z", "2026-05-01T00:00:00Z"),
    ],
    rules: [rule("r-acme", "acme_*", acme, "2026-10-01T00:00:00Z")],
};

describe("who held each database of a shared server", () => {
    it("draws a database given and taken back as nobody, the tenant, and nobody again", () => {
        expect(holdSegments("wp_staging", DATA, NOW)).toEqual([
            { from: null, to: at("2026-04-01T00:00:00Z"), tenantId: null, tenantName: null, via: null },
            { from: at("2026-04-01T00:00:00Z"), to: at("2026-07-01T00:00:00Z"), tenantId: beta.id, tenantName: "Beta", via: "assignment", byName: "Manu" },
            { from: at("2026-07-01T00:00:00Z"), to: null, tenantId: null, tenantName: null, via: null },
        ]);
    });

    it("keeps a database given by name with its tenant when a rule starts that matches it", () => {
        const segments = holdSegments("acme_shop", DATA, NOW);
        expect(segments.map((segment) => [segment.tenantName, segment.via])).toEqual([[null, null], ["Acme", "assignment"]]);
    });

    it("gives the databases a rule matches from its start, and nobody else's before", () => {
        const segments = holdSegments("acme_crm", DATA, NOW);
        expect(segments).toEqual([
            { from: null, to: at("2026-10-01T00:00:00Z"), tenantId: null, tenantName: null, via: null },
            { from: at("2026-10-01T00:00:00Z"), to: null, tenantId: acme.id, tenantName: "Acme", via: "rule", pattern: "acme_*" },
        ]);
    });

    it("draws a database nobody ever held as one stretch of only the server's tenant", () => {
        expect(holdSegments("billing", DATA, NOW)).toEqual([{ from: null, to: null, tenantId: null, tenantName: null, via: null }]);
    });

    it("keeps a line for a name given once that the server no longer holds, after the ones it holds", () => {
        const lines = holdLines(DATA, NOW);
        expect(lines.map((line) => [line.name, line.listed])).toEqual([["acme_crm", true], ["acme_shop", true], ["wp_staging", true], ["billing", true], ["old_blog", false]]);
        expect(lines[2].current.tenantId).toBeNull();
        expect(lines.filter((line) => heldBy(line, beta.id)).map((line) => line.name)).toEqual(["wp_staging", "old_blog"]);
    });

    it("counts the backups kept of a stretch and the days it lasted", () => {
        const [, held] = holdSegments("wp_staging", DATA, NOW);
        const dates = ["2026-03-31T02:00:00Z", "2026-04-01T02:00:00Z", "2026-06-30T02:00:00Z", "2026-07-01T02:00:00Z"];
        expect(backupsIn(dates, held)).toBe(2);
        expect(daysHeld(held, NOW)).toBe(91);
        expect(daysHeld({ from: null, to: null }, NOW)).toBeNull();
    });

    it("counts the changes of this year and names the last one", () => {
        expect(changesThisYear(holdLines(DATA, NOW), NOW)).toEqual({ count: 6, last: { at: at("2026-10-01T00:00:00Z"), name: "acme_crm" } });
    });
});

describe("the span and the axis of the timeline", () => {
    it("shows the last twelve months, or everything since the first change", () => {
        const lines = holdLines(DATA, NOW);
        const year = rangeOf("year", lines, {}, NOW);
        expect(year.end).toBe(NOW.getTime());
        expect(year.start).toBe(NOW.getTime() - 365 * 86_400_000);
        const all = rangeOf("all", lines, { acme_shop: ["2025-06-01T00:00:00Z"] }, NOW);
        expect(all.start).toBeLessThan(at("2025-06-01T00:00:00Z"));
    });

    it("places a moment on the track in percent, clamped to its ends", () => {
        const range = { start: 0, end: 1000 };
        expect(percentAt(null, range)).toBe(0);
        expect(percentAt(250, range)).toBe(25);
        expect(percentAt(5000, range)).toBe(100);
    });

    it("labels the first day of every month in the span", () => {
        const months = monthsIn({ start: at("2026-07-15T00:00:00Z"), end: at("2026-10-15T00:00:00Z") });
        expect(months).toEqual([at("2026-08-01T00:00:00Z"), at("2026-09-01T00:00:00Z"), at("2026-10-01T00:00:00Z")]);
    });
});

describe("a database that moved to another server", () => {
    it("ends with the move and gives the name to nobody here since, whatever a rule matches", () => {
        const to = { sourceId: "new", serverName: "New MySQL", databaseName: "shop2" };
        const data = {
            assignments: [{ ...assignment("shop", acme, "2026-02-01T00:00:00Z", "2026-06-01T00:00:00Z"), movedTo: to }],
            rules: [rule("r-all", "*", beta, "2026-01-01T00:00:00Z")],
        };
        const segments = holdSegments("shop", data, NOW);
        expect(segments.map((segment) => [segment.tenantName, segment.via, segment.movedTo?.serverName ?? null])).toEqual([
            [null, null, null],
            ["Beta", "rule", null],
            ["Acme", "assignment", null],
            [null, null, "New MySQL"],
        ]);
        expect(segments[3].from).toBe(at("2026-06-01T00:00:00Z"));
    });
});
