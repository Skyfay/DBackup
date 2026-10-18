import { describe, expect, it, vi } from "vitest";
import { jobActions } from "@/components/dashboard/jobs/job-actions";
import { retentionLabel } from "@/components/dashboard/jobs/job-retention";
import { describeSchedule } from "@/components/dashboard/jobs/job-schedule";
import { jobsAttention } from "@/components/dashboard/jobs/job-status";
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

describe("the dot of the Jobs tab", () => {
    it("names the first job that failed and counts the others the server did not name", () => {
        expect(jobsAttention({ failed: { count: 40, names: ["Shop", "ERP", "CRM"] }, partial: { count: 1, names: ["Files"] } })).toEqual({
            tone: "destructive",
            note: "Shop and 39 more failed on their last run. Files missed a copy on its last run",
        });
        expect(jobsAttention({ failed: { count: 0, names: [] }, partial: { count: 2, names: ["Files", "Wiki"] } })).toEqual({
            tone: "warning",
            note: "Files and Wiki missed a copy on their last run",
        });
        expect(jobsAttention({ failed: { count: 0, names: [] }, partial: { count: 0, names: [] } })).toBeUndefined();
    });
});

describe("job actions", () => {
    it("gives edit, clone and delete the colors of the dialogs they open", () => {
        const groups = jobActions({ onRun: vi.fn(), onEdit: vi.fn(), onClone: vi.fn(), toggle: { paused: false, onSelect: vi.fn() }, onDelete: vi.fn() });
        const tones = Object.fromEntries(groups.flatMap((group) => group.actions).map((action) => [action.id, action.tone]));
        expect(tones).toEqual({ run: "neutral", edit: "edit", clone: "create", toggle: "neutral", delete: "destructive" });
        expect(groups.map((group) => group.label)).toEqual(["Run", "Manage", undefined]);
    });

    it("offers to open a job in its tenant in All tenants, without running or changing it there", () => {
        const groups = jobActions({ onOpenLastRun: vi.fn(), openInTenant: { label: "Open in Acme GmbH", onSelect: vi.fn() } });

        expect(groups.map((group) => [group.label, group.actions.map((action) => action.id)])).toEqual([["Run", ["last-run"]], ["Manage", ["open-in-tenant"]]]);
        expect(groups[1].actions[0]).toMatchObject({ label: "Open in Acme GmbH", tone: "neutral" });
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
