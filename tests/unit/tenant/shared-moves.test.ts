// @vitest-environment node
/**
 * What happens to the databases a customer holds on a shared server when one moves to another
 * server, when the connection of the server is deleted, and when the customer starts a backup on
 * demand, against a real SQLite database migrated with the migrations of this version.
 */
import { execFileSync } from "child_process";
import { mkdtempSync, rmSync } from "fs";
import os from "os";
import path from "path";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { PrismaClient } from "@prisma/client";
import { NotFoundError, ValidationError } from "@/lib/logging/errors";
import { explicitScope, runAsTenant } from "@/lib/tenant/context";
import { tenantScopeExtension } from "@/lib/tenant/prisma-scope";

const holder = vi.hoisted(() => ({ client: undefined as unknown }));
const mocks = vi.hoisted(() => ({
    listing: vi.fn(),
    writeDump: vi.fn(),
    restoreShared: vi.fn(),
    dumpSizes: vi.fn(),
    executeJob: vi.fn(),
    timezone: vi.fn(),
}));

vi.mock("@/lib/logging/logger", () => ({
    logger: { child: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }) },
}));
// The services use the client of the app, here the one of the test database with its tenant filter.
vi.mock("@/lib/prisma", () => ({ get default() { return holder.client; } }));
vi.mock("@/services/storage/storage-service", () => ({ storageService: { readCachedListing: mocks.listing } }));
vi.mock("@/services/restore/archive-download", () => ({ writeDatabaseDump: mocks.writeDump }));
// A restore opens the copy first, to know it answers and to find its key.
vi.mock("@/services/restore/file-restore", () => ({ openArchiveForRestore: async () => ({ masterKey: undefined, dispose: async () => undefined }) }));
vi.mock("@/services/restore/restore-service", () => ({ restoreService: { restoreShared: mocks.restoreShared } }));
vi.mock("@/services/tenant/shared-dump-sizes", () => ({ dumpSizes: mocks.dumpSizes }));
vi.mock("@/services/backup/backup-service", () => ({ backupService: { executeJob: mocks.executeJob } }));
vi.mock("@/services/system/system-settings-service", () => ({ getTimezone: mocks.timezone }));

const { sharedOverview, prepareSharedDownload, restoreSharedBackup } = await import("@/services/tenant/shared-databases");
const { databaseAssignmentService } = await import("@/services/tenant/database-assignments");
const { moveDatabase } = await import("@/services/tenant/database-moves");
const { customersOfServer } = await import("@/services/tenant/shared-servers");
const { dayStart, requestSharedBackup, sharedBackupRun } = await import("@/services/tenant/shared-on-demand");
const { deleteAdapter } = await import("@/services/adapters/adapter-service");
const { restoreFromTrash } = await import("@/services/trash/trash-service");
const { tenantOnDemandService } = await import("@/services/tenant/tenant-on-demand");

let root = "";
let base: PrismaClient;

const day = (iso: string) => new Date(`${iso}T12:00:00.000Z`);
const NOW = day("2026-09-01");
const HOME = "default";
const asHome = <T,>(fn: () => Promise<T>) => runAsTenant(HOME, fn);

/** A backup at the destination of the MSP as its cached listing names it. */
const backup = (sourceId: string, file: string, createdAt: string, databases: string[]) => ({
    name: file,
    path: `Backups/${file}`,
    size: 1000,
    lastModified: day(createdAt).toISOString(),
    createdAt: day(createdAt).toISOString(),
    databases,
    sourceId,
    hasFileIndex: true,
    isEncrypted: false,
});

const LISTING = [
    backup("old-mysql", "o-jan.tar", "2026-01-10", ["shop", "blog_one", "orders"]),
    backup("old-mysql", "o-mar.tar", "2026-03-10", ["shop", "blog_one", "orders"]),
    // After both moves, the copies left on the old server belong to nobody.
    backup("old-mysql", "o-jul.tar", "2026-07-10", ["shop", "blog_one", "orders"]),
    // Before the move, the new server's database was the MSP's own.
    backup("new-mysql", "n-feb.tar", "2026-02-10", ["shop2"]),
    backup("new-mysql", "n-may.tar", "2026-05-10", ["shop2", "blog_one"]),
    backup("new-mysql", "n-aug.tar", "2026-08-10", ["shop2", "blog_one"]),
    backup("gone-mysql", "g-feb.tar", "2026-02-10", ["crm", "wiki_a"]),
];

async function server(id: string, name: string, adapterId: string, databases: string[]) {
    await base.adapterConfig.create({ data: { id, name, type: "database", adapterId, config: "{}" } });
    await base.databaseListCache.create({ data: { adapterConfigId: id, databasesJson: JSON.stringify(databases.map((entry) => ({ name: entry }))) } });
}

beforeAll(async () => {
    root = mkdtempSync(path.join(os.tmpdir(), "dbackup-moves-"));
    const file = path.join(root, "moves.db");
    execFileSync(path.join(process.cwd(), "node_modules", ".bin", "prisma"), ["migrate", "deploy"], {
        env: { ...process.env, DATABASE_URL: `file:${file}` },
        stdio: "pipe",
    });
    base = new PrismaClient({ datasources: { db: { url: `file:${file}` } } });
    holder.client = base.$extends(tenantScopeExtension(async () => null));

    await base.tenant.create({ data: { id: "acme", name: "Acme" } });
    await base.tenant.create({ data: { id: "globex", name: "Globex" } });
    await server("old-mysql", "Old MySQL", "mysql", ["shop", "blog_one", "orders", "other"]);
    await server("new-mysql", "New MySQL", "mysql", ["shop2", "blog_one", "taken"]);
    await server("pg", "Postgres", "postgres", ["shop"]);
    await server("gone-mysql", "Gone MySQL", "mysql", ["crm", "wiki_a"]);
    await server("nojob-mysql", "Lonely MySQL", "mysql", ["lonely"]);
    await base.adapterConfig.create({ data: { id: "nas", name: "NAS", type: "storage", adapterId: "local-filesystem", config: "{}" } });
    await base.job.create({ data: { id: "old-job", name: "Old", schedule: "0 3 * * *", sourceId: "old-mysql" } });
    await base.job.create({ data: { id: "new-job", name: "New", schedule: "0 3 * * *", sourceId: "new-mysql" } });

    // Acme has shop and orders on the old server, Globex the blog databases by a rule and a name
    // on the new server. A rule gives the name shop to Globex, which the name of Acme beats.
    const jan = day("2026-01-01");
    await asHome(() => databaseAssignmentService.assign("old-mysql", [{ databaseName: "shop", tenantId: "acme", validFrom: jan }, { databaseName: "orders", tenantId: "acme", validFrom: jan }], "u-msp", jan));
    await asHome(() => databaseAssignmentService.addRule("old-mysql", { pattern: "blog_*", tenantId: "globex", validFrom: jan }, jan));
    await asHome(() => databaseAssignmentService.addRule("old-mysql", { pattern: "shop", tenantId: "globex", validFrom: jan }, jan));
    await asHome(() => databaseAssignmentService.assign("new-mysql", [{ databaseName: "taken", tenantId: "globex", validFrom: jan }], "u-msp", jan));
    await asHome(() => databaseAssignmentService.assign("gone-mysql", [{ databaseName: "crm", tenantId: "acme", validFrom: jan }], "u-msp", jan));
    await asHome(() => databaseAssignmentService.addRule("gone-mysql", { pattern: "wiki_*", tenantId: "globex", validFrom: jan }, jan));
    await asHome(() => databaseAssignmentService.assign("nojob-mysql", [{ databaseName: "lonely", tenantId: "acme", validFrom: jan }], "u-msp", jan));

    // shop moves on April 1 under a new name, blog_one, which a rule gave, on June 1 under its own.
    await asHome(() => moveDatabase("old-mysql", { databaseName: "shop", toSourceId: "new-mysql", toDatabase: "shop2" }, "u-msp", day("2026-04-01")));
    await asHome(() => moveDatabase("old-mysql", { databaseName: "blog_one", toSourceId: "new-mysql" }, "u-msp", day("2026-06-01")));
}, 120_000);

afterAll(async () => {
    await base?.$disconnect();
    if (root) rmSync(root, { recursive: true, force: true });
});

beforeEach(() => {
    vi.clearAllMocks();
    mocks.listing.mockImplementation(async (id: string) => (id === "nas" ? { files: LISTING, listedAt: new Date(), current: true } : null));
    mocks.writeDump.mockResolvedValue({ fileName: "dump.sql" });
    mocks.dumpSizes.mockImplementation(async (records: { id: string }[]) => new Map(records.map((record) => [record.id, { stored: 100, unpacked: 400 }])));
    mocks.restoreShared.mockResolvedValue({ success: true, executionId: "restore-1" });
    mocks.timezone.mockResolvedValue("UTC");
});

const overview = (tenantId: string, now = NOW) => sharedOverview(tenantId, now);
type Overview = Awaited<ReturnType<typeof overview>>;
const daysOf = (data: Overview, key: string) => data.backups.filter((entry) => entry.databaseKey === key).map((entry) => `${entry.sourceId} ${entry.createdAt.slice(0, 10)}`);
async function refOf(tenantId: string, sourceId: string, databaseName: string, date: string) {
    const found = (await overview(tenantId)).backups.find((entry) => entry.sourceId === sourceId && entry.databaseName === databaseName && entry.createdAt.startsWith(date));
    if (!found) throw new Error(`No backup of ${databaseName} on ${sourceId} from ${date}`);
    return { sourceId, databaseName, backupId: found.id };
}

describe("a database that moves to another server", () => {
    it("ends the customer's time on the old server where it starts on the new one", async () => {
        const rows = await base.databaseAssignment.findMany({ where: { tenantId: "acme", databaseName: { in: ["shop", "shop2"] } }, orderBy: { validFrom: "asc" } });
        expect(rows.map((row) => [row.sourceId, row.databaseName, row.validFrom.toISOString(), row.validUntil?.toISOString() ?? null, row.movedToSourceId, row.movedToDatabase])).toEqual([
            ["old-mysql", "shop", day("2026-01-01").toISOString(), day("2026-04-01").toISOString(), "new-mysql", "shop2"],
            ["new-mysql", "shop2", day("2026-04-01").toISOString(), null, null, null],
        ]);
    });

    it("shows the customer one database with its backups from both servers", async () => {
        const data = await overview("acme");
        const shop = data.databases.find((entry) => entry.databaseName === "shop2");
        expect(shop).toEqual(expect.objectContaining({
            sourceId: "new-mysql", serverName: "New MySQL", since: day("2026-01-01").toISOString(), until: null, serverGone: false,
            movedFrom: [expect.objectContaining({ sourceId: "old-mysql", serverName: "Old MySQL", databaseName: "shop", until: day("2026-04-01").toISOString() })],
        }));
        expect(data.databases.some((entry) => entry.databaseName === "shop")).toBe(false);
        expect(daysOf(data, "new-mysql/shop2")).toEqual(["new-mysql 2026-08-10", "new-mysql 2026-05-10", "old-mysql 2026-03-10", "old-mysql 2026-01-10"]);
    });

    it("restores a backup of the old server into the database at its new place, under its new name", async () => {
        const ref = await refOf("acme", "old-mysql", "shop", "2026-03-10");
        expect(await restoreSharedBackup("acme", ref, "Ana", NOW)).toEqual({
            executionId: "restore-1",
            target: { sourceId: "new-mysql", databaseName: "shop2" },
            // The tenant of the server it goes into sees the restore.
            provider: { tenantId: "default", executionId: null, serverName: "New MySQL", customerName: "Acme" },
        });
        expect(mocks.restoreShared).toHaveBeenCalledWith(expect.objectContaining({
            file: "Backups/o-mar.tar",
            targetSourceId: "new-mysql",
            databaseMapping: [{ originalName: "shop", targetName: "shop2", selected: true }],
            shared: { databaseName: "shop2", provider: { tenantId: "default", name: "Default", customer: "Acme" } },
        }), "acme");
    });

    it("gives the old name to nobody on the old server from the move on, whatever a rule matches", async () => {
        const model = await asHome(() => databaseAssignmentService.forSource("old-mysql", NOW));
        expect(model.databases.find((entry) => entry.name === "shop")?.owner).toBeNull();
        expect(model.assignments.find((entry) => entry.databaseName === "shop")?.movedTo).toEqual({ sourceId: "new-mysql", serverName: "New MySQL", databaseName: "shop2" });
        const globex = await overview("globex");
        expect(globex.databases.some((entry) => entry.sourceId === "old-mysql" && entry.databaseName === "shop")).toBe(false);
    });

    it("tells the new server where the database came from", async () => {
        const model = await asHome(() => databaseAssignmentService.forSource("new-mysql", NOW));
        expect(model.assignments.find((entry) => entry.databaseName === "shop2")?.movedFrom).toEqual({ sourceId: "old-mysql", serverName: "Old MySQL", databaseName: "shop" });
        expect(model.databases.find((entry) => entry.name === "shop2")?.owner).toEqual(expect.objectContaining({ tenantName: "Acme", via: "assignment" }));
    });

    it("takes a database a rule gives along, with the backups of the rule's time", async () => {
        const closing = await base.databaseAssignment.findFirst({ where: { sourceId: "old-mysql", databaseName: "blog_one" } });
        expect(closing).toEqual(expect.objectContaining({ tenantId: "globex", validFrom: day("2026-01-01"), validUntil: day("2026-06-01"), movedToSourceId: "new-mysql" }));
        const data = await overview("globex");
        expect(daysOf(data, "new-mysql/blog_one")).toEqual(["new-mysql 2026-08-10", "old-mysql 2026-03-10", "old-mysql 2026-01-10"]);
    });

    it("moves only to a server of the same engine", async () => {
        await expect(asHome(() => moveDatabase("old-mysql", { databaseName: "orders", toSourceId: "pg" }, "u-msp", NOW))).rejects.toThrow(/same engine/);
    });

    it("moves only a database a customer holds now", async () => {
        await expect(asHome(() => moveDatabase("old-mysql", { databaseName: "other", toSourceId: "new-mysql" }, "u-msp", NOW))).rejects.toThrow(/belongs to no customer/);
    });

    it("never moves onto a name another customer holds on the new server", async () => {
        await expect(asHome(() => moveDatabase("old-mysql", { databaseName: "orders", toSourceId: "new-mysql", toDatabase: "taken" }, "u-msp", NOW))).rejects.toThrow(/belongs to Globex/);
        expect(await base.databaseAssignment.count({ where: { databaseName: "orders", validUntil: null } })).toBe(1);
    });

    it("lets no customer move a database", async () => {
        await expect(runAsTenant("acme", () => moveDatabase("old-mysql", { databaseName: "orders", toSourceId: "new-mysql" }, "u-acme", NOW))).rejects.toBeInstanceOf(NotFoundError);
    });
});

describe("a server whose connection is deleted", () => {
    it("names the customers who keep its backups to download, before it goes", async () => {
        expect(await asHome(() => customersOfServer("gone-mysql"))).toEqual(["Acme", "Globex"]);
        await asHome(() => deleteAdapter("gone-mysql", { by: null }));
        expect(await base.adapterConfig.findUnique({ where: { id: "gone-mysql" } })).toBeNull();
    });

    it("keeps its assignments, its rules and what the server was", async () => {
        expect(await base.databaseAssignment.count({ where: { sourceId: "gone-mysql" } })).toBe(1);
        expect(await base.databaseAssignmentRule.count({ where: { sourceId: "gone-mysql" } })).toBe(1);
        expect(await base.sharedServer.findUnique({ where: { id: "gone-mysql" } })).toEqual(expect.objectContaining({ name: "Gone MySQL", adapterId: "mysql", tenantId: HOME, deletedAt: expect.any(Date) }));
    });

    it("lists its databases to the customers with their backups, as on a deleted server", async () => {
        const acme = await overview("acme");
        expect(acme.databases.find((entry) => entry.databaseName === "crm")).toEqual(expect.objectContaining({ serverName: "Gone MySQL", adapterId: "mysql", serverGone: true, onDemand: null }));
        expect(daysOf(acme, "gone-mysql/crm")).toEqual(["gone-mysql 2026-02-10"]);
        // A rule of a deleted server gives what its backups show it gave.
        const globex = await overview("globex");
        expect(globex.databases.find((entry) => entry.databaseName === "wiki_a")).toEqual(expect.objectContaining({ serverGone: true }));
        expect(daysOf(globex, "gone-mysql/wiki_a")).toEqual(["gone-mysql 2026-02-10"]);
    });

    it("never shows one customer the databases of another of the deleted server", async () => {
        const acme = await overview("acme");
        expect(acme.databases.some((entry) => entry.databaseName === "wiki_a")).toBe(false);
        await expect(prepareSharedDownload("globex", "u-globex", await refOf("acme", "gone-mysql", "crm", "2026-02-10"))).rejects.toBeInstanceOf(NotFoundError);
    });

    it("downloads its backups and restores none of them", async () => {
        const ref = await refOf("acme", "gone-mysql", "crm", "2026-02-10");
        await expect(prepareSharedDownload("acme", "u-acme", ref)).resolves.toEqual(expect.objectContaining({ token: expect.any(String) }));
        expect(mocks.writeDump).toHaveBeenCalledWith(expect.objectContaining({ storageConfigId: "nas" }), expect.any(String));
        await expect(restoreSharedBackup("acme", ref, "Ana", NOW)).rejects.toThrow(/deleted/);
        expect(mocks.restoreShared).not.toHaveBeenCalled();
    });

    it("starts no backup of a database of it", async () => {
        await expect(requestSharedBackup("acme", { id: "u-acme", name: "Ana" }, { sourceId: "gone-mysql", databaseName: "crm" }, NOW)).rejects.toThrow(/deleted/);
        expect(mocks.executeJob).not.toHaveBeenCalled();
    });

    it("restores again once the connection is back from Recently deleted", async () => {
        const entry = await base.deletedRecord.findFirstOrThrow({ where: { recordId: "gone-mysql" } });
        const result = await asHome(() => restoreFromTrash([entry.id]));
        expect(result.restored).toHaveLength(1);
        expect((await base.sharedServer.findUnique({ where: { id: "gone-mysql" } }))?.deletedAt).toBeNull();
        await restoreSharedBackup("acme", await refOf("acme", "gone-mysql", "crm", "2026-02-10"), "Ana", NOW);
        expect(mocks.restoreShared).toHaveBeenCalledWith(expect.objectContaining({ targetSourceId: "gone-mysql" }), "acme");
    });
});

describe("backups a customer starts on demand", () => {
    const shop2 = { sourceId: "new-mysql", databaseName: "shop2" };
    const lena = { id: "u-lena", name: "Lena Graf" };
    let runs = 0;

    beforeAll(async () => {
        await asHome(() => databaseAssignmentService.setOnDemand("new-mysql", "shop2", 2));
        await asHome(() => databaseAssignmentService.setOnDemand("nojob-mysql", "lonely", 3));
    });

    beforeEach(() => {
        mocks.executeJob.mockImplementation(async () => ({ success: true, executionId: `run-${++runs}`, scope: explicitScope() }));
    });

    it("runs the job of the server for that database alone, as a run of the server's tenant", async () => {
        let scope: unknown;
        mocks.executeJob.mockImplementationOnce(async () => {
            scope = explicitScope();
            return { success: true, executionId: `run-${++runs}` };
        });
        const started = await requestSharedBackup("acme", lena, shop2, NOW);
        expect(mocks.executeJob).toHaveBeenCalledWith("new-job", { type: "Manual", label: "Acme · Lena Graf" }, { databases: ["shop2"], executionId: expect.any(String) });
        expect(scope).toEqual({ kind: "tenant", tenantId: HOME });
        // The customer gets a run of its own that follows the real one, waiting until the queue takes that.
        const leaderId = mocks.executeJob.mock.calls[0][2].executionId;
        const own = await base.execution.findUnique({ where: { id: started.customerExecutionId } });
        expect(own).toEqual(expect.objectContaining({ tenantId: "acme", type: "Backup", status: "Pending", jobId: null, triggerType: "Manual", triggerLabel: "Lena Graf" }));
        expect(JSON.parse(own!.metadata!)).toEqual(expect.objectContaining({
            target: { name: "New MySQL", adapterId: "mysql" },
            backupOf: { database: "shop2", provider: "Default" },
            onlyDatabases: ["shop2"],
            followsRun: leaderId,
        }));
        expect(started).toEqual(expect.objectContaining({ jobId: "new-job", serverTenantId: HOME, customerName: "Acme", databaseName: "shop2" }));
        expect(await base.sharedBackupRequest.findUnique({ where: { id: started.requestId } })).toEqual(expect.objectContaining({ tenantId: "acme", executionId: started.executionId }));
    });

    it("counts towards the limit of the day and refuses the one over it", async () => {
        await requestSharedBackup("acme", lena, shop2, NOW);
        await expect(requestSharedBackup("acme", lena, shop2, NOW)).rejects.toThrow(/2 backups of shop2 started today/);
        expect(mocks.executeJob).toHaveBeenCalledTimes(1);
        expect(await base.sharedBackupRequest.count({ where: { tenantId: "acme", databaseName: "shop2" } })).toBe(2);
    });

    it("starts counting again the next day", async () => {
        await expect(requestSharedBackup("acme", lena, shop2, day("2026-09-02"))).resolves.toEqual(expect.objectContaining({ databaseName: "shop2" }));
    });

    it("counts the day in the time zone of the instance", async () => {
        mocks.timezone.mockResolvedValue("Europe/Zurich");
        // 00:30 on September 2 in Zurich starts the day there at 22:00 UTC.
        expect((await dayStart(new Date("2026-09-01T22:30:00.000Z"))).toISOString()).toBe("2026-09-01T22:00:00.000Z");
    });

    it("refuses a database whose provider allows no backups on demand", async () => {
        await expect(requestSharedBackup("globex", lena, { sourceId: "new-mysql", databaseName: "blog_one" }, NOW)).rejects.toThrow(/off for blog_one/);
    });

    it("refuses a database that is not the customer's now", async () => {
        await expect(requestSharedBackup("globex", lena, shop2, NOW)).rejects.toThrow(/no longer yours/);
        await expect(requestSharedBackup("acme", lena, { sourceId: "old-mysql", databaseName: "shop" }, NOW)).rejects.toThrow(/no longer yours/);
    });

    it("refuses while the job of the server runs", async () => {
        await base.execution.create({ data: { id: "busy", jobId: "new-job", status: "Running", logs: "[]" } });
        await expect(requestSharedBackup("acme", lena, shop2, day("2026-09-03"))).rejects.toThrow(/runs right now/);
        await base.execution.delete({ where: { id: "busy" } });
    });

    it("refuses a server without a job", async () => {
        await expect(requestSharedBackup("acme", lena, { sourceId: "nojob-mysql", databaseName: "lonely" }, NOW)).rejects.toThrow(/has no job/);
        expect(await base.sharedBackupRequest.count({ where: { databaseName: "lonely" } })).toBe(0);
    });

    it("tells the customer the state of its run and nothing else of it", async () => {
        const started = await requestSharedBackup("acme", lena, shop2, day("2026-09-04"));
        await base.execution.create({ data: { id: started.executionId, jobId: "new-job", status: "Running", logs: "[]", startedAt: NOW } });
        const status = await sharedBackupRun("acme", started.requestId);
        expect(status).toEqual({ state: "running", databaseName: "shop2", startedAt: NOW.toISOString(), endedAt: null });
        await expect(sharedBackupRun("globex", started.requestId)).rejects.toBeInstanceOf(NotFoundError);

        const data = await overview("acme", day("2026-09-04"));
        expect(data.databases.find((entry) => entry.databaseName === "shop2")?.onDemand).toEqual({ perDay: 2, usedToday: 1, active: { requestId: started.requestId, state: "running" } });

        await base.execution.update({ where: { id: started.executionId }, data: { status: "Success", endedAt: day("2026-09-04") } });
        expect((await sharedBackupRun("acme", started.requestId)).state).toBe("done");
    });

    it("never lets two requests at once both take the last backup of the day, when the one that started first goes in last", async () => {
        const at = (time: string) => new Date(`2026-09-05T${time}:00.000Z`);
        // The morning took one of the two backups of the day.
        await requestSharedBackup("acme", lena, shop2, at("09:00"));

        // The request of 10:00 stops right before it goes in, the one of 11:00 goes in and starts meanwhile.
        let reached!: () => void;
        let release!: () => void;
        const waiting = new Promise<void>((resolve) => { reached = resolve; });
        const gate = new Promise<void>((resolve) => { release = resolve; });
        mocks.timezone.mockImplementationOnce(async () => {
            reached();
            await gate;
            return "UTC";
        });
        const earlier = requestSharedBackup("acme", lena, shop2, at("10:00")).then(() => "started", (error: Error) => error.message);
        await waiting;
        const later = await requestSharedBackup("acme", lena, shop2, at("11:00")).then(() => "started", (error: Error) => error.message);
        release();

        expect(later).toBe("started");
        expect(await earlier).toMatch(/2 backups of shop2 started today/);
        expect(await base.sharedBackupRequest.count({ where: { tenantId: "acme", databaseName: "shop2", createdAt: { gte: at("00:00"), lt: day("2026-09-06") } } })).toBe(2);
    });

    it("follows the number the platform sets for the customer, unless the database sets its own or is off there", async () => {
        const blog = { sourceId: "new-mysql", databaseName: "blog_one" };
        await tenantOnDemandService.set("globex", 1);
        try {
            await expect(requestSharedBackup("globex", lena, blog, day("2026-09-20"))).resolves.toEqual(expect.objectContaining({ databaseName: "blog_one" }));
            await expect(requestSharedBackup("globex", lena, blog, day("2026-09-20"))).rejects.toThrow(/1 backup of blog_one started today/);

            await asHome(() => databaseAssignmentService.setOnDemand("new-mysql", "blog_one", 0));
            await expect(requestSharedBackup("globex", lena, blog, day("2026-09-21"))).rejects.toThrow(/off for blog_one/);

            await asHome(() => databaseAssignmentService.setOnDemand("new-mysql", "blog_one", 2));
            await requestSharedBackup("globex", lena, blog, day("2026-09-22"));
            await expect(requestSharedBackup("globex", lena, blog, day("2026-09-22"))).resolves.toEqual(expect.objectContaining({ databaseName: "blog_one" }));
        } finally {
            await asHome(() => databaseAssignmentService.setOnDemand("new-mysql", "blog_one", null));
            await tenantOnDemandService.set("globex", null);
        }
    });

    it("lists what the databases and rules of a customer set on their own, and lets one follow the customer again", async () => {
        await asHome(() => databaseAssignmentService.setOnDemand("new-mysql", "blog_one", 0));
        const found = await tenantOnDemandService.find("globex");
        expect(found).toEqual({
            name: "Globex",
            perDay: null,
            overrides: [expect.objectContaining({ kind: "database", name: "blog_one", serverName: "New MySQL", providerId: HOME, providerName: "Default", perDay: 0 })],
        });

        expect(await tenantOnDemandService.follow("globex", "database", found!.overrides[0].id)).toEqual(expect.objectContaining({ name: "blog_one", tenantName: "Globex" }));
        expect((await tenantOnDemandService.find("globex"))!.overrides).toEqual([]);
        await expect(tenantOnDemandService.follow("globex", "database", found!.overrides[0].id)).rejects.toBeInstanceOf(NotFoundError);
    });

    it("keeps the number of a customer within the limits, and none for the home tenant", async () => {
        await expect(tenantOnDemandService.set("globex", 25)).rejects.toBeInstanceOf(ValidationError);
        await expect(tenantOnDemandService.set("globex", 0)).rejects.toBeInstanceOf(ValidationError);
        await expect(tenantOnDemandService.set(HOME, 3)).rejects.toThrow(/home tenant/);
        expect(await tenantOnDemandService.set("globex", 4)).toEqual({ name: "Globex", before: null, after: 4 });
        expect(await tenantOnDemandService.set("globex", null)).toEqual({ name: "Globex", before: 4, after: null });
    });

    it("lets only the tenant of the server switch backups on demand, within the limits", async () => {
        await expect(runAsTenant("acme", () => databaseAssignmentService.setOnDemand("new-mysql", "shop2", 24))).rejects.toBeInstanceOf(NotFoundError);
        await expect(asHome(() => databaseAssignmentService.setOnDemand("new-mysql", "shop2", 25))).rejects.toBeInstanceOf(ValidationError);
        await expect(asHome(() => databaseAssignmentService.setOnDemand("old-mysql", "blog_one", 3))).rejects.toThrow(/no tenant by name/);
    });
});
