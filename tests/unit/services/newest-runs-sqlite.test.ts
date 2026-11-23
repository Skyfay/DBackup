// @vitest-environment node
/**
 * The newest runs of each job, the summaries of the tenants, the dots of History, the health checks
 * of the connections and the usual length of a run in the plan of the queue, against a real SQLite
 * database migrated with the migrations of this version. Each is read with one raw query now,
 * where it took a query per job or a condition with a branch per job before, which SQLite refused
 * past 10,000 jobs. Every answer has to stay what the earlier way gave, which this test keeps here
 * as the reference, in each tenant and over every tenant.
 */
import { execFileSync } from "child_process";
import { mkdtempSync, rmSync } from "fs";
import os from "os";
import path from "path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PrismaClient } from "@prisma/client";
import { runAsSystem, runAsTenant } from "@/lib/tenant/context";
import { tenantScopeExtension } from "@/lib/tenant/prisma-scope";

vi.mock("@/lib/logging/logger", () => ({
    logger: { child: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }) },
}));

const app = vi.hoisted(() => ({ client: null as unknown as object }));
vi.mock("@/lib/prisma", () => ({
    default: new Proxy({}, {
        get: (_target, key) => {
            const value = Reflect.get(app.client, key);
            return typeof value === "function" ? value.bind(app.client) : value;
        },
    }),
}));
// The numbers of the storage and the connections other tenants share are not the subject here.
vi.mock("@/services/dashboard-service", () => ({ getStorageVolume: vi.fn(async () => []) }));
vi.mock("@/services/sharing/provided", () => ({ providedTo: vi.fn(async () => []), providedIds: vi.fn(async () => new Set()) }));

const { default: prisma } = await import("@/lib/prisma");
const { WHOLE_JOB_RUNS } = await import("@/services/history/whole-runs");
const { getRecentRunsByJob, toRunSummary } = await import("@/services/dashboard/aggregates");
const { estimateDuration } = await import("@/services/dashboard/schedule");
const { invalidateDashboardCache } = await import("@/services/dashboard/cache");
const { tenantSummaries } = await import("@/services/tenant/tenant-summaries");
const { getConnectionOverview, healthBuckets, latestRunPerJob } = await import("@/services/adapters/connection-overview");
const { getHistoryAttention } = await import("@/services/history/history-attention");
const { attentionOf, combineAttention } = await import("@/lib/core/tab-attention");
const { queueJobs, queueJobsChanged } = await import("@/services/jobs/queue-snapshot");

const TENANTS = ["default", "acme", "globex"];
const NOW = Date.parse("2026-10-18T06:00:00.000Z");
const HOUR = 3_600_000;
const FINISHED = ["Success", "Failed", "Partial", "Cancelled"];

/** The same data on every run of the test. */
let seed = 20261018;
const random = () => {
    seed = (seed * 16807) % 2147483647;
    return seed / 2147483647;
};
const pick = <T>(values: readonly T[]) => values[Math.floor(random() * values.length)];

let root = "";
let base: PrismaClient;
const jobIds: string[] = [];
const configIds: string[] = [];

async function seedData() {
    // No two rows share a time, so "the newest" is the same row for every way of asking.
    let tick = 0;
    const unique = (time: number) => time - (tick++ % 997) - 1_000 * (tick % 13);
    await runAsSystem(async () => {
        for (const tenantId of TENANTS) {
            await prisma.tenant.upsert({ where: { id: tenantId }, update: {}, create: { id: tenantId, name: tenantId } });
            const preset = await prisma.schedulePreset.create({ data: { name: `Nightly ${tenantId}`, schedule: "15 2 * * *", tenantId } });
            for (let index = 0; index < 3; index++) {
                const id = `${tenantId}-srv-${index}`;
                configIds.push(id);
                await prisma.adapterConfig.create({ data: { id, name: id, type: "database", adapterId: "postgres", config: "{}", tenantId } });
                const listed = index === 0 ? JSON.stringify(["a", "b", { name: "c" }]) : index === 1 ? "not json" : JSON.stringify({ name: "x" });
                await prisma.databaseListCache.create({ data: { adapterConfigId: id, databasesJson: listed } });
            }
            for (const kind of ["storage", "notification"]) {
                const id = `${tenantId}-${kind}`;
                configIds.push(id);
                await prisma.adapterConfig.create({ data: { id, name: id, type: kind, adapterId: kind === "storage" ? "local-filesystem" : "discord", config: "{}", tenantId } });
            }
            for (let index = 0; index < 8; index++) {
                const id = `${tenantId}-job-${index}`;
                jobIds.push(id);
                await prisma.job.create({
                    data: {
                        id,
                        name: `Job ${index} of ${tenantId}`,
                        schedule: pick(["0 * * * *", "30 3 * * *", "*/20 * * * *", "0 4 * * 1", "", "not a cron"]),
                        enabled: index !== 5,
                        sourceId: `${tenantId}-srv-0`,
                        schedulePresetId: index === 6 ? preset.id : null,
                        tenantId,
                    },
                });
                // A job without runs, one with runs of long ago, the others with a busy history.
                const runs = index === 7 ? 0 : 3 + Math.floor(random() * 30);
                for (let run = 0; run < runs; run++) {
                    const startedAt = unique(NOW - (index === 4 ? 40 * 24 * HOUR : 0) - run * 5 * HOUR - Math.floor(random() * HOUR));
                    const status = run === 0 && random() < 0.3 ? pick(["Running", "Pending"]) : pick(["Success", "Success", "Success", "Failed", "Partial", "Cancelled"]);
                    const ended = status === "Running" || status === "Pending" ? null : startedAt + Math.floor(random() * 30 * 60_000) - (random() < 0.05 ? 3_600_000 : 0);
                    await prisma.execution.create({
                        data: {
                            jobId: id,
                            type: random() < 0.1 ? "Restore" : "Backup",
                            status,
                            logs: "[]",
                            startedAt: new Date(startedAt),
                            endedAt: ended === null ? null : new Date(ended),
                            metadata: pick([null, '{"destinations":[]}', '{"onlyDatabases":["shop"]}', '{"destinations":[]}']),
                            tenantId,
                        },
                    });
                }
            }
            // A health check every few minutes over a little more than a day, some failed or offline.
            for (const configId of [`${tenantId}-srv-0`, `${tenantId}-srv-1`, `${tenantId}-storage`]) {
                for (let check = 0; check < 250; check++) {
                    await prisma.healthCheckLog.create({
                        data: {
                            adapterConfigId: configId,
                            status: pick(["ONLINE", "ONLINE", "ONLINE", "ONLINE", "DEGRADED", "OFFLINE"]),
                            latencyMs: Math.floor(random() * 500),
                            createdAt: new Date(unique(NOW - Math.floor(random() * 26 * HOUR))),
                        },
                    });
                }
            }
            for (let message = 0; message < 6; message++) {
                await prisma.notificationLog.create({
                    data: {
                        eventType: "backup_success",
                        channelId: `${tenantId}-notification`,
                        channelName: "Channel",
                        adapterId: "discord",
                        status: pick(["Success", "Failed"]),
                        title: "Backup",
                        message: "Done",
                        sentAt: new Date(unique(NOW - message * HOUR)),
                        tenantId,
                    },
                });
            }
        }
    });
}

beforeAll(async () => {
    vi.useFakeTimers({ now: NOW, toFake: ["Date"] });
    root = mkdtempSync(path.join(os.tmpdir(), "dbackup-newest-"));
    const file = path.join(root, "newest.db");
    execFileSync(path.join(process.cwd(), "node_modules", ".bin", "prisma"), ["migrate", "deploy"], {
        env: { ...process.env, DATABASE_URL: `file:${file}` },
        stdio: "pipe",
    });
    base = new PrismaClient({ datasources: { db: { url: `file:${file}` } } });
    app.client = base.$extends(tenantScopeExtension(async () => null));
    await seedData();
}, 120_000);

afterAll(async () => {
    vi.useRealTimers();
    await base?.$disconnect();
    if (root) rmSync(root, { recursive: true, force: true });
});

/** Each tenant on its own and every tenant at once. */
const scopes: [string, <T>(fn: () => Promise<T>) => Promise<T>][] = [
    ...TENANTS.map((tenantId): [string, <T>(fn: () => Promise<T>) => Promise<T>] => [tenantId, (fn) => runAsTenant(tenantId, fn)]),
    ["every tenant", (fn) => runAsSystem(fn)],
];

// The earlier ways, as the reference.

async function referenceRunsByJob() {
    const jobs = await prisma.job.findMany({ select: { id: true } });
    const entries = await Promise.all(jobs.map(async (job) => {
        const runs = await prisma.execution.findMany({
            where: { jobId: job.id, type: "Backup", AND: [WHOLE_JOB_RUNS] },
            orderBy: { startedAt: "desc" },
            take: 12,
            select: { id: true, status: true, startedAt: true, endedAt: true },
        });
        return [job.id, runs.map(toRunSummary)] as const;
    }));
    return Object.fromEntries(entries);
}

async function referenceSummaries(tenantIds: string[]) {
    const inTenants = { tenantId: { in: tenantIds } };
    const listedCount = (json: string) => {
        try {
            const value: unknown = JSON.parse(json);
            return Array.isArray(value) ? value.length : 0;
        } catch {
            return 0;
        }
    };
    return runAsSystem(async () => {
        const jobs = await prisma.job.groupBy({ by: ["tenantId"], where: inTenants, _count: { _all: true } });
        const caches = await prisma.databaseListCache.findMany({
            where: { adapterConfig: { ...inTenants, type: "database" } },
            select: { databasesJson: true, adapterConfig: { select: { tenantId: true } } },
        });
        const newest = await prisma.execution.groupBy({
            by: ["jobId"],
            where: { ...inTenants, jobId: { not: null }, type: "Backup", status: { in: FINISHED } },
            _max: { startedAt: true },
        });
        const troubled = await prisma.execution.findMany({
            where: { type: "Backup", status: { in: ["Failed", "Partial"] }, OR: newest.map((row) => ({ jobId: row.jobId, startedAt: row._max.startedAt ?? undefined })) },
            select: { tenantId: true, status: true },
        });
        return tenantIds.map((id) => {
            const runs = troubled.filter((run) => run.tenantId === id);
            return {
                id,
                jobs: jobs.find((row) => row.tenantId === id)?._count._all ?? 0,
                databases: caches.filter((cache) => cache.adapterConfig.tenantId === id).reduce((sum, cache) => sum + listedCount(cache.databasesJson), 0),
                shared: 0,
                health: runs.some((run) => run.status === "Failed") ? "failed" : runs.length > 0 ? "partial" : null,
            };
        });
    });
}

async function referenceLatestRunPerJob(ids: string[]) {
    const result = new Map<string, { id: string; at: string; status: string }>();
    const newest = await prisma.execution.groupBy({
        by: ["jobId"],
        where: { jobId: { in: ids }, type: "Backup", status: { in: ["Success", "Failed", "Partial"] } },
        _max: { startedAt: true },
    });
    const keys = newest.flatMap((row) => (row.jobId && row._max.startedAt ? [{ jobId: row.jobId, startedAt: row._max.startedAt }] : []));
    if (keys.length === 0) return result;
    const runs = await prisma.execution.findMany({ where: { OR: keys, type: "Backup", status: { in: ["Success", "Failed", "Partial"] } }, select: { id: true, jobId: true, status: true, startedAt: true } });
    for (const run of runs) if (run.jobId) result.set(run.jobId, { id: run.id, at: run.startedAt.toISOString(), status: run.status });
    return result;
}

async function referenceTroubledJobs() {
    const newest = await prisma.execution.groupBy({
        by: ["jobId"],
        where: { jobId: { not: null }, type: "Backup", status: { in: FINISHED }, AND: [WHOLE_JOB_RUNS] },
        _max: { startedAt: true },
    });
    if (newest.length === 0) return [];
    const runs = await prisma.execution.findMany({
        where: { type: "Backup", status: { in: ["Failed", "Partial"] }, OR: newest.map((row) => ({ jobId: row.jobId, startedAt: row._max.startedAt ?? undefined })), AND: [WHOLE_JOB_RUNS] },
        select: { status: true, job: { select: { name: true } } },
    });
    const jobs = (status: string) => runs.filter((run) => run.status === status && run.job).map((run) => run.job!.name).sort((a, b) => a.localeCompare(b));
    return combineAttention(
        attentionOf("destructive", jobs("Failed"), "failed on its last run", "failed on their last run"),
        attentionOf("warning", jobs("Partial"), "missed a copy on its last run", "missed a copy on their last run"),
    );
}

async function referenceHealth(ids: string[]) {
    const now = new Date();
    const checks = await prisma.healthCheckLog.findMany({
        where: { adapterConfigId: { in: ids }, createdAt: { gte: new Date(now.getTime() - 24 * HOUR) } },
        select: { adapterConfigId: true, status: true, latencyMs: true, createdAt: true },
        orderBy: { createdAt: "asc" },
    });
    return new Map(ids.map((id) => {
        const own = checks.filter((check) => check.adapterConfigId === id);
        const lastPassed = [...own].reverse().find((check) => check.status === "ONLINE");
        return [id, { ...healthBuckets(own, now), latencyMs: lastPassed?.latencyMs ?? null }];
    }));
}

describe("the newest runs of each job", () => {
    it.each(scopes)("are the newest twelve runs of the whole job, the same as a query per job, in %s", async (_name, within) => {
        invalidateDashboardCache();
        const [reference, runs] = await within(async () => [await referenceRunsByJob(), await getRecentRunsByJob()]);

        expect(Object.keys(runs).sort()).toEqual(Object.keys(reference).sort());
        expect(runs).toEqual(reference);
        expect(Object.values(runs).some((list) => list.length === 12)).toBe(true);
    });

    it.each(scopes)("give the newest finished backup of each job, the same as the condition per job, in %s", async (_name, within) => {
        const [reference, latest] = await within(async () => [await referenceLatestRunPerJob(jobIds), await latestRunPerJob(jobIds)]);

        expect([...latest].sort()).toEqual([...reference].sort());
    });

    it.each(scopes)("mark the same jobs on the History tab, in %s", async (_name, within) => {
        const [reference, attention] = await within(async () => [await referenceTroubledJobs(), await getHistoryAttention()] as const);

        expect(attention.runs).toEqual(reference);
    });
});

describe("the summaries of the tenants", () => {
    it("count the jobs and databases and mark the health of each tenant like before", async () => {
        invalidateDashboardCache();
        const [reference, summaries] = [await referenceSummaries(TENANTS), await tenantSummaries(TENANTS)];

        expect(summaries).toEqual(reference);
        expect(summaries.some((summary) => summary.health !== null)).toBe(true);
    });
});

describe("the health checks of the connections", () => {
    it.each(scopes)("fill the hours, the share that passed and the newest response time like before, in %s", async (_name, within) => {
        invalidateDashboardCache();
        const [reference, overview] = await within(async () => [await referenceHealth(configIds), await getConnectionOverview(configIds)]);

        expect(overview.size).toBeGreaterThan(0);
        for (const [id, entry] of overview) {
            const { health, checksPassed, latencyMs } = entry;
            expect({ health, checksPassed, latencyMs }, id).toEqual(reference.get(id));
        }
    });
});

describe("the usual length of a run in the plan of the queue", () => {
    it("is the one of the newest runs of each enabled job with a schedule, of every tenant", async () => {
        queueJobsChanged();
        invalidateDashboardCache();
        const [snapshot, reference, jobs] = await runAsSystem(async () => [
            await queueJobs(),
            await referenceRunsByJob(),
            await prisma.job.findMany({ where: { enabled: true }, select: { id: true, schedule: true, schedulePreset: { select: { schedule: true } } } }),
        ] as const);
        const scheduled = jobs.filter((job) => (job.schedulePreset?.schedule ?? job.schedule).trim());

        expect(snapshot.map((job) => job.id).sort()).toEqual(scheduled.map((job) => job.id).sort());
        for (const job of snapshot) expect(job.estimatedMs, job.id).toBe(estimateDuration(reference[job.id] ?? []));
        // The job that follows a preset is planned by the preset's schedule.
        expect(snapshot.find((job) => job.id.endsWith("-job-6"))?.schedule).toBe("15 2 * * *");
    });

    it("is read run by run for a job whose times SQLite holds as text, like a row an older version wrote by hand", async () => {
        const run = await runAsSystem(() => prisma.execution.findFirst({
            where: { jobId: "acme-job-0", type: "Backup", status: "Success", endedAt: { not: null } },
            orderBy: { startedAt: "desc" },
            select: { id: true, startedAt: true },
        }));
        // Ended 42 minutes after it started, written as text.
        const ended = new Date(run!.startedAt.getTime() + 42 * 60_000).toISOString();
        await base.$executeRawUnsafe(`UPDATE Execution SET endedAt = ? WHERE id = ?`, ended, run!.id);
        const snapshot = (globalThis as unknown as { __dbackupQueueSnapshot: { estimates: Map<string, number>; estimatedAt: number } }).__dbackupQueueSnapshot;
        snapshot.estimates = new Map();
        snapshot.estimatedAt = 0;
        queueJobsChanged();
        invalidateDashboardCache();

        const [jobs, reference] = await runAsSystem(async () => [await queueJobs(), await referenceRunsByJob()] as const);

        expect(reference["acme-job-0"].some((entry) => entry.id === run!.id && entry.endedAt !== null)).toBe(true);
        expect(jobs.find((job) => job.id === "acme-job-0")?.estimatedMs).toBe(estimateDuration(reference["acme-job-0"]));
    });
});
