// @vitest-environment node
/**
 * The users of a configuration file from before the tenants, imported into a real SQLite database
 * migrated with the migrations of this version that already serves customer tenants. The file holds
 * the home tenant alone, so its users never merge into an account that also works in a customer's
 * tenant, which a customer could have made under the email of the file.
 */
import { execFileSync } from "child_process";
import { copyFileSync, mkdtempSync, rmSync } from "fs";
import os from "os";
import path from "path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { Tx } from "@/lib/prisma-tx";
import type { AppConfigurationBackup } from "@/lib/types/config-backup";

vi.mock("@/lib/logging/logger", () => ({
    logger: { child: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }) },
}));

const { openCopy } = await import("@/services/config/database-copy");
const { createImportContext } = await import("@/services/config/import-context");
const { importUsers } = await import("@/services/config/import-users");
const { tenantScopeExtension } = await import("@/lib/tenant/prisma-scope");
const { runAsTenant } = await import("@/lib/tenant/context");
const { HOME_TENANT_ID } = await import("@/lib/tenant/home");

const openScoped = (file: string) => openCopy(file).$extends(tenantScopeExtension(async () => null));

let root = "";
let template = "";
let db: ReturnType<typeof openScoped>;

const now = new Date("2026-09-30T10:00:00.000Z");
const ALL_PARTS = { settings: false, adapters: false, jobs: false, users: true, sso: false, profiles: false, statistics: false };

async function seed() {
    await db.tenant.create({ data: { id: "tenant-b", name: "Customer B" } });
    await runAsTenant("tenant-b", () => db.group.create({ data: { id: "b-member", name: "Member", permissions: "[]" } }));
    await runAsTenant(HOME_TENANT_ID, () => db.group.create({ data: { id: "g-ops", name: "Operators", permissions: "[]" } }));
    // A customer's account under the email of the SuperAdmin of the file, and one under the id of another user of it.
    for (const [id, email] of [["u-attacker", "old-admin@example.test"], ["u-old-ops", "b-person@example.test"]]) {
        await db.user.create({
            data: { id, name: "Customer", email, emailVerified: false, createdAt: now, updatedAt: now, memberships: { create: { tenantId: "tenant-b", groupId: "b-member" } } },
        });
        await db.account.create({ data: { id: `acc-${id}`, accountId: id, providerId: "credential", userId: id, password: "hash-of-the-customer", createdAt: now, updatedAt: now } });
    }
    // An account of the home tenant alone, which the user of the file of the same email is.
    await db.user.create({
        data: { id: "u-manu", name: "Manu", email: "manu@example.test", emailVerified: false, createdAt: now, updatedAt: now, memberships: { create: { tenantId: HOME_TENANT_ID, groupId: "g-ops" } } },
    });
}

/** A file of an earlier version, whose users each hold a group and a sign-in, one of them an API key. */
function legacyFile(): AppConfigurationBackup {
    const fileUser = (id: string, name: string, email: string, groupId: string) => ({
        id,
        name,
        email,
        emailVerified: true,
        createdAt: now,
        updatedAt: now,
        groupId,
        accounts: [{ id: `acc-file-${id}`, accountId: id, providerId: "credential", userId: id, password: "hash-of-the-file", createdAt: now, updatedAt: now }],
    });
    return {
        metadata: { version: "1.0.0", exportedAt: now.toISOString(), includeSecrets: true, sourceType: "SYSTEM" },
        groups: [
            { id: "g-super", name: "SuperAdmin", permissions: "[]", createdAt: now, updatedAt: now },
            { id: "g-ops", name: "Operators", permissions: "[]", createdAt: now, updatedAt: now },
        ],
        users: [
            fileUser("u-old", "Old Admin", "old-admin@example.test", "g-super"),
            fileUser("u-old-ops", "Old Operator", "old-ops@example.test", "g-ops"),
            fileUser("u-manu-file", "Manu", "manu@example.test", "g-super"),
        ],
        apiKeys: [
            { id: "key-old", name: "Old key", prefix: "dbackup_old", hashedKey: "hash-old", permissions: "[]", userId: "u-old", enabled: true, createdAt: now },
            { id: "key-ops", name: "Ops key", prefix: "dbackup_ops", hashedKey: "hash-ops", permissions: "[]", userId: "u-old-ops", enabled: true, createdAt: now },
        ],
    } as unknown as AppConfigurationBackup;
}

async function importFile(): Promise<string[]> {
    return runAsTenant(HOME_TENANT_ID, () =>
        db.$transaction(async (tx) => {
            const ctx = createImportContext(tx as unknown as Tx, legacyFile(), ALL_PARTS);
            await importUsers(ctx);
            return ctx.notes;
        })
    );
}

const accountOf = (id: string) =>
    db.user.findUniqueOrThrow({
        where: { id },
        select: { name: true, emailVerified: true, platformRole: true, memberships: { select: { tenantId: true, groupId: true }, orderBy: { tenantId: "asc" } }, accounts: { select: { id: true } } },
    });

beforeAll(() => {
    root = mkdtempSync(path.join(os.tmpdir(), "dbackup-import-users-"));
    template = path.join(root, "template.db");
    execFileSync(path.join(process.cwd(), "node_modules", ".bin", "prisma"), ["migrate", "deploy"], {
        env: { ...process.env, DATABASE_URL: `file:${template}` },
        stdio: "pipe",
    });
}, 120_000);

beforeEach(async () => {
    const file = path.join(root, `test-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
    copyFileSync(template, file);
    db = openScoped(file);
    await seed();
});

afterEach(async () => {
    await db.$disconnect();
});

afterAll(() => {
    rmSync(root, { recursive: true, force: true });
});

describe("a legacy configuration file restored into a DBackup with customer tenants", () => {
    it("never makes a customer's account of the same email a platform admin or a member of the home tenant", async () => {
        const notes = await importFile();

        expect(await accountOf("u-attacker")).toEqual({
            name: "Customer",
            emailVerified: false,
            platformRole: null,
            memberships: [{ tenantId: "tenant-b", groupId: "b-member" }],
            accounts: [{ id: "acc-u-attacker" }],
        });
        expect(notes).toContain("2 users were left out, since an account of the same email or id here also works in another tenant: old-admin@example.test and old-ops@example.test.");
    });

    it("leaves out a user whose id a customer's account holds, with its sign-in and its API key", async () => {
        await importFile();

        expect(await accountOf("u-old-ops")).toMatchObject({ name: "Customer", memberships: [{ tenantId: "tenant-b", groupId: "b-member" }], accounts: [{ id: "acc-u-old-ops" }] });
        const keys = await runAsTenant(HOME_TENANT_ID, () => db.apiKey.findMany({ select: { id: true } }));
        expect(keys).toEqual([]);
        expect(await db.account.findUnique({ where: { id: "acc-file-u-old" } })).toBeNull();
    });

    it("still merges a user into the account of the home tenant of the same email, without taking over whether its email is verified", async () => {
        await importFile();

        const manu = await accountOf("u-manu");
        expect(manu.emailVerified).toBe(false);
        expect(manu.platformRole).toBe("ADMIN");
        expect(manu.memberships).toHaveLength(1);
        expect(manu.memberships[0].tenantId).toBe(HOME_TENANT_ID);
        expect(manu.accounts.map((account) => account.id).sort()).toEqual(["acc-file-u-manu-file"]);
    });
});
