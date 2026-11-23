// @vitest-environment node
/**
 * The pages of the Jobs page and of the Databases tab of the Database Explorer, against a real
 * SQLite database migrated with the migrations of this version. The server pages, searches, filters
 * and counts both lists now, where the browser did it with every job and every database. Each page
 * has to show what the earlier way showed of the whole list, which this test keeps here as the
 * reference: the jobs of `getJobList` with the rules the page applied to them, and the last backup
 * of each database from the last 40 kept runs of every job. In each tenant and over every tenant.
 */
import { execFileSync } from "child_process";
import { mkdtempSync, rmSync } from "fs";
import os from "os";
import path from "path";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "@prisma/client";
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
// The destinations other tenants share are not the subject here.
vi.mock("@/services/sharing/provided", () => ({ providedTo: vi.fn(async () => []), providedIds: vi.fn(async () => new Set()) }));

const { default: prisma } = await import("@/lib/prisma");
const { openCopy } = await import("@/services/config/database-copy");
const { invalidateDashboardCache } = await import("@/services/dashboard/cache");
const { getJobList } = await import("@/services/jobs/job-list-service");
const { listJobPage } = await import("@/services/jobs/job-page-service");
const { databaseExplorerService } = await import("@/services/databases/database-explorer-service");
const { listDatabasePage } = await import("@/services/databases/database-page-service");
const { lastBackupOfJobs, lastBackupsOf, namesOfRun, isInstance } = await import("@/services/databases/database-explorer-model");
const { pageOfDatabases, summarize } = await import("@/services/databases/database-list-model");

type JobListItem = Awaited<ReturnType<typeof getJobList>>[number];
type JobFilter = "all" | "attention" | "running" | "paused";

const TENANTS = ["default", "acme", "globex"];
const NOW = Date.parse("2026-10-18T06:00:00.000Z");
const HOUR = 3_600_000;

let seed = 20261018;
const random = () => {
    seed = (seed * 16807) % 2147483647;
    return seed / 2147483647;
};
const pick = <T>(values: readonly T[]) => values[Math.floor(random() * values.length)];

let root = "";
let base: PrismaClient;

async function seedData() {
    // No two runs share a time, so "the newest" is the same run for every way of asking.
    let tick = 0;
    const unique = (time: number) => time - (tick++ % 997) * 1_000;
    await runAsSystem(async () => {
        for (const [tenantIndex, tenantId] of TENANTS.entries()) {
            await prisma.tenant.upsert({ where: { id: tenantId }, update: {}, create: { id: tenantId, name: tenantId } });
            const preset = await prisma.schedulePreset.create({ data: { name: `Nightly ${tenantId}`, schedule: "15 2 * * *", tenantId } });
            const servers = [
                { id: `${tenantId}-pg-0`, adapterId: "postgres", list: [{ name: "a", sizeInBytes: 300, tableCount: 4 }, { name: "b", sizeInBytes: 900 }, { name: "c" }] },
                { id: `${tenantId}-pg-1`, adapterId: "postgres", list: [{ name: "a", sizeInBytes: 300 }, { name: "d", sizeInBytes: 50, tableCount: 2 }] },
                { id: `${tenantId}-redis`, adapterId: "redis", list: [{ name: "0", tableCount: 12 }, { name: "1", tableCount: 0 }] },
                { id: `${tenantId}-unread`, adapterId: "mysql", list: null },
            ];
            for (const server of servers) {
                await prisma.adapterConfig.create({
                    data: { id: server.id, name: `${server.id} server`, type: "database", adapterId: server.adapterId, config: "{}", tenantId, metadata: JSON.stringify({ engineVersion: "16.4" }) },
                });
                if (server.list) await prisma.databaseListCache.create({ data: { adapterConfigId: server.id, databasesJson: JSON.stringify(server.list), readAt: new Date(NOW - HOUR) } });
                await prisma.dbVersionHistory.create({ data: { adapterConfigId: server.id, previousVersion: "16.2", newVersion: "16.4", detectedAt: new Date(NOW - 24 * HOUR) } });
            }
            for (let index = 0; index < 10; index++) {
                const id = `${tenantId}-job-${index}`;
                const server = servers[index % 3];
                await prisma.job.create({
                    data: {
                        id,
                        name: `${index % 4 === 0 ? "Shop" : "Job"} ${index} of ${tenantId}`,
                        schedule: pick(["0 * * * *", "30 3 * * *", "*/20 * * * *", "0 4 * * 1", "not a cron"]),
                        enabled: index !== 4,
                        sourceId: server.id,
                        databases: index % 3 === 0 ? JSON.stringify(["a"]) : "[]",
                        schedulePresetId: index === 6 ? preset.id : null,
                        createdAt: new Date(NOW - (index * 60 + tenantIndex) * 60_000),
                        tenantId,
                    },
                });
                // A job without runs, the others with a history, newest first, some running now.
                const runs = index === 7 ? 0 : 3 + Math.floor(random() * 30);
                for (let run = 0; run < runs; run++) {
                    const startedAt = unique(NOW - run * 5 * HOUR - Math.floor(random() * HOUR));
                    const status = run === 0 && random() < 0.3 ? pick(["Running", "Pending"]) : pick(["Success", "Success", "Success", "Failed", "Partial", "Cancelled"]);
                    const live = status === "Running" || status === "Pending";
                    const listed = server.list?.map((entry) => entry.name) ?? [];
                    const metadata = live
                        ? JSON.stringify({ stage: "Uploading", progress: Math.floor(random() * 100) })
                        : pick([null, JSON.stringify({ names: listed }), JSON.stringify({ names: listed.slice(0, 1) }), JSON.stringify({ databases: listed }), JSON.stringify({ onlyDatabases: ["a"], names: ["a"] })]);
                    await prisma.execution.create({
                        data: {
                            jobId: id,
                            type: "Backup",
                            status,
                            logs: JSON.stringify([{ level: "error", message: `Run ${run} of ${id} went wrong` }]),
                            startedAt: new Date(startedAt),
                            endedAt: live ? null : new Date(startedAt + Math.floor(random() * 30 * 60_000)),
                            metadata,
                            size: BigInt(1_000 + run),
                            tenantId,
                        },
                    });
                }
            }
            // A restore that runs now is no run of its job.
            await prisma.execution.create({ data: { jobId: `${tenantId}-job-2`, type: "Restore", status: "Running", logs: "[]", startedAt: new Date(NOW - 60_000), tenantId } });
        }
    });
}

beforeAll(async () => {
    vi.useFakeTimers({ now: NOW, toFake: ["Date"] });
    root = mkdtempSync(path.join(os.tmpdir(), "dbackup-paged-"));
    const file = path.join(root, "paged.db");
    execFileSync(path.join(process.cwd(), "node_modules", ".bin", "prisma"), ["migrate", "deploy"], {
        env: { ...process.env, DATABASE_URL: `file:${file}` },
        stdio: "pipe",
    });
    base = openCopy(file);
    app.client = base.$extends(tenantScopeExtension(async () => null));
    await seedData();
}, 120_000);

afterAll(async () => {
    vi.useRealTimers();
    await base?.$disconnect();
    if (root) rmSync(root, { recursive: true, force: true });
});

beforeEach(() => invalidateDashboardCache());

/** Each tenant on its own and every tenant at once, the way All tenants reads them. */
const scopes: [string, <T>(fn: () => Promise<T>) => Promise<T>, boolean][] = [
    ...TENANTS.map((tenantId): [string, <T>(fn: () => Promise<T>) => Promise<T>, boolean] => [tenantId, (fn) => runAsTenant(tenantId, fn), false]),
    ["every tenant", (fn) => runAsSystem(fn), true],
];

// The earlier ways, as the reference: every job and the rules the page applied in the browser.

const FINISHED = new Set(["Success", "Failed", "Partial", "Cancelled"]);
const DONE = new Set(["Success", "Failed", "Partial"]);

function lastOutcome(job: JobListItem): string | null {
    for (let index = job.overview.runs.length - 1; index >= 0; index--) {
        if (FINISHED.has(job.overview.runs[index].status)) return job.overview.runs[index].status;
    }
    return null;
}

function matches(job: JobListItem, filter: JobFilter): boolean {
    if (filter === "attention") return lastOutcome(job) === "Failed" || lastOutcome(job) === "Partial";
    if (filter === "running") return job.overview.live !== null;
    if (filter === "paused") return !job.enabled;
    return true;
}

function referenceJobs(all: JobListItem[], query: { filter?: JobFilter; search?: string; tenantIds?: string[]; page?: number; pageSize?: number }) {
    const search = query.search?.toLowerCase() ?? "";
    const shown = all
        .filter((job) => matches(job, query.filter ?? "all"))
        .filter((job) => job.name.toLowerCase().includes(search))
        .filter((job) => !query.tenantIds?.length || query.tenantIds.includes(job.tenantId));
    const size = query.pageSize ?? 25;
    const page = query.page ?? 1;
    return { rows: shown.slice((page - 1) * size, page * size), total: shown.length };
}

function referenceStats(all: JobListItem[]) {
    const runs = all.flatMap((job) => job.overview.runs).filter((run) => DONE.has(run.status));
    const named = (outcome: string) => all.filter((job) => lastOutcome(job) === outcome).map((job) => job.name);
    const next = all.filter((job) => job.overview.nextRunAt).sort((a, b) => Date.parse(a.overview.nextRunAt!) - Date.parse(b.overview.nextRunAt!))[0];
    const running = all.filter((job) => job.overview.live?.status === "Running");
    return {
        total: all.length,
        paused: all.filter((job) => !job.enabled).length,
        runs: { succeeded: runs.filter((run) => run.status === "Success").length, partial: runs.filter((run) => run.status === "Partial").length, failed: runs.filter((run) => run.status === "Failed").length },
        failed: { count: named("Failed").length, names: named("Failed").slice(0, 3) },
        partial: { count: named("Partial").length, names: named("Partial").slice(0, 3) },
        next: next ? { at: next.overview.nextRunAt, name: next.name } : null,
        running: { count: running.length, jobs: running.slice(0, 10).map((job) => ({ name: job.name, progress: job.overview.live?.progress ?? null })) },
        waiting: all.filter((job) => job.overview.live?.status === "Pending").length,
    };
}

/** The last backup of each database as the explorer read it before: the last 40 kept runs of every job. */
async function referenceLastBackups() {
    const overview = await databaseExplorerService.getOverview({ withJobs: true });
    const kept = (await Promise.all(overview.jobs.map((job) => prisma.execution.findMany({
        where: { jobId: job.id, type: "Backup", status: { in: ["Success", "Partial"] } },
        orderBy: { startedAt: "desc" },
        take: 40,
        select: { id: true, jobId: true, status: true, startedAt: true, size: true, metadata: true },
    })))).flat()
        .sort((a, b) => b.startedAt.getTime() - a.startedAt.getTime())
        .map((run) => ({ id: run.id, jobId: run.jobId!, status: run.status as "Success" | "Partial", startedAt: run.startedAt.toISOString(), size: run.size === null ? null : Number(run.size), names: namesOfRun(run.metadata) }));
    const listed = overview.databases.filter((database) => database.kind === "database");
    const byKey = lastBackupsOf(kept, overview.jobs, listed);
    return new Map(overview.databases.map((database) => [database.key, database.kind === "database"
        ? byKey.get(database.key) ?? null
        : lastBackupOfJobs(kept, overview.jobs.filter((job) => job.enabled && job.serverId === database.serverId).map((job) => job.id))]));
}

describe.each(scopes)("the paged lists in %s", (_name, inScope, byTenant) => {
    it("shows the jobs of every page as the full list did, with the same counts and numbers", async () => {
        await inScope(async () => {
            const all = await getJobList();
            // Every quick filter holds some job of every tenant, so each rule is put to the test.
            if (byTenant) for (const value of ["attention", "running", "paused"] as const) expect(all.filter((job) => matches(job, value)).length).toBeGreaterThan(0);
            expect(all.length).toBeGreaterThan(0);
            const queries = [
                { pageSize: 4 },
                { page: 2, pageSize: 4 },
                { filter: "attention" as const, pageSize: 5 },
                { filter: "running" as const },
                { filter: "paused" as const },
                { search: "shop", pageSize: 3 },
                { search: "SHOP", filter: "attention" as const },
                ...(byTenant ? [{ tenantIds: ["acme", "globex"], pageSize: 7 }] : []),
            ];
            for (const query of queries) {
                const page = await listJobPage(query, { byTenant });
                const reference = referenceJobs(all, query);
                expect(page.total).toBe(reference.total);
                // The same rows in the same order, each as the full list showed it.
                expect(page.rows).toEqual(reference.rows);
                expect(page.counts).toEqual(Object.fromEntries((["all", "attention", "running", "paused"] as const).map((value) => [value, all.filter((job) => matches(job, value)).length])));
                expect(page.stats).toEqual(referenceStats(all));
                expect(page.live).toBe(all.some((job) => job.overview.live !== null));
                if (byTenant) {
                    const counted = all.filter((job) => matches(job, query.filter ?? "all") && job.name.toLowerCase().includes(query.search?.toLowerCase() ?? ""));
                    expect(page.tenants).toEqual(Object.fromEntries(TENANTS.map((id) => [id, counted.filter((job) => job.tenantId === id).length]).filter(([, count]) => count !== 0)));
                } else {
                    expect(page.tenants).toBeUndefined();
                }
            }
        });
    });

    it("reads the jobs a link names whatever page they are on, and none of another tenant", async () => {
        await inScope(async () => {
            const all = await getJobList();
            const last = all[all.length - 1];
            const page = await listJobPage({ ids: [last.id, "globex-job-1", "gone"], pageSize: 1 }, { byTenant });
            const known = new Set(all.map((job) => job.id));
            expect(page.rows.map((job) => job.id)).toEqual([...new Set([last.id, "globex-job-1"])].filter((id) => known.has(id)));
            expect(page.rows[0]).toEqual(last);
        });
    });

    it("gives every database the last backup the last 40 kept runs of its jobs gave", async () => {
        await inScope(async () => {
            const overview = await databaseExplorerService.getOverview({ withJobs: true });
            const reference = await referenceLastBackups();
            expect(overview.databases.length).toBeGreaterThan(0);
            // Some databases were backed up, some only by an older run than the newest of their job.
            expect([...reference.values()].some((last) => last !== null)).toBe(true);
            for (const database of overview.databases) expect(database.lastBackup).toEqual(reference.get(database.key));
        });
    });

    it("shows a page of the databases with the servers and jobs of its rows and the numbers of every database", async () => {
        await inScope(async () => {
            const overview = await databaseExplorerService.getOverview({ withJobs: true });
            const briefs = overview.servers.map(({ version: _version, versionSince: _since, previousVersion: _previous, ...brief }) => brief);
            for (const query of [{ pageSize: 3 }, { page: 2, pageSize: 3, sort: "database" as const, desc: false }, { states: ["never", "no-job"], pageSize: 50 }, { search: "a", engines: ["redis", "postgres"] }]) {
                const page = await listDatabasePage(query, { withJobs: true, byTenant });
                const reference = pageOfDatabases(overview.databases, briefs, true, query, byTenant);
                expect(page.rows).toEqual(reference.rows);
                expect(page.total).toBe(reference.total);
                expect(page.facets).toEqual(reference.facets);
                const shown = new Set(page.rows.map((row) => row.serverId));
                expect(page.servers).toEqual(overview.servers.filter((server) => shown.has(server.id)));
                expect(page.jobs).toEqual(overview.jobs.filter((job) => shown.has(job.serverId)));
                expect(page.summary).toEqual(summarize(overview));
                expect(page.serverList).toEqual(briefs);
                expect(page.jobOptions).toEqual(overview.jobs.filter((job) => job.enabled).map((job) => ({ id: job.id, name: job.name })));
                expect(page.keyStores).toEqual(overview.servers.some((server) => isInstance(server.adapterId) && overview.databases.some((database) => database.key === server.id)) ? ["redis"] : []);
            }
        });
    });

    it("leaves the jobs out of the databases for a viewer who may not see jobs", async () => {
        await inScope(async () => {
            const page = await listDatabasePage({ jobIds: ["acme-job-1"] }, { withJobs: false, byTenant });
            expect(page.coverage).toBe(false);
            expect(page.jobs).toEqual([]);
            expect(page.jobOptions).toEqual([]);
            expect(page.rows.every((row) => row.jobIds.length === 0 && row.lastBackup === null)).toBe(true);
            expect(page.total).toBe(page.summary.databases);
        });
    });
});
