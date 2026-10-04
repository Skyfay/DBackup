import { describe, expect, it } from "vitest";
import { markFulls, missedDays, readPolicy, runsBetween, simulateRetention } from "@/services/storage/explorer-plan";

const at = (iso: string) => Date.parse(iso);
const DAY = 86_400_000;

describe("the plan of the timeline", () => {
    it("lists the runs a schedule plans between two moments, in the time zone of the scheduler", () => {
        const { times, truncated } = runsBetween("0 3 * * *", "Europe/Zurich", at("2026-09-25T12:00:00Z"), at("2026-09-28T12:00:00Z"));

        // 03:00 in Zurich is 01:00 UTC in summer time.
        expect(times.map((time) => new Date(time).toISOString())).toEqual(["2026-09-26T01:00:00.000Z", "2026-09-27T01:00:00.000Z", "2026-09-28T01:00:00.000Z"]);
        expect(truncated).toBe(false);
        expect(runsBetween("*/5 * * * *", "UTC", at("2026-09-25T00:00:00Z"), at("2026-09-26T00:00:00Z"), 10)).toMatchObject({ truncated: true });
        expect(runsBetween("not a schedule", "UTC", 0, DAY).times).toEqual([]);
    });

    it("calls a day missed only when none of its runs started, by the schedule or by hand", () => {
        const started = [at("2026-09-21T03:02:00Z"), at("2026-09-23T10:00:00Z"), at("2026-09-24T03:00:30Z")];
        const missed = missedDays("0 3 * * *", "UTC", at("2026-09-20T00:00:00Z"), at("2026-09-25T12:00:00Z"), started);

        expect(missed).toEqual([
            { at: "2026-09-20T03:00:00.000Z", runs: 1 },
            { at: "2026-09-22T03:00:00.000Z", runs: 1 },
            { at: "2026-09-25T03:00:00.000Z", runs: 1 },
        ]);
    });

    it("leaves a run that came due a moment ago to the queue", () => {
        expect(missedDays("0 3 * * *", "UTC", at("2026-09-25T00:00:00Z"), at("2026-09-25T03:10:00Z"), [])).toEqual([]);
    });

    it("counts the runs of a day that did not start, and looks only from the moment the job changed", () => {
        expect(missedDays("0 * * * *", "UTC", at("2026-09-24T00:00:00Z"), at("2026-09-25T00:00:00Z"), [])).toEqual([{ at: "2026-09-24T00:00:00.000Z", runs: 24 }]);
        expect(missedDays("0 * * * *", "UTC", at("2026-09-24T18:30:00Z"), at("2026-09-25T00:00:00Z"), [])).toEqual([{ at: "2026-09-24T19:00:00.000Z", runs: 5 }]);
    });

    it("starts a new chain once the running one is as old as the job allows, or when there is none", () => {
        const start = at("2026-09-20T00:30:00Z");
        const runs = [1, 2, 3, 4, 5, 6, 7, 8].map((days) => start + days * DAY);

        expect(markFulls(runs, start, 7)).toEqual([false, false, false, false, false, false, true, false]);
        expect(markFulls(runs.slice(0, 2), null, 7)).toEqual([true, false]);
    });

    it("works out what a policy that keeps the last ones removes after each planned run", () => {
        const files = ["2026-09-22", "2026-09-23", "2026-09-24"].map((date, index) => ({
            name: `b${index}.tar`,
            path: `Shop/b${index}.tar`,
            size: 1,
            lastModified: new Date(`${date}T03:00:00Z`),
        }));
        const runs = [{ at: at("2026-09-26T03:00:00Z") }, { at: at("2026-09-27T03:00:00Z") }];

        expect(simulateRetention(files, runs, { mode: "SIMPLE", simple: { keepCount: 3 } }, "UTC", false)).toEqual([
            { count: 1, oldest: at("2026-09-22T03:00:00Z") },
            { count: 1, oldest: at("2026-09-23T03:00:00Z") },
        ]);
        expect(simulateRetention(files, runs, { mode: "NONE" }, "UTC", false)).toEqual([null, null]);
    });

    it("tells what a day removes on its last run, so an hourly job is judged once a day", () => {
        const files = ["2026-09-22", "2026-09-23", "2026-09-24"].map((date, index) => ({
            name: `b${index}.tar`,
            path: `Crm/b${index}.tar`,
            size: 1,
            lastModified: new Date(`${date}T03:00:00Z`),
        }));
        const runs = [{ at: at("2026-09-26T01:00:00Z") }, { at: at("2026-09-26T02:00:00Z") }];

        expect(simulateRetention(files, runs, { mode: "SIMPLE", simple: { keepCount: 3 } }, "UTC", false))
            .toEqual([null, { count: 2, oldest: at("2026-09-22T03:00:00Z") }]);
    });

    it("keeps a locked backup and removes a chain only as a whole", () => {
        const file = (name: string, date: string, extra: object = {}) => ({ name, path: `Media/${name}`, size: 1, lastModified: new Date(`${date}T00:30:00Z`), ...extra });
        const files = [
            file("locked.tar", "2026-09-01", { locked: true }),
            file("full-a.tar", "2026-09-20", { chainId: "a" }),
            file("inc-a1.tar", "2026-09-21", { chainId: "a" }),
            file("full-b.tar", "2026-09-22", { chainId: "b" }),
        ];

        // A new chain and the newest one stay with two to keep, so the older chain goes with both of its backups.
        expect(simulateRetention(files, [{ at: at("2026-09-26T00:30:00Z"), full: true }], { mode: "SIMPLE", simple: { keepCount: 2 } }, "UTC", true))
            .toEqual([{ count: 2, oldest: at("2026-09-20T00:30:00Z") }]);
    });

    it("reads a stored policy the way the runner does", () => {
        expect(readPolicy("{}")).toBeNull();
        expect(readPolicy(null)).toBeNull();
        expect(readPolicy("not json")).toEqual({ mode: "NONE" });
        expect(readPolicy('{"mode":"SIMPLE","simple":{"keepCount":5}}')).toEqual({ mode: "SIMPLE", simple: { keepCount: 5 } });
    });
});
