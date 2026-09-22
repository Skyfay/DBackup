import { describe, it, expect, beforeEach, type Mock } from "vitest";
import { prismaMock } from "@/lib/testing/prisma-mock";
import { getConnectionDetails } from "@/services/adapters/connection-details";

// Prisma's groupBy and aggregate overloads are too deep for the mock types.
const mocked = (fn: unknown) => fn as Mock;
const job = (id: string, name: string, enabled = true) => ({ id, name, enabled });

describe("getConnectionDetails", () => {
    beforeEach(() => {
        mocked(prismaMock.healthCheckLog.aggregate).mockResolvedValue({ _avg: { latencyMs: null } });
        prismaMock.healthCheckLog.findFirst.mockResolvedValue(null);
        prismaMock.dbVersionHistory.findMany.mockResolvedValue([]);
        prismaMock.job.findMany.mockResolvedValue([]);
        prismaMock.jobDestination.findMany.mockResolvedValue([]);
        prismaMock.jobSource.findMany.mockResolvedValue([]);
        prismaMock.notificationTemplateChannel.findMany.mockResolvedValue([]);
        mocked(prismaMock.execution.groupBy).mockResolvedValue([]);
        prismaMock.execution.findMany.mockResolvedValue([]);
    });

    it("lists each job once with its role and its newest backup, sorted by name", async () => {
        prismaMock.jobSource.findMany.mockResolvedValue([
            { job: job("files", "uploads-nightly") },
            // A second folder of the same source in the same job.
            { job: job("files", "uploads-nightly") },
            { job: job("docs", "archive-weekly", false) },
        ] as never);
        mocked(prismaMock.execution.groupBy).mockResolvedValue([{ jobId: "files", _max: { startedAt: new Date("2026-09-22T02:00:00.000Z") } }]);
        prismaMock.execution.findMany.mockResolvedValue([
            { id: "exec-1", jobId: "files", status: "Success", startedAt: new Date("2026-09-22T02:00:00.000Z") },
        ] as never);

        const { usage } = await getConnectionDetails("nas", { includeUsage: true });

        expect(usage?.jobs).toEqual([
            { id: "docs", name: "archive-weekly", enabled: false, role: "directory", lastRun: null },
            { id: "files", name: "uploads-nightly", enabled: true, role: "directory", lastRun: { id: "exec-1", at: "2026-09-22T02:00:00.000Z", status: "Success" } },
        ]);
    });

    it("leaves the jobs out for a caller who may not see them", async () => {
        const details = await getConnectionDetails("pg", { includeUsage: false });

        expect(details.usage).toBeNull();
        expect(prismaMock.jobSource.findMany).not.toHaveBeenCalled();
    });

    it("rounds the mean response time and lists the versions newest first", async () => {
        mocked(prismaMock.healthCheckLog.aggregate).mockResolvedValue({ _avg: { latencyMs: 8.6 } });
        prismaMock.healthCheckLog.findFirst.mockResolvedValue({ createdAt: new Date("2026-09-22T11:59:00.000Z") } as never);
        prismaMock.dbVersionHistory.findMany.mockResolvedValue([
            { newVersion: "16.4", previousVersion: "16.3", detectedAt: new Date("2026-08-14T00:00:00.000Z") },
        ] as never);

        const details = await getConnectionDetails("pg", { includeUsage: false });

        expect(details).toMatchObject({
            averageLatencyMs: 9,
            lastPassedAt: "2026-09-22T11:59:00.000Z",
            versions: [{ version: "16.4", previous: "16.3", at: "2026-08-14T00:00:00.000Z" }],
        });
    });
});
