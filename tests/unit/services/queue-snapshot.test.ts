// @vitest-environment node
/**
 * The snapshot of the queue every tenant shares: the jobs of every tenant with their usual length,
 * read once, and the runs their schedules start, planned once for the next minutes. Each page of
 * each tenant cuts its own window from it, and has to see the runs it would have worked out itself.
 */
import { beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import { prismaMock } from "@/lib/testing/prisma-mock";
import { offsetReader, zoneReader } from "@/lib/core/cron-window";

const { queueJobs, queueJobsChanged, queueRunEnded } = await import("@/services/jobs/queue-snapshot");
const { queuePlan } = await import("@/services/jobs/queue-schedules");

const MIN = 60_000;
const HOUR = 60 * MIN;
const NOW = Date.parse("2026-10-23T09:17:12.345Z");

const JOBS = [
    { id: "acme-erp", tenantId: "acme", schedule: "0 3 * * *", schedulePreset: null },
    { id: "acme-often", tenantId: "acme", schedule: "* * * * *", schedulePreset: null },
    { id: "beta-shop", tenantId: "beta", schedule: "*/5 * * * *", schedulePreset: { schedule: "30 2 * * *" } },
    { id: "beta-files", tenantId: "beta", schedule: "15 * * * *", schedulePreset: null },
    { id: "beta-often", tenantId: "beta", schedule: "*/10 * * * *", schedulePreset: null },
    { id: "beta-none", tenantId: "beta", schedule: "  ", schedulePreset: null },
];

const runs: Record<string, { id: string; status: string; startedAt: Date; endedAt: Date | null }[]> = {
    "acme-erp": [{ id: "e1", status: "Success", startedAt: new Date(NOW - 30 * HOUR), endedAt: new Date(NOW - 30 * HOUR + 40 * MIN) }],
    "beta-shop": [{ id: "s1", status: "Success", startedAt: new Date(NOW - 20 * HOUR), endedAt: new Date(NOW - 20 * HOUR + 10 * MIN) }],
};

/** The jobs whose runs the raw query of the usual length was asked for, once per query. */
const askedFor: string[][] = [];

beforeEach(() => {
    vi.clearAllMocks();
    askedFor.length = 0;
    queueJobsChanged();
    // The usual lengths outlive a refresh of the scheduler, so each test starts the process anew.
    const snapshot = (globalThis as unknown as { __dbackupQueueSnapshot: { estimates: Map<string, number>; estimatedAt: number; ended: Set<string> } }).__dbackupQueueSnapshot;
    snapshot.estimates = new Map();
    snapshot.estimatedAt = 0;
    snapshot.ended.clear();
    prismaMock.job.findMany.mockResolvedValue(JOBS as never);
    // How long the newest runs of the jobs it names took, summed by SQLite.
    prismaMock.$queryRaw.mockImplementation(((_strings: TemplateStringsArray, ...values: unknown[]) => {
        const ids = JSON.parse(values.find((value) => typeof value === "string" && value.startsWith("[")) as string) as string[];
        askedFor.push(ids);
        return Promise.resolve(ids.flatMap((jobId) => {
            const ended = (runs[jobId] ?? []).filter((run) => run.endedAt && run.status !== "Cancelled");
            const total = ended.reduce((sum, run) => sum + run.endedAt!.getTime() - run.startedAt.getTime(), 0);
            return runs[jobId] ? [{ jobId, odd: 0, total, counted: ended.length }] : [];
        }));
    }) as never);
    (prismaMock.execution.findMany as Mock).mockImplementation((args: { where: { id: { in: string[] } } }) =>
        Promise.resolve(Object.entries(runs).flatMap(([jobId, list]) => list.filter((run) => args.where.id.in.includes(run.id)).map((run) => ({ ...run, jobId })))));
});

describe("the jobs of the queue", () => {
    it("are the enabled jobs with a schedule of every tenant, by the schedule of their preset, with their usual length", async () => {
        const jobs = await queueJobs();

        expect(jobs).toEqual([
            { id: "acme-erp", tenantId: "acme", schedule: "0 3 * * *", estimatedMs: 40 * MIN },
            { id: "acme-often", tenantId: "acme", schedule: "* * * * *", estimatedMs: 60_000 },
            { id: "beta-shop", tenantId: "beta", schedule: "30 2 * * *", estimatedMs: 10 * MIN },
            { id: "beta-files", tenantId: "beta", schedule: "15 * * * *", estimatedMs: 60_000 },
            { id: "beta-often", tenantId: "beta", schedule: "*/10 * * * *", estimatedMs: 60_000 },
        ]);
        expect(prismaMock.job.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { enabled: true } }));
    });

    it("are read once, and only the usual length of a job whose run ended is read again", async () => {
        await queueJobs();
        runs["beta-files"] = [{ id: "f1", status: "Success", startedAt: new Date(NOW - HOUR), endedAt: new Date(NOW - HOUR + 3 * MIN) }];
        queueRunEnded("beta-files");

        const jobs = await queueJobs();

        expect(prismaMock.job.findMany).toHaveBeenCalledTimes(1);
        expect(askedFor.at(-1)).toEqual(["beta-files"]);
        expect(jobs.find((job) => job.id === "beta-files")?.estimatedMs).toBe(3 * MIN);
        delete runs["beta-files"];
    });

    it("are read again after a saved job or setting refreshed the scheduler, with the usual length of the new jobs alone", async () => {
        await queueJobs();
        prismaMock.job.findMany.mockResolvedValue([...JOBS, { id: "beta-new", tenantId: "beta", schedule: "0 6 * * *", schedulePreset: null }] as never);
        queueJobsChanged();
        const jobs = await queueJobs();

        expect(prismaMock.job.findMany).toHaveBeenCalledTimes(2);
        expect(askedFor.at(-1)).toEqual(["beta-new"]);
        expect(jobs.find((job) => job.id === "acme-erp")?.estimatedMs).toBe(40 * MIN);
    });

    it("read the usual length of a job whose run ended before the jobs are read again", async () => {
        await queueJobs();
        runs["acme-erp"] = [{ id: "e2", status: "Success", startedAt: new Date(NOW - HOUR), endedAt: new Date(NOW - HOUR + 20 * MIN) }];
        queueRunEnded("acme-erp");
        queueJobsChanged();

        const jobs = await queueJobs();

        expect(askedFor.at(-1)).toEqual(["acme-erp"]);
        expect(jobs.find((job) => job.id === "acme-erp")?.estimatedMs).toBe(20 * MIN);
        runs["acme-erp"] = [{ id: "e1", status: "Success", startedAt: new Date(NOW - 30 * HOUR), endedAt: new Date(NOW - 30 * HOUR + 40 * MIN) }];
    });
});

describe("the plan of the queue", () => {
    const limit = 576;
    const direct = (read: ReturnType<typeof zoneReader>, schedule: string) => {
        const times = read(schedule, limit + 1);
        return times ? { times: times.slice(0, limit), truncated: times.length > limit } : null;
    };

    it("gives every request of the next minutes the runs it would read itself, in the scheduler's time zone", async () => {
        await queuePlan({ timezone: "Europe/Zurich" }, NOW, NOW + 48 * HOUR);

        // A later request, whose window reaches over the change to winter time.
        for (const later of [NOW + 5 * MIN + 1, NOW + 9 * MIN]) {
            const plan = await queuePlan({ timezone: "Europe/Zurich" }, later, later + 48 * HOUR);
            const read = zoneReader("Europe/Zurich", later, later + 48 * HOUR, "croner");
            for (const job of [...JOBS.map((entry) => ({ id: entry.id, schedule: entry.schedulePreset?.schedule ?? entry.schedule })), { id: "new", schedule: "45 1 * * *" }]) {
                expect(plan.due(job, limit, read), `${job.id} at ${new Date(later).toISOString()}`).toEqual(direct(read, job.schedule));
            }
        }
    });

    it("gives the Timeline what it reads at the offset of now, a week ahead", async () => {
        const to = NOW + 7 * 24 * HOUR;
        const plan = await queuePlan({ offset: 120 }, NOW, to);
        const read = offsetReader(120, NOW, to);

        for (const job of JOBS) {
            const schedule = job.schedulePreset?.schedule ?? job.schedule;
            const times = read(schedule, 2017);
            expect(plan.due({ schedule }, 2016, read)).toEqual(times ? { times: times.slice(0, 2016), truncated: times.length > 2016 } : null);
        }
    });

    it("moves on to a later window by reading only the runs past its end, with the runs a request would read itself", async () => {
        const week = 7 * 24 * HOUR;
        const schedules = [...JOBS.map((job) => job.schedulePreset?.schedule ?? job.schedule), "*/5 * * * *", "0 4 * * 1"];
        await queuePlan({ offset: 120 }, NOW, NOW + week);

        // Moved on twice within the hour, then made anew, and once for a request that started before.
        for (const later of [NOW + 15 * MIN, NOW + 40 * MIN + 7, NOW + 3 * HOUR, NOW + 2 * HOUR]) {
            const plan = await queuePlan({ offset: 120 }, later, later + week);
            const read = offsetReader(120, later, later + week);
            for (const schedule of schedules) {
                const times = read(schedule, 2017);
                expect(plan.due({ schedule }, 2016, read), `${schedule} at ${new Date(later).toISOString()}`)
                    .toEqual(times ? { times: times.slice(0, 2016), truncated: times.length > 2016 } : null);
            }
        }
    });

    it("plans a schedule saved since the plan was made when a request first asks for it", async () => {
        const plan = await queuePlan({ offset: 0 }, NOW, NOW + 48 * HOUR);
        const read = vi.fn(offsetReader(0, NOW, NOW + 48 * HOUR));

        expect(plan.due({ schedule: "0 5 * * *" }, limit, read)?.times[0]).toBe(Date.parse("2026-10-24T05:00:00.000Z"));
        // Planned once for the window of the plan, which every later request reads.
        expect(read).not.toHaveBeenCalled();
        expect(plan.due({ schedule: "@daily" }, limit, read)).toBeNull();
        expect(read).toHaveBeenCalledWith("@daily", limit + 1);
    });
});
