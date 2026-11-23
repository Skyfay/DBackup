// @vitest-environment node
/**
 * Deleting a tenant against a real SQLite database migrated with the migrations of this version:
 * no row of any tenant model or of a row hanging off one stays with the deleted tenant, nothing of
 * the other tenant goes with it, the rows of the platform that name it go too, and a new tenant of
 * the same name never gets its id, so what kept the old id never falls to the new one.
 */
import { execFileSync } from "child_process";
import { mkdtempSync, rmSync } from "fs";
import os from "os";
import path from "path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PrismaClient } from "@prisma/client";
import { CHILD_MODELS, TENANT_MODELS, tenantScopeExtension } from "@/lib/tenant/prisma-scope";

const holder = vi.hoisted(() => ({ client: undefined as unknown }));

vi.mock("@/lib/logging/logger", () => ({
    logger: { child: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }) },
}));
vi.mock("@/lib/prisma", () => ({ get default() { return holder.client; } }));
vi.mock("@/services/storage/storage-service", () => ({ storageService: { readCachedListing: vi.fn(async () => null) } }));
vi.mock("@/lib/server/scheduler", () => ({ scheduler: { refresh: vi.fn() } }));
vi.mock("@/services/dashboard/cache", () => ({ invalidateDashboardCache: vi.fn() }));
// The storage of the destinations stays untouched here, the rows of the database are the subject.
vi.mock("@/services/sharing/share-cleanup", async (importOriginal) => ({
    ...(await importOriginal<typeof import("@/services/sharing/share-cleanup")>()),
    deleteTenantBackups: vi.fn(async () => undefined),
    sweepCustomerFolder: vi.fn(async () => undefined),
}));
vi.mock("@/services/dashboard-service", async (importOriginal) => ({
    ...(await importOriginal<typeof import("@/services/dashboard-service")>()),
    refreshStorageStatsCache: vi.fn(async () => undefined),
}));

const { tenantService } = await import("@/services/tenant/tenant-service");
const { tenantNotificationKey } = await import("@/services/notifications/tenant-notification-settings");

let root = "";
let base: PrismaClient;

const TENANTS = ["acme", "globex"] as const;
type Tenant = (typeof TENANTS)[number];

/** One row of every tenant model and of every child model for a tenant, with ids that name the tenant. */
async function seedTenant(tenantId: Tenant) {
    const id = (name: string) => `${tenantId}-${name}`;
    const now = new Date("2026-10-15T10:00:00.000Z");
    await base.tenant.create({ data: { id: tenantId, name: tenantId } });
    await base.user.create({ data: { id: id("user"), name: tenantId, email: `${tenantId}@example.ch`, emailVerified: true, createdAt: now, updatedAt: now } });
    await base.group.create({ data: { tenantId, id: id("group"), name: "Operators", permissions: "[]" } });
    await base.tenantMembership.create({ data: { userId: id("user"), tenantId, groupId: id("group") } });
    await base.tenantInvitation.create({ data: { tenantId, groupId: id("group"), tokenHash: id("token"), expiresAt: new Date("2026-11-15T10:00:00.000Z") } });
    await base.tenantLogo.create({ data: { tenantId, mimeType: "image/png", size: 1, data: Buffer.from([0]) } });
    await base.session.create({ data: { id: id("session"), token: id("session-token"), userId: id("user"), activeTenantId: tenantId, expiresAt: new Date("2026-11-15T10:00:00.000Z"), createdAt: now, updatedAt: now } });
    await base.ssoProvider.create({ data: { tenantId, providerId: id("sso"), adapterId: "generic", name: "Login" } });
    await base.systemSetting.create({ data: { key: tenantNotificationKey(tenantId), value: "{}" } });
    await base.credentialProfile.create({ data: { tenantId, id: id("credential"), name: "Login", type: "USERNAME_PASSWORD", data: "encrypted" } });
    await base.encryptionProfile.create({ data: { tenantId, id: id("key"), name: "Key", secretKey: "not-a-real-secret" } });
    await base.adapterConfig.create({ data: { tenantId, id: id("source"), name: "Shop", type: "database", adapterId: "mysql", config: "{}" } });
    await base.adapterConfig.create({ data: { tenantId, id: id("nas"), name: "NAS", type: "storage", adapterId: "local-filesystem", config: "{}" } });
    await base.adapterConfig.create({ data: { tenantId, id: id("mail"), name: "Mail", type: "notification", adapterId: "email", config: "{}" } });
    await base.healthCheckLog.create({ data: { adapterConfigId: id("source"), status: "ONLINE", latencyMs: 1 } });
    await base.dbVersionHistory.create({ data: { adapterConfigId: id("source"), newVersion: "8.0.36" } });
    await base.adapterConfig.create({ data: { tenantId, id: id("files"), name: "Files", type: "storage", storageRole: "SOURCE", adapterId: "local-filesystem", config: "{}" } });
    await base.databaseListCache.create({ data: { adapterConfigId: id("source"), databasesJson: JSON.stringify([{ name: `${tenantId}_shop` }]) } });
    await base.retentionPolicy.create({ data: { tenantId, id: id("retention"), name: "Keep 7", config: "{}" } });
    await base.namingTemplate.create({ data: { tenantId, id: id("naming"), name: "Dated", pattern: "{name}" } });
    await base.schedulePreset.create({ data: { tenantId, id: id("schedule"), name: "Nightly", schedule: "0 3 * * *" } });
    await base.excludePatternPreset.create({ data: { tenantId, id: id("exclude"), name: "No cache", patterns: "[]" } });
    await base.notificationTemplate.create({
        data: { tenantId, id: id("template"), name: "Failures", channels: { create: { configId: id("mail") } } },
    });
    await base.job.create({
        data: {
            tenantId,
            id: id("job"),
            name: "Nightly shop",
            schedule: "0 3 * * *",
            sourceId: id("source"),
            destinations: { create: { id: id("destination"), configId: id("nas") } },
            notificationTemplates: { create: { templateId: id("template") } },
            sources: { create: { configId: id("files"), path: "/srv" } },
        },
    });
    await base.execution.create({ data: { tenantId, id: id("execution"), jobId: id("job"), status: "Success", logs: "[]" } });
    await base.apiKey.create({ data: { tenantId, id: id("apikey"), name: "CI", prefix: "dbackup_00000000", hashedKey: id("hash"), permissions: "[]", userId: id("user") } });
    await base.auditLog.create({ data: { tenantId, id: id("audit"), action: "CREATE", resource: "JOB" } });
    await base.notificationLog.create({ data: { tenantId, id: id("notification"), eventType: "backup_success", channelName: "Mail", adapterId: "email", status: "Success", title: "Done", message: "Done" } });
    await base.storageSnapshot.create({ data: { tenantId, id: id("snapshot"), adapterConfigId: id("nas"), adapterName: "NAS", adapterId: "local-filesystem" } });
    await base.deletedRecord.create({ data: { tenantId, id: id("trash"), kind: "job", recordId: "gone", name: "Old job", data: "{}", permission: "jobs:write" } });
    await base.sharedServer.create({ data: { tenantId, id: id("source"), name: "Shop", adapterId: "mysql" } });
    await base.databaseAssignment.create({ data: { id: id("assignment"), sourceId: id("source"), databaseName: `${tenantId}_shop`, tenantId, validFrom: now } });
    await base.databaseAssignmentRule.create({ data: { id: id("rule"), sourceId: id("source"), pattern: `${tenantId}_*`, tenantId, validFrom: now } });
    await base.sharedBackupRequest.create({ data: { tenantId, id: id("request"), sourceId: id("source"), databaseName: `${tenantId}_shop`, executionId: id("execution") } });
    await base.connectionShare.create({ data: { tenantId, id: id("nas") } });
    await base.channelRecipients.create({ data: { tenantId, id: id("recipients"), configId: id("mail"), recipients: "[]" } });
    await base.storageListCache.create({ data: { tenantId, adapterConfigId: id("nas"), filesJson: "{}" } });
}

/** The delegate of a model, by the name Prisma gives it, like adapterConfig for AdapterConfig. */
function delegate(model: string) {
    const key = model[0].toLowerCase() + model.slice(1);
    return (base as unknown as Record<string, { count(args?: object): Promise<number> }>)[key];
}

/** How many rows of each tenant model and each child model a tenant holds, read without any filter. */
async function holdings(tenantId: Tenant): Promise<Record<string, number>> {
    const counts: Record<string, number> = {};
    for (const model of TENANT_MODELS) counts[model] = await delegate(model).count({ where: { tenantId } });
    for (const [model, relation] of Object.entries(CHILD_MODELS)) {
        counts[model] = await delegate(model).count({ where: { [relation]: { tenantId } } });
    }
    return counts;
}

beforeAll(async () => {
    root = mkdtempSync(path.join(os.tmpdir(), "dbackup-tenant-delete-all-"));
    const file = path.join(root, "tenants.db");
    execFileSync(path.join(process.cwd(), "node_modules", ".bin", "prisma"), ["migrate", "deploy"], {
        env: { ...process.env, DATABASE_URL: `file:${file}` },
        stdio: "pipe",
    });
    base = new PrismaClient({ datasources: { db: { url: `file:${file}` } } });
    holder.client = base.$extends(tenantScopeExtension(async () => null));
    for (const tenant of TENANTS) await seedTenant(tenant);
    // Each shares its destination with the other, Acme holds a database of Globex's server.
    await base.connectionShareTenant.create({ data: { shareId: "globex-nas", tenantId: "acme" } });
    await base.connectionShareTenant.create({ data: { shareId: "acme-nas", tenantId: "globex" } });
    await base.channelRecipients.create({ data: { tenantId: "acme", id: "acme-recipients-of-globex", configId: "globex-mail", recipients: "[]" } });
    await base.storageListCache.create({ data: { tenantId: "acme", adapterConfigId: "globex-nas", filesJson: "{}" } });
    await base.databaseAssignment.create({ data: { id: "acme-holds-globex", sourceId: "globex-source", databaseName: "crm", tenantId: "acme", validFrom: new Date("2026-10-01T10:00:00.000Z") } });
}, 120_000);

afterAll(async () => {
    await base?.$disconnect();
    if (root) rmSync(root, { recursive: true, force: true });
});

describe("a deleted tenant", () => {
    let before: Record<string, number>;

    beforeAll(async () => {
        before = await holdings("globex");
        // Every model is seeded, so the cases below prove something for each of them.
        for (const [model, count] of Object.entries(await holdings("acme"))) expect(count, model).toBeGreaterThan(0);
        await tenantService.delete("acme", new Date("2026-10-20T10:00:00.000Z"));
    });

    it("leaves no row of a tenant model or of a row hanging off one", async () => {
        const left = Object.entries(await holdings("acme")).filter(([, count]) => count > 0);
        expect(left, "Delete the rows of the model in tenantService.delete").toEqual([]);
    });

    it("takes nothing of another tenant with it", async () => {
        const after = await holdings("globex");
        // Globex keeps every row, only the ones that named Acme on its share and its server went.
        expect({ ...after, ConnectionShareTenant: before.ConnectionShareTenant, DatabaseAssignment: before.DatabaseAssignment })
            .toEqual(before);
    });

    it("leaves no share, recipient, listing or open assignment naming it on another tenant's connections", async () => {
        expect(await base.connectionShareTenant.count({ where: { tenantId: "acme" } })).toBe(0);
        expect(await base.channelRecipients.count({ where: { tenantId: "acme" } })).toBe(0);
        expect(await base.storageListCache.count({ where: { tenantId: "acme" } })).toBe(0);
        expect(await base.databaseAssignment.count({ where: { tenantId: "acme", validUntil: null } })).toBe(0);
        expect(await base.databaseAssignmentRule.count({ where: { tenantId: "acme", validUntil: null } })).toBe(0);
    });

    it("leaves no membership, invitation, logo, sign-in provider, setting or session working in it", async () => {
        expect(await base.tenantMembership.count({ where: { tenantId: "acme" } })).toBe(0);
        expect(await base.tenantInvitation.count({ where: { tenantId: "acme" } })).toBe(0);
        expect(await base.tenantLogo.count({ where: { tenantId: "acme" } })).toBe(0);
        expect(await base.ssoProvider.count({ where: { tenantId: "acme" } })).toBe(0);
        expect(await base.systemSetting.count({ where: { key: tenantNotificationKey("acme") } })).toBe(0);
        expect(await base.session.count({ where: { activeTenantId: "acme" } })).toBe(0);
        expect(await base.systemSetting.count({ where: { key: tenantNotificationKey("globex") } })).toBe(1);
        expect(await base.session.count({ where: { activeTenantId: "globex" } })).toBe(1);
    });

    it("never hands its id to a new tenant of the same name, so what kept the id stays nobody's", async () => {
        const again = await tenantService.create("acme");
        expect(again.id).not.toBe("acme");
        // The ended assignment kept the old id and names no tenant that exists.
        const kept = await base.databaseAssignment.findMany({ where: { tenantId: { in: ["acme", again.id] } }, select: { tenantId: true, validUntil: true } });
        expect(kept.every((row) => row.tenantId === "acme" && row.validUntil !== null)).toBe(true);
    });
});
