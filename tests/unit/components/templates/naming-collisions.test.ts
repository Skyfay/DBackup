import { describe, expect, it } from "vitest";
import { firstNameClash, hasDateOrTime, hasTimeOfDay } from "@/components/templates/naming-collisions";

const FROM = new Date("2026-09-24T00:30:00.000Z");
const STANDARD = "{job_name}_yyyy-MM-dd_HH-mm-ss";
const DATE_ONLY = "{job_name}_yyyy-MM-dd";

describe("file names that two runs of a schedule share", () => {
    it("finds the first two runs of a day when the name has no time", () => {
        expect(firstNameClash(DATE_ONLY, "0 */6 * * *", "UTC", FROM)).toEqual({
            first: new Date("2026-09-24T06:00:00.000Z"),
            second: new Date("2026-09-24T12:00:00.000Z"),
        });
    });

    it("finds runs within the same hour when the name stops at the hour", () => {
        expect(firstNameClash("{job_name}_yyyy-MM-dd_HH", "*/30 * * * *", "UTC", FROM)).toEqual({
            first: new Date("2026-09-24T01:00:00.000Z"),
            second: new Date("2026-09-24T01:30:00.000Z"),
        });
    });

    it("finds a name that comes back a day later when it has the time but no date", () => {
        expect(firstNameClash("{job_name}_HH-mm", "0 3 * * *", "UTC", FROM)).toEqual({
            first: new Date("2026-09-24T03:00:00.000Z"),
            second: new Date("2026-09-25T03:00:00.000Z"),
        });
    });

    it("finds nothing when every run lands on its own day, or the name goes down to the second", () => {
        expect(firstNameClash(DATE_ONLY, "0 3 * * *", "UTC", FROM)).toBeNull();
        expect(firstNameClash(STANDARD, "* * * * *", "UTC", FROM)).toBeNull();
    });

    it("reads the day in the time zone of the scheduler, like the runner names the file", () => {
        // 19:00 and 21:00 in New York fall on two days in UTC, but on one day where the scheduler runs.
        expect(firstNameClash(DATE_ONLY, "0 19,21 * * *", "America/New_York", FROM)).toEqual({
            first: new Date("2026-09-24T23:00:00.000Z"),
            second: new Date("2026-09-25T01:00:00.000Z"),
        });
    });
});

describe("what a pattern writes into a name", () => {
    it("knows whether it has the time of day, and whether it has a date or time at all", () => {
        expect(hasTimeOfDay(STANDARD)).toBe(true);
        expect(hasTimeOfDay(DATE_ONLY)).toBe(false);
        expect(hasDateOrTime(DATE_ONLY)).toBe(true);
        expect(hasDateOrTime("{job_name}_{db_name}")).toBe(false);
    });
});
