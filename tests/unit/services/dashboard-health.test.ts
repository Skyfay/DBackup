import { describe, it, expect } from "vitest";
import { deriveHealth, extractLastError, latestFinishedRun, mergeRuns, type HealthJob } from "@/services/dashboard/health";
import type { RunSummary } from "@/services/dashboard/types";

function run(id: string, status: string, startedAt: string, endedAt: string | null = startedAt): RunSummary {
    return { id, status, startedAt, endedAt };
}

function job(id: string, overrides: Partial<HealthJob> = {}): HealthJob {
    return { id, name: `job-${id}`, enabled: true, nextRunAt: null, ...overrides };
}

describe("deriveHealth", () => {
    it("reports an empty state when no jobs exist", () => {
        expect(deriveHealth([], new Map())).toEqual({ state: "empty" });
    });

    it("is healthy when every job's latest finished run succeeded, naming the next scheduled run", () => {
        const runs = new Map([
            ["a", [run("a2", "Success", "2026-09-21T02:00:00.000Z", "2026-09-21T02:04:00.000Z")]],
            ["b", [run("b1", "Success", "2026-09-20T01:00:00.000Z")]],
        ]);
        const jobs = [
            job("a", { nextRunAt: "2026-09-22T02:00:00.000Z" }),
            job("b", { nextRunAt: "2026-09-21T23:00:00.000Z" }),
        ];

        expect(deriveHealth(jobs, runs)).toEqual({
            state: "healthy",
            lastRunAt: "2026-09-21T02:04:00.000Z",
            nextRun: { jobName: "job-b", at: "2026-09-21T23:00:00.000Z" },
        });
    });

    it("flags a job whose latest finished run failed, counting failures among its recent runs", () => {
        const runs = new Map([
            ["a", [
                run("a4", "Running", "2026-09-21T03:00:00.000Z", null),
                run("a3", "Failed", "2026-09-21T02:00:00.000Z"),
                run("a2", "Failed", "2026-09-20T02:00:00.000Z"),
                run("a1", "Success", "2026-09-19T02:00:00.000Z"),
            ]],
        ]);

        const health = deriveHealth([job("a")], runs);

        expect(health.state).toBe("failing");
        if (health.state !== "failing") return;
        expect(health.jobs).toEqual([{
            jobId: "a",
            jobName: "job-a",
            executionId: "a3",
            failedAt: "2026-09-21T02:00:00.000Z",
            badRuns: 2,
            recentRuns: 3,
            lastSuccessAt: "2026-09-19T02:00:00.000Z",
            error: null,
        }]);
    });

    it("leaves a paused job out, so an old failure cannot keep the banner red", () => {
        const runs = new Map([["a", [run("a1", "Failed", "2026-09-21T02:00:00.000Z")]]]);

        expect(deriveHealth([job("a", { enabled: false })], runs).state).toBe("healthy");
    });

    it("ranks failures above partial runs and lists the most recent problem first", () => {
        const runs = new Map([
            ["partial", [run("p1", "Partial", "2026-09-21T05:00:00.000Z")]],
            ["old", [run("o1", "Failed", "2026-09-19T02:00:00.000Z")]],
            ["new", [run("n1", "Failed", "2026-09-21T02:00:00.000Z")]],
        ]);

        const health = deriveHealth([job("partial"), job("old"), job("new")], runs);

        expect(health.state).toBe("failing");
        if (health.state !== "failing") return;
        expect(health.jobs.map((entry) => entry.jobId)).toEqual(["new", "old"]);
    });

    it("reports degraded when the worst latest outcome is a partial run", () => {
        const runs = new Map([["a", [run("a1", "Partial", "2026-09-21T02:00:00.000Z")]]]);

        expect(deriveHealth([job("a")], runs).state).toBe("degraded");
    });
});

describe("latestFinishedRun", () => {
    it("skips live runs to find the newest outcome", () => {
        const runs = [run("2", "Pending", "b", null), run("1", "Cancelled", "a")];
        expect(latestFinishedRun(runs)?.id).toBe("1");
    });
});

describe("mergeRuns", () => {
    it("puts live runs first and drops cached entries that were still running when cached", () => {
        const history = [
            run("h3", "Running", "2026-09-21T03:00:00.000Z", null),
            run("h2", "Success", "2026-09-21T02:00:00.000Z"),
            run("h1", "Failed", "2026-09-21T01:00:00.000Z"),
        ];
        const live = [run("l1", "Running", "2026-09-21T04:00:00.000Z", null)];

        expect(mergeRuns(history, live, 12).map((entry) => entry.id)).toEqual(["l1", "h2", "h1"]);
    });

    it("keeps no more than the limit", () => {
        const history = Array.from({ length: 12 }, (_, i) => run(`h${i}`, "Success", `2026-09-${10 + i}`));
        const live = [run("l1", "Running", "2026-09-30", null)];

        const merged = mergeRuns(history, live, 12);
        expect(merged).toHaveLength(12);
        expect(merged[0].id).toBe("l1");
    });
});

describe("extractLastError", () => {
    it("returns the message of the last error entry", () => {
        const logs = JSON.stringify([
            { level: "error", message: "first problem" },
            { level: "info", message: "retrying" },
            { level: "error", message: "connect ECONNREFUSED 10.0.4.41:5432" },
            { level: "info", message: "cleanup done" },
        ]);

        expect(extractLastError(logs)).toBe("connect ECONNREFUSED 10.0.4.41:5432");
    });

    it("returns null for purged, malformed or error-free logs", () => {
        expect(extractLastError(null)).toBeNull();
        expect(extractLastError("not json")).toBeNull();
        expect(extractLastError(JSON.stringify({ level: "error" }))).toBeNull();
        expect(extractLastError(JSON.stringify([{ level: "info", message: "ok" }]))).toBeNull();
    });

    it("shortens very long messages", () => {
        const message = "x".repeat(500);
        const result = extractLastError(JSON.stringify([{ level: "error", message }]));

        expect(result).toHaveLength(300);
        expect(result?.endsWith("...")).toBe(true);
    });
});
