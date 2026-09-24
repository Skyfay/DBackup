import { describe, expect, it } from "vitest";
import { clashContext, findScheduleClash, type ScheduleLoad, type ScheduleOwners, type ScheduledJobLoad } from "@/lib/core/schedule-conflicts";

// A Thursday, noon in UTC.
const NOW = new Date("2026-09-24T12:00:00.000Z");
const MINUTE = 60_000;
const NEW_JOB: ScheduleOwners = { ids: [], durations: [MINUTE] };

function job(id: string, name: string, schedule: string, minutes: number, presetId: string | null = null): ScheduledJobLoad {
    return { id, name, schedule, presetId, estimatedMs: minutes * MINUTE };
}

function clash(expression: string, slots: number, jobs: ScheduledJobLoad[], owners: ScheduleOwners = NEW_JOB) {
    const load: ScheduleLoad = { timezone: "UTC", slots, jobs };
    return findScheduleClash(expression, clashContext(load, owners, NOW));
}

const MAIL = job("mail", "Mail archive", "0 3 * * *", 6);

describe("findScheduleClash", () => {
    it("warns when a daily time meets another daily job and the queue has one slot, and waits until it is done", () => {
        expect(clash("0 3 * * *", 1, [MAIL])).toEqual({ at: new Date("2026-09-25T03:00:00.000Z"), everyRun: true, others: ["Mail archive"], waitMs: 6 * MINUTE });
    });

    it("waits for every job ahead of it, one after the other", () => {
        const found = clash("0 0 * * *", 1, [job("db", "Database Test", "0 0 * * *", 5), job("files", "FileBackup", "0 0 * * *", 8)]);

        expect(found?.others).toEqual(["Database Test", "FileBackup"]);
        expect(found?.waitMs).toBe(13 * MINUTE);
    });

    it("stays quiet while the slots are enough, like two jobs and this one on three slots", () => {
        const others = [MAIL, job("wiki", "Wiki", "0 3 * * *", 10)];

        expect(clash("0 3 * * *", 3, others)).toBeNull();
        // A third one fills the slots, so this job waits for the shortest of them.
        expect(clash("0 3 * * *", 3, [...others, job("crm", "CRM", "0 3 * * *", 4)])).toMatchObject({ others: ["Mail archive", "Wiki", "CRM"], waitMs: 4 * MINUTE });
    });

    it("counts a job that is still running, for as long as it still runs", () => {
        expect(clash("0 3 * * *", 1, [job("uploads", "Uploads", "30 2 * * *", 45)])).toMatchObject({ others: ["Uploads"], waitMs: 15 * MINUTE });
    });

    it("says on which day only some runs meet, like a daily time and a job on Sundays", () => {
        expect(clash("0 2 * * *", 1, [job("nas", "NAS sync", "0 2 * * 0", 20)])).toMatchObject({
            at: new Date("2026-09-27T02:00:00.000Z"),
            everyRun: false,
            others: ["NAS sync"],
            waitMs: 20 * MINUTE,
        });
    });

    it("leaves out the job being edited, which cannot wait for itself", () => {
        expect(clash("0 3 * * *", 1, [MAIL], { ids: ["mail"], durations: [6 * MINUTE] })).toBeNull();
    });

    it("lets the jobs of a preset start together, and warns when they are more than the slots", () => {
        const followers: ScheduleOwners = { ids: ["a", "b"], durations: [5 * MINUTE, 5 * MINUTE] };

        expect(clash("0 1 * * *", 1, [], followers)).toMatchObject({ others: [], everyRun: true, waitMs: 5 * MINUTE });
        expect(clash("0 1 * * *", 2, [], followers)).toBeNull();
    });

    it("looks up the later runs of a monthly schedule past the days worked out ahead", () => {
        expect(clash("0 4 1 * *", 1, [job("report", "Month report", "0 4 1 * *", 30)])).toMatchObject({ at: new Date("2026-10-01T04:00:00.000Z"), everyRun: true, waitMs: 30 * MINUTE });
    });

    it("finds nothing for an expression the scheduler cannot read", () => {
        expect(clash("0 3 * *", 1, [MAIL])).toBeNull();
    });
});
