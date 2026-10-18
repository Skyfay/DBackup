// @vitest-environment node
/**
 * Deleting a tenant and switching off its sharing, against a real SQLite database migrated with the
 * migrations of this version: what a deleted customer held by name falls to no rule of another
 * tenant, a tenant with a run that waits or runs stays, a tenant with keys is no empty one, a deleted
 * server never blocks Stop sharing, and giving a database to the tenant a rule gives it to already
 * changes nothing.
 */
import { execFileSync } from "child_process";
import { mkdtempSync, rmSync } from "fs";
import os from "os";
import path from "path";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { PrismaClient } from "@prisma/client";
import { ConflictError, ValidationError } from "@/lib/logging/errors";
import { runAsSystem, runAsTenant } from "@/lib/tenant/context";
import { ownerAt } from "@/lib/tenant/database-owner";
import { tenantScopeExtension } from "@/lib/tenant/prisma-scope";

const holder = vi.hoisted(() => ({
    client: undefined as unknown,
    /** A tenant whose delete fails late in its transaction, after its customers lost what it shared. */
    failLateFor: null as string | null,
    deleteTenantBackups: vi.fn(),
    sweepCustomerFolder: vi.fn(),
    refreshStorageStatsCache: vi.fn(),
}));

vi.mock("@/lib/logging/logger", () => ({
    logger: { child: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }) },
}));
vi.mock("@/lib/prisma", () => ({ get default() { return holder.client; } }));
// No backups on the destinations, the owners of the databases are the subject here.
vi.mock("@/services/storage/storage-service", () => ({ storageService: { readCachedListing: vi.fn(async () => null) } }));
vi.mock("@/lib/server/scheduler", () => ({ scheduler: { refresh: vi.fn() } }));
vi.mock("@/services/dashboard/cache", () => ({ invalidateDashboardCache: vi.fn() }));
// The storage of the destinations, which the delete of a customer empties in the background.
vi.mock("@/services/sharing/share-cleanup", async (importOriginal) => ({
    ...(await importOriginal<typeof import("@/services/sharing/share-cleanup")>()),
    deleteTenantBackups: (...args: unknown[]) => holder.deleteTenantBackups(...args),
    sweepCustomerFolder: (...args: unknown[]) => holder.sweepCustomerFolder(...args),
}));
vi.mock("@/services/dashboard-service", async (importOriginal) => ({
    ...(await importOriginal<typeof import("@/services/dashboard-service")>()),
    refreshStorageStatsCache: (...args: unknown[]) => holder.refreshStorageStatsCache(...args),
}));
// The key of the notifications of a tenant, which the delete names late in its transaction.
vi.mock("@/services/notifications/tenant-notification-settings", async (importOriginal) => {
    const original = await importOriginal<typeof import("@/services/notifications/tenant-notification-settings")>();
    return {
        ...original,
        tenantNotificationKey: (tenantId: string) => {
            if (tenantId === holder.failLateFor) throw new Error("The database went away");
            return original.tenantNotificationKey(tenantId);
        },
    };
});

const { tenantService } = await import("@/services/tenant/tenant-service");
const { databaseAssignmentService } = await import("@/services/tenant/database-assignments");
const { tenantOnDemandService } = await import("@/services/tenant/tenant-on-demand");
const { isEmptyTenant, tenantContents } = await import("@/services/tenant/tenant-contents");
const { factsOf } = await import("@/services/tenant/shared-backups");
const { sharingVersion } = await import("@/services/tenant/shared-servers");

let root = "";
let base: PrismaClient;

const day = (iso: string) => new Date(`${iso}T12:00:00.000Z`);

beforeAll(async () => {
    root = mkdtempSync(path.join(os.tmpdir(), "dbackup-tenant-delete-"));
    const file = path.join(root, "tenants.db");
    execFileSync(path.join(process.cwd(), "node_modules", ".bin", "prisma"), ["migrate", "deploy"], {
        env: { ...process.env, DATABASE_URL: `file:${file}` },
        stdio: "pipe",
    });
    base = new PrismaClient({ datasources: { db: { url: `file:${file}` } } });
    holder.client = base.$extends(tenantScopeExtension(async () => null));
}, 120_000);

afterAll(async () => {
    await base?.$disconnect();
    if (root) rmSync(root, { recursive: true, force: true });
});

/** The home tenant runs the shared MySQL. Acme, Globex and Retail are its customers, MSP Two shares too. */
beforeEach(async () => {
    for (const model of ["execution", "databaseAssignment", "databaseAssignmentRule", "sharedServer", "databaseListCache", "job", "connectionShareTenant", "connectionShare", "adapterConfig", "encryptionProfile", "apiKey", "deletedRecord", "user", "tenant"] as const) {
        await (base[model] as unknown as { deleteMany(args: object): Promise<unknown> }).deleteMany({ where: model === "tenant" ? { id: { not: "default" } } : {} });
    }
    for (const [id, name] of [["acme", "Acme"], ["globex", "Globex"], ["retail", "Retail"]]) await base.tenant.create({ data: { id, name } });
    await base.tenant.create({ data: { id: "msp-two", name: "MSP Two", sharesWithCustomers: true } });
    await base.adapterConfig.create({ data: { id: "shared-mysql", name: "Shared MySQL", type: "database", adapterId: "mysql", config: "{}" } });
    await base.sharedServer.create({ data: { id: "shared-mysql", name: "Shared MySQL", adapterId: "mysql", tenantId: "default" } });
    await base.databaseListCache.create({ data: { adapterConfigId: "shared-mysql", databasesJson: JSON.stringify(["shop_acme", "blog_one"]) } });
});

const ownerOf = async (databaseName: string, at: Date) => {
    const facts = await runAsSystem(() => factsOf("shared-mysql"));
    return ownerAt(facts.assignments, facts.rules, databaseName, at);
};

describe("a customer that is deleted", () => {
    it("leaves a database it held by name to the tenant of the server, never to another tenant's rule", async () => {
        await base.databaseAssignment.create({ data: { sourceId: "shared-mysql", databaseName: "shop_acme", tenantId: "acme", validFrom: day("2026-03-01"), createdAt: day("2026-03-01") } });
        await base.databaseAssignmentRule.create({ data: { sourceId: "shared-mysql", pattern: "shop_*", tenantId: "retail", validFrom: day("2026-01-01"), createdAt: day("2026-01-01") } });

        await tenantService.delete("acme", day("2026-08-01"));

        // Before the delete the database was Acme's, from then on nobody's but the server's tenant.
        expect(await ownerOf("shop_acme", day("2026-05-01"))).toBe("acme");
        expect(await ownerOf("shop_acme", day("2026-09-01"))).toBeNull();
        const model = await runAsTenant("default", () => databaseAssignmentService.forSource("shared-mysql", day("2026-09-01")));
        expect(model.databases.find((database) => database.name === "shop_acme")?.owner).toBeNull();
    });

    it("is refused while a run of it waits or runs, and stays with everything it holds", async () => {
        await base.adapterConfig.create({ data: { tenantId: "globex", id: "globex-db", name: "Shop", type: "database", adapterId: "mysql", config: "{}" } });
        await base.job.create({ data: { tenantId: "globex", id: "globex-job", name: "Nightly", schedule: "0 3 * * *", sourceId: "globex-db" } });
        for (const status of ["Pending", "Running"]) {
            await base.execution.deleteMany({});
            await base.execution.create({ data: { tenantId: "globex", jobId: "globex-job", status, logs: "[]" } });
            const refused = await tenantService.delete("globex").catch((error: unknown) => error);
            expect(refused).toBeInstanceOf(ConflictError);
            expect((refused as Error).message).toContain("A run of Globex waits or runs right now");
            expect(await base.tenant.count({ where: { id: "globex" } })).toBe(1);
            expect(await base.execution.count({ where: { tenantId: "globex" } })).toBe(1);
        }

        await base.execution.updateMany({ data: { status: "Success" } });
        await tenantService.delete("globex");
        expect(await base.tenant.count({ where: { id: "globex" } })).toBe(0);
    });
});

describe("a tenant that shares a destination with customers", () => {
    beforeEach(async () => {
        holder.failLateFor = null;
        await base.adapterConfig.create({ data: { tenantId: "msp-two", id: "two-s3", name: "Two S3", type: "storage", adapterId: "s3-generic", config: "{}" } });
        await base.connectionShare.create({ data: { id: "two-s3", tenantId: "msp-two", tenants: { create: [{ tenantId: "acme" }] } } });
        await base.adapterConfig.create({ data: { tenantId: "acme", id: "acme-db", name: "Shop", type: "database", adapterId: "mysql", config: "{}" } });
        await base.job.create({ data: { tenantId: "acme", id: "acme-job", name: "Nightly", schedule: "0 3 * * *", sourceId: "acme-db", destinations: { create: { configId: "two-s3" } } } });
    });

    it("is refused while a run of a customer writes to it or waits to, and the customer keeps it", async () => {
        for (const status of ["Pending", "Running"]) {
            await base.execution.deleteMany({});
            await base.execution.create({ data: { tenantId: "acme", jobId: "acme-job", status, logs: "[]" } });

            const refused = await tenantService.delete("msp-two").catch((error: unknown) => error);

            expect(refused).toBeInstanceOf(ConflictError);
            expect((refused as Error).message).toContain("A run of Acme writes to a destination MSP Two shares");
            expect(await base.tenant.count({ where: { id: "msp-two" } })).toBe(1);
            expect(await base.jobDestination.count({ where: { jobId: "acme-job", configId: "two-s3" } })).toBe(1);
        }
    });

    it("takes it from its customers in the transaction of the delete, so they keep it when the delete fails", async () => {
        holder.failLateFor = "msp-two";

        await expect(tenantService.delete("msp-two")).rejects.toThrow("The database went away");

        expect(await base.tenant.count({ where: { id: "msp-two" } })).toBe(1);
        expect(await base.jobDestination.count({ where: { jobId: "acme-job", configId: "two-s3" } })).toBe(1);
    });

    it("takes it from the jobs of its customers once the delete went through, and names what they lost", async () => {
        const removal = await tenantService.delete("msp-two");

        expect(removal.withdrawn).toEqual([expect.objectContaining({ configId: "two-s3", tenantId: "acme", jobs: ["Nightly"] })]);
        expect(await base.jobDestination.count({ where: { jobId: "acme-job" } })).toBe(0);
        expect(await base.adapterConfig.count({ where: { id: "two-s3" } })).toBe(0);
    });
});

describe("the last customer of a shared destination that is deleted", () => {
    beforeEach(async () => {
        holder.failLateFor = null;
        holder.deleteTenantBackups.mockReset().mockResolvedValue(2);
        holder.sweepCustomerFolder.mockReset().mockResolvedValue(1);
        holder.refreshStorageStatsCache.mockReset().mockResolvedValue([]);
        await base.adapterConfig.create({ data: { tenantId: "msp-two", id: "two-s3", name: "Two S3", type: "storage", adapterId: "s3-generic", config: "{}" } });
        await base.connectionShare.create({ data: { id: "two-s3", tenantId: "msp-two", tenants: { create: [{ tenantId: "acme" }] } } });
    });

    it("leaves nothing of the customers in its folder before the destination is shared no longer, and counts its space again", async () => {
        await tenantService.delete("acme");

        await vi.waitFor(() => expect(holder.refreshStorageStatsCache).toHaveBeenCalledWith({ configIds: ["two-s3"] }));
        expect(holder.deleteTenantBackups).toHaveBeenCalledWith("two-s3", "acme");
        expect(holder.sweepCustomerFolder).toHaveBeenCalledWith("two-s3");
        expect(holder.sweepCustomerFolder.mock.invocationCallOrder[0]).toBeGreaterThan(holder.deleteTenantBackups.mock.invocationCallOrder[0]);
        expect(await base.connectionShare.count({ where: { id: "two-s3" } })).toBe(0);
    });

    it("stays shared with nobody when the folder cannot be emptied, so its tenant never sees a file of a customer", async () => {
        holder.sweepCustomerFolder.mockRejectedValue(new Error("connect ECONNREFUSED"));

        await tenantService.delete("acme");

        await vi.waitFor(() => expect(holder.refreshStorageStatsCache).toHaveBeenCalledWith({ configIds: ["two-s3"] }));
        expect(await base.connectionShare.count({ where: { id: "two-s3" } })).toBe(1);
        expect(await base.connectionShareTenant.count({ where: { shareId: "two-s3" } })).toBe(0);
    });

    it("keeps the share and sweeps nothing while another customer still gets it", async () => {
        await base.connectionShareTenant.create({ data: { shareId: "two-s3", tenantId: "globex" } });

        await tenantService.delete("acme");

        await vi.waitFor(() => expect(holder.refreshStorageStatsCache).toHaveBeenCalled());
        expect(holder.sweepCustomerFolder).not.toHaveBeenCalled();
        expect(await base.connectionShare.count({ where: { id: "two-s3" } })).toBe(1);
    });
});

describe("an empty tenant for Delete of several at once", () => {
    it("holds no key, no API key and nothing in Recently deleted either", async () => {
        expect(isEmptyTenant(await tenantContents("acme"))).toBe(true);

        await base.encryptionProfile.create({ data: { tenantId: "acme", name: "Acme key", secretKey: "sealed" } });
        expect(await tenantContents("acme")).toMatchObject({ connections: 0, jobs: 0, members: 0, keys: 1 });
        expect(isEmptyTenant(await tenantContents("acme"))).toBe(false);

        await base.encryptionProfile.deleteMany({});
        const at = new Date();
        await base.user.create({ data: { id: "u-lena", name: "Lena", email: "lena@example.ch", emailVerified: true, createdAt: at, updatedAt: at } });
        await base.apiKey.create({ data: { tenantId: "acme", name: "Panel", prefix: "dbackup_a3f2", hashedKey: "hash-1", permissions: "[]", userId: "u-lena" } });
        expect(isEmptyTenant(await tenantContents("acme"))).toBe(false);

        await base.apiKey.deleteMany({});
        await base.deletedRecord.create({ data: { tenantId: "acme", kind: "encryptionKey", recordId: "k1", name: "Old key", data: "{}", permission: "vault:write" } });
        expect(await tenantContents("acme")).toMatchObject({ deleted: 1 });
        expect(isEmptyTenant(await tenantContents("acme"))).toBe(false);
    });
});

describe("stopping to share with customers", () => {
    beforeEach(async () => {
        // A server of MSP Two whose connection was deleted, still giving a database and a rule.
        await base.sharedServer.create({ data: { id: "two-old", name: "Old MySQL", adapterId: "mysql", tenantId: "msp-two", deletedAt: day("2026-06-01") } });
        await base.databaseAssignment.create({ data: { sourceId: "two-old", databaseName: "crm", tenantId: "globex", validFrom: day("2026-02-01"), createdAt: day("2026-02-01") } });
        await base.databaseAssignmentRule.create({ data: { sourceId: "two-old", pattern: "erp_*", tenantId: "globex", validFrom: day("2026-02-01"), createdAt: day("2026-02-01") } });
    });

    it("is not blocked by a deleted server, whose databases and rules end with the switch", async () => {
        expect(await tenantService.setSharing("msp-two", false, day("2026-08-01"))).toEqual({ name: "MSP Two", changed: true });
        expect(await base.databaseAssignment.findFirst({ where: { sourceId: "two-old" } })).toMatchObject({ tenantId: "globex", validUntil: day("2026-08-01") });
        expect(await base.databaseAssignmentRule.findFirst({ where: { sourceId: "two-old" } })).toMatchObject({ validUntil: day("2026-08-01") });
    });

    it("is still refused while a server that exists gives a database away", async () => {
        await base.adapterConfig.create({ data: { tenantId: "msp-two", id: "two-live", name: "Live MySQL", type: "database", adapterId: "mysql", config: "{}" } });
        await base.sharedServer.create({ data: { id: "two-live", name: "Live MySQL", adapterId: "mysql", tenantId: "msp-two" } });
        await base.databaseAssignment.create({ data: { sourceId: "two-live", databaseName: "shop", tenantId: "globex", validFrom: day("2026-02-01") } });

        await expect(tenantService.setSharing("msp-two", false)).rejects.toBeInstanceOf(ValidationError);
        expect(await base.tenant.findUnique({ where: { id: "msp-two" } })).toMatchObject({ sharesWithCustomers: true });
        // Nothing of the deleted server ended either.
        expect(await base.databaseAssignment.findFirst({ where: { sourceId: "two-old" } })).toMatchObject({ validUntil: null });
    });
});

describe("giving a database to the tenant a rule gives it to already", () => {
    it("changes nothing, so the rule keeps its start and its backups on demand", async () => {
        await base.databaseAssignmentRule.create({ data: { sourceId: "shared-mysql", pattern: "blog_*", tenantId: "globex", validFrom: day("2026-01-01"), onDemandPerDay: 3 } });
        const before = sharingVersion();

        const result = await runAsTenant("default", () => databaseAssignmentService.assign("shared-mysql", [{ databaseName: "blog_one", tenantId: "globex", validFrom: day("2026-05-01") }], null));

        expect(result).toEqual({ changed: 0 });
        expect(await base.databaseAssignment.count({ where: { databaseName: "blog_one" } })).toBe(0);
        expect(sharingVersion()).toBe(before);
        const model = await runAsTenant("default", () => databaseAssignmentService.forSource("shared-mysql"));
        expect(model.databases.find((database) => database.name === "blog_one")?.owner).toMatchObject({ tenantId: "globex", via: "rule", onDemandPerDay: 3 });
    });

    it("still gives it to another tenant, and counts the change for the cached rows of the customers", async () => {
        await base.databaseAssignmentRule.create({ data: { sourceId: "shared-mysql", pattern: "blog_*", tenantId: "globex", validFrom: day("2026-01-01") } });
        const before = sharingVersion();
        expect(await runAsTenant("default", () => databaseAssignmentService.assign("shared-mysql", [{ databaseName: "blog_one", tenantId: "acme" }], null))).toEqual({ changed: 1 });
        expect(sharingVersion()).toBeGreaterThan(before);
    });
});

describe("backups on demand of a customer for a platform group of some tenants", () => {
    beforeEach(async () => {
        // MSP Two gives Globex a database with a number of its own.
        await base.sharedServer.create({ data: { id: "two-db", name: "Two MySQL", adapterId: "mysql", tenantId: "msp-two" } });
        await base.databaseAssignment.create({ data: { id: "two-crm", sourceId: "two-db", databaseName: "crm", tenantId: "globex", validFrom: day("2026-02-01"), onDemandPerDay: 2 } });
    });

    it("shows a tenant that shares beyond the reach by no name", async () => {
        const found = await tenantOnDemandService.find("globex", ["globex"]);
        expect(found?.overrides).toEqual([expect.objectContaining({ id: "two-crm", serverName: "Two MySQL", providerId: null, providerName: "Another tenant" })]);

        const reached = await tenantOnDemandService.find("globex", ["globex", "msp-two"]);
        expect(reached?.overrides).toEqual([expect.objectContaining({ providerId: "msp-two", providerName: "MSP Two" })]);
    });

    it("changes nothing a tenant beyond the reach gave, and what a reached one gave", async () => {
        await expect(tenantOnDemandService.follow("globex", "database", "two-crm", ["globex"]))
            .rejects.toThrow("Two MySQL belongs to a tenant your platform group does not reach");
        expect(await base.databaseAssignment.findUnique({ where: { id: "two-crm" } })).toMatchObject({ onDemandPerDay: 2 });

        await tenantOnDemandService.follow("globex", "database", "two-crm", ["globex", "msp-two"]);
        expect(await base.databaseAssignment.findUnique({ where: { id: "two-crm" } })).toMatchObject({ onDemandPerDay: null });
    });
});

describe("backups on demand of the home tenant", () => {
    it("are set like those of any customer, since the home tenant can get databases of another tenant too", async () => {
        const change = await tenantOnDemandService.set("default", 3);
        expect(change).toMatchObject({ before: null, after: 3 });
        expect(await base.tenant.findUnique({ where: { id: "default" }, select: { onDemandPerDay: true } })).toEqual({ onDemandPerDay: 3 });
        await tenantOnDemandService.set("default", null);
    });
});
