import { describe, expect, it } from "vitest";
import {
    FOLD_FROM, buildTimeline, databaseHref, emptyLogicalNames, expandRuns, foldedNames, freshnessOf, markOf, pageGroups, runsSpan, statesOf, summarize, timelineUnits,
} from "@/components/dashboard/explorer/database-model";
import type { DatabaseRun, ExplorerDatabase, ExplorerDbJob, ExplorerServer, VersionChange } from "@/services/databases/database-explorer-types";

const server = (id: string, overrides: Partial<ExplorerServer> = {}): ExplorerServer => ({
    id, name: id, adapterId: "postgres", version: "16.4", versionSince: null, previousVersion: null, status: "ONLINE", readAt: "2026-09-27T09:00:00Z", readError: null, ...overrides,
});
const database = (serverId: string, name: string, jobIds: string[] = [], size: number | null = 100): ExplorerDatabase => ({
    key: `${serverId}/${name}`, serverId, kind: "database", name, sizeInBytes: size, tableCount: 10, keyCount: null, logical: [], emptyLogical: 0, jobIds, lastBackup: null,
});
/** A Redis server as one entry, db0 and db3 holding keys of 16. */
const instance = (serverId: string, jobIds: string[] = []): ExplorerDatabase => ({
    key: serverId, serverId, kind: "instance", name: serverId, sizeInBytes: null, tableCount: null, keyCount: 1012,
    logical: [{ name: "0", keys: 1000 }, { name: "3", keys: 12 }], emptyLogical: 14, jobIds, lastBackup: null,
});
const job = (id: string, serverId: string): ExplorerDbJob => ({ id, name: id, serverId, enabled: true, databases: null, schedule: "0 3 * * *" });
const run = (id: string, startedAt: string, databases: string[], status: DatabaseRun["status"] = "Success"): DatabaseRun => ({
    id, jobId: "nightly", serverId: "s1", status, startedAt, endedAt: null, size: 10, path: null, databases, destinations: [], error: null,
});
const change = (newVersion: string, detectedAt: string, previousVersion = "16.2"): VersionChange => ({ serverId: "s1", previousVersion, newVersion, detectedAt, downgrade: false });
// The days are UTC here, so a run's day is the date of its time.
const dayOf = (iso: string) => iso.slice(0, 10);
const DAYS = ["2026-09-24", "2026-09-25", "2026-09-26", "2026-09-27", "2026-09-28"];
const NOW = Date.parse("2026-09-27T10:00:00Z");

describe("the numbers and states of the list", () => {
    it("counts what is backed up, what is in no job and what the servers do not size", () => {
        const summary = summarize({
            servers: [server("s1")],
            jobs: [],
            coverage: true,
            databases: [database("s1", "shop", ["nightly"], 300), database("s1", "analytics", [], 1200), database("s1", "hidden", [], null)],
        });
        expect(summary).toMatchObject({ databases: 3, backedUp: 1, noJob: 2, noJobSize: 1200, size: 1500, unsized: 1 });
        expect(summary.biggest?.name).toBe("analytics");
    });

    it("counts a Redis server once and its keys as no tables", () => {
        const summary = summarize({ servers: [server("s1"), server("cache", { adapterId: "redis" })], jobs: [], coverage: true, databases: [database("s1", "shop"), instance("cache")] });
        expect(summary).toMatchObject({ databases: 2, tables: 10 });
    });

    it("marks a database in no job, one never backed up yet and one whose server was not read", () => {
        expect(statesOf(database("s1", "a"), server("s1"), true)).toEqual(["no-job"]);
        expect(statesOf(database("s1", "b", ["nightly"]), server("s1", { readError: "timeout" }), true)).toEqual(["backed-up", "never", "unread"]);
        // Without the right to see jobs there is nothing to say about them.
        expect(statesOf(database("s1", "a"), server("s1"), false)).toEqual([]);
    });

    it("names the oldest list and the servers whose read failed or never happened", () => {
        const { behind, oldest } = freshnessOf([server("s1", { readAt: "2026-09-27T09:00:00Z" }), server("s2", { readAt: "2026-09-27T08:00:00Z" }), server("s3", { readAt: null })]);
        expect(oldest).toBe("2026-09-27T08:00:00Z");
        expect(behind.map((entry) => entry.id)).toEqual(["s3"]);
    });
});

describe("the timeline of the databases", () => {
    const databases = [database("s1", "shop", ["nightly"]), database("s1", "analytics")];
    const base = { databases, servers: [server("s1"), server("s2")], jobs: [job("nightly", "s1")], days: DAYS, now: NOW, dayOf };

    it("puts every run on the days of the databases it backed up, a failure beside a backup as mixed", () => {
        const [group] = buildTimeline({
            ...base,
            runs: [
                run("r1", "2026-09-25T03:00:00Z", ["shop"]),
                run("r2", "2026-09-26T03:00:00Z", ["shop"], "Failed"),
                run("r3", "2026-09-26T04:00:00Z", ["shop"]),
                run("r4", "2026-09-24T03:00:00Z", ["shop"], "Failed"),
                run("r5", "2026-09-27T03:00:00Z", ["shop"], "Cancelled"),
            ],
            planned: [],
            versionChanges: [],
        });
        const shop = group.rows.find((row) => row.database.name === "shop")!;
        expect(shop.cells.map((cell) => cell.kind)).toEqual(["failed", "ok", "mixed", "none", "none"]);
        expect(group.rows.find((row) => row.database.name === "analytics")!.cells.every((cell) => cell.kind === "none")).toBe(true);
    });

    it("plans a run only after now and only for the databases its job backs up", () => {
        const [group] = buildTimeline({
            ...base,
            runs: [],
            planned: [{ jobId: "nightly", at: "2026-09-27T03:00:00Z" }, { jobId: "nightly", at: "2026-09-28T03:00:00Z" }],
            versionChanges: [],
        });
        expect(group.rows.find((row) => row.database.name === "shop")!.cells.map((cell) => cell.kind)).toEqual(["none", "none", "none", "none", "planned"]);
        expect(group.rows.find((row) => row.database.name === "analytics")!.cells[4].kind).toBe("none");
    });

    it("puts every run of a Redis server on its one row, whatever databases the run names", () => {
        const [group] = buildTimeline({
            ...base,
            databases: [instance("s1", ["nightly"])],
            runs: [run("r1", "2026-09-25T03:00:00Z", ["0", "3"]), run("r2", "2026-09-26T03:00:00Z", [])],
            planned: [{ jobId: "nightly", at: "2026-09-28T03:00:00Z" }],
            versionChanges: [],
        });
        expect(group.rows[0].cells.map((cell) => cell.kind)).toEqual(["none", "ok", "ok", "none", "planned"]);
    });

    it("gives a server a row of every run of it, which it shows folded", () => {
        const [group] = buildTimeline({
            ...base,
            runs: [run("r1", "2026-09-25T03:00:00Z", ["shop"]), run("r2", "2026-09-26T03:00:00Z", ["analytics"], "Failed")],
            planned: [{ jobId: "nightly", at: "2026-09-28T03:00:00Z" }],
            versionChanges: [],
        });
        expect(group.cells.map((cell) => cell.kind)).toEqual(["none", "ok", "failed", "none", "planned"]);
    });

    it("leaves out a server without databases in view", () => {
        const groups = buildTimeline({ ...base, runs: [], planned: [], versionChanges: [] });
        expect(groups.map((group) => group.server.id)).toEqual(["s1"]);
    });

    it("marks new versions by the day they were read, updates on days in a row apart and several on one day together", () => {
        const [group] = buildTimeline({
            ...base,
            runs: [],
            planned: [],
            versionChanges: [change("16.3", "2026-09-25T02:00:00Z"), change("16.4", "2026-09-26T02:00:00Z", "16.3"), change("16.5", "2026-09-26T09:00:00Z", "16.4")],
        });
        expect([...group.marks.keys()]).toEqual(["2026-09-25", "2026-09-26"]);
        const { latest, earlier } = markOf(group.marks.get("2026-09-26")!);
        expect(latest.newVersion).toBe("16.5");
        expect(earlier).toBe(1);
    });
});

describe("the runs the timeline asks for", () => {
    it("asks in blocks, so a window a few days further asks for the same span", () => {
        expect(runsSpan("2026-09-10", "2026-09-27")).toEqual(runsSpan("2026-09-12", "2026-09-26"));
    });

    it("covers the whole window with a day to spare on both sides", () => {
        const { from, until } = runsSpan("2026-09-10", "2026-09-27");
        expect(Date.parse(from)).toBeLessThanOrEqual(Date.parse("2026-09-09T00:00:00Z"));
        expect(Date.parse(until)).toBeGreaterThanOrEqual(Date.parse("2026-09-29T00:00:00Z"));
    });
});

describe("the page of a database", () => {
    it("names the server and the database in the address, and only the server for an instance", () => {
        expect(databaseHref(database("s1", "shop"))).toBe("/dashboard/explorer/database?server=s1&database=shop");
        expect(databaseHref(instance("cache"), { table: "3" })).toBe("/dashboard/explorer/database?server=cache&table=3");
    });

    it("finds the empty numbered databases and names them in few words", () => {
        const empty = emptyLogicalNames(instance("cache"));
        expect(empty).toHaveLength(14);
        expect(empty).not.toContain("0");
        expect(foldedNames(empty)).toBe("db1, db2, db4 to db15");
        expect(foldedNames(["5"])).toBe("db5");
    });
});

describe("the lines and pages of the timeline", () => {
    const many = Array.from({ length: FOLD_FROM + 2 }, (_, index) => database("big", `tenant_${index}`, ["tenants"]));
    const groups = buildTimeline({
        databases: [database("s1", "shop", ["nightly"]), database("s1", "billing", ["nightly"]), ...many],
        servers: [server("s1"), server("big")],
        jobs: [job("nightly", "s1"), job("tenants", "big")],
        runs: [],
        planned: [],
        versionChanges: [],
        days: DAYS,
        now: NOW,
        dayOf,
    });
    const byDefault = (group: (typeof groups)[number]) => group.rows.length > FOLD_FROM;

    it("folds a server with many databases into one line, which a page counts once", () => {
        const units = timelineUnits(groups, byDefault);
        expect(units.map((unit) => unit.kind)).toEqual(["row", "row", "folded"]);
    });

    it("cuts pages by lines, and shows the head of a server cut by a page on both pages", () => {
        const units = timelineUnits(groups, () => false);
        const first = pageGroups(units, 0, 10);
        const second = pageGroups(units, 1, 10);
        expect(first.map((part) => [part.group.server.id, part.rows.length])).toEqual([["s1", 2], ["big", 8]]);
        expect(second.map((part) => [part.group.server.id, part.rows.length])).toEqual([["big", 4]]);
    });
});

describe("the runs of the API", () => {
    it("looks up the databases of each run in the lists the API sends once", () => {
        const expanded = expandRuns({
            runs: [{ ...run("r1", "2026-09-25T03:00:00Z", []), databases: 0 }, { ...run("r2", "2026-09-26T03:00:00Z", []), databases: 0 }],
            names: [["shop", "billing"]],
            versionChanges: [],
            planned: [],
        });
        expect(expanded.runs.map((entry) => entry.databases)).toEqual([["shop", "billing"], ["shop", "billing"]]);
    });
});
