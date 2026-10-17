// @vitest-environment node
/**
 * Databases of a shared server given to customers, against a real SQLite database migrated with the
 * migrations of this version: the server's tenant assigns them, a customer sees the backups of its
 * own database from the time it was theirs and nothing else of the server, and every download and
 * restore is checked again on the server.
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
    openArchive: vi.fn(),
    restoreShared: vi.fn(),
    dumpSizes: vi.fn(),
}));

vi.mock("@/lib/logging/logger", () => ({
    logger: { child: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }) },
}));
// The services use the client of the app, here the one of the test database with its tenant filter.
vi.mock("@/lib/prisma", () => ({ get default() { return holder.client; } }));
vi.mock("@/services/storage/storage-service", () => ({ storageService: { readCachedListing: mocks.listing } }));
vi.mock("@/services/restore/archive-download", () => ({ writeDatabaseDump: mocks.writeDump }));
// A restore opens the copy first, to know it answers and to find its key.
vi.mock("@/services/restore/file-restore", () => ({ openArchiveForRestore: mocks.openArchive }));
vi.mock("@/services/restore/restore-service", () => ({ restoreService: { restoreShared: mocks.restoreShared } }));
// Reading the size of a dump opens the index of the archive, see shared-dump-sizes.test.ts.
vi.mock("@/services/tenant/shared-dump-sizes", () => ({ dumpSizes: mocks.dumpSizes }));
vi.mock("@/lib/server/scheduler", () => ({ scheduler: { refresh: vi.fn() } }));
vi.mock("@/services/dashboard/cache", () => ({ invalidateDashboardCache: vi.fn() }));

const { listSharedDatabases, sharedOverview, prepareSharedDownload, restoreSharedBackup } = await import("@/services/tenant/shared-databases");
type Overview = Awaited<ReturnType<typeof sharedOverview>>;
const { databaseAssignmentService } = await import("@/services/tenant/database-assignments");
const { tenantService } = await import("@/services/tenant/tenant-service");

let root = "";
let base: PrismaClient;

const day = (iso: string) => new Date(`${iso}T12:00:00.000Z`);

/** A backup at the destination of the MSP as its cached listing names it. */
const backup = (file: string, createdAt: string, databases: string[], extra: Record<string, unknown> = {}) => ({
    name: file,
    path: `Shared/${file}`,
    size: 1000,
    lastModified: day(createdAt).toISOString(),
    createdAt: day(createdAt).toISOString(),
    databases,
    sourceId: "shared-mysql",
    jobId: "nightly",
    hasFileIndex: true,
    isEncrypted: true,
    encryptionProfileId: "msp-key",
    ...extra,
});

const LISTING = [
    backup("feb.tar", "2026-02-10", ["shop", "shop_acme", "other"]),
    backup("may.tar", "2026-05-10", ["shop", "shop_acme", "blog_one"]),
    backup("jul.tar", "2026-07-10", ["shop", "shop_acme", "blog_one"]),
    // An archive of earlier versions, which cannot let one database out without the others.
    backup("old.sql.gz", "2026-03-10", ["shop"], { hasFileIndex: false }),
    // A backup of another server that happens to hold a database of the same name.
    backup("elsewhere.tar", "2026-03-10", ["shop"], { sourceId: "other-server" }),
    // A row cached before the server was kept, known by its job.
    backup("legacy-row.tar", "2026-03-20", ["shop"], { sourceId: undefined }),
];

beforeAll(async () => {
    root = mkdtempSync(path.join(os.tmpdir(), "dbackup-shared-"));
    const file = path.join(root, "shared.db");
    execFileSync(path.join(process.cwd(), "node_modules", ".bin", "prisma"), ["migrate", "deploy"], {
        env: { ...process.env, DATABASE_URL: `file:${file}` },
        stdio: "pipe",
    });
    base = new PrismaClient({ datasources: { db: { url: `file:${file}` } } });
    holder.client = base.$extends(tenantScopeExtension(async () => null));

    await base.tenant.create({ data: { id: "acme", name: "Acme" } });
    await base.tenant.create({ data: { id: "globex", name: "Globex" } });
    // The shared server, its destination and its job belong to the MSP, the home tenant.
    await base.adapterConfig.create({ data: { id: "shared-mysql", name: "Shared MySQL", type: "database", adapterId: "mysql", config: "{}" } });
    await base.adapterConfig.create({ data: { id: "other-server", name: "Other", type: "database", adapterId: "mysql", config: "{}" } });
    await base.adapterConfig.create({ data: { id: "msp-nas", name: "MSP NAS", type: "storage", adapterId: "local-filesystem", config: "{}" } });
    // A second destination of the job, which holds a copy of the backup of February.
    await base.adapterConfig.create({ data: { id: "msp-s3", name: "MSP S3", type: "storage", adapterId: "s3-generic", config: "{}" } });
    await base.job.create({ data: { id: "nightly", name: "Shared", schedule: "0 3 * * *", sourceId: "shared-mysql" } });
    await base.databaseListCache.create({
        data: { adapterConfigId: "shared-mysql", databasesJson: JSON.stringify([{ name: "shop" }, { name: "shop_acme" }, { name: "blog_one" }, { name: "other" }]) },
    });
    // The assignments hang off the shared server, which outlives its connection.
    await base.sharedServer.create({ data: { id: "shared-mysql", name: "Shared MySQL", adapterId: "mysql", tenantId: "default" } });
    // Acme had shop until April, Globex took the name over in June. shop_acme is Acme's since
    // March, and the blog databases go to Globex by a rule.
    await base.databaseAssignment.createMany({
        data: [
            { sourceId: "shared-mysql", databaseName: "shop", tenantId: "acme", validFrom: day("2026-01-01"), validUntil: day("2026-04-01") },
            { sourceId: "shared-mysql", databaseName: "shop", tenantId: "globex", validFrom: day("2026-06-01") },
            { sourceId: "shared-mysql", databaseName: "shop_acme", tenantId: "acme", validFrom: day("2026-03-01") },
        ],
    });
    await base.databaseAssignmentRule.create({ data: { sourceId: "shared-mysql", pattern: "blog_*", tenantId: "globex", validFrom: day("2026-01-01") } });
}, 120_000);

afterAll(async () => {
    await base?.$disconnect();
    if (root) rmSync(root, { recursive: true, force: true });
});

beforeEach(() => {
    vi.clearAllMocks();
    mocks.listing.mockImplementation(async (id: string) => {
        if (id === "msp-nas") return { files: LISTING, listedAt: new Date(), current: true };
        if (id === "msp-s3") return { files: [backup("feb.tar", "2026-02-10", ["shop", "shop_acme", "other"], { verification: { verifiedAt: day("2026-02-11").toISOString(), passed: true, trigger: "scheduled" } })], listedAt: new Date(), current: true };
        return null;
    });
    mocks.writeDump.mockResolvedValue({ fileName: "feb_shop.sql" });
    mocks.openArchive.mockResolvedValue({ masterKey: undefined, dispose: vi.fn() });
    mocks.dumpSizes.mockImplementation(async (records: { id: string }[]) => new Map(records.map((record) => [record.id, { stored: 100, unpacked: 400 }])));
    mocks.restoreShared.mockResolvedValue({ success: true, executionId: "run-1", providerExecutionId: "msp-run-1" });
});

const overview = (tenantId: string) => sharedOverview(tenantId, day("2026-08-01"));
/** The days the backups of a database were made, newest first. */
const daysOf = (data: Overview, databaseName: string) => data.backups.filter((entry) => entry.databaseName === databaseName).map((entry) => entry.createdAt.slice(0, 10));
/** The action's name of a backup of a database from a day. */
async function refOf(tenantId: string, databaseName: string, date: string) {
    const found = (await overview(tenantId)).backups.find((entry) => entry.databaseName === databaseName && entry.createdAt.startsWith(date));
    if (!found) throw new Error(`No backup of ${databaseName} from ${date}`);
    return { sourceId: "shared-mysql", databaseName, backupId: found.id };
}

describe("what a customer sees of a shared server", () => {
    it("lists the databases given to them, the former ones with their end", async () => {
        expect(await runAsTenant("acme", () => listSharedDatabases("acme", day("2026-08-01")))).toEqual([
            expect.objectContaining({ sourceId: "shared-mysql", serverName: "Shared MySQL", databaseName: "shop", until: day("2026-04-01").toISOString() }),
            expect.objectContaining({ databaseName: "shop_acme", until: null }),
        ]);
    });

    it("lists the databases a rule gives them that the server holds now", async () => {
        const shared = await runAsTenant("globex", () => listSharedDatabases("globex", day("2026-08-01")));
        expect(shared.map((entry) => entry.databaseName)).toEqual(["blog_one", "shop"]);
    });

    it("names the tenant that runs the server and its backups", async () => {
        const data = await overview("acme");
        expect(new Set(data.databases.map((entry) => entry.providerName))).toEqual(new Set(["Default"]));
    });

    it("shows the backups of a database from the time it was theirs only", async () => {
        expect(daysOf(await overview("acme"), "shop")).toEqual(["2026-03-20", "2026-02-10"]);
        expect(daysOf(await overview("globex"), "shop")).toEqual(["2026-07-10"]);
    });

    it("leaves out an archive without an index and a backup of another server", async () => {
        // The archive without an index and the one of the other server are both of March 10.
        expect(daysOf(await overview("acme"), "shop")).not.toContain("2026-03-10");
    });

    it("shows nothing of a database that was never theirs", async () => {
        expect(daysOf(await overview("acme"), "other")).toEqual([]);
        expect(daysOf(await overview("globex"), "shop_acme")).toEqual([]);
    });

    it("lists a backup once however many destinations hold it, as verified when one copy passed its check", async () => {
        const february = (await overview("acme")).backups.filter((entry) => entry.databaseName === "shop" && entry.createdAt.startsWith("2026-02-10"));
        expect(february).toHaveLength(1);
        expect(february[0].verification).toEqual({ at: day("2026-02-11").toISOString(), passed: true });
    });

    it("hands out no destination, path, key or size of the archive with a backup, only the size of its dump", async () => {
        const data = await overview("acme");
        expect(Object.keys(data.backups[0]).sort()).toEqual(["createdAt", "databaseKey", "databaseName", "dump", "encrypted", "id", "requestedBy", "sourceId", "verification"]);
        expect(data.backups[0].dump).toEqual({ stored: 100, unpacked: 400 });
        const text = JSON.stringify(data);
        for (const secret of ["msp-nas", "MSP NAS", "msp-s3", "Shared/", "msp-key", "nightly"]) expect(text).not.toContain(secret);
    });

    it("says which backups someone of the tenant started with Back up now, and by whom", async () => {
        await base.user.create({ data: { id: "u-sara", name: "Sara Nguyen", email: "sara@acme.test", emailVerified: true, createdAt: new Date(), updatedAt: new Date() } });
        await base.execution.create({ data: { id: "run-on-demand", jobId: "nightly", status: "Success", logs: "[]", path: "/Shared/may.tar" } });
        // A request of another tenant never names the person of this one.
        await base.execution.create({ data: { id: "run-of-globex", jobId: "nightly", status: "Success", logs: "[]", path: "Shared/jul.tar" } });
        await base.sharedBackupRequest.createMany({
            data: [
                { tenantId: "acme", sourceId: "shared-mysql", databaseName: "shop_acme", executionId: "run-on-demand", requestedById: "u-sara" },
                { tenantId: "globex", sourceId: "shared-mysql", databaseName: "blog_one", executionId: "run-of-globex", requestedById: "u-sara" },
            ],
        });
        try {
            const started = (await overview("acme")).backups.filter((entry) => entry.databaseName === "shop_acme").map((entry) => [entry.createdAt.slice(0, 10), entry.requestedBy]);
            // The path of the run names the backup however the destination writes it, a leading slash or not.
            expect(started).toEqual([["2026-07-10", null], ["2026-05-10", { name: "Sara Nguyen" }]]);
        } finally {
            await base.sharedBackupRequest.deleteMany({});
            await base.execution.deleteMany({ where: { id: { in: ["run-on-demand", "run-of-globex"] } } });
            await base.user.delete({ where: { id: "u-sara" } });
        }
    });

    it("reads the sizes of the dumps in the tenant of the server, so a backup that names no key is matched against that tenant's keys alone", async () => {
        let scope: unknown;
        mocks.dumpSizes.mockImplementationOnce(async (records: { id: string }[]) => {
            scope = explicitScope();
            return new Map(records.map((record) => [record.id, { stored: 100, unpacked: 400 }]));
        });
        expect((await overview("acme")).backups.every((entry) => entry.dump !== null)).toBe(true);
        expect(scope).toEqual({ kind: "tenant", tenantId: "default" });
    });

    it("never shows the customer the server, its job or its destination itself", async () => {
        await runAsTenant("acme", async () => {
            expect(await base.$extends(tenantScopeExtension(async () => null)).adapterConfig.findMany()).toEqual([]);
        });
    });
});

describe("what a customer does with a backup", () => {
    it("downloads the dump of their database alone, opened with the key the backup names, under a name of its own", async () => {
        const ref = await refOf("acme", "shop", "2026-02-10");
        const prepared = await prepareSharedDownload("acme", "u-acme", ref);
        // The copy whose check passed comes first.
        expect(mocks.writeDump).toHaveBeenCalledWith(
            { storageConfigId: "msp-s3", file: "Shared/feb.tar", database: "shop", keyOverride: { profileId: "msp-key" } },
            expect.any(String)
        );
        // The name of the archive starts with the job of the server's tenant, the time takes its place.
        // The token alone leaves the server, never the destination it was read from.
        expect(prepared).toEqual({ token: expect.any(String), fileName: "2026-02-10_1200_shop.sql" });
    });

    it("reads the next copy when the first one cannot be read", async () => {
        mocks.writeDump.mockRejectedValueOnce(new Error("offline"));
        await prepareSharedDownload("acme", "u-acme", await refOf("acme", "shop", "2026-02-10"));
        expect(mocks.writeDump).toHaveBeenCalledTimes(2);
        expect(mocks.writeDump.mock.calls[1][0]).toEqual(expect.objectContaining({ storageConfigId: "msp-nas" }));
    });

    it("reads a backup in the tenant of the server, so one that names no key is matched against that tenant's keys alone", async () => {
        mocks.listing.mockImplementation(async (id: string) => (id === "msp-nas" ? { files: LISTING.map((file) => ({ ...file, encryptionProfileId: undefined })), listedAt: new Date(), current: true } : null));
        let scope: unknown;
        mocks.writeDump.mockImplementationOnce(async () => {
            scope = explicitScope();
            return { fileName: "feb_shop.sql" };
        });
        await prepareSharedDownload("acme", "u-acme", await refOf("acme", "shop", "2026-02-10"));
        expect(mocks.writeDump).toHaveBeenCalledWith({ storageConfigId: "msp-nas", file: "Shared/feb.tar", database: "shop" }, expect.any(String));
        expect(scope).toEqual({ kind: "tenant", tenantId: "default" });
    });

    it("refuses a backup from before or after their time, or a database of someone else", async () => {
        const ref = await refOf("acme", "shop", "2026-02-10");
        const july = await refOf("globex", "shop", "2026-07-10");
        await expect(prepareSharedDownload("acme", "u-acme", { ...ref, backupId: july.backupId })).rejects.toBeInstanceOf(NotFoundError);
        await expect(prepareSharedDownload("globex", "u-globex", ref)).rejects.toBeInstanceOf(NotFoundError);
        await expect(prepareSharedDownload("acme", "u-acme", { ...ref, databaseName: "other" })).rejects.toBeInstanceOf(NotFoundError);
        await expect(prepareSharedDownload("acme", "u-acme", { ...ref, backupId: "0".repeat(32) })).rejects.toBeInstanceOf(NotFoundError);
        expect(mocks.writeDump).not.toHaveBeenCalled();
    });

    it("restores their database into itself on its server, and nothing else", async () => {
        const ref = await refOf("acme", "shop_acme", "2026-05-10");
        expect(await restoreSharedBackup("acme", ref, "Ana")).toEqual({
            executionId: "run-1",
            target: { sourceId: "shared-mysql", databaseName: "shop_acme" },
            // The tenant of the server gets its own run of the restore, and its audit log names the server and the customer.
            provider: { tenantId: "default", executionId: "msp-run-1", serverName: "Shared MySQL", customerName: "Acme" },
        });
        expect(mocks.restoreShared).toHaveBeenCalledWith(
            {
                storageConfigId: "msp-nas",
                file: "Shared/may.tar",
                scope: "databases",
                targetSourceId: "shared-mysql",
                databaseMapping: [{ originalName: "shop_acme", targetName: "shop_acme", selected: true }],
                keyOverride: { profileId: "msp-key" },
                triggerInfo: { type: "Manual", label: "Ana" },
                // The run in the customer's History names the database, never the archive of the server.
                shared: { databaseName: "shop_acme", provider: { tenantId: "default", name: "Default", customer: "Acme" } },
            },
            "acme"
        );
    });

    it("restores with the key found among the keys of the server's tenant when the backup names none", async () => {
        mocks.listing.mockImplementation(async (id: string) => (id === "msp-nas" ? { files: LISTING.map((file) => ({ ...file, encryptionProfileId: undefined })), listedAt: new Date(), current: true } : null));
        let scope: unknown;
        mocks.openArchive.mockImplementationOnce(async () => {
            scope = explicitScope();
            return { masterKey: Buffer.alloc(32, 7), dispose: vi.fn() };
        });
        await restoreSharedBackup("acme", await refOf("acme", "shop_acme", "2026-05-10"), "Ana");
        expect(mocks.openArchive).toHaveBeenCalledWith("msp-nas", "Shared/may.tar", undefined);
        expect(scope).toEqual({ kind: "tenant", tenantId: "default" });
        expect(mocks.restoreShared).toHaveBeenCalledWith(expect.objectContaining({ keyOverride: { rawKeyHex: "07".repeat(32) } }), "acme");
    });

    it("restores from the next copy when the destination of the first one does not answer", async () => {
        const verified = { verification: { verifiedAt: day("2026-05-11").toISOString(), passed: true, trigger: "scheduled" } };
        mocks.listing.mockImplementation(async (id: string) => {
            if (id === "msp-nas") return { files: LISTING, listedAt: new Date(), current: true };
            if (id === "msp-s3") return { files: [backup("may.tar", "2026-05-10", ["shop", "shop_acme", "blog_one"], verified)], listedAt: new Date(), current: true };
            return null;
        });
        mocks.openArchive.mockRejectedValueOnce(new Error("connect ETIMEDOUT"));
        await restoreSharedBackup("acme", await refOf("acme", "shop_acme", "2026-05-10"), "Ana");
        expect(mocks.openArchive.mock.calls.map((call) => call[0])).toEqual(["msp-s3", "msp-nas"]);
        expect(mocks.restoreShared).toHaveBeenCalledWith(expect.objectContaining({ storageConfigId: "msp-nas", file: "Shared/may.tar" }), "acme");
    });

    it("starts no restore when no copy opens, and says so without naming the archive", async () => {
        mocks.openArchive.mockRejectedValue(new Error("Archive missing: Shared/may.tar"));
        const refused = restoreSharedBackup("acme", await refOf("acme", "shop_acme", "2026-05-10"), "Ana");
        await expect(refused).rejects.toBeInstanceOf(ValidationError);
        await expect(refused).rejects.not.toThrow(/Shared\//);
        expect(mocks.restoreShared).not.toHaveBeenCalled();
    });

    it("restores nothing that is not theirs", async () => {
        await expect(restoreSharedBackup("globex", await refOf("acme", "shop", "2026-02-10"), "Gil")).rejects.toBeInstanceOf(NotFoundError);
        expect(mocks.restoreShared).not.toHaveBeenCalled();
    });

    it("downloads a backup from their time of a database that moved on, but never writes it over the new owner's", async () => {
        // shop was Acme's until April and is Globex's since June, the backup from February is Acme's.
        const ref = await refOf("acme", "shop", "2026-02-10");
        await expect(restoreSharedBackup("acme", ref, "Ana")).rejects.toBeInstanceOf(ValidationError);
        expect(mocks.restoreShared).not.toHaveBeenCalled();
        await expect(prepareSharedDownload("acme", "u-acme", ref)).resolves.toEqual(expect.objectContaining({ fileName: "2026-02-10_1200_shop.sql" }));
    });
});

describe("what the tenant of the server decides", () => {
    it("lists the databases of the server with who each belongs to now", async () => {
        const model = await runAsTenant("default", () => databaseAssignmentService.forSource("shared-mysql", day("2026-08-01")));
        expect(model.databases.map((entry) => [entry.name, entry.owner?.tenantName ?? null, entry.owner?.via ?? null])).toEqual([
            ["blog_one", "Globex", "rule"],
            ["other", null, null],
            ["shop", "Globex", "assignment"],
            ["shop_acme", "Acme", "assignment"],
        ]);
        expect(model.customers.map((tenant) => tenant.id)).toEqual(["acme", "globex"]);
    });

    it("counts the backups of each database once however many destinations hold them", async () => {
        const model = await runAsTenant("default", () => databaseAssignmentService.forSource("shared-mysql", day("2026-08-01")));
        expect(Object.fromEntries(model.databases.map((entry) => [entry.name, entry.backups]))).toEqual({ blog_one: 2, other: 1, shop: 4, shop_acme: 3 });
    });

    it("hands the timeline the days of the backups of the databases a tenant ever held, and only of those", async () => {
        const model = await runAsTenant("default", () => databaseAssignmentService.forSource("shared-mysql", day("2026-08-01")));
        expect(Object.keys(model.backupDates).sort()).toEqual(["blog_one", "shop", "shop_acme"]);
        expect(model.backupDates.shop.map((iso) => iso.slice(0, 10))).toEqual(["2026-02-10", "2026-03-20", "2026-05-10", "2026-07-10"]);
    });

    it("ends an assignment instead of deleting it when the database moves on", async () => {
        await runAsTenant("default", () => databaseAssignmentService.assign("shared-mysql", [{ databaseName: "other", tenantId: "acme" }], "u-msp", day("2026-08-01")));
        await runAsTenant("default", () => databaseAssignmentService.assign("shared-mysql", [{ databaseName: "other", tenantId: "globex" }], "u-msp", day("2026-09-01")));

        const rows = await base.databaseAssignment.findMany({ where: { databaseName: "other" }, orderBy: { validFrom: "asc" } });
        expect(rows.map((row) => [row.tenantId, row.validFrom.toISOString(), row.validUntil?.toISOString() ?? null])).toEqual([
            ["acme", day("2026-08-01").toISOString(), day("2026-09-01").toISOString()],
            ["globex", day("2026-09-01").toISOString(), null],
        ]);
    });

    it("never starts an assignment before the end of the one before, so no backup belongs to two customers", async () => {
        await runAsTenant("default", () => databaseAssignmentService.assign("shared-mysql", [{ databaseName: "other", tenantId: "acme", validFrom: day("2026-01-01") }], "u-msp", day("2026-09-15")));
        const current = await base.databaseAssignment.findFirst({ where: { databaseName: "other", validUntil: null } });
        expect(current?.validFrom.toISOString()).toBe(day("2026-09-15").toISOString());
    });

    it("takes back a database a rule gives, which no rule gives again, and counts no change for one nobody holds", async () => {
        expect(await runAsTenant("default", () => databaseAssignmentService.assign("shared-mysql", [{ databaseName: "blog_one", tenantId: null }], "u-msp"))).toEqual({ changed: 1 });
        const data = await runAsTenant("default", () => databaseAssignmentService.forSource("shared-mysql"));
        expect(data.databases.find((row) => row.name === "blog_one")?.owner ?? null).toBeNull();
        expect(await runAsTenant("default", () => databaseAssignmentService.assign("shared-mysql", [{ databaseName: "blog_one", tenantId: null }], "u-msp"))).toEqual({ changed: 0 });
        expect(await runAsTenant("default", () => databaseAssignmentService.assign("shared-mysql", [{ databaseName: "nobody_db", tenantId: null }], "u-msp"))).toEqual({ changed: 0 });
    });

    it("starts a rule today or earlier, like an assignment", async () => {
        const tomorrow = new Date(Date.now() + 86_400_000);
        await expect(runAsTenant("default", () => databaseAssignmentService.addRule("shared-mysql", { pattern: "shop_*", tenantId: "acme", validFrom: tomorrow })))
            .rejects.toBeInstanceOf(ValidationError);
    });

    it("refuses to give a database to its own tenant or to a tenant that is gone", async () => {
        await expect(runAsTenant("default", () => databaseAssignmentService.assign("shared-mysql", [{ databaseName: "shop", tenantId: "default" }], null)))
            .rejects.toBeInstanceOf(ValidationError);
        await expect(runAsTenant("default", () => databaseAssignmentService.assign("shared-mysql", [{ databaseName: "shop", tenantId: "nobody" }], null)))
            .rejects.toBeInstanceOf(ValidationError);
    });

    it("shares only from a tenant that shares, so a customer neither gives databases away nor sees the other tenants", async () => {
        await base.adapterConfig.create({ data: { id: "acme-mysql", tenantId: "acme", name: "Acme MySQL", type: "database", adapterId: "mysql", config: "{}" } });
        const model = await runAsTenant("acme", () => databaseAssignmentService.forSource("acme-mysql"));
        expect(model.customers).toEqual([]);
        await expect(runAsTenant("acme", () => databaseAssignmentService.assign("acme-mysql", [{ databaseName: "crm", tenantId: "globex" }], null)))
            .rejects.toBeInstanceOf(ValidationError);
        await expect(runAsTenant("acme", () => databaseAssignmentService.addRule("acme-mysql", { pattern: "crm_*", tenantId: "globex" })))
            .rejects.toBeInstanceOf(ValidationError);
    });

    it("lets no other tenant touch the assignments of the server", async () => {
        await expect(runAsTenant("acme", () => databaseAssignmentService.assign("shared-mysql", [{ databaseName: "shop", tenantId: "acme" }], null)))
            .rejects.toBeInstanceOf(NotFoundError);
        await expect(runAsTenant("acme", () => databaseAssignmentService.forSource("shared-mysql"))).rejects.toBeInstanceOf(NotFoundError);
    });
});

describe("tenants of the MSP that share databases", () => {
    it("lets a second tenant share its servers once the platform switches it on, to every other tenant", async () => {
        await base.tenant.create({ data: { id: "msp-two", name: "MSP Two" } });
        await base.adapterConfig.create({ data: { id: "two-mysql", tenantId: "msp-two", name: "Two MySQL", type: "database", adapterId: "mysql", config: "{}" } });
        await expect(runAsTenant("msp-two", () => databaseAssignmentService.assign("two-mysql", [{ databaseName: "crm", tenantId: "globex" }], null)))
            .rejects.toBeInstanceOf(ValidationError);

        expect(await tenantService.setSharing("msp-two", true)).toEqual({ name: "MSP Two", changed: true });
        expect(await runAsTenant("msp-two", () => databaseAssignmentService.assign("two-mysql", [{ databaseName: "crm", tenantId: "globex" }], null))).toEqual({ changed: 1 });
        // Every other tenant can get one, a tenant that shares as well.
        const model = await runAsTenant("msp-two", () => databaseAssignmentService.forSource("two-mysql"));
        expect(model.customers.map((tenant) => tenant.id).sort()).toEqual(["acme", "default", "globex"]);
        expect(await runAsTenant("default", () => databaseAssignmentService.assign("shared-mysql", [{ databaseName: "other", tenantId: "msp-two" }], null))).toEqual({ changed: 1 });
        await runAsTenant("default", () => databaseAssignmentService.assign("shared-mysql", [{ databaseName: "other", tenantId: null }], null));
    });

    it("stops sharing only once the tenant took back what it gives, and starts also for a tenant that holds databases of another", async () => {
        await expect(tenantService.setSharing("msp-two", false)).rejects.toBeInstanceOf(ValidationError);
        await runAsTenant("msp-two", () => databaseAssignmentService.assign("two-mysql", [{ databaseName: "crm", tenantId: null }], null));
        expect(await tenantService.setSharing("msp-two", false)).toEqual({ name: "MSP Two", changed: true });

        // Globex holds databases of the home tenant and may share its own all the same.
        expect(await tenantService.setSharing("globex", true)).toEqual({ name: "Globex", changed: true });
        expect(await tenantService.setSharing("globex", false)).toEqual({ name: "Globex", changed: true });
    });
});

describe("a customer that is deleted", () => {
    it("keeps the backups of its time away from a tenant whose rule matches the name, and ends what it held", async () => {
        // Retail gets every shop_ database by a rule, Acme holds shop_acme by name since March.
        await base.tenant.create({ data: { id: "retail", name: "Retail" } });
        await base.databaseAssignmentRule.create({ data: { sourceId: "shared-mysql", pattern: "shop_*", tenantId: "retail", validFrom: day("2026-01-01") } });
        expect((await overview("retail")).backups.filter((entry) => entry.databaseName === "shop_acme")).toEqual([]);

        await tenantService.delete("acme");

        expect((await overview("retail")).backups.filter((entry) => entry.databaseName === "shop_acme")).toEqual([]);
        const kept = await base.databaseAssignment.findFirst({ where: { databaseName: "shop_acme" } });
        expect(kept?.tenantId).toBe("acme");
        expect(kept?.validUntil).not.toBeNull();
    });
});
