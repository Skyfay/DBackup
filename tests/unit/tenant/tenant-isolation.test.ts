// @vitest-environment node
/**
 * The boundary between tenants against a real SQLite database migrated with the migrations of this
 * version: for every model that belongs to a tenant, a second tenant neither reads, counts,
 * changes nor deletes a row of the first, a write names the tenant it runs in, and a query outside
 * any tenant fails instead of handing out every row.
 */
import { execFileSync } from "child_process";
import { mkdtempSync, rmSync } from "fs";
import os from "os";
import path from "path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { Prisma, PrismaClient } from "@prisma/client";
import { TenantScopeError } from "@/lib/logging/errors";
import { runAsSystem, runAsTenant } from "@/lib/tenant/context";
import { CHILD_MODELS, TENANT_MODELS, tenantScopeExtension } from "@/lib/tenant/prisma-scope";

vi.mock("@/lib/logging/logger", () => ({
    logger: { child: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }) },
}));

let root = "";
let base: PrismaClient;
/** The client of the app on the test database, with no request to name a tenant. */
let scoped: ReturnType<typeof extend>;

const extend = (client: PrismaClient) => client.$extends(tenantScopeExtension(async () => null));

const TENANTS = ["acme", "globex"] as const;
type Tenant = (typeof TENANTS)[number];

/** One row of every tenant model for a tenant, with ids that name the tenant. */
async function seedTenant(tenantId: Tenant) {
    const id = (name: string) => `${tenantId}-${name}`;
    const now = new Date("2026-10-15T10:00:00.000Z");
    await base.tenant.create({ data: { id: tenantId, name: tenantId } });
    await base.user.create({ data: { id: id("user"), name: tenantId, email: `${tenantId}@example.ch`, emailVerified: true, createdAt: now, updatedAt: now } });
    await base.credentialProfile.create({ data: { tenantId, id: id("credential"), name: "Login", type: "USERNAME_PASSWORD", data: "encrypted" } });
    await base.encryptionProfile.create({ data: { tenantId, id: id("key"), name: "Key", secretKey: "not-a-real-secret" } });
    await base.adapterConfig.create({ data: { tenantId, id: id("source"), name: "Shop", type: "database", adapterId: "mysql", config: "{}" } });
    await base.adapterConfig.create({ data: { tenantId, id: id("nas"), name: "NAS", type: "storage", adapterId: "local-filesystem", config: "{}" } });
    await base.retentionPolicy.create({ data: { tenantId, id: id("retention"), name: "Keep 7", config: "{}" } });
    await base.namingTemplate.create({ data: { tenantId, id: id("naming"), name: "Dated", pattern: "{name}" } });
    await base.schedulePreset.create({ data: { tenantId, id: id("schedule"), name: "Nightly", schedule: "0 3 * * *" } });
    await base.excludePatternPreset.create({ data: { tenantId, id: id("exclude"), name: "No cache", patterns: "[]" } });
    await base.notificationTemplate.create({ data: { tenantId, id: id("template"), name: "Failures" } });
    await base.job.create({
        data: {
            tenantId,
            id: id("job"),
            name: "Nightly shop",
            schedule: "0 3 * * *",
            sourceId: id("source"),
            destinations: { create: { id: id("destination"), configId: id("nas") } },
        },
    });
    await base.execution.create({ data: { tenantId, id: id("execution"), jobId: id("job"), status: "Success", logs: "[]" } });
    await base.apiKey.create({ data: { tenantId, id: id("apikey"), name: "CI", prefix: "dbackup_00000000", hashedKey: id("hash"), permissions: "[]", userId: id("user") } });
    await base.auditLog.create({ data: { tenantId, id: id("audit"), action: "CREATE", resource: "JOB" } });
    await base.notificationLog.create({ data: { tenantId, id: id("notification"), eventType: "backup_success", channelName: "Mail", adapterId: "email", status: "Success", title: "Done", message: "Done" } });
    await base.storageSnapshot.create({ data: { tenantId, id: id("snapshot"), adapterConfigId: id("nas"), adapterName: "NAS", adapterId: "local-filesystem" } });
    await base.deletedRecord.create({ data: { tenantId, id: id("trash"), kind: "job", recordId: "gone", name: "Old job", data: "{}", permission: "jobs:write" } });
    await base.group.create({ data: { tenantId, id: id("group"), name: "Operators", permissions: "[]" } });
    await base.databaseListCache.create({ data: { adapterConfigId: id("source"), databasesJson: JSON.stringify([{ name: `${tenantId}_shop` }]) } });
    await base.sharedServer.create({ data: { tenantId, id: id("source"), name: "Shop", adapterId: "mysql" } });
    await base.databaseAssignment.create({ data: { id: id("assignment"), sourceId: id("source"), databaseName: `${tenantId}_shop`, tenantId, validFrom: now } });
    await base.sharedBackupRequest.create({ data: { tenantId, id: id("request"), sourceId: id("source"), databaseName: `${tenantId}_shop`, executionId: id("execution") } });
}

/** The delegate of a model, by the name Prisma gives it, like adapterConfig for AdapterConfig. */
function delegate(client: unknown, model: string) {
    const key = model[0].toLowerCase() + model.slice(1);
    return (client as Record<string, {
        findMany(args?: object): Promise<{ id: string; tenantId: string }[]>;
        findUnique(args: object): Promise<unknown>;
        count(args?: object): Promise<number>;
        updateMany(args: object): Promise<{ count: number }>;
        deleteMany(args: object): Promise<{ count: number }>;
        update(args: object): Promise<unknown>;
    }>)[key];
}

beforeAll(async () => {
    root = mkdtempSync(path.join(os.tmpdir(), "dbackup-tenants-"));
    const file = path.join(root, "tenants.db");
    execFileSync(path.join(process.cwd(), "node_modules", ".bin", "prisma"), ["migrate", "deploy"], {
        env: { ...process.env, DATABASE_URL: `file:${file}` },
        stdio: "pipe",
    });
    base = new PrismaClient({ datasources: { db: { url: `file:${file}` } } });
    scoped = extend(base);
    for (const tenant of TENANTS) await seedTenant(tenant);
}, 120_000);

afterAll(async () => {
    await base?.$disconnect();
    if (root) rmSync(root, { recursive: true, force: true });
});

describe("the boundary between tenants", () => {
    it("covers every model that has a tenant column", () => {
        const withColumn = Prisma.dmmf.datamodel.models.filter((model) => model.fields.some((field) => field.name === "tenantId" && field.kind === "scalar"));
        // Memberships and invitations name a tenant but are the platform's to read, through their own
        // services. The assignments of databases name the customer, they belong to the tenant of
        // their server, see CHILD_MODELS. A sign-in provider names its tenant but the login page reads
        // it before anyone is signed in, and the logo of a tenant is keyed by the tenant itself.
        const own = withColumn.map((model) => model.name).filter((name) => !["TenantMembership", "TenantInvitation", "DatabaseAssignment", "DatabaseAssignmentRule", "SsoProvider", "TenantLogo", "PlatformGroupTenant"].includes(name));
        expect(own.sort()).toEqual([...TENANT_MODELS].sort());
    });

    describe.each([...TENANT_MODELS])("%s", (model) => {
        const own = (tenant: Tenant) => {
            const name = { AdapterConfig: "source", CredentialProfile: "credential", EncryptionProfile: "key", RetentionPolicy: "retention", NamingTemplate: "naming", SchedulePreset: "schedule", ExcludePatternPreset: "exclude", Job: "job", NotificationTemplate: "template", Execution: "execution", ApiKey: "apikey", AuditLog: "audit", NotificationLog: "notification", StorageSnapshot: "snapshot", DeletedRecord: "trash", Group: "group", SharedServer: "source", SharedBackupRequest: "request" }[model];
            return `${tenant}-${name}`;
        };

        it("lists and counts only the rows of the tenant", async () => {
            const rows = await runAsTenant("acme", () => delegate(scoped, model).findMany());
            expect(rows.length).toBeGreaterThan(0);
            expect(rows.every((row) => row.tenantId === "acme")).toBe(true);
            const counted = await runAsTenant("acme", () => delegate(scoped, model).count());
            expect(counted).toBe(rows.length);
        });

        it("does not find a row of another tenant by its id", async () => {
            expect(await runAsTenant("acme", () => delegate(scoped, model).findUnique({ where: { id: own("globex") } }))).toBeNull();
        });

        it("neither changes nor deletes a row of another tenant", async () => {
            const changed = await runAsTenant("acme", () => delegate(scoped, model).updateMany({ where: { id: own("globex") }, data: {} }));
            const deleted = await runAsTenant("acme", () => delegate(scoped, model).deleteMany({ where: { id: own("globex") } }));
            expect(changed.count).toBe(0);
            expect(deleted.count).toBe(0);
            await expect(runAsTenant("acme", () => delegate(scoped, model).update({ where: { id: own("globex") }, data: {} }))).rejects.toThrow();
            expect(await delegate(base, model).findUnique({ where: { id: own("globex") } })).not.toBeNull();
        });

        it("refuses to be read outside a tenant", async () => {
            await expect(delegate(scoped, model).findMany()).rejects.toBeInstanceOf(TenantScopeError);
        });

        it("is read for every tenant in the system scope", async () => {
            const rows = await runAsSystem(() => delegate(scoped, model).findMany());
            // The built-in templates of the migrations belong to the home tenant and show up too.
            expect([...new Set(rows.map((row) => row.tenantId))]).toEqual(expect.arrayContaining(["acme", "globex"]));
        });
    });

    describe("a write", () => {
        it("lands in the tenant it runs in", async () => {
            const created = await runAsTenant("acme", () => scoped.namingTemplate.create({ data: { name: "Weekly", pattern: "{name}" } }));
            expect(created.tenantId).toBe("acme");
        });

        it("may not name another tenant", async () => {
            await expect(runAsTenant("acme", () => scoped.namingTemplate.create({ data: { tenantId: "globex", name: "Sneaky", pattern: "{name}" } })))
                .rejects.toBeInstanceOf(TenantScopeError);
            await expect(runAsTenant("acme", () => scoped.namingTemplate.updateMany({ where: {}, data: { tenantId: "globex" } })))
                .rejects.toBeInstanceOf(TenantScopeError);
        });

        it("names its tenant itself in the system scope, instead of falling back to the home tenant", async () => {
            await expect(runAsSystem(() => scoped.namingTemplate.create({ data: { name: "Nobody's", pattern: "{name}" } })))
                .rejects.toBeInstanceOf(TenantScopeError);
            const created = await runAsSystem(() => scoped.namingTemplate.create({ data: { tenantId: "globex", name: "Monthly", pattern: "{name}" } }));
            expect(created.tenantId).toBe("globex");
        });

        it("keeps names unique within a tenant only", async () => {
            const own = await runAsTenant("globex", () => scoped.namingTemplate.create({ data: { name: "Weekly", pattern: "{name}" } }));
            expect(own.tenantId).toBe("globex");
            await expect(runAsTenant("acme", () => scoped.namingTemplate.create({ data: { name: "Weekly", pattern: "{name}" } }))).rejects.toThrow();
        });
    });

    describe("the rows that belong to a tenant through their parent", () => {
        it("knows a parent relation for every child model", () => {
            for (const [model, relation] of Object.entries(CHILD_MODELS)) {
                const found = Prisma.dmmf.datamodel.models.find((entry) => entry.name === model);
                expect(found?.fields.some((field) => field.name === relation && field.kind === "object"), `${model}.${relation}`).toBe(true);
            }
        });

        it("hides the destination of a job of another tenant", async () => {
            const rows = await runAsTenant("acme", () => scoped.jobDestination.findMany());
            expect(rows.map((row) => row.id)).toEqual(["acme-destination"]);
            expect(await runAsTenant("acme", () => scoped.jobDestination.findUnique({ where: { id: "globex-destination" } }))).toBeNull();
        });

        it("does not delete the destinations of a job of another tenant by its id", async () => {
            const deleted = await runAsTenant("acme", () => scoped.jobDestination.deleteMany({ where: { jobId: "globex-job" } }));
            expect(deleted.count).toBe(0);
            expect(await base.jobDestination.count({ where: { jobId: "globex-job" } })).toBe(1);
        });

        it("hides the databases another tenant's servers hold, which the global search reads", async () => {
            const rows = await runAsTenant("acme", () => scoped.databaseListCache.findMany({ select: { adapterConfigId: true, adapterConfig: { select: { tenantId: true } } } }));
            expect(rows).toEqual([{ adapterConfigId: "acme-source", adapterConfig: { tenantId: "acme" } }]);
        });

        it("hides the assignments of another tenant's servers", async () => {
            const rows = await runAsTenant("acme", () => scoped.databaseAssignment.findMany());
            expect(rows.map((row) => row.id)).toEqual(["acme-assignment"]);
            const changed = await runAsTenant("acme", () => scoped.databaseAssignment.updateMany({ where: { id: "globex-assignment" }, data: { validUntil: new Date() } }));
            expect(changed.count).toBe(0);
        });

        it("keeps the assignments of a deleted server with its tenant, and from every other one", async () => {
            for (const tenantId of TENANTS) {
                await base.adapterConfig.create({ data: { tenantId, id: `${tenantId}-old`, name: "Old", type: "database", adapterId: "mysql", config: "{}" } });
                await base.sharedServer.create({ data: { tenantId, id: `${tenantId}-old`, name: "Old", adapterId: "mysql" } });
                await base.databaseAssignment.create({ data: { id: `${tenantId}-old-assignment`, sourceId: `${tenantId}-old`, databaseName: "crm", tenantId, validFrom: new Date() } });
                // The connection goes, the shared server and its assignments stay.
                await base.adapterConfig.delete({ where: { id: `${tenantId}-old` } });
            }
            const own = await runAsTenant("acme", () => scoped.databaseAssignment.findMany({ where: { sourceId: { in: ["acme-old", "globex-old"] } } }));
            expect(own.map((row) => row.id)).toEqual(["acme-old-assignment"]);
            expect(await runAsTenant("acme", () => scoped.sharedServer.findUnique({ where: { id: "globex-old" } }))).toBeNull();
            const deleted = await runAsTenant("acme", () => scoped.databaseAssignment.deleteMany({ where: { sourceId: "globex-old" } }));
            expect(deleted.count).toBe(0);
            expect(await base.databaseAssignment.count({ where: { sourceId: "globex-old" } })).toBe(1);
        });

        it("reads the relation of a tenant's own row through the filter as well", async () => {
            const job = await runAsTenant("acme", () => scoped.job.findUnique({ where: { id: "acme-job" }, include: { destinations: true, source: true } }));
            expect(job?.source?.tenantId).toBe("acme");
            expect(job?.destinations.map((destination) => destination.id)).toEqual(["acme-destination"]);
        });
    });

    describe("All tenants of a platform admin", () => {
        /** The client as a request in All tenants sees it. */
        const everyTenant = () => base.$extends(tenantScopeExtension(async () => ({ kind: "all" })));

        it("reads the rows of every tenant", async () => {
            const tenants = new Set((await everyTenant().job.findMany()).map((row) => row.tenantId));
            expect(tenants).toEqual(new Set(TENANTS));
            expect(await everyTenant().jobDestination.count()).toBe(2);
        });

        it("changes, creates and deletes nothing of a tenant, that happens in the tenant", async () => {
            const client = everyTenant();
            await expect(client.job.update({ where: { id: "acme-job" }, data: { name: "Renamed" } })).rejects.toBeInstanceOf(TenantScopeError);
            await expect(client.job.deleteMany({})).rejects.toBeInstanceOf(TenantScopeError);
            await expect(client.adapterConfig.create({ data: { tenantId: "acme", name: "New", type: "database", adapterId: "mysql", config: "{}" } })).rejects.toBeInstanceOf(TenantScopeError);
            await expect(client.jobDestination.deleteMany({ where: { id: "acme-destination" } })).rejects.toBeInstanceOf(TenantScopeError);
            expect(await base.job.count({ where: { name: "Nightly shop" } })).toBe(2);
        });

        it("still fills the cache of what a server holds, which reading it writes on the way", async () => {
            const client = everyTenant();
            await client.databaseListCache.update({ where: { adapterConfigId: "acme-source" }, data: { databasesJson: JSON.stringify([{ name: "acme_shop" }]) } });
            expect(await base.databaseListCache.count()).toBe(2);
        });
    });

    describe("in a transaction", () => {
        it("keeps the tenant of the code that opened it", async () => {
            const names = await runAsTenant("acme", () => scoped.$transaction(async (tx) => (await tx.adapterConfig.findMany()).map((row) => row.tenantId)));
            expect(new Set(names)).toEqual(new Set(["acme"]));
        });

        it("keeps it in a batch as well", async () => {
            const [configs, jobs] = await runAsTenant("acme", () => scoped.$transaction([scoped.adapterConfig.findMany(), scoped.job.findMany()]));
            expect(configs.every((row) => row.tenantId === "acme")).toBe(true);
            expect(jobs.every((row) => row.tenantId === "acme")).toBe(true);
        });
    });
});
