import { beforeEach, describe, expect, it, vi } from "vitest";
import prisma from "@/lib/prisma";

vi.mock("@/lib/prisma", () => ({
    default: {
        systemSetting: { findUnique: vi.fn() },
        execution: { findMany: vi.fn() },
    },
}));

const started = vi.hoisted(() => [] as string[]);

vi.mock("@/lib/runner", () => ({
    performExecution: async (executionId: string) => { started.push(executionId); },
}));

vi.mock("@/lib/server/shutdown", () => ({ isShutdownRequested: () => false }));

vi.mock("@/lib/logging/logger", () => ({
    logger: { child: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }) },
}));

import { pickFairly } from "@/lib/core/queue-fairness";
import { planQueue, type QueueItem } from "@/lib/core/queue-plan";

interface Run {
    id: string;
    jobId: string;
    tenantId: string;
    status: "Pending" | "Running" | "Success";
}

/** The runs as the database holds them, oldest first, read the way the queue reads them. */
function database(runs: Run[], slots: number | null) {
    vi.mocked(prisma.systemSetting.findUnique).mockResolvedValue(
        slots === null ? null : { key: "maxConcurrentJobs", value: String(slots), description: null, updatedAt: new Date() },
    );
    vi.mocked(prisma.execution.findMany).mockImplementation((async (args: { where: { status: string } }) =>
        runs.filter((run) => run.status === args.where.status)) as never);
}

/** Lets the queue run until nothing waits, one run ending after the other, and answers the order of the starts. */
async function drain(processQueue: () => Promise<void>, runs: Run[]): Promise<string[]> {
    for (let round = 0; round < 50 && runs.some((run) => run.status !== "Success"); round++) {
        const before = started.length;
        await processQueue();
        for (const id of started.slice(before)) runs.find((run) => run.id === id)!.status = "Running";
        // The run that has run longest ends and frees its slot.
        const ending = runs.find((run) => run.status === "Running");
        if (ending) ending.status = "Success";
    }
    return [...started];
}

describe("one tenant cannot keep the backups of the others waiting behind its line", () => {
    let processQueue: () => Promise<void>;

    beforeEach(async () => {
        started.length = 0;
        // A fresh queue, like after a start of the server: no tenant had a turn yet.
        vi.resetModules();
        ({ processQueue } = await import("@/lib/execution/queue-manager"));
    });

    it("starts the run of the provider and of another customer before the second waiting run of a customer who queued six", async () => {
        // The default single slot. Customer A's schedule fired six more times while its run held it.
        const runs: Run[] = [
            { id: "a-running", jobId: "job-a", tenantId: "customer-a", status: "Running" },
            ...Array.from({ length: 6 }, (_, index): Run => ({ id: `a-${index + 1}`, jobId: "job-a", tenantId: "customer-a", status: "Pending" })),
            { id: "provider-1", jobId: "job-home", tenantId: "home", status: "Pending" },
            { id: "b-1", jobId: "job-b", tenantId: "customer-b", status: "Pending" },
        ];
        database(runs, null);

        await processQueue();
        expect(started).toEqual([]);

        runs[0].status = "Success";
        const order = await drain(processQueue, runs);

        // Oldest first while nobody had a turn, then everyone else before A again. It was a-1 to a-6 first.
        expect(order.slice(0, 4)).toEqual(["a-1", "provider-1", "b-1", "a-2"]);
        expect(order).toHaveLength(8);
    });

    it("gives a free slot to the tenant with the fewest running runs, so many jobs of one tenant do not take every slot", async () => {
        const runs: Run[] = [
            { id: "a-running", jobId: "job-a0", tenantId: "customer-a", status: "Running" },
            { id: "a-1", jobId: "job-a1", tenantId: "customer-a", status: "Pending" },
            { id: "a-2", jobId: "job-a2", tenantId: "customer-a", status: "Pending" },
            { id: "b-1", jobId: "job-b", tenantId: "customer-b", status: "Pending" },
        ];
        database(runs, 2);

        await processQueue();

        expect(started).toEqual(["b-1"]);
    });

    it("still uses every free slot for one tenant while no other tenant waits", async () => {
        database([
            { id: "a-1", jobId: "job-a1", tenantId: "customer-a", status: "Pending" },
            { id: "a-2", jobId: "job-a2", tenantId: "customer-a", status: "Pending" },
            { id: "a-3", jobId: "job-a3", tenantId: "customer-a", status: "Pending" },
        ], 3);

        await processQueue();

        expect(started).toEqual(["a-1", "a-2", "a-3"]);
    });

    it("never starts two runs of one job at once, whichever tenant has the turn", async () => {
        database([
            { id: "a-1", jobId: "job-a", tenantId: "customer-a", status: "Pending" },
            { id: "a-2", jobId: "job-a", tenantId: "customer-a", status: "Pending" },
            { id: "b-running", jobId: "job-b", tenantId: "customer-b", status: "Running" },
            { id: "b-2", jobId: "job-b", tenantId: "customer-b", status: "Pending" },
        ], 4);

        await processQueue();

        expect(started).toEqual(["a-1"]);
    });
});

describe("whose turn a free slot is", () => {
    it("prefers fewer running runs, then the tenant served longest ago, then the oldest run", () => {
        const waiting = [{ tenantId: "a" }, { tenantId: "b" }, { tenantId: "c" }];

        expect(pickFairly(waiting, new Map(), new Map())).toBe(0);
        expect(pickFairly(waiting, new Map([["a", 1]]), new Map())).toBe(1);
        expect(pickFairly(waiting, new Map(), new Map([["a", 5], ["b", 2]]))).toBe(2);
        expect(pickFairly(waiting, new Map(), new Map([["a", 5], ["b", 2], ["c", 3]]))).toBe(1);
        expect(pickFairly([], new Map(), new Map())).toBe(-1);
    });
});

describe("the planned queue of the Timeline follows the same turns", () => {
    const MIN = 60_000;
    const now = Date.parse("2026-11-11T03:00:00Z");

    it("plans the run of another tenant right after the running one, not behind the six waiting runs of its tenant", () => {
        const items: QueueItem[] = [
            { key: "a-running", jobId: "job-a", tenantId: "customer-a", due: now - 5 * MIN, durationMs: 10 * MIN, startedAt: now - 5 * MIN },
            ...Array.from({ length: 6 }, (_, index): QueueItem => ({ key: `a-${index + 1}`, jobId: "job-a", tenantId: "customer-a", due: now - (4 - index * 0.5) * MIN, durationMs: 10 * MIN })),
            { key: "b-1", jobId: "job-b", tenantId: "customer-b", due: now - MIN, durationMs: 2 * MIN },
        ];
        const plan = planQueue(items, 1, now);

        // The slot frees at 03:05. Customer A just had it, so customer B goes first.
        expect(plan.get("b-1")).toMatchObject({ start: now + 5 * MIN, waitsFor: ["job-a"] });
        expect(plan.get("a-1")?.start).toBe(now + 7 * MIN);
        expect(plan.get("a-2")?.start).toBe(now + 17 * MIN);
    });

    it("lets a run step aside while its job still runs, so the free slot goes to the next job", () => {
        const items: QueueItem[] = [
            { key: "long", jobId: "files", tenantId: "t", due: now, durationMs: 30 * MIN },
            { key: "again", jobId: "files", tenantId: "t", due: now + MIN, durationMs: 30 * MIN },
            { key: "other", jobId: "cache", tenantId: "t", due: now + 2 * MIN, durationMs: MIN },
        ];
        const plan = planQueue(items, 2, now);

        expect(plan.get("other")).toMatchObject({ start: now + 2 * MIN, waitMs: 0 });
        expect(plan.get("again")).toMatchObject({ start: now + 30 * MIN, waitsFor: ["files"] });
    });

    it("plans a week of a job that is due far more often than it ends without slowing the page", () => {
        const items: QueueItem[] = [];
        for (let index = 0; index < 2016; index++) {
            items.push({ key: `a-${index}`, jobId: "job-a", tenantId: "customer-a", due: now + index * 5 * MIN, durationMs: 60 * MIN });
            items.push({ key: `b-${index}`, jobId: `job-b${index % 50}`, tenantId: "customer-b", due: now + index * 5 * MIN, durationMs: 4 * MIN });
        }
        const startedAt = performance.now();
        const plan = planQueue(items, 1, now);

        expect(plan.size).toBe(items.length);
        expect(performance.now() - startedAt).toBeLessThan(2000);
    });
});
