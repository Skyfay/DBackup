// @vitest-environment node
/**
 * A restore on the sign-up page has to end the time without an account, against real SQLite files
 * migrated with the migrations of this version. What counts is what the restore leaves behind, not
 * what the uploaded backup showed: a copy that loses its accounts while it is made ready is never
 * staged, a file never reaches the database as a nested write, and a file whose import ends without
 * an account writes nothing.
 */
import { execFileSync } from "child_process";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, rmSync } from "fs";
import os from "os";
import path from "path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "@prisma/client";
import type { AppConfigurationBackup } from "@/lib/types/config-backup";

const mocks = vi.hoisted(() => ({ live: "", restart: vi.fn(), client: null as unknown as object }));

vi.mock("@/lib/logging/logger", () => ({
    logger: { child: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }) },
}));
vi.mock("@/lib/server/restart", () => ({ restartSoon: (...args: unknown[]) => mocks.restart(...args) }));
vi.mock("@/services/system/database-service", () => ({ getDatabaseFilePath: async () => mocks.live }));
vi.mock("@/lib/prisma", () => ({
    default: new Proxy({}, {
        get: (_target, key) => {
            const value = Reflect.get(mocks.client, key);
            return typeof value === "function" ? value.bind(mocks.client) : value;
        },
    }),
}));

const { openCopy } = await import("@/services/config/database-copy");
const { stageDatabaseRestore, FOREIGN_SCHEMA } = await import("@/services/config/restore-staging");
const { importConfiguration } = await import("@/services/config/import");
const { LEAVES_NO_ACCOUNT, NOT_A_BACKUP } = await import("@/services/config/import-shape");
const { tenantScopeExtension } = await import("@/lib/tenant/prisma-scope");

let root = "";
let template = "";
let liveDir = "";
const now = new Date("2026-10-20T10:00:00.000Z");
const RECORD = { actorName: null, fileName: "planted.db" };

/** A database of this version with the row a visitor wants to plant, and one account when asked. */
async function copyWith(name: string, { user = true } = {}): Promise<{ file: string; db: PrismaClient }> {
    const file = path.join(root, name);
    copyFileSync(template, file);
    const db = openCopy(file);
    await db.systemSetting.create({ data: { key: "planted.marker", value: "planted-by-a-visitor" } });
    if (user) await db.user.create({ data: { id: "d1", name: "Decoy", email: "decoy@example.invalid", emailVerified: true, createdAt: now, updatedAt: now } });
    return { file, db };
}

const pending = () => path.join(liveDir, "restore-pending.db");

beforeAll(() => {
    root = mkdtempSync(path.join(os.tmpdir(), "dbackup-restore-account-"));
    template = path.join(root, "template.db");
    execFileSync(path.join(process.cwd(), "node_modules", ".bin", "prisma"), ["migrate", "deploy"], {
        env: { ...process.env, DATABASE_URL: `file:${template}` },
        stdio: "pipe",
    });
}, 120_000);

beforeEach(() => {
    vi.clearAllMocks();
    liveDir = mkdtempSync(path.join(root, "live-"));
    mkdirSync(liveDir, { recursive: true });
    mocks.live = path.join(liveDir, "dbackup.db");
});

afterAll(() => {
    rmSync(root, { recursive: true, force: true });
});

describe("a copy of the database restored before the first account", () => {
    it("is never staged when its one account hangs off a sign-in the restore drops", async () => {
        const { file, db } = await copyWith("cascade.db", { user: false });
        // The account goes with its session, which every restore deletes.
        await db.$executeRawUnsafe(`ALTER TABLE "User" ADD COLUMN "hook" TEXT REFERENCES "Session"("id") ON DELETE CASCADE`);
        await db.$executeRawUnsafe(`INSERT INTO "User" ("id", "name", "email", "emailVerified", "createdAt", "updatedAt") VALUES ('d1', 'Decoy', 'decoy@example.invalid', 1, 0, 0)`);
        await db.$executeRawUnsafe(`INSERT INTO "Session" ("id", "expiresAt", "token", "createdAt", "updatedAt", "userId") VALUES ('s1', 0, 't1', 0, 0, 'd1')`);
        await db.$executeRawUnsafe(`UPDATE "User" SET "hook" = 's1' WHERE "id" = 'd1'`);
        await db.$disconnect();

        await expect(stageDatabaseRestore(file, null, RECORD)).rejects.toThrow(FOREIGN_SCHEMA);

        expect(existsSync(pending())).toBe(false);
        expect(mocks.restart).not.toHaveBeenCalled();
    });

    it("is never staged when making it ready leaves it without an account", async () => {
        const { file, db } = await copyWith("empty.db", { user: false });
        await db.$disconnect();

        await expect(stageDatabaseRestore(file, null, RECORD)).rejects.toThrow(LEAVES_NO_ACCOUNT);

        expect(existsSync(pending())).toBe(false);
        expect(mocks.restart).not.toHaveBeenCalled();
    });

    it("is staged with its account when it is a copy DBackup made", async () => {
        const { file, db } = await copyWith("honest.db");
        await db.$disconnect();

        await stageDatabaseRestore(file, null, RECORD);

        const staged = openCopy(pending());
        expect(await staged.user.count()).toBe(1);
        await staged.$disconnect();
        expect(mocks.restart).toHaveBeenCalledTimes(1);
    });
});

describe("a file of an older version restored before the first account", () => {
    let db: PrismaClient;

    const file = (users: unknown[]): AppConfigurationBackup => ({
        metadata: { version: "1.0.0", exportedAt: now.toISOString(), includeSecrets: true, sourceType: "MANUAL" },
        settings: [{ key: "planted.marker", value: "planted-by-a-visitor" }],
        groups: [{ id: "vg1", name: "Readers", permissions: "[]", createdAt: now, updatedAt: now }],
        users,
        credentialProfiles: [], adapters: [], jobs: [], jobDestinations: [], jobNotifications: {}, apiKeys: [], ssoProviders: [], encryptionProfiles: [],
    }) as unknown as AppConfigurationBackup;

    const decoy = (id: string, more: Record<string, unknown> = {}) => ({ id, name: "decoy", email: "decoy@example.invalid", emailVerified: true, createdAt: now, updatedAt: now, ...more });

    const planted = () => db.systemSetting.findUnique({ where: { key: "planted.marker" } });

    beforeEach(() => {
        const target = path.join(root, `import-${Math.random().toString(36).slice(2)}.db`);
        copyFileSync(template, target);
        db = openCopy(target);
        mocks.client = db.$extends(tenantScopeExtension(async () => null));
    });

    afterEach(async () => {
        await db.$disconnect();
    });

    it("refuses a user that carries a nested write, which would delete the accounts the file showed", async () => {
        const nested = decoy("d2", { memberships: { update: [{ where: { userId_tenantId: { userId: "d1", tenantId: "default" } }, data: { tenant: { update: { platformGroups: { update: [] } } } } }] } });

        await expect(importConfiguration(file([decoy("d1", { groupId: "vg1" }), nested]), "OVERWRITE", undefined, { requireAccount: true })).rejects.toThrow(NOT_A_BACKUP);

        expect(await db.user.count()).toBe(0);
        expect(await planted()).toBeNull();
    });

    it("refuses a nested write in any other record of the file as well, also in Settings", async () => {
        const backup = file([decoy("d1")]);
        (backup.groups as unknown as Record<string, unknown>[])[0].memberships = { deleteMany: {} };

        await expect(importConfiguration(backup, "OVERWRITE")).rejects.toThrow(NOT_A_BACKUP);
    });

    it("writes nothing when the import ends without an account", async () => {
        await expect(importConfiguration(file([]), "OVERWRITE", undefined, { requireAccount: true })).rejects.toThrow(LEAVES_NO_ACCOUNT);

        expect(await planted()).toBeNull();
    });

    it("restores a file that leaves an account, and in Settings also one without users", async () => {
        await importConfiguration(file([]), "OVERWRITE");
        expect(await planted()).not.toBeNull();

        await importConfiguration(file([decoy("d1", { groupId: "vg1", accounts: [{ id: "cred-d1", accountId: "d1", providerId: "credential", userId: "d1", password: "hash", createdAt: now, updatedAt: now }] })]), "OVERWRITE", undefined, { requireAccount: true });
        expect(await db.user.count()).toBe(1);
        expect(await db.account.count()).toBe(1);
    });
});
