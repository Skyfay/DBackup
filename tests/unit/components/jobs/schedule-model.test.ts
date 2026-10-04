import { describe, expect, it } from "vitest";
import { DEFAULT_SCHEDULE, buildCron, parseCron, parseTime, shiftTimes, suggestFreeTime, type SimpleSchedule } from "@/components/dashboard/jobs/schedule-model";

const schedule = (patch: Partial<SimpleSchedule>): SimpleSchedule => ({ ...DEFAULT_SCHEDULE, ...patch });

describe("schedule model", () => {
    it("writes each kind of schedule as the cron the scheduler reads, and reads it back", () => {
        const cases: [SimpleSchedule, string][] = [
            [schedule({ frequency: "hourly", everyHours: 6, minute: 15 }), "15 */6 * * *"],
            [schedule({ frequency: "hourly", everyHours: 1, minute: 0 }), "0 * * * *"],
            [schedule({ frequency: "daily", hours: [3, 15] }), "0 3,15 * * *"],
            [schedule({ frequency: "weekly", minute: 30, hours: [22], days: [1, 2, 3, 4, 5] }), "30 22 * * 1-5"],
            [schedule({ frequency: "weekly", hours: [10], days: [0, 6] }), "0 10 * * 0,6"],
            [schedule({ frequency: "weekly", hours: [22], days: [1, 3, 5] }), "0 22 * * 1,3,5"],
            [schedule({ frequency: "monthly", hours: [4], dayOfMonth: "L" }), "0 4 L * *"],
            [schedule({ frequency: "monthly", hours: [4], dayOfMonth: 1 }), "0 4 1 * *"],
        ];
        for (const [value, cron] of cases) {
            expect(buildCron(value)).toBe(cron);
            expect(buildCron(parseCron(cron)!)).toBe(cron);
        }
    });

    it("reads Sunday as 7 too, and a week of every day as daily", () => {
        expect(parseCron("0 3 * * 7")).toMatchObject({ frequency: "weekly", days: [0] });
        expect(parseCron("0 3 * * 0-6")).toMatchObject({ frequency: "daily", hours: [3] });
    });

    it("leaves what the picker cannot show to cron", () => {
        expect(parseCron("*/5 * * * *")).toBeNull();
        expect(parseCron("0 */5 * * *")).toBeNull();
        expect(parseCron("0 3 1 * 1")).toBeNull();
        expect(parseCron("0 3 * 1 *")).toBeNull();
        expect(parseCron("0 3 * *")).toBeNull();
    });

    it("takes a time typed in the usual ways and nothing past 23:59", () => {
        expect(parseTime("3")).toEqual({ hour: 3, minute: 0 });
        expect(parseTime("0330")).toEqual({ hour: 3, minute: 30 });
        expect(parseTime("15.30")).toEqual({ hour: 15, minute: 30 });
        expect(parseTime(" 22:05 ")).toEqual({ hour: 22, minute: 5 });
        expect(parseTime("24:00")).toBeNull();
        expect(parseTime("3:5")).toBeNull();
    });

    it("does not move a weekly time over midnight, which would change its days", () => {
        expect(shiftTimes(schedule({ frequency: "weekly", hours: [23], minute: 30, days: [1] }), 45)).toBeNull();
        expect(shiftTimes(schedule({ frequency: "daily", hours: [23], minute: 30 }), 45)).toMatchObject({ hours: [0], minute: 15 });
    });

    it("suggests the nearest later time the queue has room for", () => {
        const busy = new Set(["0 3 * * *", "15 3 * * *"]);
        const isFree = (candidate: SimpleSchedule) => !busy.has(buildCron(candidate));

        expect(suggestFreeTime(schedule({ hours: [3] }), isFree)).toMatchObject({ label: "Use 03:30", schedule: { hours: [3], minute: 30 } });
        expect(suggestFreeTime(schedule({ hours: [3, 15] }), () => true)?.label).toBe("Move 15 min later");
        expect(suggestFreeTime(schedule({ frequency: "hourly", everyHours: 1, minute: 0 }), (candidate) => buildCron(candidate) !== "15 * * * *")?.label).toBe("Use :30");
        expect(suggestFreeTime(schedule({ hours: [3] }), () => false)).toBeNull();
    });

    it("tells by how many minutes a suggestion moves every start, also across the full hour", () => {
        const shifts: number[] = [];
        suggestFreeTime(schedule({ frequency: "hourly", everyHours: 6, minute: 50 }), (_candidate, shift) => {
            shifts.push(shift);
            return shifts.length === 2;
        });

        // :50 plus 15 is :05, which is 45 minutes earlier within the same hours, not 15 later.
        expect(shifts).toEqual([-45, -30]);
    });
});
