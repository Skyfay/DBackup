import { describe, it, expect, beforeEach, type Mock } from "vitest";
import { subDays } from "date-fns";
import { prismaMock } from "@/lib/testing/prisma-mock";
import {
    purgeExecutionLogs,
    deleteOldExecutions,
    LOG_PURGE_BATCH_SIZE,
    HISTORY_DELETE_BATCH_SIZE,
    PURGED_LOGS_VALUE,
} from "@/services/system/execution-retention";
import { EXECUTION_HISTORY_KEEP_LATEST, RETENTION_NEVER } from "@/lib/core/data-retention";

const NOW = new Date("2026-09-16T12:00:00.000Z");

function ids(prefix: string, count: number) {
    return Array.from({ length: count }, (_, i) => ({ id: `${prefix}-${i}` }));
}

type FindManyArgs = { take?: number; orderBy?: unknown; where?: Record<string, unknown> };

describe("Execution log purge", () => {
    beforeEach(() => {
        prismaMock.execution.findMany.mockReset();
        prismaMock.execution.updateMany.mockReset();
    });

    it("keeps every log when retention is set to never", async () => {
        const purged = await purgeExecutionLogs(RETENTION_NEVER, NOW);

        expect(purged).toBe(0);
        expect(prismaMock.execution.findMany).not.toHaveBeenCalled();
        expect(prismaMock.execution.updateMany).not.toHaveBeenCalled();
    });

    it("clears the log of finished runs older than the window and marks them", async () => {
        prismaMock.execution.findMany.mockResolvedValueOnce(ids("run", 2) as never);
        prismaMock.execution.updateMany.mockResolvedValueOnce({ count: 2 });

        const purged = await purgeExecutionLogs(90, NOW);

        expect(purged).toBe(2);
        expect(prismaMock.execution.findMany).toHaveBeenCalledWith(expect.objectContaining({
            where: {
                startedAt: { lt: subDays(NOW, 90) },
                status: { notIn: ["Pending", "Running"] },
                logsPurgedAt: null,
            },
        }));
        expect(prismaMock.execution.updateMany).toHaveBeenCalledWith({
            where: { id: { in: ["run-0", "run-1"] }, status: { notIn: ["Pending", "Running"] } },
            data: { logs: PURGED_LOGS_VALUE, logsPurgedAt: NOW },
        });
    });

    it("works through a large backlog batch by batch", async () => {
        prismaMock.execution.findMany
            .mockResolvedValueOnce(ids("a", LOG_PURGE_BATCH_SIZE) as never)
            .mockResolvedValueOnce(ids("b", LOG_PURGE_BATCH_SIZE) as never)
            .mockResolvedValueOnce(ids("c", 5) as never);
        prismaMock.execution.updateMany
            .mockResolvedValueOnce({ count: LOG_PURGE_BATCH_SIZE })
            .mockResolvedValueOnce({ count: LOG_PURGE_BATCH_SIZE })
            .mockResolvedValueOnce({ count: 5 });

        const purged = await purgeExecutionLogs(30, NOW);

        expect(purged).toBe(LOG_PURGE_BATCH_SIZE * 2 + 5);
        expect(prismaMock.execution.updateMany).toHaveBeenCalledTimes(3);
    });

    it("stops instead of looping when a full batch changes nothing", async () => {
        prismaMock.execution.findMany.mockResolvedValue(ids("stuck", LOG_PURGE_BATCH_SIZE) as never);
        prismaMock.execution.updateMany.mockResolvedValue({ count: 0 });

        const purged = await purgeExecutionLogs(30, NOW);

        expect(purged).toBe(0);
        expect(prismaMock.execution.findMany).toHaveBeenCalledTimes(1);
    });
});

// Prisma's overloaded groupBy signature hides the mock helpers from the type checker.
const groupBy = prismaMock.execution.groupBy as unknown as Mock;

describe("Execution history cleanup", () => {
    const cutoff = subDays(NOW, 30);
    const old = subDays(NOW, 400);
    const recent = subDays(NOW, 1);

    beforeEach(() => {
        groupBy.mockReset();
        prismaMock.execution.findMany.mockReset();
        prismaMock.execution.findFirst.mockReset();
        prismaMock.execution.deleteMany.mockReset();
    });

    /** Routes findMany calls: the per-group "newest runs" lookup versus the deletion batch. */
    function mockFindMany(newestByGroup: Record<string, { id: string; startedAt: Date }[]>, batches: { id: string }[][]) {
        prismaMock.execution.findMany.mockImplementation((async (args: FindManyArgs) => {
            if (args.orderBy) {
                const where = args.where as { jobId: string | null; type: string };
                return newestByGroup[`${where.jobId}:${where.type}`] ?? [];
            }
            return batches.shift() ?? [];
        }) as never);
    }

    it("deletes nothing when retention is set to never", async () => {
        const deleted = await deleteOldExecutions(RETENTION_NEVER, NOW);

        expect(deleted).toBe(0);
        expect(groupBy).not.toHaveBeenCalled();
        expect(prismaMock.execution.deleteMany).not.toHaveBeenCalled();
    });

    it("keeps the newest runs of each job and of each run type without a job", async () => {
        groupBy.mockResolvedValue([
            { jobId: "job-rare", type: "Backup" },
            { jobId: null, type: "Restore" },
        ] as never);
        prismaMock.execution.findFirst.mockResolvedValue(null);
        mockFindMany(
            {
                // A monthly job: its newest runs are all older than the cutoff.
                "job-rare:Backup": [{ id: "rare-new", startedAt: old }, { id: "rare-older", startedAt: old }],
                // A restore from yesterday plus an old one. Only the old one needs protecting.
                "null:Restore": [{ id: "restore-recent", startedAt: recent }, { id: "restore-old", startedAt: old }],
            },
            [[{ id: "deletable-1" }]]
        );
        prismaMock.execution.deleteMany.mockResolvedValue({ count: 1 });

        const deleted = await deleteOldExecutions(30, NOW);

        expect(deleted).toBe(1);
        expect(prismaMock.execution.findMany).toHaveBeenCalledWith(expect.objectContaining({
            where: { jobId: "job-rare", type: "Backup" },
            take: EXECUTION_HISTORY_KEEP_LATEST,
        }));
        const batchCall = prismaMock.execution.findMany.mock.calls.find(([args]) => !(args as FindManyArgs).orderBy);
        expect((batchCall![0] as FindManyArgs).where).toEqual({
            AND: [
                { startedAt: { lt: cutoff } },
                { status: { notIn: ["Pending", "Running"] } },
                { id: { notIn: ["rare-new", "rare-older", "restore-old"] } },
            ],
        });
        expect(prismaMock.execution.deleteMany).toHaveBeenCalledWith({
            where: { id: { in: ["deletable-1"] }, status: { notIn: ["Pending", "Running"] } },
        });
    });

    it("keeps every run of the chain an incremental job is still extending", async () => {
        groupBy.mockResolvedValue([{ jobId: "job-inc", type: "Backup" }] as never);
        prismaMock.execution.findFirst.mockResolvedValue({ chainId: "chain-active" } as never);
        mockFindMany({ "job-inc:Backup": [] }, [[]]);

        await deleteOldExecutions(30, NOW);

        expect(prismaMock.execution.findFirst).toHaveBeenCalledWith(expect.objectContaining({
            where: expect.objectContaining({ jobId: "job-inc", chainId: { not: null } }),
        }));
        const batchCall = prismaMock.execution.findMany.mock.calls.find(([args]) => !(args as FindManyArgs).orderBy);
        expect((batchCall![0] as FindManyArgs).where).toEqual({
            AND: [
                { startedAt: { lt: cutoff } },
                { status: { notIn: ["Pending", "Running"] } },
                { OR: [{ chainId: null }, { chainId: { notIn: ["chain-active"] } }] },
            ],
        });
        expect(prismaMock.execution.deleteMany).not.toHaveBeenCalled();
    });

    it("deletes a large backlog batch by batch", async () => {
        groupBy.mockResolvedValue([] as never);
        mockFindMany({}, [ids("x", HISTORY_DELETE_BATCH_SIZE), ids("y", 3)]);
        prismaMock.execution.deleteMany
            .mockResolvedValueOnce({ count: HISTORY_DELETE_BATCH_SIZE })
            .mockResolvedValueOnce({ count: 3 });

        const deleted = await deleteOldExecutions(365, NOW);

        expect(deleted).toBe(HISTORY_DELETE_BATCH_SIZE + 3);
        expect(prismaMock.execution.deleteMany).toHaveBeenCalledTimes(2);
    });
});
