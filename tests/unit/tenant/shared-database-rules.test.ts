// @vitest-environment node
/**
 * The rules of Shared Databases as the user guide states them, against a real SQLite database
 * migrated with the migrations of this version: a tenant that was given nothing reaches nothing,
 * a database taken back stays with its old holder for download only, and a deleted customer's
 * backups never fall to another tenant.
 */
import { execFileSync } from "child_process";
import { mkdtempSync, rmSync } from "fs";
import os from "os";
import path from "path";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { PrismaClient } from "@prisma/client";
import { NotFoundError, ValidationError } from "@/lib/logging/errors";
import { runAsTenant } from "@/lib/tenant/context";
import { tenantScopeExtension } from "@/lib/tenant/prisma-scope";

const holder = vi.hoisted(() => ({ client: undefined as unknown }));
const mocks = vi.hoisted(() => ({
    listing: vi.fn(),
    writeDump: vi.fn(),
    restoreShared: vi.fn(),
    dumpSizes: vi.fn(),
    executeJob: vi.fn(),
}));

vi.mock("@/lib/logging/logger", () => ({
    logger: { child: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }) },
}));
// The services use the client of the app, here the one of the test database with its tenant filter.
vi.mock("@/lib/prisma", () => ({ get default() { return holder.client; } }));
vi.mock("@/services/storage/storage-service", () => ({ storageService: { readCachedListing: mocks.listing } }));
vi.mock("@/services/restore/archive-download", () => ({ writeDatabaseDump: mocks.writeDump }));
vi.mock("@/services/restore/file-restore", () => ({ openArchiveForRestore: async () => ({ masterKey: undefined, dispose: async () => undefined }) }));
vi.mock("@/services/restore/restore-service", () => ({ restoreService: { restoreShared: mocks.restoreShared } }));
vi.mock("@/services/tenant/shared-dump-sizes", () => ({ dumpSizes: mocks.dumpSizes }));
vi.mock("@/services/backup/backup-service", () => ({ backupService: { executeJob: mocks.executeJob } }));
vi.mock("@/services/system/system-settings-service", () => ({ getTimezone: async () => "UTC" }));
vi.mock("@/lib/server/scheduler", () => ({ scheduler: { refresh: vi.fn() } }));
vi.mock("@/services/dashboard/cache", () => ({ invalidateDashboardCache: vi.fn() }));

const { sharedOverview, prepareSharedDownload, restoreSharedBackup } = await import("@/services/tenant/shared-databases");
const { requestSharedBackup, sharedBackupRun } = await import("@/services/tenant/shared-on-demand");
const { databaseAssignmentService } = await import("@/services/tenant/database-assignments");
const { tenantService } = await import("@/services/tenant/tenant-service");

type Overview = Awaited<ReturnType<typeof sharedOverview>>;

let root = "";
let base: PrismaClient;

const day = (iso: string) => new Date(`${iso}T12:00:00.000Z`);
const HOME = "default";
const asHome = <T,>(fn: () => Promise<T>) => runAsTenant(HOME, fn);
const NOW = day("2026-08-01");
const person = { id: "u-1", name: "Someone" };

/** A backup at the destination of the MSP as its cached listing names it. */
const backup = (sourceId: string | undefined, file: string, createdAt: string, databases: string[], jobId?: string) => ({
    name: file,
    path: `Backups/${file}`,
    size: 1000,
    lastModified: day(createdAt).toISOString(),
    createdAt: day(createdAt).toISOString(),
    databases,
    ...(sourceId ? { sourceId } : {}),
    ...(jobId ? { jobId } : {}),
    hasFileIndex: true,
    isEncrypted: false,
});

const LISTING = [
    backup("srv-a", "a-feb.tar", "2026-02-10", ["shop", "blog", "report", "crm", "orders"], "a-job"),
    backup("srv-a", "a-jul.tar", "2026-07-10", ["shop", "blog", "report", "crm", "orders"], "a-job"),
];

const daysOf = (data: Overview, databaseName: string, sourceId = "srv-a") =>
    data.backups.filter((entry) => entry.sourceId === sourceId && entry.databaseName === databaseName).map((entry) => entry.createdAt.slice(0, 10));

async function refOf(tenantId: string, databaseName: string, date: string, sourceId = "srv-a") {
    const found = (await sharedOverview(tenantId, NOW)).backups.find((entry) => entry.sourceId === sourceId && entry.databaseName === databaseName && entry.createdAt.startsWith(date));
    if (!found) throw new Error(`No backup of ${databaseName} from ${date} for ${tenantId}`);
    return { sourceId, databaseName, backupId: found.id };
}

beforeAll(async () => {
    root = mkdtempSync(path.join(os.tmpdir(), "dbackup-shared-rules-"));
    const file = path.join(root, "rules.db");
    execFileSync(path.join(process.cwd(), "node_modules", ".bin", "prisma"), ["migrate", "deploy"], {
        env: { ...process.env, DATABASE_URL: `file:${file}` },
        stdio: "pipe",
    });
    base = new PrismaClient({ datasources: { db: { url: `file:${file}` } } });
    holder.client = base.$extends(tenantScopeExtension(async () => null));

    for (const [id, name] of [["acme", "Acme"], ["globex", "Globex"], ["initech", "Initech"], ["umbrella", "Umbrella"], ["doomed", "Doomed"]]) {
        await base.tenant.create({ data: { id, name } });
    }
    await base.adapterConfig.create({ data: { id: "srv-a", name: "MySQL A", type: "database", adapterId: "mysql", config: "{}" } });
    await base.sharedServer.create({ data: { id: "srv-a", name: "MySQL A", adapterId: "mysql", tenantId: HOME } });
    await base.databaseListCache.create({ data: { adapterConfigId: "srv-a", databasesJson: JSON.stringify(["shop", "blog", "report", "crm", "orders"]) } });
    await base.adapterConfig.create({ data: { id: "nas", name: "MSP NAS", type: "storage", adapterId: "local-filesystem", config: "{}" } });
    await base.job.create({ data: { id: "a-job", name: "Nightly A", schedule: "0 3 * * *", sourceId: "srv-a" } });

    const jan = day("2026-01-01");
    await base.databaseAssignment.createMany({
        data: [
            { sourceId: "srv-a", databaseName: "shop", tenantId: "acme", validFrom: jan, createdAt: jan },
            // Doomed holds crm by name since January.
            { sourceId: "srv-a", databaseName: "crm", tenantId: "doomed", validFrom: jan, createdAt: jan },
        ],
    });
}, 120_000);

afterAll(async () => {
    await base?.$disconnect();
    if (root) rmSync(root, { recursive: true, force: true });
});

beforeEach(() => {
    vi.clearAllMocks();
    mocks.listing.mockImplementation(async (id: string) => (id === "nas" ? { files: LISTING, listedAt: new Date(), current: true } : null));
    mocks.writeDump.mockResolvedValue({ fileName: "a-feb_shop.sql" });
    mocks.dumpSizes.mockImplementation(async (records: { id: string }[]) => new Map(records.map((record) => [record.id, { stored: 100, unpacked: 400 }])));
    mocks.restoreShared.mockResolvedValue({ success: true, executionId: "run-1", providerExecutionId: "msp-run-1" });
    mocks.executeJob.mockResolvedValue({ success: true, executionId: "leader-1" });
});

describe("a tenant that was given no database", () => {
    it("sees nothing of a shared server", async () => {
        expect(await sharedOverview("umbrella", NOW)).toEqual({ databases: [], backups: [] });
    });

    it("downloads and restores nothing by the name of another tenant's backup, which reads like one that does not exist", async () => {
        const ref = await refOf("acme", "shop", "2026-02-10");
        await expect(prepareSharedDownload("umbrella", "u-umbrella", ref)).rejects.toBeInstanceOf(NotFoundError);
        await expect(restoreSharedBackup("umbrella", ref, "Uma", NOW)).rejects.toBeInstanceOf(NotFoundError);
        await expect(prepareSharedDownload("umbrella", "u-umbrella", { ...ref, sourceId: "no-such-server" })).rejects.toBeInstanceOf(NotFoundError);
        expect(mocks.writeDump).not.toHaveBeenCalled();
        expect(mocks.restoreShared).not.toHaveBeenCalled();
    });

    it("starts no backup of another tenant's database, refused in the words of a server that does not exist", async () => {
        const held = await requestSharedBackup("umbrella", person, { sourceId: "srv-a", databaseName: "shop" }, NOW).catch((error: unknown) => error);
        const nowhere = await requestSharedBackup("umbrella", person, { sourceId: "no-such-server", databaseName: "shop" }, NOW).catch((error: unknown) => error);
        expect(held).toBeInstanceOf(ValidationError);
        expect((held as Error).message).toBe((nowhere as Error).message);
        // It never held shop, so it does not read that shop is no longer its.
        expect((held as Error).message).toBe("shop is not a database of yours, so you cannot back it up.");
        expect(mocks.executeJob).not.toHaveBeenCalled();
        expect(await base.sharedBackupRequest.count({ where: { tenantId: "umbrella" } })).toBe(0);
    });

    it("follows no backup another tenant started", async () => {
        const request = await base.sharedBackupRequest.create({ data: { tenantId: "acme", sourceId: "srv-a", databaseName: "shop", executionId: "leader-x", requestedById: null } });
        await expect(sharedBackupRun("umbrella", request.id)).rejects.toBeInstanceOf(NotFoundError);
        await expect(sharedBackupRun("acme", request.id)).resolves.toEqual(expect.objectContaining({ databaseName: "shop" }));
        await base.sharedBackupRequest.delete({ where: { id: request.id } });
    });
});

describe("a database taken back", () => {
    beforeAll(async () => {
        await asHome(() => databaseAssignmentService.assign("srv-a", [{ databaseName: "shop", tenantId: null }], null, day("2026-06-01")));
    });

    it("stays with its old holder as a former database, with the backups of its time and none after", async () => {
        const data = await sharedOverview("acme", NOW);
        const shop = data.databases.find((entry) => entry.sourceId === "srv-a" && entry.databaseName === "shop");
        expect(shop?.until).toBe(day("2026-06-01").toISOString());
        expect(shop?.onDemand).toBeNull();
        expect(daysOf(data, "shop")).toEqual(["2026-02-10"]);
    });

    it("downloads there, but restores and backs up no more", async () => {
        const ref = await refOf("acme", "shop", "2026-02-10");
        await expect(prepareSharedDownload("acme", "u-acme", ref)).resolves.toEqual(expect.objectContaining({ fileName: "2026-02-10_1200_shop.sql" }));
        await expect(restoreSharedBackup("acme", ref, "Ana", NOW)).rejects.toBeInstanceOf(ValidationError);
        await expect(requestSharedBackup("acme", person, { sourceId: "srv-a", databaseName: "shop" }, NOW)).rejects.toThrow("shop is no longer yours, so you cannot back it up.");
        expect(mocks.restoreShared).not.toHaveBeenCalled();
        expect(mocks.executeJob).not.toHaveBeenCalled();
    });

    it("goes to no tenant by a rule from then on, and its backups of before stay with the old holder", async () => {
        await asHome(() => databaseAssignmentService.addRule("srv-a", { pattern: "sh*", tenantId: "globex", priority: 100, validFrom: day("2026-01-01") }, day("2026-06-02")));
        expect(daysOf(await sharedOverview("globex", NOW), "shop")).toEqual([]);
        expect(daysOf(await sharedOverview("acme", NOW), "shop")).toEqual(["2026-02-10"]);
    });
});

describe("a deleted customer", () => {
    beforeAll(async () => {
        await tenantService.delete("doomed", day("2026-06-01"));
    });

    it("leaves a database it held by name to nobody, so a tenant given it later with an earlier start gets none of its backups", async () => {
        await asHome(() => databaseAssignmentService.assign("srv-a", [{ databaseName: "crm", tenantId: "initech", validFrom: day("2026-01-01") }], null, day("2026-06-10")));
        await asHome(() => databaseAssignmentService.addRule("srv-a", { pattern: "crm*", tenantId: "initech", priority: 500, validFrom: day("2026-01-01") }, day("2026-06-10")));
        expect(daysOf(await sharedOverview("initech", NOW), "crm")).toEqual(["2026-07-10"]);
    });
});
