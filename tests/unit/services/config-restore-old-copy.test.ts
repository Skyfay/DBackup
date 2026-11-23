// @vitest-environment node
/**
 * The restore of a configuration backup that a copy of the database made by v4.0.x holds, whose
 * schema predates the tenants. The copy is migrated with the migrations of this version up to
 * 20261011095131_dashboard_history_indexes, the last one v4.0.2 shipped, and must be checked,
 * made ready and laid beside the live database without naming a column it does not have yet.
 */
import { execFileSync } from "child_process";
import { copyFileSync, cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync } from "fs";
import os from "os";
import path from "path";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { symmetricDecrypt, symmetricEncrypt } from "better-auth/crypto";
import { decryptWithKey, encryptWithKey } from "@/lib/crypto";

const mocks = vi.hoisted(() => ({ live: "", restart: vi.fn() }));

vi.mock("@/lib/logging/logger", () => ({
    logger: { child: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }) },
}));
vi.mock("@/lib/server/restart", () => ({ restartSoon: (...args: unknown[]) => mocks.restart(...args) }));
vi.mock("@/services/system/database-service", () => ({ getDatabaseFilePath: async () => mocks.live }));

const { COPY_KEYS_SETTING, openCopy } = await import("@/services/config/database-copy");
const { inspectDatabaseCopy } = await import("@/services/config/copy-inspect");
const { stageDatabaseRestore } = await import("@/services/config/restore-staging");

/** The last migration of v4.0.2, before the tenants. */
const LAST_OF_V402 = "20261011095131_dashboard_history_indexes";
const KEY_A = "a1".repeat(32);
const KEY_B = "b2".repeat(32);
const SECRET_A = "secret-of-the-old-dbackup-0123456789";
const SECRET_B = "secret-of-the-new-dbackup-9876543210";

let root = "";
let template = "";

function migrate(file: string, schema: string): void {
    execFileSync(path.join(process.cwd(), "node_modules", ".bin", "prisma"), ["migrate", "deploy", "--schema", schema], {
        env: { ...process.env, DATABASE_URL: `file:${file}` },
        stdio: "pipe",
    });
}

/** A database of v4.0.2 with a user in a group, a key, a connection and the keys of the DBackup it came from. */
async function copyOfV402(name: string): Promise<string> {
    const file = path.join(root, name);
    copyFileSync(template, file);
    const db = openCopy(file);
    const now = Date.now();
    const keyA = Buffer.from(KEY_A, "hex");
    // Written raw, since the client of this version names columns this schema does not have yet.
    await db.$executeRawUnsafe(`INSERT INTO "Group" ("id", "name", "permissions", "updatedAt") VALUES ('g-1', 'SuperAdmin', '[]', ?)`, now);
    await db.$executeRawUnsafe(
        `INSERT INTO "User" ("id", "name", "email", "emailVerified", "createdAt", "updatedAt", "twoFactorEnabled", "groupId") VALUES ('u-1', 'Anna', 'anna@example.ch', 1, ?, ?, 1, 'g-1')`,
        now,
        now
    );
    await db.$executeRawUnsafe(
        `INSERT INTO "TwoFactor" ("id", "secret", "backupCodes", "userId") VALUES ('tf-1', ?, ?, 'u-1')`,
        await symmetricEncrypt({ key: SECRET_A, data: "TOTPSECRET" }),
        await symmetricEncrypt({ key: SECRET_A, data: '["one"]' })
    );
    await db.$executeRawUnsafe(`INSERT INTO "Session" ("id", "token", "userId", "expiresAt", "createdAt", "updatedAt") VALUES ('s-1', 'token-1', 'u-1', ?, ?, ?)`, now + 86_400_000, now, now);
    await db.$executeRawUnsafe(`INSERT INTO "EncryptionProfile" ("id", "name", "secretKey", "updatedAt") VALUES ('key-1', 'Main key', ?, ?)`, encryptWithKey("ab".repeat(32), keyA), now);
    await db.$executeRawUnsafe(
        `INSERT INTO "AdapterConfig" ("id", "name", "type", "adapterId", "config", "updatedAt") VALUES ('db-1', 'Shop', 'database', 'mysql', ?, ?)`,
        JSON.stringify({ host: "db", password: encryptWithKey("s3cret", keyA) }),
        now
    );
    await db.$executeRawUnsafe(
        `INSERT INTO "SystemSetting" ("key", "value", "updatedAt") VALUES (?, ?, ?)`,
        COPY_KEYS_SETTING,
        JSON.stringify({ encryptionKey: KEY_A, authSecret: SECRET_A, version: "4.0.2", createdAt: "2026-10-12T03:00:00.000Z" }),
        now
    );
    await db.$disconnect();
    return file;
}

beforeAll(() => {
    root = mkdtempSync(path.join(os.tmpdir(), "dbackup-old-copy-"));
    // The migrations of v4.0.2 beside a schema file, which is all `migrate deploy` reads.
    const old = path.join(root, "v402", "prisma");
    mkdirSync(path.join(old, "migrations"), { recursive: true });
    copyFileSync(path.join(process.cwd(), "prisma", "schema.prisma"), path.join(old, "schema.prisma"));
    const migrations = path.join(process.cwd(), "prisma", "migrations");
    for (const entry of readdirSync(migrations, { withFileTypes: true })) {
        if (entry.isDirectory() ? entry.name <= LAST_OF_V402 : entry.name === "migration_lock.toml") {
            cpSync(path.join(migrations, entry.name), path.join(old, "migrations", entry.name), { recursive: true });
        }
    }
    template = path.join(root, "template.db");
    migrate(template, path.join(old, "schema.prisma"));
}, 120_000);

afterAll(() => {
    rmSync(root, { recursive: true, force: true });
});

beforeEach(() => {
    vi.stubEnv("ENCRYPTION_KEY", KEY_B);
    vi.stubEnv("BETTER_AUTH_SECRET", SECRET_B);
    mocks.restart.mockReset();
});

describe("a restore of a copy made by v4.0.2", () => {
    it("is built on a schema without tenants", async () => {
        const db = openCopy(await copyOfV402("schema.db"));
        const columns = await db.$queryRawUnsafe<{ name: string }[]>(`PRAGMA table_info("AuditLog")`);
        await db.$disconnect();

        expect(columns.map((column) => column.name)).not.toContain("tenantId");
    });

    it("says what the copy holds and reads the keys it carries", async () => {
        const { preview, keys } = await inspectDatabaseCopy(await copyOfV402("inspect.db"));

        expect(preview).toMatchObject({ kind: "database", version: "4.0.2", otherKeys: true, counts: { connections: 1, users: 1 } });
        expect(keys).toMatchObject({ encryptionKey: KEY_A, authSecret: SECRET_A });
    });

    it("notes the restore in the audit log of the copy, re-encrypts it and lays it down for the next start", async () => {
        const file = await copyOfV402("stage.db");
        const liveDir = path.join(root, "live");
        mkdirSync(liveDir, { recursive: true });
        mocks.live = path.join(liveDir, "dbackup.db");

        const { keys } = await inspectDatabaseCopy(file);
        await stageDatabaseRestore(file, keys, { actorName: "Manu", fileName: "config_backup.db.gz.enc" });

        const pending = path.join(liveDir, "restore-pending.db");
        expect(existsSync(pending)).toBe(true);
        expect(mocks.restart).toHaveBeenCalledTimes(1);

        // The next start migrates the copy, which gives the entry its tenant.
        migrate(pending, path.join(process.cwd(), "prisma", "schema.prisma"));
        const db = openCopy(pending);
        const entry = await db.auditLog.findFirst({ where: { action: "RESTORE" } });
        expect(entry).toMatchObject({ actorName: "Manu", resource: "SYSTEM", tenantId: "default" });
        expect(JSON.parse(entry?.details ?? "{}")).toEqual({ action: "config_restore", file: "config_backup.db.gz.enc", kind: "database" });
        expect(Math.abs(Date.now() - (entry?.createdAt.getTime() ?? 0))).toBeLessThan(60_000);
        const key = Buffer.from(KEY_B, "hex");
        expect(decryptWithKey((await db.encryptionProfile.findUniqueOrThrow({ where: { id: "key-1" } })).secretKey, key)).toBe("ab".repeat(32));
        expect(decryptWithKey(JSON.parse((await db.adapterConfig.findUniqueOrThrow({ where: { id: "db-1" } })).config).password, key)).toBe("s3cret");
        expect(await symmetricDecrypt({ key: SECRET_B, data: (await db.twoFactor.findUniqueOrThrow({ where: { id: "tf-1" } })).secret })).toBe("TOTPSECRET");
        expect(await db.session.count()).toBe(0);
        expect(await db.systemSetting.findUnique({ where: { key: COPY_KEYS_SETTING } })).toBeNull();
        expect(await db.tenantMembership.findMany({ select: { userId: true, tenantId: true } })).toEqual([{ userId: "u-1", tenantId: "default" }]);
        await db.$disconnect();
    });
});
