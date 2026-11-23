/**
 * What the Jobs page and the schedule picker say about the runs of other tenants, which share the
 * one queue: a wait behind one of them reads as a job of another tenant, and they count in the
 * Every job row.
 */
import { describe, expect, it } from "vitest";
import { demandOf, otherTenantsOf, waitNames, waitSentence, type TimelineBar } from "@/components/dashboard/jobs/timeline/job-timeline-model";
import { clashNames } from "@/components/dashboard/jobs/schedule-summary";
import { OTHER_TENANT_JOB, OTHER_TENANT_JOB_NAME, type JobTimeline } from "@/services/jobs/job-timeline-types";

const names = new Map([["shop", "Shop nightly"]]);

describe("a wait behind another tenant", () => {
    it("names the job of another tenant without its name", () => {
        expect(waitSentence([OTHER_TENANT_JOB], names)).toBe("A job of another tenant holds the queue");
        expect(waitSentence(["shop", OTHER_TENANT_JOB], names)).toBe("Shop nightly, a job of another tenant hold the queue");
        expect(waitNames([OTHER_TENANT_JOB], names)).toEqual([OTHER_TENANT_JOB_NAME]);
        expect(waitSentence([], names)).toBe("The queue is full");
    });

    it("puts the jobs of other tenants last in the clash note of the schedule picker, however many there are", () => {
        expect(clashNames([OTHER_TENANT_JOB_NAME])).toBe("A job of another tenant");
        expect(clashNames([OTHER_TENANT_JOB_NAME, "Shop nightly"])).toBe("Shop nightly and a job of another tenant");
    });
});

describe("the Every job row of the timeline", () => {
    const range = { from: 0, to: 1000 };
    const bar: TimelineBar = { key: "own", kind: "pending", start: 300, end: 400, waitFrom: 100, run: undefined };

    it("counts the runs of other tenants beside the own ones, so a wait behind them shows", () => {
        const data = { otherTenants: [{ from: new Date(100).toISOString(), to: new Date(300).toISOString(), count: 1 }] } as JobTimeline;

        expect(demandOf([bar], range, otherTenantsOf(data))).toEqual([
            { from: 100, to: 300, count: 2 },
            { from: 300, to: 400, count: 1 },
        ]);
        expect(demandOf([bar], range)).toEqual([{ from: 100, to: 400, count: 1 }]);
    });
});
