import { describe, expect, it } from "vitest";
import { chainSize, isLongChain, shorterChains, upcomingRuns } from "@/components/dashboard/jobs/incremental-chain";

// A Thursday, so the next run of a daily job is on Friday the 25th.
const THURSDAY = new Date("2026-09-24T10:00:00.000Z");
// A Sunday, so a job on weekdays starts its first chain on Monday.
const SUNDAY = new Date("2026-09-27T10:00:00.000Z");

const runsOf = (schedule: string, from = THURSDAY, timezone = "UTC") => upcomingRuns(schedule, timezone, from);

describe("chains of an incremental job", () => {
    it("makes chains of 7 backups for a daily job with a full backup every 7 days", () => {
        expect(chainSize(runsOf("0 3 * * *"), 7)).toEqual({ first: 7, fewest: 7, most: 7, open: false });
    });

    it("makes chains of 168 backups for an hourly job, and offers a full backup every day with chains of 24", () => {
        const runs = runsOf("0 * * * *");

        const size = chainSize(runs, 7);
        expect(size).toEqual({ first: 168, fewest: 168, most: 168, open: false });
        expect(isLongChain(size!)).toBe(true);
        expect(shorterChains(runs, 7)).toEqual({ days: 1, size: { first: 24, fewest: 24, most: 24, open: false } });
    });

    it("offers the most days whose chains are not long, like 3 for a job every 4 hours", () => {
        expect(shorterChains(runsOf("0 */4 * * *"), 7)).toMatchObject({ days: 3, size: { most: 18 } });
    });

    it("lets a month of daily backups be one chain, and offers 30 days to a job with more", () => {
        const runs = runsOf("0 3 * * *");

        expect(isLongChain(chainSize(runs, 30)!)).toBe(false);
        expect(shorterChains(runs, 30)).toBeNull();
        expect(shorterChains(runs, 45)).toMatchObject({ days: 30, size: { most: 30 } });
    });

    it("tells chains of different lengths apart on a schedule of weekdays", () => {
        // Monday to Wednesday, then Thursday and Friday, since Monday is 4 days after Thursday.
        expect(chainSize(runsOf("0 3 * * 1-5", SUNDAY), 3)).toEqual({ first: 3, fewest: 2, most: 3, open: false });
    });

    it("makes every backup a full one when the runs are as far apart as the full backups", () => {
        expect(chainSize(runsOf("0 3 * * 0"), 7)).toEqual({ first: 1, fewest: 1, most: 1, open: false });
    });

    it("keeps a chain at 7 daily backups over the change to daylight saving time", () => {
        // Clocks in Zurich go forward on 28 March 2027, which makes that week an hour short.
        const runs = runsOf("0 3 * * *", new Date("2027-03-24T12:00:00.000Z"), "Europe/Zurich");

        expect(chainSize(runs, 7)).toMatchObject({ first: 7, most: 7 });
    });

    it("counts a chain that goes past the runs worked out as at least that many", () => {
        const runs = runsOf("*/5 * * * *");

        expect(chainSize(runs, 7)).toEqual({ first: 1000, fewest: 1000, most: 1000, open: true });
        // Even a full backup every day leaves 288 backups in a chain, but it is still the shortest.
        expect(shorterChains(runs, 7)).toMatchObject({ days: 1, size: { most: 288, open: false } });
    });

    it("offers nothing shorter to a job that already makes a full backup every day, or runs too often to count", () => {
        expect(shorterChains(runsOf("*/5 * * * *"), 1)).toBeNull();
        expect(shorterChains(runsOf("* * * * *"), 7)).toBeNull();
    });

    it("has no chains for a schedule the scheduler cannot read", () => {
        expect(runsOf("not a schedule")).toEqual([]);
        expect(chainSize([], 7)).toBeNull();
    });
});
