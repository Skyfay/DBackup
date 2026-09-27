import { describe, expect, it } from "vitest";
import { matchesQuick, serverHref, serverRows, serversSummary, timeOn } from "@/components/dashboard/explorer/server-model";
import { overview, serversOverview } from "./database-fixtures";

const rows = serverRows(overview, serversOverview);
const row = (id: string) => rows.find((entry) => entry.server.id === id)!;

describe("serverRows", () => {
    it("gives every server its summary, its databases and how many of them a job backs up", () => {
        expect(row("s1").summary?.address).toBe("db.internal:5432");
        expect(row("s1").databases.map((database) => database.name)).toEqual(["shop", "analytics"]);
        expect(row("s1").covered).toBe(1);
        expect(row("s1").jobIds).toEqual(["nightly"]);
    });

    it("adds up the sizes the server tells and has none when it tells no size", () => {
        expect(row("s1").size).toBe(14_500_000_000);
        expect(row("s2").size).toBeNull();
    });

    it("keeps a Redis server as one entry of keys", () => {
        expect(row("s3").instance?.keyCount).toBe(184_344);
        expect(row("s1").instance).toBeNull();
    });

    it("has no summary while the servers call has not answered", () => {
        expect(serverRows(overview, null).every((entry) => entry.summary === null)).toBe(true);
    });
});

describe("matchesQuick", () => {
    it("keeps behind the servers too old for a newer backup of their engine", () => {
        expect(rows.filter((entry) => matchesQuick(entry, "behind")).map((entry) => entry.server.id)).toEqual(["s2"]);
    });

    it("keeps as not all backed up the servers with a database in no job", () => {
        expect(rows.filter((entry) => matchesQuick(entry, "uncovered")).map((entry) => entry.server.id)).toEqual(["s1"]);
        expect(rows.filter((entry) => matchesQuick(entry, "all"))).toHaveLength(3);
    });
});

describe("serversSummary", () => {
    it("counts the servers, engines, databases, the ones in a job, the servers behind and the ones online", () => {
        const summary = serversSummary(rows);
        expect(summary).toMatchObject({ servers: 3, engines: 3, databases: 4, covered: 3, online: 3 });
        expect(summary.behind.map((entry) => entry.server.name)).toEqual(["ERP"]);
    });
});

describe("serverHref", () => {
    it("opens the page of a server", () => {
        expect(serverHref("a b")).toBe("/dashboard/explorer/server?server=a%20b");
    });
});

describe("timeOn", () => {
    const since = "2026-01-01T00:00:00.000Z";
    const after = (days: number) => new Date(Date.parse(since) + days * 86_400_000).toISOString();

    it("says how long a version ran in the unit that reads best", () => {
        expect(timeOn(since, after(0.5), 0)).toBe("less than a day");
        expect(timeOn(since, after(1), 0)).toBe("1 day");
        expect(timeOn(since, after(10), 0)).toBe("10 days");
        expect(timeOn(since, after(198), 0)).toBe("6.5 months");
        expect(timeOn(since, after(767), 0)).toBe("2.1 years");
    });

    it("counts the current version up to now and knows nothing without a start", () => {
        expect(timeOn(since, null, Date.parse(after(3)))).toBe("3 days");
        expect(timeOn(null, null, Date.now())).toBeNull();
    });
});
