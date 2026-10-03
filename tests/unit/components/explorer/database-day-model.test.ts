import { describe, expect, it } from "vitest";
import { dayEntries, dayTarget, nearbyBackups, panelSpan, pickEntry, runsOf } from "@/components/dashboard/explorer/database-day-model";
import { dbRun, overview } from "./database-fixtures";

const dayOf = (iso: string) => iso.slice(0, 10);
const NOW = Date.parse("2026-09-27T10:00:00Z");

describe("what a day was picked for", () => {
    it("reads a database, an instance and a folded server, whose jobs plan its runs", () => {
        expect(dayTarget("s1/shop", overview)).toMatchObject({ name: "shop", serverId: "s1", database: "shop", jobIds: ["nightly"] });
        expect(dayTarget("s3", overview)).toMatchObject({ name: "Cache", database: null, jobIds: ["cache-daily"] });
        expect(dayTarget("server:s2", overview)).toMatchObject({ name: "ERP", database: null, jobIds: ["erp-nightly"] });
        expect(dayTarget("s1/gone", overview)).toBeNull();
    });

    it("asks for a month on each side of the day", () => {
        const { from, until } = panelSpan("2026-09-22");
        expect(Date.parse(from)).toBeLessThanOrEqual(Date.parse("2026-08-22T00:00:00Z"));
        expect(Date.parse(until)).toBeGreaterThanOrEqual(Date.parse("2026-10-23T00:00:00Z"));
    });
});

describe("the runs of a day", () => {
    const target = dayTarget("s1/shop", overview)!;
    const runs = runsOf(target, [
        dbRun({ id: "early", startedAt: "2026-09-22T00:02:00Z" }),
        dbRun({ id: "late", startedAt: "2026-09-22T00:15:00Z" }),
        dbRun({ id: "other-db", startedAt: "2026-09-22T01:00:00Z", databases: ["analytics"] }),
        dbRun({ id: "failed", startedAt: "2026-09-21T03:00:00Z", status: "Failed" }),
        dbRun({ id: "before", startedAt: "2026-09-20T03:00:00Z" }),
    ]);

    it("keeps the runs that backed up the database, newest first", () => {
        expect(runs.map((run) => run.id)).toEqual(["late", "early", "failed", "before"]);
    });

    it("lists the runs of the day by time with the runs still planned that day, and opens with the newest run", () => {
        const entries = dayEntries(target, runs, [{ jobId: "nightly", at: "2026-09-22T23:00:00Z" }, { jobId: "other", at: "2026-09-22T22:00:00Z" }], "2026-09-22", dayOf, Date.parse("2026-09-22T12:00:00Z"));
        expect(entries.map((entry) => entry.id)).toEqual(["early", "late", "planned:nightly:2026-09-22T23:00:00Z"]);
        expect(pickEntry(entries, null)?.id).toBe("late");
        expect(pickEntry(entries, "early")?.id).toBe("early");
    });

    it("leaves out plans that are past", () => {
        const entries = dayEntries(target, [], [{ jobId: "nightly", at: "2026-09-27T03:00:00Z" }], "2026-09-27", dayOf, NOW);
        expect(entries).toEqual([]);
    });

    it("finds the kept backups around a failed run", () => {
        const { before, after } = nearbyBackups(runs, "2026-09-21T03:00:00Z");
        expect(before?.id).toBe("before");
        expect(after?.id).toBe("early");
    });
});
