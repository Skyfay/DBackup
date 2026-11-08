// @vitest-environment node
/**
 * A run of single databases, like a backup a customer started of a database a shared server gives
 * it, stays out of the usual length of the job, and a run that follows another one, like the
 * provider's run of a customer's restore, neither waits for nor fills a slot of the queue, against a
 * real SQLite database migrated with the migrations of this version, since a filter on a text column
 * that may be null is easy to get wrong.
 */
import { execFileSync } from "child_process";
import { mkdtempSync, rmSync } from "fs";
import os from "os";
import path from "path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PrismaClient } from "@prisma/client";
import { runAsTenant } from "@/lib/tenant/context";
import { tenantScopeExtension } from "@/lib/tenant/prisma-scope";
import { WHOLE_JOB_RUNS, isSingleDatabaseRun } from "@/services/history/whole-runs";
import { LEADING_RUNS, activeFollowersOf, leaderOf } from "@/lib/execution/follower-runs";

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

const { usualOf } = await import("@/services/history/run-list-service");

let root = "";
let base: PrismaClient;

const at = (minute: number) => new Date(Date.UTC(2026, 9, 17, 2, minute));

beforeAll(async () => {
    root = mkdtempSync(path.join(os.tmpdir(), "dbackup-whole-runs-"));
    const file = path.join(root, "runs.db");
    execFileSync(path.join(process.cwd(), "node_modules", ".bin", "prisma"), ["migrate", "deploy"], {
        env: { ...process.env, DATABASE_URL: `file:${file}` },
        stdio: "pipe",
    });
    base = new PrismaClient({ datasources: { db: { url: `file:${file}` } } });
    app.client = base.$extends(tenantScopeExtension(async () => null));
    await base.adapterConfig.create({ data: { id: "server", name: "Shared MySQL", type: "database", adapterId: "mysql", config: "{}" } });
    await base.job.create({ data: { id: "nightly", name: "Nightly", schedule: "0 2 * * *", sourceId: "server" } });
    // Three whole runs of five minutes, one without metadata, and two runs of single databases of ten seconds.
    const runs = [
        { id: "whole-1", start: 0, seconds: 300, metadata: null },
        { id: "whole-2", start: 10, seconds: 300, metadata: JSON.stringify({ progress: 100, stage: "Completed" }) },
        { id: "whole-3", start: 20, seconds: 300, metadata: JSON.stringify({ progress: 100, destinations: [] }) },
        { id: "single-1", start: 30, seconds: 10, metadata: JSON.stringify({ progress: 100, onlyDatabases: ["acme_shop"] }) },
        { id: "single-2", start: 40, seconds: 10, metadata: JSON.stringify({ onlyDatabases: ["acme_crm"] }) },
    ];
    for (const run of runs) {
        await base.execution.create({
            data: { id: run.id, jobId: "nightly", type: "Backup", status: "Success", logs: "[]", startedAt: at(run.start), endedAt: new Date(at(run.start).getTime() + run.seconds * 1000), metadata: run.metadata },
        });
    }
    // Running now: a backup without metadata, a customer's restore and the provider's run beside it.
    // Waiting: a backup a customer started of a shared database and the customer's run of it.
    const live = [
        { id: "running-backup", type: "Backup", status: "Running", metadata: null },
        { id: "restore-acme", type: "Restore", status: "Running", metadata: JSON.stringify({ progress: 40, restoreOf: { database: "acme_shop" } }) },
        { id: "restore-msp", type: "Restore", status: "Running", metadata: JSON.stringify({ progress: 40, restoreOf: { database: "acme_shop", customer: "Acme" }, followsRun: "restore-acme" }) },
        { id: "backup-msp", type: "Backup", status: "Pending", metadata: JSON.stringify({ progress: 0, stage: "Queued", onlyDatabases: ["acme_shop"] }) },
        { id: "backup-acme", type: "Backup", status: "Pending", metadata: JSON.stringify({ progress: 0, stage: "Queued", backupOf: { database: "acme_shop", provider: "Default" }, followsRun: "backup-msp" }) },
    ];
    for (const run of live) {
        await base.execution.create({ data: { ...run, tenantId: "default", logs: "[]", startedAt: at(50) } });
    }
}, 120_000);

afterAll(async () => {
    await base?.$disconnect();
    if (root) rmSync(root, { recursive: true, force: true });
});

describe("the runs of a job as a whole", () => {
    it("keep a run without metadata and leave the runs of single databases out", async () => {
        const ids = (await base.execution.findMany({ where: { jobId: "nightly", AND: [WHOLE_JOB_RUNS] }, orderBy: { startedAt: "asc" }, select: { id: true } })).map((run) => run.id);
        expect(ids).toEqual(["whole-1", "whole-2", "whole-3"]);
    });

    it("give the usual length of the job, which a customer's backup of one database does not pull down", async () => {
        await expect(runAsTenant("default", () => usualOf("nightly"))).resolves.toBe(300_000);
    });

    it("leave a run that follows another one out of the queue, which the run it follows holds a slot of", async () => {
        const running = (await base.execution.findMany({ where: { status: "Running", AND: [LEADING_RUNS] }, orderBy: { id: "asc" }, select: { id: true } })).map((run) => run.id);
        expect(running).toEqual(["restore-acme", "running-backup"]);
        // The customer's run of a backup never starts from the queue, the real run does.
        const waiting = (await base.execution.findMany({ where: { status: "Pending", AND: [LEADING_RUNS] }, select: { id: true } })).map((run) => run.id);
        expect(waiting).toEqual(["backup-msp"]);
    });

    it("find the followers of a run in any tenant, and the run a follower follows", async () => {
        expect((await activeFollowersOf("backup-msp")).map((run) => run.id)).toEqual(["backup-acme"]);
        expect((await activeFollowersOf("restore-acme")).map((run) => run.id)).toEqual(["restore-msp"]);
        expect(await activeFollowersOf("running-backup")).toEqual([]);
        expect(leaderOf(JSON.stringify({ followsRun: "backup-msp" }))).toBe("backup-msp");
        expect(leaderOf(JSON.stringify({ progress: 1 }))).toBeNull();
        expect(leaderOf(null)).toBeNull();
    });

    it("tell a run of single databases by its metadata", () => {
        expect(isSingleDatabaseRun(JSON.stringify({ onlyDatabases: ["acme_shop"] }))).toBe(true);
        expect(isSingleDatabaseRun(JSON.stringify({ progress: 100 }))).toBe(false);
        expect(isSingleDatabaseRun(null)).toBe(false);
    });
});
