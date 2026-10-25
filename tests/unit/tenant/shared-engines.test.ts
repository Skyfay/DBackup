// @vitest-environment node
/**
 * A server of an engine that cannot hand out one database alone, like Redis, whose backup is one
 * snapshot of every logical database, gives nothing to a customer: no database by name, no rule and
 * no move, and an assignment made before the check hands the customer nothing either. A server of
 * a tenant that does not share takes nothing back either, against a real SQLite database migrated
 * with the migrations of this version.
 */
import { execFileSync } from "child_process";
import { mkdtempSync, rmSync } from "fs";
import os from "os";
import path from "path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PrismaClient } from "@prisma/client";
import { runAsSystem, runAsTenant } from "@/lib/tenant/context";
import { tenantScopeExtension } from "@/lib/tenant/prisma-scope";

const holder = vi.hoisted(() => ({ client: undefined as unknown }));

vi.mock("@/lib/logging/logger", () => ({
    logger: { child: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }) },
}));
vi.mock("@/lib/prisma", () => ({ get default() { return holder.client; } }));
vi.mock("@/services/storage/storage-service", () => ({ storageService: { readCachedListing: async () => null } }));
vi.mock("@/services/backup/backup-service", () => ({ backupService: { executeJob: vi.fn() } }));
vi.mock("@/services/system/system-settings-service", () => ({ getTimezone: async () => "UTC" }));

const { databaseAssignmentService } = await import("@/services/tenant/database-assignments");
const { moveDatabase } = await import("@/services/tenant/database-moves");
const { tenantPlaces } = await import("@/services/tenant/shared-places");
const { requestSharedBackup } = await import("@/services/tenant/shared-on-demand");

let root = "";
let base: PrismaClient;

const HOME = "default";
const NOW = new Date("2026-09-01T12:00:00.000Z");
const asHome = <T,>(fn: () => Promise<T>) => runAsTenant(HOME, fn);

async function server(id: string, adapterId: string, databases: string[], tenantId = HOME) {
    await base.adapterConfig.create({ data: { id, name: id, type: "database", adapterId, config: "{}", tenantId } });
    await base.databaseListCache.create({ data: { adapterConfigId: id, databasesJson: JSON.stringify(databases.map((name) => ({ name }))) } });
}

beforeAll(async () => {
    root = mkdtempSync(path.join(os.tmpdir(), "dbackup-shared-engines-"));
    const file = path.join(root, "engines.db");
    execFileSync(path.join(process.cwd(), "node_modules", ".bin", "prisma"), ["migrate", "deploy"], {
        env: { ...process.env, DATABASE_URL: `file:${file}` },
        stdio: "pipe",
    });
    base = new PrismaClient({ datasources: { db: { url: `file:${file}` } } });
    holder.client = base.$extends(tenantScopeExtension(async () => null));

    await base.tenant.create({ data: { id: "acme", name: "Acme", onDemandPerDay: 5 } });
    await base.tenant.create({ data: { id: "solo", name: "Solo" } });
    await server("cache-1", "redis", ["0", "1"]);
    await server("cache-2", "redis", ["0", "1"]);
    await server("kv-1", "valkey", ["0"]);
    await server("solo-mysql", "mysql", ["crm"], "solo");
    // Given before the check existed, straight into the table.
    await base.sharedServer.create({ data: { id: "cache-1", name: "cache-1", adapterId: "redis", tenantId: HOME } });
    await base.databaseAssignment.create({ data: { sourceId: "cache-1", databaseName: "1", tenantId: "acme", validFrom: new Date("2026-01-01T00:00:00.000Z"), createdAt: new Date("2026-01-01T00:00:00.000Z") } });
}, 120_000);

afterAll(async () => {
    await base?.$disconnect();
    if (root) rmSync(root, { recursive: true, force: true });
});

describe("a server whose backup holds every database in one snapshot", () => {
    it("gives no database of Redis or Valkey to a customer by name", async () => {
        await expect(asHome(() => databaseAssignmentService.assign("cache-2", [{ databaseName: "0", tenantId: "acme" }], "u-msp", NOW))).rejects.toThrow(/Redis keeps every database/);
        await expect(asHome(() => databaseAssignmentService.assign("kv-1", [{ databaseName: "0", tenantId: "acme" }], "u-msp", NOW))).rejects.toThrow(/Valkey keeps every database/);
        expect(await base.databaseAssignment.count({ where: { sourceId: { in: ["cache-2", "kv-1"] } } })).toBe(0);
    });

    it("adds no rule there", async () => {
        await expect(asHome(() => databaseAssignmentService.addRule("cache-2", { pattern: "*", tenantId: "acme" }, NOW))).rejects.toThrow(/Redis keeps every database/);
        expect(await base.databaseAssignmentRule.count({ where: { sourceId: "cache-2" } })).toBe(0);
    });

    it("moves no database of it, also one a customer was given before", async () => {
        await expect(asHome(() => moveDatabase("cache-1", { databaseName: "1", toSourceId: "cache-2" }, "u-msp", NOW))).rejects.toThrow(/Redis keeps every database/);
        expect(await base.databaseAssignment.count({ where: { sourceId: "cache-2" } })).toBe(0);
    });

    it("still takes back what was given before, so the provider can end it", async () => {
        await base.databaseAssignment.create({ data: { sourceId: "cache-1", databaseName: "0", tenantId: "acme", validFrom: new Date("2026-01-01T00:00:00.000Z"), createdAt: new Date("2026-01-01T00:00:00.000Z") } });
        await expect(asHome(() => databaseAssignmentService.assign("cache-1", [{ databaseName: "0", tenantId: null }], "u-msp", NOW))).resolves.toEqual({ changed: 1 });
    });

    it("hands a customer nothing of a database given there before: no backups, no download, no restore", async () => {
        const held = await runAsSystem(() => tenantPlaces("acme", NOW));
        expect([...held.places.keys()].filter((key) => key.startsWith("cache-1/"))).toEqual([]);
    });

    it("starts no backup on demand of it for the customer", async () => {
        await expect(requestSharedBackup("acme", { id: "u-acme", name: "Sara" }, { sourceId: "cache-1", databaseName: "1" }, NOW)).rejects.toThrow(/is not a database of yours/);
    });
});

describe("a server of a tenant that does not share with customers", () => {
    it("refuses taking a database back too, and records no shared server", async () => {
        await expect(runAsTenant("solo", () => databaseAssignmentService.assign("solo-mysql", [{ databaseName: "crm", tenantId: null }], "u-solo", NOW))).rejects.toThrow(/give no databases to other tenants/);
        expect(await base.sharedServer.findUnique({ where: { id: "solo-mysql" } })).toBeNull();
        expect(await base.databaseAssignment.count({ where: { sourceId: "solo-mysql" } })).toBe(0);
    });
});
