import { beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import { prismaMock } from "@/lib/testing/prisma-mock";

vi.mock("@/services/jobs/job-overview", () => ({
    getJobOverviews: vi.fn(async (jobs: { id: string }[]) => new Map(jobs.map((job) => [job.id, { status: "Success", runs: [], lastRun: null, error: null, live: null, nextRunAt: null }]))),
}));

import { getJobList, getJobRunHistory } from "@/services/jobs/job-list-service";

const connectionSelect = { select: { id: true, name: true, adapterId: true, lastStatus: true } };

describe("job list", () => {
    beforeEach(() => vi.clearAllMocks());

    it("gives the connections of a job with their name and type only, never their config", async () => {
        prismaMock.job.findMany.mockResolvedValue([
            {
                id: "files",
                name: "Uploads",
                createdAt: new Date("2026-03-12T10:00:00Z"),
                sources: [{ configId: "nas", priority: 0, path: "/srv", excludePatterns: '["*.tmp"]', stopContainers: true, excludePatternPresets: [{ id: "preset-1" }], config: { id: "nas", name: "NAS", adapterId: "sftp", lastStatus: "ONLINE" } }],
            },
        ] as never);

        const [job] = await getJobList();

        const args = prismaMock.job.findMany.mock.calls[0][0] as { select: Record<string, { select: Record<string, unknown> }> };
        expect(args.select.source).toEqual(connectionSelect);
        expect(args.select.destinations.select.config).toEqual(connectionSelect);
        expect(args.select.sources.select.config).toEqual(connectionSelect);
        expect(JSON.stringify(args.select)).not.toContain("config\":true");

        expect(job.createdAt).toBe("2026-03-12T10:00:00.000Z");
        expect(job.sources[0]).toMatchObject({ excludePatterns: ["*.tmp"], excludePatternPresetIds: ["preset-1"] });
        expect(job.overview.status).toBe("Success");
    });
});

describe("job run history", () => {
    beforeEach(() => vi.clearAllMocks());

    it("lists the latest runs oldest first and counts the finished ones of the last 30 days", async () => {
        prismaMock.execution.findMany.mockResolvedValue([
            { id: "run-2", status: "Failed", startedAt: new Date("2026-09-23T03:00:00Z"), endedAt: new Date("2026-09-23T03:00:03Z"), size: null },
            { id: "run-1", status: "Success", startedAt: new Date("2026-09-22T03:00:00Z"), endedAt: new Date("2026-09-22T03:04:00Z"), size: BigInt(1234) },
        ] as never);
        (prismaMock.execution.groupBy as Mock).mockResolvedValue([
            { status: "Success", _count: { _all: 28 } },
            { status: "Failed", _count: { _all: 2 } },
        ]);
        prismaMock.execution.findFirst.mockResolvedValue({ startedAt: new Date("2026-09-22T03:00:00Z"), size: BigInt(1234) } as never);

        const history = await getJobRunHistory("shop", new Date("2026-09-23T12:00:00Z"));

        expect(history.runs.map((run) => run.id)).toEqual(["run-1", "run-2"]);
        expect(history.runs[0].size).toBe(1234);
        expect(history.successRate).toEqual({ succeeded: 28, total: 30 });
        expect(history.lastSuccess).toEqual({ at: "2026-09-22T03:00:00.000Z", size: 1234 });
    });
});
