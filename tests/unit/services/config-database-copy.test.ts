// @vitest-environment node
/**
 * The configuration backup as a copy of the database, against real SQLite files migrated with
 * the migrations of this version: what the copy leaves out and carries, how a restore checks it,
 * encrypts its secrets again for another DBackup and lays it beside the live database.
 */
import { execFileSync } from "child_process";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, rmSync } from "fs";
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
vi.mock("@/services/system/database-service", async () => {
    const { copyFile } = await import("fs/promises");
    return {
        // VACUUM INTO of the live database, a plain copy of the test file here.
        createDatabaseSnapshot: async () => {
            const tempFile = `${mocks.live}.snapshot-${Date.now()}`;
            await copyFile(mocks.live, tempFile);
            return { tempFile, fileName: "snapshot.db", sizeBytes: 0 };
        },
        getDatabaseFilePath: async () => mocks.live,
    };
});

const { COPY_KEYS_SETTING, createConfigCopy, openCopy } = await import("@/services/config/database-copy");
const { inspectDatabaseCopy, isDatabaseCopy } = await import("@/services/config/copy-inspect");
const { stageDatabaseRestore } = await import("@/services/config/restore-staging");

const KEY_A = "a1".repeat(32);
const KEY_B = "b2".repeat(32);
const SECRET_A = "secret-of-the-old-dbackup-0123456789";
const SECRET_B = "secret-of-the-new-dbackup-9876543210";

let root = "";
let template = "";

/** A fresh database of this version, seeded like a DBackup made with KEY_A and SECRET_A. */
async function oldDatabase(name: string, { withKeys = true } = {}): Promise<string> {
    const file = path.join(root, name);
    copyFileSync(template, file);
    const db = openCopy(file);
    const now = new Date();
    await db.encryptionProfile.create({ data: { id: "key-1", name: "Main key", secretKey: encryptWithKey("ab".repeat(32), Buffer.from(KEY_A, "hex")) } });
    await db.credentialProfile.create({ data: { id: "cred-1", name: "NAS login", type: "USERNAME_PASSWORD", data: encryptWithKey('{"password":"hunter2"}', Buffer.from(KEY_A, "hex")) } });
    await db.adapterConfig.create({
        data: { id: "db-1", name: "Shop", type: "database", adapterId: "mysql", config: JSON.stringify({ host: "db", port: 3306, password: encryptWithKey("s3cret", Buffer.from(KEY_A, "hex")) }) },
    });
    await db.user.create({ data: { id: "u-1", name: "Anna", email: "anna@example.ch", emailVerified: true, twoFactorEnabled: true, createdAt: now, updatedAt: now } });
    await db.twoFactor.create({
        data: { id: "tf-1", userId: "u-1", secret: await symmetricEncrypt({ key: SECRET_A, data: "TOTPSECRET" }), backupCodes: await symmetricEncrypt({ key: SECRET_A, data: '["one","two"]' }) },
    });
    await db.session.create({ data: { id: "s-1", token: "token-1", userId: "u-1", expiresAt: new Date(Date.now() + 86_400_000), createdAt: now, updatedAt: now } });
    await db.execution.create({ data: { type: "Backup", status: "Success", startedAt: now, logs: "[]" } });
    if (withKeys) {
        await db.systemSetting.create({ data: { key: COPY_KEYS_SETTING, value: JSON.stringify({ encryptionKey: KEY_A, authSecret: SECRET_A, version: "3.4.0", createdAt: "2026-09-29T03:00:00.000Z" }) } });
    }
    await db.$disconnect();
    return file;
}

beforeAll(() => {
    root = mkdtempSync(path.join(os.tmpdir(), "dbackup-copy-"));
    template = path.join(root, "template.db");
    execFileSync(path.join(process.cwd(), "node_modules", ".bin", "prisma"), ["migrate", "deploy"], {
        env: { ...process.env, DATABASE_URL: `file:${template}` },
        stdio: "pipe",
    });
}, 120_000);

afterAll(() => {
    rmSync(root, { recursive: true, force: true });
});

beforeEach(() => {
    vi.stubEnv("ENCRYPTION_KEY", KEY_B);
    vi.stubEnv("BETTER_AUTH_SECRET", SECRET_B);
    mocks.restart.mockReset();
});

describe("the copy a configuration backup uploads", () => {
    it("leaves sign-ins and, without the history, the runs out, and carries the keys of this DBackup", async () => {
        mocks.live = await oldDatabase("live-for-copy.db");

        const copy = await createConfigCopy({ includeHistory: false });

        expect(await isDatabaseCopy(copy.file)).toBe(true);
        const db = openCopy(copy.file);
        expect(await db.session.count()).toBe(0);
        expect(await db.execution.count()).toBe(0);
        expect(await db.adapterConfig.count()).toBe(1);
        const keys = JSON.parse((await db.systemSetting.findUniqueOrThrow({ where: { key: COPY_KEYS_SETTING } })).value);
        expect(keys).toMatchObject({ encryptionKey: KEY_B, authSecret: SECRET_B });
        await db.$disconnect();
    });

    it("keeps the runs with Include the history", async () => {
        mocks.live = await oldDatabase("live-with-history.db");

        const copy = await createConfigCopy({ includeHistory: true });

        const db = openCopy(copy.file);
        expect(await db.execution.count()).toBe(1);
        await db.$disconnect();
    });
});

describe("a restore of a copy", () => {
    it("says what the copy holds and that it comes from a DBackup with other keys", async () => {
        const file = await oldDatabase("inspect.db");

        const { preview, keys } = await inspectDatabaseCopy(file);

        expect(preview).toMatchObject({ kind: "database", version: "3.4.0", otherKeys: true, counts: { connections: 1, jobs: 0, users: 1, runs: 1 } });
        expect(keys).toMatchObject({ encryptionKey: KEY_A, authSecret: SECRET_A });
    });

    it("refuses a copy of a newer DBackup, which knows a migration this one does not", async () => {
        const file = await oldDatabase("newer.db");
        const db = openCopy(file);
        await db.$executeRawUnsafe(
            `INSERT INTO "_prisma_migrations" (id, checksum, finished_at, migration_name, applied_steps_count) VALUES ('x', 'x', CURRENT_TIMESTAMP, '29990101000000_from_the_future', 1)`
        );
        await db.$disconnect();

        await expect(inspectDatabaseCopy(file)).rejects.toThrow("newer DBackup, v3.4.0");
    });

    it("refuses a copy without its keys whose secrets the key of this DBackup does not open", async () => {
        const file = await oldDatabase("no-keys.db", { withKeys: false });

        await expect(inspectDatabaseCopy(file)).rejects.toThrow("another ENCRYPTION_KEY");
    });

    it("encrypts every secret again for this DBackup, drops sign-ins, the keys and triggers, notes itself and restarts", async () => {
        const file = await oldDatabase("stage.db");
        const setup = openCopy(file);
        await setup.$executeRawUnsafe(`CREATE TRIGGER wipe AFTER INSERT ON "Group" BEGIN DELETE FROM "User"; END`);
        await setup.$disconnect();
        const liveDir = path.join(root, "live");
        mkdirSync(liveDir, { recursive: true });
        mocks.live = path.join(liveDir, "dbackup.db");

        const { keys } = await inspectDatabaseCopy(file);
        await stageDatabaseRestore(file, keys, { actorName: "Manu", fileName: "config_backup.db.gz.enc" });

        const pending = path.join(liveDir, "restore-pending.db");
        expect(existsSync(pending)).toBe(true);
        expect(mocks.restart).toHaveBeenCalledTimes(1);

        const db = openCopy(pending);
        const key = Buffer.from(KEY_B, "hex");
        expect(decryptWithKey((await db.encryptionProfile.findUniqueOrThrow({ where: { id: "key-1" } })).secretKey, key)).toBe("ab".repeat(32));
        expect(decryptWithKey((await db.credentialProfile.findUniqueOrThrow({ where: { id: "cred-1" } })).data, key)).toBe('{"password":"hunter2"}');
        const config = JSON.parse((await db.adapterConfig.findUniqueOrThrow({ where: { id: "db-1" } })).config);
        expect(config.host).toBe("db");
        expect(decryptWithKey(config.password, key)).toBe("s3cret");
        const factor = await db.twoFactor.findUniqueOrThrow({ where: { id: "tf-1" } });
        expect(await symmetricDecrypt({ key: SECRET_B, data: factor.secret })).toBe("TOTPSECRET");
        expect(await symmetricDecrypt({ key: SECRET_B, data: factor.backupCodes })).toBe('["one","two"]');
        expect(await db.session.count()).toBe(0);
        expect(await db.systemSetting.findUnique({ where: { key: COPY_KEYS_SETTING } })).toBeNull();
        expect(await db.$queryRawUnsafe<unknown[]>(`SELECT name FROM sqlite_master WHERE type = 'trigger'`)).toEqual([]);
        expect(await db.auditLog.findFirst({ where: { action: "RESTORE" } })).toMatchObject({ actorName: "Manu", resource: "SYSTEM" });
        await db.$disconnect();
    });
});
