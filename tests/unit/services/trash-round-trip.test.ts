// @vitest-environment node
/**
 * Recently deleted against a real SQLite database migrated with the migrations of this version: a
 * delete keeps a snapshot of the record with everything that belongs to it, and a restore brings it
 * back under the same id, or leaves out the links to what is gone meanwhile and says so. The client
 * carries the tenant scope of DBackup, so every query on a tenant model runs for a tenant like in
 * the app.
 */
import { execFileSync } from "child_process";
import { copyFileSync, mkdtempSync, rmSync } from "fs";
import os from "os";
import path from "path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { Tx } from "@/lib/prisma-tx";
import { ConflictError, TenantScopeError } from "@/lib/logging/errors";

vi.mock("@/lib/logging/logger", () => ({
    logger: { child: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }) },
}));

const { openCopy } = await import("@/services/config/database-copy");
const { keepInTrash } = await import("@/services/trash/trash-snapshot");
const { restoreSnapshot } = await import("@/services/trash/trash-restore");
const { tenantScopeExtension } = await import("@/lib/tenant/prisma-scope");
const { runAsSystem, runAsTenant } = await import("@/lib/tenant/context");
const { HOME_TENANT_ID } = await import("@/lib/tenant/home");

/** A copy with the tenant scope of the app. Outside a request no tenant is known, so a query without a scope fails. */
const openScoped = (file: string) => openCopy(file).$extends(tenantScopeExtension(async () => null));

let root = "";
let template = "";
let db: ReturnType<typeof openScoped>;
/** The file of the database of the running test. */
let dbFile = "";

const now = new Date("2026-09-30T10:00:00.000Z");

/** The client of the test database where the services expect the transaction of the app. */
const asTx = (tx: unknown) => tx as Tx;

/** Runs as someone who works in the home tenant, where everything of an earlier version lives. */
const home = <T>(fn: () => Promise<T>) => runAsTenant(HOME_TENANT_ID, fn);

type Kind = "job" | "user" | "connection" | "encryptionKey";

/** Moves a record to Recently deleted and deletes it, like the delete of its service. */
async function trash(kind: Kind, id: string, remove: (tx: Tx) => Promise<unknown>) {
    return db.$transaction(async (tx) => {
        const trashId = await keepInTrash(asTx(tx), kind, id, "u-actor");
        await remove(asTx(tx));
        return trashId;
    });
}

async function restore(kind: Kind, trashId: string, newName?: string) {
    const entry = await db.deletedRecord.findUniqueOrThrow({ where: { id: trashId } });
    return db.$transaction((tx) => restoreSnapshot(asTx(tx), kind, JSON.parse(entry.data), newName));
}

async function seed() {
    await db.group.create({ data: { id: "g-ops", name: "Operators", permissions: "[]" } });
    await db.user.create({
        data: { id: "u-actor", name: "Manu", email: "manu@example.ch", emailVerified: true, createdAt: now, updatedAt: now, memberships: { create: { tenantId: HOME_TENANT_ID, groupId: "g-ops" } } },
    });
    await db.encryptionProfile.create({ data: { id: "key-1", name: "Main key", secretKey: "not-a-real-secret" } });
    await db.credentialProfile.create({ data: { id: "cred-1", name: "Shop login", type: "USERNAME_PASSWORD", data: "encrypted" } });
    await db.adapterConfig.create({ data: { id: "db-1", name: "Shop", type: "database", adapterId: "mysql", config: "{}", primaryCredentialId: "cred-1" } });
    await db.adapterConfig.create({ data: { id: "nas", name: "NAS", type: "storage", adapterId: "local-filesystem", config: "{}" } });
    await db.adapterConfig.create({ data: { id: "files", name: "Files", type: "storage", adapterId: "local-filesystem", config: "{}", storageRole: "SOURCE" } });
    await db.adapterConfig.create({ data: { id: "mail", name: "Admins", type: "notification", adapterId: "email", config: "{}" } });
    await db.retentionPolicy.create({ data: { id: "keep-7", name: "Keep 7", config: '{"mode":"SIMPLE","simple":{"keepCount":7}}' } });
    await db.namingTemplate.create({ data: { id: "names", name: "Dated", pattern: "{name}_yyyy-MM-dd" } });
    await db.schedulePreset.create({ data: { id: "nightly", name: "Nightly", schedule: "0 3 * * *" } });
    await db.excludePatternPreset.create({ data: { id: "no-cache", name: "No cache", patterns: '["cache/"]' } });
    await db.notificationTemplate.create({ data: { id: "tpl", name: "Failures" } });
    await db.job.create({
        data: {
            id: "job-1",
            name: "Shop nightly",
            schedule: "0 3 * * *",
            sourceId: "db-1",
            encryptionProfileId: "key-1",
            namingTemplateId: "names",
            schedulePresetId: "nightly",
            notifications: { connect: [{ id: "mail" }] },
            destinations: { create: [{ id: "dest-1", configId: "nas", retentionPolicyId: "keep-7" }] },
            sources: { create: [{ id: "src-1", configId: "files", path: "/srv/www", excludePatternPresets: { connect: [{ id: "no-cache" }] } }] },
            notificationTemplates: { create: [{ id: "jnt-1", templateId: "tpl" }] },
        },
    });
    await db.execution.create({ data: { id: "run-1", jobId: "job-1", type: "Backup", status: "Success", startedAt: now, logs: "[]" } });
}

beforeAll(() => {
    root = mkdtempSync(path.join(os.tmpdir(), "dbackup-trash-"));
    template = path.join(root, "template.db");
    execFileSync(path.join(process.cwd(), "node_modules", ".bin", "prisma"), ["migrate", "deploy"], {
        env: { ...process.env, DATABASE_URL: `file:${template}` },
        stdio: "pipe",
    });
}, 120_000);

beforeEach(async () => {
    const file = path.join(root, `test-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
    copyFileSync(template, file);
    dbFile = file;
    db = openScoped(file);
    await home(seed);
});

afterEach(async () => {
    await db.$disconnect();
});

afterAll(() => {
    rmSync(root, { recursive: true, force: true });
});

describe("the database of these tests", () => {
    it("reads a tenant model only for a tenant, like DBackup", async () => {
        await expect(db.job.count()).rejects.toBeInstanceOf(TenantScopeError);
        expect(await runAsTenant("acme", () => db.job.count())).toBe(0);
        expect(await home(() => db.job.count())).toBe(1);
    });
});

describe("a job in Recently deleted", () => {
    it("keeps the job with its destinations, folders, notifications and runs, and brings all of it back", () => home(async () => {
        const trashId = await trash("job", "job-1", (tx) => tx.job.delete({ where: { id: "job-1" } }));

        const entry = await db.deletedRecord.findUniqueOrThrow({ where: { id: trashId } });
        expect(entry).toMatchObject({ kind: "job", recordId: "job-1", name: "Shop nightly", detail: "Shop to NAS", permission: "jobs:write", deletedByName: "Manu", tenantId: HOME_TENANT_ID });
        expect(await db.job.count()).toBe(0);
        expect(await db.jobDestination.count()).toBe(0);
        expect((await db.execution.findUniqueOrThrow({ where: { id: "run-1" } })).jobId).toBeNull();

        const restored = await restore("job", trashId);

        expect(restored).toEqual({ name: "Shop nightly", notes: [] });
        const job = await db.job.findUniqueOrThrow({
            where: { id: "job-1" },
            include: { destinations: true, sources: { include: { excludePatternPresets: true } }, notifications: true, notificationTemplates: true },
        });
        expect(job).toMatchObject({ sourceId: "db-1", encryptionProfileId: "key-1", namingTemplateId: "names", schedulePresetId: "nightly", enabled: true, tenantId: HOME_TENANT_ID });
        expect(job.destinations).toMatchObject([{ id: "dest-1", configId: "nas", retentionPolicyId: "keep-7" }]);
        expect(job.sources).toMatchObject([{ id: "src-1", path: "/srv/www", excludePatternPresets: [{ id: "no-cache" }] }]);
        expect(job.notifications.map((channel) => channel.id)).toEqual(["mail"]);
        expect(job.notificationTemplates.map((link) => link.templateId)).toEqual(["tpl"]);
        expect((await db.execution.findUniqueOrThrow({ where: { id: "run-1" } })).jobId).toBe("job-1");
    }));

    it("pauses a job whose key is gone and leaves out the links to what was deleted meanwhile", () => home(async () => {
        const trashId = await trash("job", "job-1", (tx) => tx.job.delete({ where: { id: "job-1" } }));
        await db.encryptionProfile.delete({ where: { id: "key-1" } });
        await db.adapterConfig.delete({ where: { id: "nas" } });
        await db.namingTemplate.delete({ where: { id: "names" } });
        await db.retentionPolicy.delete({ where: { id: "keep-7" } });

        const restored = await restore("job", trashId);

        expect(restored.notes).toEqual([
            "It is paused, its encryption key is gone and it would back up unencrypted.",
            "It uses the default file names, its naming template is gone.",
            "1 destination is left out, its connection is gone.",
        ]);
        const job = await db.job.findUniqueOrThrow({ where: { id: "job-1" }, include: { destinations: true } });
        expect(job).toMatchObject({ enabled: false, encryptionProfileId: null, namingTemplateId: null });
        expect(job.destinations).toEqual([]);
    }));

    it("stops at a name another job took meanwhile, and restores under a new one", () => home(async () => {
        const trashId = await trash("job", "job-1", (tx) => tx.job.delete({ where: { id: "job-1" } }));
        await db.job.create({ data: { name: "Shop nightly", schedule: "0 4 * * *" } });

        await expect(restore("job", trashId)).rejects.toBeInstanceOf(ConflictError);
        expect(await db.job.count()).toBe(1);

        await expect(restore("job", trashId, "Shop nightly (restored)")).resolves.toMatchObject({ name: "Shop nightly (restored)" });
        expect((await db.job.findUniqueOrThrow({ where: { id: "job-1" } })).name).toBe("Shop nightly (restored)");
    }));
});

describe("a user in Recently deleted", () => {
    beforeEach(() => home(async () => {
        await db.user.create({
            data: {
                id: "u-jana",
                name: "Jana Keller",
                email: "jana@example.ch",
                emailVerified: true,
                twoFactorEnabled: true,
                createdAt: now,
                updatedAt: now,
                memberships: { create: { tenantId: HOME_TENANT_ID, groupId: "g-ops" } },
            },
        });
        await db.account.create({ data: { id: "acc-1", accountId: "u-jana", providerId: "credential", userId: "u-jana", password: "hashed", createdAt: now, updatedAt: now } });
        await db.twoFactor.create({ data: { id: "tf-1", userId: "u-jana", secret: "encrypted-totp", backupCodes: "encrypted-codes" } });
        await db.passkey.create({ data: { id: "pk-1", publicKey: "key", userId: "u-jana", credentialID: "cred-id", counter: 3, deviceType: "multiDevice", backedUp: true } });
        await db.apiKey.create({ data: { id: "api-1", name: "CI", prefix: "dbackup_12345678", hashedKey: "hash", permissions: "[]", userId: "u-jana" } });
        await db.userPreference.create({ data: { userId: "u-jana", key: "theme", value: "dark" } });
        await db.avatar.create({ data: { userId: "u-jana", mimeType: "image/png", size: 4, data: Buffer.from([0x89, 0x50, 0x4e, 0x47]), updatedAt: now } });
        await db.session.create({ data: { id: "s-1", token: "token", userId: "u-jana", expiresAt: new Date(Date.now() + 86_400_000), createdAt: now, updatedAt: now } });
    }));

    /** Jana also works in a second tenant, with a role and an API key there. */
    async function secondTenant() {
        await db.tenant.create({ data: { id: "acme", name: "Acme" } });
        await runAsTenant("acme", () => db.group.create({ data: { id: "g-admin", name: "Admin", permissions: "[]", fullAccess: true } }));
        await db.tenantMembership.create({ data: { userId: "u-jana", tenantId: "acme", groupId: "g-admin" } });
        await runAsTenant("acme", () => db.apiKey.create({ data: { id: "api-2", name: "Acme CI", prefix: "dbackup_87654321", hashedKey: "hash-acme", permissions: "[]", userId: "u-jana" } }));
    }

    /** The keys of the account in every tenant, with the tenant each belongs to. */
    const keysOf = (userId: string) => runAsSystem(() => db.apiKey.findMany({ where: { userId }, select: { id: true, tenantId: true }, orderBy: { id: "asc" } }));

    const membershipsOf = (userId: string) => db.tenantMembership.findMany({ where: { userId }, select: { tenantId: true, groupId: true }, orderBy: { tenantId: "asc" } });

    it("comes back with the password, second factor, passkeys, API keys, preferences, picture and group, but signed out", () => home(async () => {
        const trashId = await trash("user", "u-jana", (tx) => tx.user.delete({ where: { id: "u-jana" } }));
        expect(await db.deletedRecord.findUniqueOrThrow({ where: { id: trashId } })).toMatchObject({ detail: "jana@example.ch · 1 tenant", superAdminOnly: false });
        expect(await db.account.count({ where: { userId: "u-jana" } })).toBe(0);
        expect(await membershipsOf("u-jana")).toEqual([]);

        await expect(restore("user", trashId)).resolves.toEqual({ name: "Jana Keller", notes: [] });

        const user = await db.user.findUniqueOrThrow({ where: { id: "u-jana" }, include: { accounts: true, twoFactor: true, passkeys: true, apiKeys: true, preferences: true, avatar: true, sessions: true } });
        expect(user).toMatchObject({ email: "jana@example.ch", twoFactorEnabled: true, platformRole: null });
        expect(await membershipsOf("u-jana")).toEqual([{ tenantId: HOME_TENANT_ID, groupId: "g-ops" }]);
        expect(user.accounts).toMatchObject([{ id: "acc-1", password: "hashed" }]);
        expect(user.twoFactor).toMatchObject({ secret: "encrypted-totp" });
        expect(user.passkeys).toMatchObject([{ credentialID: "cred-id", counter: 3 }]);
        expect(user.apiKeys).toMatchObject([{ id: "api-1", hashedKey: "hash", enabled: true, tenantId: HOME_TENANT_ID }]);
        expect(user.preferences).toMatchObject([{ key: "theme", value: "dark" }]);
        expect(user.avatar).toMatchObject({ mimeType: "image/png", size: 4, updatedAt: now });
        expect(Buffer.from(user.avatar?.data ?? [])).toEqual(Buffer.from([0x89, 0x50, 0x4e, 0x47]));
        expect(user.sessions).toEqual([]);
    }));

    it("keeps the groups of every tenant the account worked in, and brings each back with the keys of that tenant", () => home(async () => {
        await secondTenant();

        const trashId = await trash("user", "u-jana", (tx) => tx.user.delete({ where: { id: "u-jana" } }));
        const entry = await db.deletedRecord.findUniqueOrThrow({ where: { id: trashId } });
        // Bringing her back puts her back into the other tenant too, which only a platform admin decides.
        expect(entry).toMatchObject({ detail: "jana@example.ch · 2 tenants", superAdminOnly: true });
        expect(JSON.parse(entry.data).memberships).toEqual(expect.arrayContaining([
            { tenantId: HOME_TENANT_ID, groupId: "g-ops" },
            { tenantId: "acme", groupId: "g-admin" },
        ]));
        expect(await keysOf("u-jana")).toEqual([]);

        await expect(restore("user", trashId)).resolves.toEqual({ name: "Jana Keller", notes: [] });

        expect(await membershipsOf("u-jana")).toEqual([
            { tenantId: "acme", groupId: "g-admin" },
            { tenantId: HOME_TENANT_ID, groupId: "g-ops" },
        ]);
        expect(await keysOf("u-jana")).toEqual([
            { id: "api-1", tenantId: HOME_TENANT_ID },
            { id: "api-2", tenantId: "acme" },
        ]);
        // The home tenant sees only its own key of the account.
        expect((await db.apiKey.findMany({ where: { userId: "u-jana" }, select: { id: true } })).map((key) => key.id)).toEqual(["api-1"]);
    }));

    it("leaves out the group and the keys of a tenant that is gone meanwhile, and says so", () => home(async () => {
        await secondTenant();
        const trashId = await trash("user", "u-jana", (tx) => tx.user.delete({ where: { id: "u-jana" } }));
        await db.tenant.delete({ where: { id: "acme" } });

        await expect(restore("user", trashId)).resolves.toEqual({ name: "Jana Keller", notes: ["1 of its groups is gone."] });

        expect(await membershipsOf("u-jana")).toEqual([{ tenantId: HOME_TENANT_ID, groupId: "g-ops" }]);
        expect(await keysOf("u-jana")).toEqual([{ id: "api-1", tenantId: HOME_TENANT_ID }]);
    }));

    it("brings a snapshot of an earlier version back with its group as a membership in the home tenant", () => home(async () => {
        // Before tenants a snapshot kept the group on the record, and its keys had no tenant.
        const legacy = {
            record: {
                id: "u-kim",
                name: "Kim Frei",
                email: "kim@example.ch",
                emailVerified: true,
                image: null,
                timezone: "",
                dateFormat: "P",
                timeFormat: "p",
                autoRedirectOnJobStart: true,
                createdAt: now,
                updatedAt: now,
                twoFactorEnabled: false,
                passkeyTwoFactor: false,
                groupId: "g-ops",
            },
            accounts: [{ id: "acc-kim", accountId: "u-kim", providerId: "credential", userId: "u-kim", password: "hashed-kim", createdAt: now, updatedAt: now }],
            twoFactor: null,
            passkeys: [],
            apiKeys: [{ id: "api-kim", name: "Old CI", prefix: "dbackup_00000000", hashedKey: "hash-kim", permissions: "[]", userId: "u-kim", expiresAt: null, lastUsedAt: null, enabled: true, createdAt: now }],
            preferences: [],
        };
        const { id: trashId } = await db.deletedRecord.create({
            data: { kind: "user", recordId: "u-kim", name: "Kim Frei", detail: "kim@example.ch · Operators", data: JSON.stringify(legacy), permission: "users:write" },
        });

        await expect(restore("user", trashId)).resolves.toEqual({ name: "Kim Frei", notes: [] });

        expect(await db.user.findUniqueOrThrow({ where: { id: "u-kim" } })).toMatchObject({ email: "kim@example.ch", platformRole: null });
        expect(await membershipsOf("u-kim")).toEqual([{ tenantId: HOME_TENANT_ID, groupId: "g-ops" }]);
        expect(await keysOf("u-kim")).toEqual([{ id: "api-kim", tenantId: HOME_TENANT_ID }]);
        expect(await db.account.findMany({ where: { userId: "u-kim" }, select: { password: true } })).toEqual([{ password: "hashed-kim" }]);
    }));

    it("keeps an account of several tenants in the home tenant, also when it is deleted from inside another", async () => {
        await home(secondTenant);
        const trashId = await runAsTenant("acme", () => trash("user", "u-jana", (tx) => tx.user.delete({ where: { id: "u-jana" } })));
        const entry = await runAsSystem(() => db.deletedRecord.findUniqueOrThrow({ where: { id: trashId } }));
        expect(entry).toMatchObject({ tenantId: HOME_TENANT_ID, superAdminOnly: true });
    });

    it("keeps an account of one tenant a platform admin deletes in All tenants in that tenant", async () => {
        // All tenants writes no row of a tenant, the entry of an account goes to the tenant of the account.
        const everyTenant = openCopy(dbFile).$extends(tenantScopeExtension(async () => ({ kind: "all" as const })));
        try {
            const trashId = await everyTenant.$transaction(async (tx) => {
                const id = await keepInTrash(asTx(tx), "user", "u-jana", "u-actor");
                await tx.user.delete({ where: { id: "u-jana" } });
                return id;
            });
            const entry = await runAsSystem(() => db.deletedRecord.findUniqueOrThrow({ where: { id: trashId } }));
            expect(entry).toMatchObject({ tenantId: HOME_TENANT_ID, superAdminOnly: false });
        } finally {
            await everyTenant.$disconnect();
        }
    });

    it("marks a platform admin as one only a platform admin restores, and asks for another email once the old one is taken", () => home(async () => {
        await db.user.update({ where: { id: "u-jana" }, data: { platformRole: "ADMIN" } });

        const trashId = await trash("user", "u-jana", (tx) => tx.user.delete({ where: { id: "u-jana" } }));
        expect(await db.deletedRecord.findUniqueOrThrow({ where: { id: trashId } })).toMatchObject({ detail: "jana@example.ch · platform admin", superAdminOnly: true });

        await db.user.create({ data: { id: "u-new", name: "New Jana", email: "jana@example.ch", emailVerified: true, createdAt: now, updatedAt: now } });
        await expect(restore("user", trashId)).rejects.toThrow("An account with jana@example.ch exists already");
        await expect(restore("user", trashId, "jana.keller@example.ch")).resolves.toMatchObject({ name: "Jana Keller" });
        expect(await db.user.findUniqueOrThrow({ where: { id: "u-jana" } })).toMatchObject({ email: "jana.keller@example.ch", platformRole: "ADMIN" });
    }));
});

describe("a connection and a key in Recently deleted", () => {
    it("brings a database back with its version history, without the saved login deleted meanwhile", () => home(async () => {
        await db.job.delete({ where: { id: "job-1" } });
        await db.dbVersionHistory.create({ data: { adapterConfigId: "db-1", newVersion: "8.0.36" } });

        const trashId = await trash("connection", "db-1", (tx) => tx.adapterConfig.delete({ where: { id: "db-1" } }));
        expect(await db.dbVersionHistory.count()).toBe(0);
        await db.credentialProfile.delete({ where: { id: "cred-1" } });

        const restored = await restore("connection", trashId);

        expect(restored.notes).toEqual(["Its saved login is gone, pick one again before it connects."]);
        expect(await db.adapterConfig.findUniqueOrThrow({ where: { id: "db-1" } })).toMatchObject({ name: "Shop", primaryCredentialId: null });
        expect(await db.dbVersionHistory.findMany({ select: { newVersion: true } })).toEqual([{ newVersion: "8.0.36" }]);
    }));

    it("restores a key under its own id, so the job that named it encrypts with it again", () => home(async () => {
        await db.job.update({ where: { id: "job-1" }, data: { encryptionProfileId: null } });
        const trashId = await trash("encryptionKey", "key-1", (tx) => tx.encryptionProfile.delete({ where: { id: "key-1" } }));
        await db.encryptionProfile.create({ data: { name: "Main key", secretKey: "another" } });

        await expect(restore("encryptionKey", trashId)).rejects.toThrow("A key named Main key exists already");
        await restore("encryptionKey", trashId, "Main key (restored)");

        expect(await db.encryptionProfile.findUniqueOrThrow({ where: { id: "key-1" } })).toMatchObject({ name: "Main key (restored)", secretKey: "not-a-real-secret" });
    }));
});
