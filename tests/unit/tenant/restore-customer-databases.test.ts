// @vitest-environment node
/**
 * An ordinary restore by the tenant of a shared server over databases its customers hold now asks
 * first: the request has to confirm it, or it is refused before anything touches the server. Against
 * a real SQLite database migrated with the migrations of this version.
 */
import { execFileSync } from "child_process";
import { mkdtempSync, rmSync } from "fs";
import os from "os";
import path from "path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PrismaClient } from "@prisma/client";
import { runAsTenant } from "@/lib/tenant/context";
import { tenantScopeExtension } from "@/lib/tenant/prisma-scope";

const holder = vi.hoisted(() => ({ client: undefined as unknown, meta: {} as Record<string, unknown> }));

vi.mock("@/lib/logging/logger", () => ({
    logger: { child: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }) },
}));
vi.mock("@/lib/prisma", () => ({ get default() { return holder.client; } }));
vi.mock("@/services/storage/storage-service", () => ({ storageService: { readCachedListing: async () => null } }));
// The metadata of a backup by its path, a path without one reads as a backup whose metadata is gone.
vi.mock("@/lib/archive/storage-source", () => ({ resolveStorageAdapter: async () => ({ adapter: {}, config: {} }) }));
vi.mock("@/services/restore/file-restore", () => ({
    readBackupMetadata: async (_adapter: unknown, _config: unknown, file: string) => {
        if (!(file in holder.meta)) throw new Error("Backup metadata not found");
        return holder.meta[file];
    },
}));

const { databaseAssignmentService } = await import("@/services/tenant/database-assignments");
const { assertCustomerDatabasesConfirmed, assertTargetsConfirmed, customerDatabases } = await import("@/services/restore/customer-databases");
const { moveDatabase } = await import("@/services/tenant/database-moves");
const { holdSharedRestore, sharedRestoresOn } = await import("@/services/restore/shared-restores-active");

let root = "";
let base: PrismaClient;

const HOME = "default";
const JAN = new Date("2026-01-01T12:00:00.000Z");
const asHome = <T,>(fn: () => Promise<T>) => runAsTenant(HOME, fn);
const restoring = (names: string[], extra: Record<string, unknown> = {}) => ({
    storageConfigId: "nas",
    file: "nightly/2026-10-01.tar",
    targetSourceId: "shared-mysql",
    databaseMapping: names.map((name) => ({ originalName: name, targetName: name, selected: true })),
    ...extra,
});

beforeAll(async () => {
    root = mkdtempSync(path.join(os.tmpdir(), "dbackup-restore-customers-"));
    const file = path.join(root, "customers.db");
    execFileSync(path.join(process.cwd(), "node_modules", ".bin", "prisma"), ["migrate", "deploy"], {
        env: { ...process.env, DATABASE_URL: `file:${file}` },
        stdio: "pipe",
    });
    base = new PrismaClient({ datasources: { db: { url: `file:${file}` } } });
    holder.client = base.$extends(tenantScopeExtension(async () => null));

    await base.tenant.create({ data: { id: "acme", name: "Acme" } });
    await base.tenant.create({ data: { id: "globex", name: "Globex" } });
    for (const id of ["shared-mysql", "plain-mysql"]) {
        await base.adapterConfig.create({ data: { id, name: id, type: "database", adapterId: "mysql", config: "{}" } });
        await base.databaseListCache.create({ data: { adapterConfigId: id, databasesJson: JSON.stringify(["shop_acme", "cust_1", "intern"].map((name) => ({ name }))) } });
    }
    await asHome(() => databaseAssignmentService.assign("shared-mysql", [{ databaseName: "shop_acme", tenantId: "acme", validFrom: JAN }], "u-msp", JAN));
    await asHome(() => databaseAssignmentService.addRule("shared-mysql", { pattern: "cust_*", tenantId: "globex", validFrom: JAN }, JAN));
}, 120_000);

afterAll(async () => {
    await base?.$disconnect();
    if (root) rmSync(root, { recursive: true, force: true });
});

describe("the databases of customers a restore of the provider overwrites", () => {
    it("names the databases a customer holds now by name or by a rule, with the customer", async () => {
        expect(await asHome(() => customerDatabases("shared-mysql", ["shop_acme", "cust_1", "intern"]))).toEqual([
            { database: "cust_1", tenantId: "globex", customer: "Globex" },
            { database: "shop_acme", tenantId: "acme", customer: "Acme" },
        ]);
        expect(await asHome(() => customerDatabases("plain-mysql", ["shop_acme"]))).toEqual([]);
    });

    it("reads every database of the server for a restore that does not name its databases", async () => {
        const held = await asHome(() => customerDatabases("shared-mysql", null));
        expect(held.map((entry) => entry.database)).toEqual(["cust_1", "shop_acme"]);
    });

    it("refuses a restore over them without the confirmation, and lets it through with it", async () => {
        await expect(asHome(() => assertCustomerDatabasesConfirmed(restoring(["shop_acme", "intern"])))).rejects.toThrow(/overwrite databases that customers hold now: shop_acme/);
        await expect(asHome(() => assertCustomerDatabasesConfirmed({ storageConfigId: "nas", file: "x.tar", targetSourceId: "shared-mysql" }))).rejects.toThrow(/cust_1, shop_acme/);
        await expect(asHome(() => assertCustomerDatabasesConfirmed(restoring(["shop_acme"], { overwriteCustomerDatabases: true }))))
            .resolves.toEqual([{ database: "shop_acme", tenantId: "acme", customer: "Acme" }]);
    });

    it("refuses a plain target name on a backup of several databases, which each go back under their own name", async () => {
        holder.meta["nightly/all.tar"] = { version: 1, databases: { count: 3, names: ["shop_acme", "cust_1", "intern"] }, archive: { formatVersion: 2 } };
        const api = { storageConfigId: "nas", file: "nightly/all.tar", targetSourceId: "shared-mysql", targetDatabaseName: "scratch" };
        await expect(asHome(() => assertCustomerDatabasesConfirmed(api))).rejects.toThrow(/customers hold now: cust_1, shop_acme\./);
        await expect(asHome(() => assertCustomerDatabasesConfirmed({ ...api, overwriteCustomerDatabases: true }))).resolves.toEqual([
            { database: "cust_1", tenantId: "globex", customer: "Globex" },
            { database: "shop_acme", tenantId: "acme", customer: "Acme" },
        ]);
    });

    it("lets a plain target name through on a backup of one database, which goes back under that name", async () => {
        holder.meta["nightly/shop.tar"] = { version: 1, databases: { count: 1, names: ["shop_acme"] }, archive: { formatVersion: 2 } };
        const api = { storageConfigId: "nas", file: "nightly/shop.tar", targetSourceId: "shared-mysql", targetDatabaseName: "shop_check" };
        await expect(asHome(() => assertCustomerDatabasesConfirmed(api))).resolves.toEqual([]);
        await expect(asHome(() => assertCustomerDatabasesConfirmed({ ...api, targetDatabaseName: "cust_9" }))).rejects.toThrow(/customers hold now: cust_9\./);
    });

    it("counts every database of the server and the plain target name for a backup whose databases it cannot read", async () => {
        const api = { storageConfigId: "nas", file: "gone/unknown.tar", targetSourceId: "shared-mysql", targetDatabaseName: "cust_new" };
        await expect(asHome(() => assertCustomerDatabasesConfirmed(api))).rejects.toThrow(/customers hold now: cust_1, cust_new, shop_acme\./);
    });

    it("refuses at the write a database of a customer the check before did not confirm", async () => {
        const input = { storageConfigId: "nas", file: "nightly/all.tar", targetSourceId: "shared-mysql", overwriteCustomerDatabases: true };
        await expect(asHome(() => assertTargetsConfirmed({ ...input, confirmedCustomerDatabases: [] }, ["shop_acme", "intern"]))).rejects.toThrow(/customers hold now: shop_acme\. The request did not confirm/);
        await expect(asHome(() => assertTargetsConfirmed({ ...input, confirmedCustomerDatabases: ["shop_acme"] }, ["shop_acme", "cust_1"]))).rejects.toThrow(/customers hold now: cust_1\./);
        await expect(asHome(() => assertTargetsConfirmed({ ...input, confirmedCustomerDatabases: ["shop_acme"] }, ["shop_acme", "intern"]))).resolves.toBeUndefined();
        // The customer's own restore of the database it holds.
        await expect(asHome(() => assertTargetsConfirmed({ ...input, shared: { databaseName: "shop_acme", tenantId: "acme" } }, ["shop_acme"]))).resolves.toBeUndefined();
    });

    it("refuses at the write a customer's restore of a database it no longer holds, or of a tenant deleted since", async () => {
        const input = { storageConfigId: "nas", file: "nightly/all.tar", targetSourceId: "shared-mysql" };
        // Held by Globex through its rule, never by Acme.
        await expect(asHome(() => assertTargetsConfirmed({ ...input, shared: { databaseName: "cust_1", tenantId: "acme" } }, ["cust_1"]))).rejects.toThrow("cust_1 is no longer yours, so nothing was restored.");
        // A restore whose customer nobody filled in writes nothing.
        await expect(asHome(() => assertTargetsConfirmed({ ...input, shared: { databaseName: "shop_acme" } }, ["shop_acme"]))).rejects.toThrow(/no longer yours/);
        await expect(asHome(() => assertTargetsConfirmed({ ...input, targetSourceId: "gone-mysql", shared: { databaseName: "shop_acme", tenantId: "acme" } }, ["shop_acme"]))).rejects.toThrow(/no longer yours/);

        await base.tenant.create({ data: { id: "initech", name: "Initech" } });
        await asHome(() => databaseAssignmentService.assign("shared-mysql", [{ databaseName: "intern", tenantId: "initech" }], "u-msp"));
        const initech = { ...input, shared: { databaseName: "intern", tenantId: "initech" } };
        await expect(asHome(() => assertTargetsConfirmed(initech, ["intern"]))).resolves.toBeUndefined();
        // The tenant of the server takes it back while the restore stages its dump.
        await asHome(() => databaseAssignmentService.assign("shared-mysql", [{ databaseName: "intern", tenantId: null }], "u-msp"));
        await expect(asHome(() => assertTargetsConfirmed(initech, ["intern"]))).rejects.toThrow("intern is no longer yours");

        await asHome(() => databaseAssignmentService.assign("shared-mysql", [{ databaseName: "intern", tenantId: "initech" }], "u-msp"));
        await base.tenant.delete({ where: { id: "initech" } });
        await expect(asHome(() => assertTargetsConfirmed(initech, ["intern"]))).rejects.toThrow("intern is no longer yours");
    });

    it("refuses giving, taking back, ending the rule of or moving a database while a customer restores it", async () => {
        const release = holdSharedRestore({ sourceId: "shared-mysql", databaseName: "cust_1", tenantId: "globex" });
        try {
            const refusal = "A customer restores cust_1 right now. Try again once the restore ended.";
            await expect(asHome(() => databaseAssignmentService.assign("shared-mysql", [{ databaseName: "cust_1", tenantId: "acme" }], "u-msp"))).rejects.toThrow(refusal);
            await expect(asHome(() => databaseAssignmentService.assign("shared-mysql", [{ databaseName: "cust_1", tenantId: null }], "u-msp"))).rejects.toThrow(refusal);
            const rule = await base.databaseAssignmentRule.findFirstOrThrow({ where: { sourceId: "shared-mysql", pattern: "cust_*", validUntil: null } });
            await expect(asHome(() => databaseAssignmentService.removeRule("shared-mysql", rule.id))).rejects.toThrow(refusal);
            await expect(asHome(() => databaseAssignmentService.addRule("shared-mysql", { pattern: "cust_*", tenantId: "acme", priority: 5 }))).rejects.toThrow(refusal);
            await expect(asHome(() => moveDatabase("shared-mysql", { databaseName: "cust_1", toSourceId: "plain-mysql" }, "u-msp"))).rejects.toThrow(refusal);
            // Another database of the server, or giving it to the tenant that restores it, goes on.
            await expect(asHome(() => databaseAssignmentService.assign("shared-mysql", [{ databaseName: "cust_1", tenantId: "globex" }], "u-msp"))).resolves.toMatchObject({ changed: 0 });
            expect(await base.databaseAssignmentRule.count({ where: { sourceId: "shared-mysql", validUntil: null } })).toBe(1);
        } finally {
            release();
        }
        expect(sharedRestoresOn("shared-mysql")).toEqual([]);
    });

    it("asks nothing for a copy beside them, a restore of files or the customer's own restore", async () => {
        const copy = { ...restoring([]), databaseMapping: [{ originalName: "shop_acme", targetName: "shop_acme_restored", selected: true }] };
        await expect(asHome(() => assertCustomerDatabasesConfirmed(copy))).resolves.toEqual([]);
        await expect(asHome(() => assertCustomerDatabasesConfirmed(restoring(["shop_acme"], { scope: "files" })))).resolves.toEqual([]);
        await expect(asHome(() => assertCustomerDatabasesConfirmed(restoring(["shop_acme"], { shared: { databaseName: "shop_acme", tenantId: "acme" } })))).resolves.toEqual([]);
    });
});

describe("the databases of customers on a Firebird server, whose restore target is a path", () => {
    const aliases = [{ name: "fb_acme", path: "/firebird/data/acme.fdb" }, { name: "fb_intern", path: "C:\\Firebird\\Intern.FDB" }];

    beforeAll(async () => {
        await base.adapterConfig.create({ data: { id: "shared-firebird", name: "shared-firebird", type: "database", adapterId: "firebird", config: JSON.stringify({ host: "fb", databases: aliases }) } });
        await base.databaseListCache.create({ data: { adapterConfigId: "shared-firebird", databasesJson: JSON.stringify(aliases.map(({ name }) => ({ name }))) } });
        await asHome(() => databaseAssignmentService.assign("shared-firebird", [
            { databaseName: "fb_acme", tenantId: "acme", validFrom: JAN },
            { databaseName: "fb_intern", tenantId: "globex", validFrom: JAN },
        ], "u-msp", JAN));
    });

    it("counts the path of an alias as the alias a customer holds", async () => {
        expect(await asHome(() => customerDatabases("shared-firebird", ["/firebird/data/acme.fdb"]))).toEqual([{ database: "fb_acme", tenantId: "acme", customer: "Acme" }]);
        expect(await asHome(() => customerDatabases("shared-firebird", ["/firebird/data/./acme.fdb"]))).toEqual([{ database: "fb_acme", tenantId: "acme", customer: "Acme" }]);
        // A path on Windows in another case is the same file.
        expect(await asHome(() => customerDatabases("shared-firebird", ["c:\\firebird\\intern.fdb"]))).toEqual([{ database: "fb_intern", tenantId: "globex", customer: "Globex" }]);
        expect(await asHome(() => customerDatabases("shared-firebird", ["/firebird/data/scratch.fdb"]))).toEqual([]);
    });

    it("refuses a restore by the path of a customer's alias without the confirmation, before and at the write", async () => {
        const api = { storageConfigId: "nas", file: "nightly/fb.tar", targetSourceId: "shared-firebird", databaseMapping: [{ originalName: "fb_acme", targetName: "/firebird/data/acme.fdb", selected: true }] };
        await expect(asHome(() => assertCustomerDatabasesConfirmed(api))).rejects.toThrow(/customers hold now: fb_acme\./);
        await expect(asHome(() => assertCustomerDatabasesConfirmed({ ...api, overwriteCustomerDatabases: true }))).resolves.toEqual([{ database: "fb_acme", tenantId: "acme", customer: "Acme" }]);
        await expect(asHome(() => assertTargetsConfirmed({ ...api, confirmedCustomerDatabases: [] }, ["/firebird/data/acme.fdb"]))).rejects.toThrow(/customers hold now: fb_acme\. The request did not confirm/);
        await expect(asHome(() => assertTargetsConfirmed({ ...api, confirmedCustomerDatabases: ["fb_acme"] }, ["/firebird/data/acme.fdb"]))).resolves.toBeUndefined();
    });
});
