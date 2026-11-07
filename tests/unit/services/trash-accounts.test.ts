// @vitest-environment node
/**
 * Where a deleted account waits in Recently deleted and how it comes back, against a real SQLite
 * database migrated with the migrations of this version. An account belongs to no tenant, so its
 * entry follows the account, never the tenant it was deleted from: one of exactly one tenant waits
 * there for its admins, every other one in the home tenant for a platform admin. A record of a
 * tenant deleted outside a request names its tenant, and a restored account brings back no API key
 * its tenant may no longer make.
 */
import { execFileSync } from "child_process";
import { copyFileSync, mkdtempSync, rmSync } from "fs";
import os from "os";
import path from "path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { Tx } from "@/lib/prisma-tx";

vi.mock("@/lib/logging/logger", () => ({
    logger: { child: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }) },
}));

/** The client of the services, the database of the running test with the tenant of the request. */
const app = vi.hoisted(() => ({ client: null as unknown as object, requestTenant: null as string | null }));
vi.mock("@/lib/prisma", () => ({
    default: new Proxy({}, {
        get: (_target, key) => {
            const value = Reflect.get(app.client, key);
            return typeof value === "function" ? value.bind(app.client) : value;
        },
    }),
}));
vi.mock("@/lib/server/scheduler", () => ({ scheduler: { refresh: vi.fn(async () => undefined) } }));

const { openCopy } = await import("@/services/config/database-copy");
const { keepInTrash } = await import("@/services/trash/trash-snapshot");
const { restoreFromTrash, latestAccountEntries } = await import("@/services/trash/trash-service");
const { tenantScopeExtension } = await import("@/lib/tenant/prisma-scope");
const { runAsSystem, runAsTenant } = await import("@/lib/tenant/context");
const { HOME_TENANT_ID } = await import("@/lib/tenant/home");

const openScoped = (file: string) => openCopy(file).$extends(tenantScopeExtension(async () => app.requestTenant));

let root = "";
let template = "";
let db: ReturnType<typeof openScoped>;

const now = new Date("2026-10-17T10:00:00.000Z");
const asTx = (tx: unknown) => tx as Tx;

/** Deletes an account like `userService.deleteUser`, with its entry in Recently deleted. */
function deleteAccount(userId: string) {
    return db.$transaction(async (tx) => {
        const trashId = await keepInTrash(asTx(tx), "user", userId, "u-root");
        await tx.user.delete({ where: { id: userId } });
        return trashId;
    });
}

const entryOf = (trashId: string) => runAsSystem(() => db.deletedRecord.findUniqueOrThrow({ where: { id: trashId } }));

async function seed() {
    await db.tenant.create({ data: { id: "acme", name: "Acme" } });
    await db.tenant.create({ data: { id: "globex", name: "Globex", addsApiKeys: false } });
    await runAsTenant(HOME_TENANT_ID, () => db.group.create({ data: { id: "g-home", name: "Platform team", permissions: "[]" } }));
    await runAsTenant("acme", () => db.group.create({ data: { id: "g-acme", name: "Operators", permissions: "[]" } }));
    await runAsTenant("globex", () => db.group.create({ data: { id: "g-globex", name: "Operators", permissions: "[]" } }));
    const person = (id: string, name: string) => ({ id, name, email: `${id}@example.ch`, emailVerified: true, createdAt: now, updatedAt: now });
    await db.user.create({ data: { ...person("u-root", "Root"), platformRole: "ADMIN", memberships: { create: { tenantId: HOME_TENANT_ID, groupId: "g-home" } } } });
    await db.user.create({ data: { ...person("u-carla", "Carla"), memberships: { create: { tenantId: "acme", groupId: "g-acme" } } } });
    await db.user.create({ data: person("u-nobody", "Nobody") });
}

beforeAll(() => {
    root = mkdtempSync(path.join(os.tmpdir(), "dbackup-trash-accounts-"));
    template = path.join(root, "template.db");
    execFileSync(path.join(process.cwd(), "node_modules", ".bin", "prisma"), ["migrate", "deploy"], {
        env: { ...process.env, DATABASE_URL: `file:${template}` },
        stdio: "pipe",
    });
}, 120_000);

beforeEach(async () => {
    const file = path.join(root, `test-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
    copyFileSync(template, file);
    app.requestTenant = null;
    db = openScoped(file);
    app.client = db;
    await runAsSystem(seed);
});

afterEach(async () => {
    await db.$disconnect();
});

afterAll(() => {
    rmSync(root, { recursive: true, force: true });
});

describe("where a deleted account waits", () => {
    it("keeps an account of one tenant in that tenant for its admins, also when the home tenant deletes it", async () => {
        const trashId = await runAsTenant(HOME_TENANT_ID, () => deleteAccount("u-carla"));

        expect(await entryOf(trashId)).toMatchObject({ tenantId: "acme", superAdminOnly: false, detail: "u-carla@example.ch · 1 tenant" });
        // The admins of Acme find it in their Recently deleted, the home tenant does not.
        expect(await runAsTenant("acme", () => db.deletedRecord.count({ where: { id: trashId } }))).toBe(1);
        expect(await runAsTenant(HOME_TENANT_ID, () => db.deletedRecord.count({ where: { id: trashId } }))).toBe(0);
    });

    it("keeps an account of no tenant in the home tenant for a platform admin, whichever tenant deletes it", async () => {
        const trashId = await runAsTenant("acme", () => deleteAccount("u-nobody"));

        expect(await entryOf(trashId)).toMatchObject({ tenantId: HOME_TENANT_ID, superAdminOnly: true });
        expect(await runAsTenant("acme", () => db.deletedRecord.count({ where: { id: trashId } }))).toBe(0);
    });

    it("keeps an account of one tenant with an API key in another tenant in the home tenant for a platform admin", async () => {
        await runAsTenant(HOME_TENANT_ID, () => db.apiKey.create({ data: { id: "key-home", name: "CI", prefix: "dbackup_11111111", hashedKey: "hash-1", permissions: "[]", userId: "u-carla" } }));

        const trashId = await runAsTenant("acme", () => deleteAccount("u-carla"));

        expect(await entryOf(trashId)).toMatchObject({ tenantId: HOME_TENANT_ID, superAdminOnly: true });
    });

    it("keeps an account of one tenant that holds a platform group in the home tenant for a platform admin", async () => {
        await db.platformGroup.create({ data: { id: "pg-support", name: "Support", platformPermissions: "[]", tenantPermissions: "[]", allTenants: true } });
        await db.user.update({ where: { id: "u-carla" }, data: { platformGroupId: "pg-support" } });

        const trashId = await runAsTenant("acme", () => deleteAccount("u-carla"));

        expect(await entryOf(trashId)).toMatchObject({ tenantId: HOME_TENANT_ID, superAdminOnly: true });
    });
});

describe("a record of a tenant deleted outside a request", () => {
    it("names the tenant of the record, which the system scope needs for a new row", async () => {
        await runAsTenant("acme", () => db.encryptionProfile.create({ data: { id: "key-acme", name: "Acme key", secretKey: "not-a-real-secret" } }));

        const trashId = await runAsSystem(() => db.$transaction(async (tx) => {
            const id = await keepInTrash(asTx(tx), "encryptionKey", "key-acme", null);
            await tx.encryptionProfile.delete({ where: { id: "key-acme" } });
            return id;
        }));

        expect(await entryOf(trashId)).toMatchObject({ kind: "encryptionKey", tenantId: "acme", permission: "vault:write" });
    });
});

describe("an account back from Recently deleted", () => {
    it("leaves out the API keys of a tenant that makes none any more, and says so", async () => {
        await db.tenantMembership.create({ data: { userId: "u-carla", tenantId: "globex", groupId: "g-globex" } });
        await runAsTenant("acme", () => db.apiKey.create({ data: { id: "key-acme", name: "Acme CI", prefix: "dbackup_22222222", hashedKey: "hash-2", permissions: "[]", userId: "u-carla" } }));
        await runAsSystem(() => db.apiKey.create({ data: { id: "key-globex", tenantId: "globex", name: "Globex CI", prefix: "dbackup_33333333", hashedKey: "hash-3", permissions: "[]", userId: "u-carla" } }));
        const trashId = await runAsTenant(HOME_TENANT_ID, () => deleteAccount("u-carla"));

        const result = await runAsTenant(HOME_TENANT_ID, () => restoreFromTrash([trashId]));

        expect(result.restored).toEqual([expect.objectContaining({ id: trashId, notes: ["1 API key is left out, Globex makes no API keys."] })]);
        const keys = await runAsSystem(() => db.apiKey.findMany({ where: { userId: "u-carla" }, select: { id: true } }));
        expect(keys.map((key) => key.id)).toEqual(["key-acme"]);
    });

    it("comes back through Undo from another tenant than the one its entry waits in", async () => {
        // Deleted from the home tenant, its entry waits in Acme, which the request of the home tenant does not read.
        app.requestTenant = HOME_TENANT_ID;
        const trashId = await deleteAccount("u-carla");
        expect(await db.deletedRecord.count({ where: { id: trashId } })).toBe(0);

        const [entry] = await latestAccountEntries(["u-carla"]);
        expect(entry).toMatchObject({ id: trashId, tenantId: "acme", deletedById: "u-root" });

        // Without leave to read it in another tenant the entry reads as gone.
        expect((await restoreFromTrash([trashId])).failed).toEqual([{ id: trashId, name: trashId, error: "It is gone from Recently deleted." }]);

        const result = await restoreFromTrash([trashId], { anyTenantAccounts: true });
        expect(result.restored).toEqual([expect.objectContaining({ id: trashId, recordId: "u-carla", kind: "user" })]);
        expect(await db.tenantMembership.findMany({ where: { userId: "u-carla" }, select: { tenantId: true } })).toEqual([{ tenantId: "acme" }]);
        expect(await runAsSystem(() => db.deletedRecord.count({ where: { id: trashId } }))).toBe(0);
    });
});
