// @vitest-environment node
/**
 * Rules of Shared Databases from the user guide that the other tests leave open, against a real
 * SQLite database migrated with the migrations of this version: a rule counts the backups on demand
 * of every database it gives on its own, and a backup on demand picks the job that backs the
 * database up.
 */
import { execFileSync } from "child_process";
import { mkdtempSync, rmSync } from "fs";
import os from "os";
import path from "path";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { PrismaClient } from "@prisma/client";
import { runAsTenant } from "@/lib/tenant/context";
import { tenantScopeExtension } from "@/lib/tenant/prisma-scope";

const holder = vi.hoisted(() => ({ client: undefined as unknown }));
const mocks = vi.hoisted(() => ({ executeJob: vi.fn() }));

vi.mock("@/lib/logging/logger", () => ({
    logger: { child: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }) },
}));
vi.mock("@/lib/prisma", () => ({ get default() { return holder.client; } }));
vi.mock("@/services/storage/storage-service", () => ({ storageService: { readCachedListing: async () => null } }));
vi.mock("@/services/backup/backup-service", () => ({ backupService: { executeJob: mocks.executeJob } }));
vi.mock("@/services/system/system-settings-service", () => ({ getTimezone: async () => "UTC" }));

const { databaseAssignmentService } = await import("@/services/tenant/database-assignments");
const { requestSharedBackup } = await import("@/services/tenant/shared-on-demand");

let root = "";
let base: PrismaClient;
let runs = 0;

const day = (iso: string) => new Date(`${iso}T12:00:00.000Z`);
const HOME = "default";
const NOW = day("2026-09-01");
const asHome = <T,>(fn: () => Promise<T>) => runAsTenant(HOME, fn);
const lena = { id: "u-lena", name: "Lena" };

async function server(id: string, databases: string[]) {
    await base.adapterConfig.create({ data: { id, name: id, type: "database", adapterId: "mysql", config: "{}" } });
    await base.databaseListCache.create({ data: { adapterConfigId: id, databasesJson: JSON.stringify(databases.map((name) => ({ name }))) } });
}

beforeAll(async () => {
    root = mkdtempSync(path.join(os.tmpdir(), "dbackup-shared-review-"));
    const file = path.join(root, "review.db");
    execFileSync(path.join(process.cwd(), "node_modules", ".bin", "prisma"), ["migrate", "deploy"], {
        env: { ...process.env, DATABASE_URL: `file:${file}` },
        stdio: "pipe",
    });
    base = new PrismaClient({ datasources: { db: { url: `file:${file}` } } });
    holder.client = base.$extends(tenantScopeExtension(async () => null));

    await base.tenant.create({ data: { id: "acme", name: "Acme", onDemandPerDay: 5 } });
    await server("rule-mysql", ["shop_a", "shop_b"]);
    await server("jobs-mysql", ["crm"]);
    await base.job.create({ data: { id: "rule-job", name: "Rule job", schedule: "0 3 * * *", sourceId: "rule-mysql" } });
    // The oldest job leaves crm out, a disabled one backs up every database, an enabled one names crm.
    await base.job.create({ data: { id: "other-job", name: "Other", schedule: "0 3 * * *", sourceId: "jobs-mysql", databases: JSON.stringify(["billing"]), createdAt: day("2026-01-01") } });
    await base.job.create({ data: { id: "off-job", name: "Off", schedule: "0 3 * * *", sourceId: "jobs-mysql", enabled: false, createdAt: day("2026-01-02") } });
    await base.job.create({ data: { id: "crm-job", name: "Crm", schedule: "0 3 * * *", sourceId: "jobs-mysql", databases: JSON.stringify(["crm"]), createdAt: day("2026-01-03") } });

    const jan = day("2026-01-01");
    const rule = await asHome(() => databaseAssignmentService.addRule("rule-mysql", { pattern: "shop_*", tenantId: "acme", validFrom: jan }, jan));
    await asHome(() => databaseAssignmentService.setRuleOnDemand("rule-mysql", rule.id, 1));
    await asHome(() => databaseAssignmentService.assign("jobs-mysql", [{ databaseName: "crm", tenantId: "acme", validFrom: jan }], "u-msp", jan));
}, 120_000);

afterAll(async () => {
    await base?.$disconnect();
    if (root) rmSync(root, { recursive: true, force: true });
});

beforeEach(() => {
    vi.clearAllMocks();
    mocks.executeJob.mockImplementation(async () => ({ success: true, executionId: `run-${++runs}` }));
});

describe("backups on demand of the databases a rule gives", () => {
    it("counts every database of the rule on its own, so one database used up leaves the others open", async () => {
        await expect(requestSharedBackup("acme", lena, { sourceId: "rule-mysql", databaseName: "shop_a" }, NOW)).resolves.toEqual(expect.objectContaining({ databaseName: "shop_a" }));
        await expect(requestSharedBackup("acme", lena, { sourceId: "rule-mysql", databaseName: "shop_b" }, NOW)).resolves.toEqual(expect.objectContaining({ databaseName: "shop_b" }));
        await expect(requestSharedBackup("acme", lena, { sourceId: "rule-mysql", databaseName: "shop_a" }, NOW)).rejects.toThrow(/1 backup of shop_a started today/);
        expect(mocks.executeJob).toHaveBeenCalledTimes(2);
    });
});

describe("the job a backup on demand runs", () => {
    it("is an enabled job that backs the database up, never the older one that leaves it out", async () => {
        await requestSharedBackup("acme", lena, { sourceId: "jobs-mysql", databaseName: "crm" }, NOW);
        expect(mocks.executeJob).toHaveBeenCalledWith("crm-job", expect.anything(), expect.objectContaining({ databases: ["crm"] }));
    });
});
