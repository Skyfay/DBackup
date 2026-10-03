import { describe, expect, it, vi } from "vitest";
import { jobActions } from "@/components/dashboard/jobs/job-actions";
import { retentionLabel } from "@/components/dashboard/jobs/job-retention";
import { describeSchedule } from "@/components/dashboard/jobs/job-schedule";
import { lastOutcome, matchesJobFilter } from "@/components/dashboard/jobs/job-status";
import type { JobListItem } from "@/services/jobs/job-list-service";

function job(overrides: Partial<JobListItem> & { runs?: string[]; live?: boolean } = {}): JobListItem {
    const { runs = [], live = false, ...rest } = overrides;
    return {
        id: "job-1",
        name: "Shop nightly",
        enabled: true,
        overview: {
            status: live ? "Running" : runs[runs.length - 1] ?? null,
            runs: runs.map((status, index) => ({ id: `run-${index}`, status, startedAt: "2026-09-23T03:00:00.000Z", endedAt: null })),
            lastRun: null,
            error: null,
            live: live ? { executionId: "run-live", status: "Running", startedAt: "2026-09-23T14:00:00.000Z", stage: "Uploading", progress: 62 } : null,
            nextRunAt: null,
        },
        ...rest,
    } as JobListItem;
}

describe("job schedules in words", () => {
    it("names the schedules people pick most", () => {
        expect(describeSchedule("0 3 * * *").text).toBe("Every day at 03:00");
        expect(describeSchedule("0 * * * *").text).toBe("Every hour");
        expect(describeSchedule("15 * * * *").text).toBe("Every hour at :15");
        expect(describeSchedule("0 */6 * * *").text).toBe("Every 6 hours");
        expect(describeSchedule("30 22 * * 1-5").text).toBe("Weekdays at 22:30");
        expect(describeSchedule("0 2 * * 0").text).toBe("Every Sunday at 02:00");
        expect(describeSchedule("0 4 1 * *").text).toBe("Monthly on day 1 at 04:00");
        expect(describeSchedule("*/15 * * * *").text).toBe("Every 15 minutes");
    });

    it("says several times, some days and the last day of the month the way the picker builds them", () => {
        expect(describeSchedule("0 3,15 * * *").text).toBe("Every day at 03:00 and 15:00");
        expect(describeSchedule("30 22 * * 1,3,5").text).toBe("Mon, Wed and Fri at 22:30");
        expect(describeSchedule("0 10 * * 0,6").text).toBe("Weekends at 10:00");
        expect(describeSchedule("0 4 L * *").text).toBe("Monthly on the last day at 04:00");
        expect(describeSchedule("0 */5 * * *").text).toBe("Every 5 hours");
    });

    it("keeps an expression it cannot put into words as it is", () => {
        expect(describeSchedule("0 3 1-7 * 1")).toEqual({ text: "0 3 1-7 * 1", described: false });
        expect(describeSchedule("0 3 * 1 *").described).toBe(false);
    });
});

describe("job quick filters", () => {
    it("counts a job whose last finished run failed or was partial as needing attention, also while it runs again", () => {
        expect(matchesJobFilter(job({ runs: ["Success", "Failed"] }), "attention")).toBe(true);
        expect(matchesJobFilter(job({ runs: ["Failed", "Partial", "Running"], live: true }), "attention")).toBe(true);
        expect(matchesJobFilter(job({ runs: ["Failed", "Success"] }), "attention")).toBe(false);
        expect(lastOutcome(job({ runs: ["Success", "Cancelled"] }))).toBe("Cancelled");
    });

    it("puts live and paused jobs under their own filter", () => {
        expect(matchesJobFilter(job({ live: true }), "running")).toBe(true);
        expect(matchesJobFilter(job({ enabled: false }), "paused")).toBe(true);
        expect(matchesJobFilter(job(), "paused")).toBe(false);
    });
});

describe("job actions", () => {
    it("gives edit, clone and delete the colors of the dialogs they open", () => {
        const groups = jobActions({ onRun: vi.fn(), onEdit: vi.fn(), onClone: vi.fn(), toggle: { paused: false, onSelect: vi.fn() }, onDelete: vi.fn() });
        const tones = Object.fromEntries(groups.flatMap((group) => group.actions).map((action) => [action.id, action.tone]));
        expect(tones).toEqual({ run: "neutral", edit: "edit", clone: "create", toggle: "neutral", delete: "destructive" });
        expect(groups.map((group) => group.label)).toEqual(["Run", "Manage", undefined]);
    });

    it("leaves out what the user may not do and offers Resume for a paused job", () => {
        const groups = jobActions({ toggle: { paused: true, onSelect: vi.fn() } });
        expect(groups).toHaveLength(1);
        expect(groups[0].actions.map((action) => action.label)).toEqual(["Resume"]);
    });
});

describe("what a destination keeps", () => {
    it("names the policy, the default policy or the older inline setting", () => {
        expect(retentionLabel({ retentionPolicy: { name: "Long term" }, retention: "{}" })).toBe("Long term");
        expect(retentionLabel({ retentionPolicy: null, retention: "{}" })).toBe("Default policy");
        expect(retentionLabel({ retentionPolicy: null, retention: JSON.stringify({ mode: "SIMPLE", simple: { keepCount: 10 } }) })).toBe("Last 10");
        expect(retentionLabel({ retentionPolicy: null, retention: "not json" })).toBe("Everything");
    });
});
