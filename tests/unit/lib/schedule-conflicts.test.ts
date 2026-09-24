import { describe, expect, it } from "vitest";
import { findScheduleClash, type ScheduleLoad, type ScheduledJobLoad } from "@/lib/core/schedule-conflicts";

// A Thursday, noon in UTC.
const NOW = new Date("2026-09-24T12:00:00.000Z");
const MINUTE = 60_000;
const NEW_JOB = { ids: [], durations: [MINUTE] };

function job(id: string, name: string, schedule: string, minutes: number, presetId: string | null = null): ScheduledJobLoad {
    return { id, name, schedule, presetId, estimatedMs: minutes * MINUTE };
}

function load(slots: number, jobs: ScheduledJobLoad[]): ScheduleLoad {
    return { timezone: "UTC", slots, jobs };
}

const MAIL = job("mail", "Mail archive", "0 3 * * *", 6);

describe("findScheduleClash", () => {
    it("warns when a daily time meets another daily job and the queue has one slot", () => {
        const clash = findScheduleClash("0 3 * * *", load(1, [MAIL]), NEW_JOB, NOW);

        expect(clash).toEqual({ at: new Date("2026-09-25T03:00:00.000Z"), everyRun: true, others: ["Mail archive"], overlapMs: MINUTE });
    });

    it("stays quiet while the slots are enough, like two jobs and this one on three slots", () => {
        const others = [MAIL, job("wiki", "Wiki", "0 3 * * *", 10)];

        expect(findScheduleClash("0 3 * * *", load(3, others), NEW_JOB, NOW)).toBeNull();
        expect(findScheduleClash("0 3 * * *", load(3, [...others, job("crm", "CRM", "0 3 * * *", 4)]), NEW_JOB, NOW)?.others).toEqual(["Mail archive", "Wiki", "CRM"]);
    });

    it("counts a job that is still running, not only one that starts at the same time", () => {
        const clash = findScheduleClash("0 3 * * *", load(1, [job("uploads", "Uploads", "30 2 * * *", 45)]), NEW_JOB, NOW);

        expect(clash?.others).toEqual(["Uploads"]);
    });

    it("says on which day only some runs meet, like a daily time and a job on Sundays", () => {
        const clash = findScheduleClash("0 2 * * *", load(1, [job("nas", "NAS sync", "0 2 * * 0", 20)]), NEW_JOB, NOW);

        expect(clash).toMatchObject({ at: new Date("2026-09-27T02:00:00.000Z"), everyRun: false, others: ["NAS sync"] });
    });

    it("leaves out the job being edited, which cannot meet itself", () => {
        expect(findScheduleClash("0 3 * * *", load(1, [MAIL]), { ids: ["mail"], durations: [6 * MINUTE] }, NOW)).toBeNull();
    });

    it("lets the jobs of a preset start together, and warns when they are more than the slots", () => {
        const followers = { ids: ["a", "b"], durations: [5 * MINUTE, 5 * MINUTE] };

        expect(findScheduleClash("0 1 * * *", load(1, []), followers, NOW)).toMatchObject({ others: [], everyRun: true });
        expect(findScheduleClash("0 1 * * *", load(2, []), followers, NOW)).toBeNull();
    });

    it("finds nothing for an expression the scheduler cannot read", () => {
        expect(findScheduleClash("0 3 * *", load(1, [MAIL]), NEW_JOB, NOW)).toBeNull();
    });
});
