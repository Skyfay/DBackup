// @vitest-environment node
/**
 * Planning many schedules at once reads them at a fixed offset from UTC, about fifty times faster
 * than a cron in a named zone. The runs have to stay the same as those of the zone, also when the
 * window holds a change to summer or winter time, where the zone skips or repeats an hour.
 */
import { describe, expect, it } from "vitest";
import { Cron } from "croner";
import { offsetReader, runsBetween, steadyOffset, zoneReader } from "@/lib/core/cron-window";
import { readCronAtOffset } from "@/lib/core/cron";

const HOUR = 3_600_000;
const WINDOW = 48 * HOUR;

/** What a cron of the zone itself starts, one run after the other, like the scheduler. */
function inZone(expression: string, timezone: string, from: number, until: number, limit: number): number[] {
    return runsBetween(new Cron(expression, { timezone }), from, until, limit);
}

const PATTERNS = [
    "50 * * * *", "*/20 * * * *", "0 2 * * *", "30 2 * * *", "0 3 * * *", "59 1 * * *",
    "0 1 * * *", "30 1-3 * * *", "*/7 2 * * *", "0 */2 * * *", "45 2 * * 0", "0 0 * * 0", "15 9 1 * *", "0 0 * * *",
    "30 0 * * *", "0 12 * * 1-5", "10 2,3 * * *", "0 30 2 * * *",
];

/** Changes to summer and winter time in zones of a whole and of half an hour, and a window of each side. */
const WINDOWS: { timezone: string; around: string }[] = [
    { timezone: "Europe/Amsterdam", around: "2026-10-25T01:00:00Z" },
    { timezone: "Europe/Amsterdam", around: "2027-03-28T01:00:00Z" },
    { timezone: "America/New_York", around: "2026-11-01T06:00:00Z" },
    { timezone: "America/New_York", around: "2027-03-14T07:00:00Z" },
    { timezone: "Australia/Lord_Howe", around: "2026-10-03T15:30:00Z" },
    { timezone: "Australia/Lord_Howe", around: "2027-04-03T15:00:00Z" },
    { timezone: "Asia/Kolkata", around: "2026-10-25T01:00:00Z" },
    { timezone: "UTC", around: "2026-10-25T01:00:00Z" },
];

/** Starts from two days before the change to just after it, each with some milliseconds. */
function startsAround(around: string): number[] {
    const change = Date.parse(around);
    const starts: number[] = [];
    for (let offset = -50 * HOUR; offset <= 4 * HOUR; offset += 9 * HOUR + 17 * 60_000) starts.push(change + offset + 431);
    return starts;
}

describe("the runs of a schedule read in a time zone over a window", () => {
    it("are those of a cron in the zone, across a change to summer or winter time too", () => {
        let compared = 0;
        for (const { timezone, around } of WINDOWS) {
            for (const from of startsAround(around)) {
                const until = from + WINDOW;
                const read = zoneReader(timezone, from, until, "croner");
                for (const pattern of PATTERNS) {
                    expect(read(pattern, 577), `${timezone} ${pattern} from ${new Date(from).toISOString()}`).toEqual(inZone(pattern, timezone, from, until, 577));
                    compared++;
                }
            }
        }
        expect(compared).toBeGreaterThan(500);
    }, 60_000);

    it("cut at a limit like the zone, also where the limit falls on the change", () => {
        const from = Date.parse("2026-10-24T23:00:00Z");
        const until = from + WINDOW;
        const read = zoneReader("Europe/Amsterdam", from, until);
        for (const limit of [1, 2, 3, 4, 5, 10]) {
            expect(read("*/15 * * * *", limit)).toEqual(inZone("*/15 * * * *", "Europe/Amsterdam", from, until, limit));
            expect(read("30 1-3 * * *", limit)).toEqual(inZone("30 1-3 * * *", "Europe/Amsterdam", from, until, limit));
        }
    });

    it("leave out what the scheduler cannot read, and anything croner fails on", () => {
        const from = Date.parse("2026-10-24T09:17:00Z");
        const scheduler = zoneReader("Europe/Amsterdam", from, from + WINDOW, "scheduler");
        const croner = zoneReader("Europe/Amsterdam", from, from + WINDOW, "croner");

        expect(scheduler("not a cron", 10)).toBeNull();
        expect(croner("not a cron", 10)).toBeNull();
        expect(scheduler("", 10)).toBeNull();
        expect(zoneReader("Not/AZone", from, from + WINDOW)("0 3 * * *", 10)).toBeNull();
    });
});

describe("the runs of a schedule read at a fixed offset", () => {
    it("are those of the cron at that offset, the way the Timeline reads them", () => {
        const from = Date.parse("2026-10-20T08:00:00.250Z");
        const until = from + 7 * 24 * HOUR;
        const read = offsetReader(120, from, until);
        for (const pattern of PATTERNS) {
            const cron = readCronAtOffset(pattern, 120);
            expect(read(pattern, 2_017), pattern).toEqual(cron ? runsBetween(cron, from, until, 2_017) : null);
        }
    });
});

describe("the offset a zone keeps over a window", () => {
    it("is its offset while it does not change, and none across a change", () => {
        expect(steadyOffset("Europe/Zurich", Date.parse("2026-10-10T00:00:00Z"), Date.parse("2026-10-12T00:00:00Z"))).toBe(120);
        expect(steadyOffset("America/New_York", Date.parse("2026-12-10T00:00:00Z"), Date.parse("2026-12-17T00:00:00Z"))).toBe(-300);
        expect(steadyOffset("Asia/Kolkata", Date.parse("2026-10-24T00:00:00Z"), Date.parse("2026-10-26T00:00:00Z"))).toBe(330);
        expect(steadyOffset("Europe/Zurich", Date.parse("2026-10-24T00:00:00Z"), Date.parse("2026-10-26T00:00:00Z"))).toBeNull();
        // A change just after the window, which a run near its end may already fall into.
        expect(steadyOffset("Europe/Zurich", Date.parse("2026-10-23T02:00:00Z"), Date.parse("2026-10-24T23:30:00Z"))).toBeNull();
        expect(steadyOffset("Not/AZone", Date.parse("2026-10-10T00:00:00Z"), Date.parse("2026-10-12T00:00:00Z"))).toBeNull();
    });
});
