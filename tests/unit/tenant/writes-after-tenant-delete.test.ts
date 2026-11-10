// @vitest-environment node
/**
 * A customer deleted after a writer checked it and before the writer commits, against a real SQLite
 * database migrated with the migrations of this version: giving it a database, adding a rule for it
 * and starting a backup on demand for it are refused in the transaction of the write, so no row
 * keeps the id of a tenant that is gone.
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
const { createCustomerBackupRun } = await import("@/services/tenant/shared-backup-runs");

let root = "";
let base: PrismaClient;
let scoped: unknown;

const day = (iso: string) => new Date(`${iso}T12:00:00.000Z`);
const NOW = day("2026-09-01");
const asHome = <T,>(fn: () => Promise<T>) => runAsTenant("default", fn);
const lena = { id: "u-lena", name: "Lena" };

beforeAll(async () => {
    root = mkdtempSync(path.join(os.tmpdir(), "dbackup-writes-after-delete-"));
    const file = path.join(root, "writes.db");
    execFileSync(path.join(process.cwd(), "node_modules", ".bin", "prisma"), ["migrate", "deploy"], {
        env: { ...process.env, DATABASE_URL: `file:${file}` },
        stdio: "pipe",
    });
    base = new PrismaClient({ datasources: { db: { url: `file:${file}` } } });
    scoped = base.$extends(tenantScopeExtension(async () => null));
    holder.client = scoped;
}, 120_000);

afterAll(async () => {
    await base?.$disconnect();
    if (root) rmSync(root, { recursive: true, force: true });
});

/** The home tenant shares the MySQL server, Acme is its customer. */
beforeEach(async () => {
    vi.clearAllMocks();
    holder.client = scoped;
    for (const model of ["sharedBackupRequest", "execution", "databaseAssignment", "databaseAssignmentRule", "sharedServer", "databaseListCache", "job", "adapterConfig", "tenant"] as const) {
        await (base[model] as unknown as { deleteMany(args: object): Promise<unknown> }).deleteMany({ where: model === "tenant" ? { id: { not: "default" } } : {} });
    }
    await base.tenant.create({ data: { id: "acme", name: "Acme", onDemandPerDay: 5 } });
    await base.adapterConfig.create({ data: { id: "mysql", name: "Shared MySQL", type: "database", adapterId: "mysql", config: "{}" } });
    await base.databaseListCache.create({ data: { adapterConfigId: "mysql", databasesJson: JSON.stringify([{ name: "shop" }]) } });
    await base.job.create({ data: { id: "mysql-job", name: "Nightly", schedule: "0 3 * * *", sourceId: "mysql" } });
    mocks.executeJob.mockResolvedValue({ success: true, executionId: "run-1" });
});

/**
 * Runs `act` while `tenantId` is deleted right before the first transaction starts, like by a
 * delete that commits after the writer checked the tenant and before it writes.
 */
async function deletedBeforeWrite<T>(tenantId: string, act: () => Promise<T>): Promise<T> {
    const real = holder.client as object;
    holder.client = new Proxy(real, {
        get: (target, key) => {
            if (key !== "$transaction") return Reflect.get(target, key);
            return async (...args: unknown[]) => {
                holder.client = real;
                await base.tenant.delete({ where: { id: tenantId } });
                return (Reflect.get(target, key) as (...rest: unknown[]) => Promise<unknown>).apply(target, args);
            };
        },
    });
    try {
        return await act();
    } finally {
        holder.client = real;
    }
}

describe("a customer deleted before the write", () => {
    it("is given no database", async () => {
        await expect(deletedBeforeWrite("acme", () => asHome(() => databaseAssignmentService.assign("mysql", [{ databaseName: "shop", tenantId: "acme" }], null, NOW))))
            .rejects.toThrow("The tenant no longer exists.");
        expect(await base.databaseAssignment.count()).toBe(0);
    });

    it("gets no rule", async () => {
        await expect(deletedBeforeWrite("acme", () => asHome(() => databaseAssignmentService.addRule("mysql", { pattern: "shop*", tenantId: "acme" }, NOW))))
            .rejects.toThrow("The tenant no longer exists.");
        expect(await base.databaseAssignmentRule.count()).toBe(0);
    });

    it("still lets the server's tenant take a database back, which names no customer", async () => {
        await asHome(() => databaseAssignmentService.assign("mysql", [{ databaseName: "shop", tenantId: "acme" }], null, day("2026-08-01")));
        await expect(asHome(() => databaseAssignmentService.assign("mysql", [{ databaseName: "shop", tenantId: null }], null, NOW))).resolves.toMatchObject({ changed: 1 });
    });

    it("starts no backup on demand and keeps no request of it", async () => {
        await asHome(() => databaseAssignmentService.assign("mysql", [{ databaseName: "shop", tenantId: "acme" }], null, day("2026-08-01")));

        await expect(deletedBeforeWrite("acme", () => requestSharedBackup("acme", lena, { sourceId: "mysql", databaseName: "shop" }, NOW)))
            .rejects.toThrow("The tenant no longer exists.");
        expect(await base.sharedBackupRequest.count()).toBe(0);
        expect(await base.execution.count()).toBe(0);
        expect(mocks.executeJob).not.toHaveBeenCalled();
    });

    it("gets no run that follows a backup", async () => {
        const run = { tenantId: "acme", leaderId: "leader", databaseName: "shop", serverName: "Shared MySQL", adapterId: "mysql", providerName: "Default", person: "Lena" };
        await expect(deletedBeforeWrite("acme", () => createCustomerBackupRun(run))).rejects.toThrow("The tenant no longer exists.");
        expect(await base.execution.count()).toBe(0);
    });
});
