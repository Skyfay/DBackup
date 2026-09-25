import { describe, expect, it } from "vitest";
import { buildRow, daysEnding, pickedRuns, shiftDay, totalsOf } from "@/components/dashboard/storage/explorer/timeline-model";
import type { BackupRun, ExplorerFile, ExplorerJob, JobPlan } from "@/services/storage/explorer-types";

const dayOf = (iso: string) => iso.slice(0, 10);

function job(overrides: Partial<ExplorerJob> = {}): ExplorerJob {
    return {
        key: "shop", kind: "job", name: "Shop nightly", jobId: "shop", sourceType: "postgres", sourceName: "Shop", hasFolders: false, incremental: false,
        configuredDestinationIds: ["nas"], destinationIds: ["nas"], runs: 3, size: 3, newest: "2026-09-24T03:00:00Z", oldest: "2026-09-20T03:00:00Z",
        failedChecks: 1, missingCopies: 1, locked: 0, ...overrides,
    };
}

function run(date: string, overrides: { failed?: boolean; missing?: boolean; jobKey?: string } = {}): BackupRun {
    const file: ExplorerFile = {
        name: `${date}.tar`, path: `Shop/${date}.tar`, size: 1, lastModified: `${date}T03:00:00Z`, createdAt: `${date}T03:00:00Z`,
        ...(overrides.failed ? { verification: { verifiedAt: `${date}T04:00:00Z`, passed: false, trigger: "post-upload" } } : {}),
    };
    return {
        path: file.path,
        jobKey: overrides.jobKey ?? "shop",
        file,
        createdAt: file.createdAt!,
        copies: [{ destinationId: "nas", state: "stored", file }, ...(overrides.missing ? [{ destinationId: "r2", state: "missing" as const }] : [])],
    };
}

const plan: JobPlan = {
    jobKey: "shop",
    schedule: "0 3 * * *",
    enabled: true,
    createdAt: "2026-09-01T00:00:00Z",
    retention: '{"mode":"SIMPLE","simple":{"keepCount":30}}',
    planned: [{ at: "2026-09-26T03:00:00Z", full: true }, { at: "2026-09-27T03:00:00Z", full: false }],
    missed: [{ at: "2026-09-23T03:00:00Z", runs: 1 }],
    truncated: false,
};

describe("the grid of the timeline", () => {
    it("counts days without a time zone in between", () => {
        expect(shiftDay("2026-09-30", 1)).toBe("2026-10-01");
        expect(shiftDay("2026-03-01", -1)).toBe("2026-02-28");
        expect(daysEnding("2026-09-25", 3)).toEqual(["2026-09-23", "2026-09-24", "2026-09-25"]);
    });

    it("shows what each day of a job holds, what it missed and what its schedule plans", () => {
        const days = daysEnding("2026-09-27", 10);
        const runs = [run("2026-09-20"), run("2026-09-22", { failed: true }), run("2026-09-24", { missing: true })];
        const row = buildRow({ job: job(), plan, runs, days, today: "2026-09-25", at: [], dayOf });

        // Before the oldest backup, while the job already existed, its backups aged out.
        expect(row.spans).toEqual([{ kind: "aged", start: 0, end: 1 }]);
        expect(row.cells.map((cell) => cell?.kind ?? "span")).toEqual(["span", "span", "ok", "none", "failed", "missed", "missing", "none", "planned", "planned"]);
        expect(row.cells[8]?.planned).toEqual([plan.planned[0]]);
    });

    it("keeps the days before a job existed out of the span of backups that aged out", () => {
        const days = daysEnding("2026-09-22", 5);
        const row = buildRow({ job: job(), plan: { ...plan, createdAt: "2026-09-19T12:00:00Z" }, runs: [run("2026-09-20")], days, today: "2026-09-25", at: [], dayOf });

        expect(row.spans).toEqual([{ kind: "aged", start: 1, end: 1 }]);
        expect(row.cells[0]?.kind).toBe("none");
    });

    it("ends the row of a deleted job with the days after its last backup", () => {
        const deleted = job({ kind: "deleted", key: "deleted:erp", newest: "2026-09-21T03:00:00Z", oldest: "2026-09-20T03:00:00Z" });
        const row = buildRow({ job: deleted, runs: [run("2026-09-20", { jobKey: "deleted:erp" }), run("2026-09-21", { jobKey: "deleted:erp" })], days: daysEnding("2026-09-25", 6), today: "2026-09-25", at: [], dayOf });

        expect(row.spans).toEqual([{ kind: "gone", start: 2, end: 5 }]);
    });

    it("sums every job per day with the worst of them, and the planned runs of the days to come", () => {
        const days = daysEnding("2026-09-27", 10);
        const row = buildRow({ job: job(), plan, runs: [run("2026-09-22", { failed: true }), run("2026-09-24", { missing: true })], days, today: "2026-09-25", at: [], dayOf });
        const totals = totalsOf([row], days, "2026-09-25");

        expect(totals[4]).toEqual({ day: "2026-09-22", count: 1, worst: "destructive", planned: false });
        expect(totals[6]).toEqual({ day: "2026-09-24", count: 1, worst: "warning", planned: false });
        expect(totals[8]).toEqual({ day: "2026-09-26", count: 1, worst: "ok", planned: true });
    });

    it("lists the backups of a job, of a day, or of a job on a day", () => {
        const runs = [run("2026-09-20"), run("2026-09-22"), run("2026-09-22", { jobKey: "crm" })];

        expect(pickedRuns(runs, { from: "2026-09-22", to: "2026-09-22" }, dayOf)).toHaveLength(2);
        expect(pickedRuns(runs, { jobKey: "shop", from: "2026-09-22", to: "2026-09-22" }, dayOf)).toHaveLength(1);
        expect(pickedRuns(runs, { jobKey: "shop", from: "2026-09-19", to: "2026-09-25" }, dayOf)).toHaveLength(2);
    });
});
