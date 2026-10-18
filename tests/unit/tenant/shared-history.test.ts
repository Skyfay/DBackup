// @vitest-environment node
/**
 * The history of a shared database, against a real SQLite database migrated with the migrations of
 * this version: a database a rule gave keeps the backups of its time once it is someone else's or
 * the server no longer lists it, and a backup the server's tenant writes to a destination another
 * tenant shares with it reaches the customer too, to download.
 */
import { execFileSync } from "child_process";
import { mkdtempSync, rmSync } from "fs";
import os from "os";
import path from "path";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { PrismaClient } from "@prisma/client";
import { tenantScopeExtension } from "@/lib/tenant/prisma-scope";

const holder = vi.hoisted(() => ({ client: undefined as unknown }));
const mocks = vi.hoisted(() => ({
    listing: vi.fn(),
    writeDump: vi.fn(),
    openArchive: vi.fn(),
    restoreShared: vi.fn(),
}));

vi.mock("@/lib/logging/logger", () => ({
    logger: { child: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }) },
}));
vi.mock("@/lib/prisma", () => ({ get default() { return holder.client; } }));
vi.mock("@/services/storage/storage-service", () => ({ storageService: { readCachedListing: mocks.listing } }));
vi.mock("@/services/restore/archive-download", () => ({ writeDatabaseDump: mocks.writeDump }));
vi.mock("@/services/restore/file-restore", () => ({ openArchiveForRestore: mocks.openArchive }));
vi.mock("@/services/restore/restore-service", () => ({ restoreService: { restoreShared: mocks.restoreShared } }));
vi.mock("@/services/tenant/shared-dump-sizes", () => ({ dumpSizes: vi.fn(async () => new Map()) }));

const { listSharedDatabases, sharedOverview, prepareSharedDownload, restoreSharedBackup } = await import("@/services/tenant/shared-databases");

let root = "";
let base: PrismaClient;

const day = (iso: string) => new Date(`${iso}T12:00:00.000Z`);
const NOW = day("2026-08-01");

const backup = (file: string, createdAt: string, databases: string[]) => ({
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
});

beforeAll(async () => {
    root = mkdtempSync(path.join(os.tmpdir(), "dbackup-shared-history-"));
    const file = path.join(root, "history.db");
    execFileSync(path.join(process.cwd(), "node_modules", ".bin", "prisma"), ["migrate", "deploy"], {
        env: { ...process.env, DATABASE_URL: `file:${file}` },
        stdio: "pipe",
    });
    base = new PrismaClient({ datasources: { db: { url: `file:${file}` } } });
    holder.client = base.$extends(tenantScopeExtension(async () => null));

    await base.tenant.create({ data: { id: "acme", name: "Acme" } });
    await base.tenant.create({ data: { id: "globex", name: "Globex" } });
    // A storage company shares its S3 with the MSP, the home tenant, which writes there too.
    await base.tenant.create({ data: { id: "store-co", name: "Store Co", sharesWithCustomers: true } });
    await base.adapterConfig.create({ data: { id: "shared-mysql", name: "Shared MySQL", type: "database", adapterId: "mysql", config: "{}" } });
    await base.adapterConfig.create({ data: { id: "msp-nas", name: "MSP NAS", type: "storage", adapterId: "local-filesystem", config: "{}" } });
    await base.adapterConfig.create({ data: { tenantId: "store-co", id: "co-s3", name: "Store S3", type: "storage", adapterId: "s3-generic", config: "{}" } });
    await base.connectionShare.create({ data: { id: "co-s3", tenantId: "store-co", tenants: { create: { tenantId: "default" } } } });
    await base.job.create({ data: { id: "nightly", name: "Shared", schedule: "0 3 * * *", sourceId: "shared-mysql" } });
    // blog_gone was dropped from the server, the list holds the others.
    await base.databaseListCache.create({ data: { adapterConfigId: "shared-mysql", databasesJson: JSON.stringify(["blog_one", "blog_two"]) } });
    await base.sharedServer.create({ data: { id: "shared-mysql", name: "Shared MySQL", adapterId: "mysql", tenantId: "default" } });
    // Globex gets every blog_ database by a rule, and Acme got blog_one by name in June.
    await base.databaseAssignmentRule.create({ data: { sourceId: "shared-mysql", pattern: "blog_*", tenantId: "globex", validFrom: day("2026-01-01"), createdAt: day("2026-01-01") } });
    await base.databaseAssignment.create({ data: { sourceId: "shared-mysql", databaseName: "blog_one", tenantId: "acme", validFrom: day("2026-06-01"), createdAt: day("2026-06-01") } });
}, 120_000);

afterAll(async () => {
    await base?.$disconnect();
    if (root) rmSync(root, { recursive: true, force: true });
});

beforeEach(() => {
    vi.clearAllMocks();
    mocks.listing.mockImplementation(async (id: string, tenantId?: string) => {
        if (id === "msp-nas") {
            return { files: [backup("feb.tar", "2026-02-10", ["blog_one", "blog_gone"]), backup("may.tar", "2026-05-10", ["blog_one", "blog_two"]), backup("jul.tar", "2026-07-10", ["blog_one", "blog_two"])], listedAt: new Date(), current: true };
        }
        // The folder of the MSP on the destination Store Co shares with it, which only it reads.
        if (id === "co-s3" && tenantId === "default") return { files: [backup("aug.tar", "2026-07-20", ["blog_two"])], listedAt: new Date(), current: true };
        return null;
    });
    mocks.writeDump.mockResolvedValue({ fileName: "aug_blog_two.sql" });
    mocks.openArchive.mockResolvedValue({ masterKey: undefined, dispose: vi.fn() });
    mocks.restoreShared.mockResolvedValue({ success: true, executionId: "run-1", providerExecutionId: "msp-run-1" });
});

const daysOf = async (tenantId: string, databaseName: string) =>
    (await sharedOverview(tenantId, NOW)).backups.filter((entry) => entry.databaseName === databaseName).map((entry) => entry.createdAt.slice(0, 10));

describe("a database a rule gave", () => {
    it("keeps the backups of its time once it is someone else's, as a former database", async () => {
        const databases = await listSharedDatabases("globex", NOW);
        expect(databases.find((entry) => entry.databaseName === "blog_one")).toMatchObject({ until: day("2026-06-01").toISOString() });
        expect(await daysOf("globex", "blog_one")).toEqual(["2026-05-10", "2026-02-10"]);
        // The backup of July is Acme's.
        expect(await daysOf("acme", "blog_one")).toEqual(["2026-07-10"]);
    });

    it("keeps the backups of a database the server no longer lists", async () => {
        expect(await daysOf("globex", "blog_gone")).toEqual(["2026-02-10"]);
    });
});

describe("a backup on a destination another tenant shares with the tenant of the server", () => {
    const refOfAugust = async () => {
        const found = (await sharedOverview("globex", NOW)).backups.find((entry) => entry.databaseName === "blog_two" && entry.createdAt.startsWith("2026-07-20"));
        if (!found) throw new Error("No backup of blog_two from July 20");
        return { sourceId: "shared-mysql", databaseName: "blog_two", backupId: found.id };
    };

    it("reaches the customer beside the backups on the destinations of the server's tenant", async () => {
        expect(await daysOf("globex", "blog_two")).toEqual(["2026-07-20", "2026-07-10", "2026-05-10"]);
        expect(mocks.listing).toHaveBeenCalledWith("co-s3", "default");
    });

    it("downloads from the folder of the server's tenant there", async () => {
        await prepareSharedDownload("globex", "u-globex", await refOfAugust());
        expect(mocks.writeDump).toHaveBeenCalledWith(expect.objectContaining({ storageConfigId: "co-s3", file: "Shared/aug.tar", database: "blog_two" }), expect.any(String));
    });

    it("is restored too, opened in the folder of the server's tenant there", async () => {
        await restoreSharedBackup("globex", await refOfAugust(), "Globex", NOW);
        expect(mocks.restoreShared).toHaveBeenCalledWith(
            expect.objectContaining({ storageConfigId: "co-s3", file: "Shared/aug.tar", shared: expect.objectContaining({ databaseName: "blog_two", copyTenantId: "default" }) }),
            "globex"
        );
    });
});
