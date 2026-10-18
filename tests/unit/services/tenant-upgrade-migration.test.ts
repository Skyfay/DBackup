// @vitest-environment node
/**
 * The upgrade of a database of v4.0.2, before the tenants, with every migration of this version:
 * everything lands in the home tenant, the API keys keep what they could do like the groups, and the
 * rows the migrations write carry their times like the rows the app writes.
 */
import { execFileSync } from "child_process";
import { copyFileSync, cpSync, mkdirSync, mkdtempSync, readdirSync, rmSync } from "fs";
import os from "os";
import path from "path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { openCopy } from "@/services/config/database-copy";

/** The last migration of v4.0.2, before the tenants. */
const LAST_OF_V402 = "20261011095131_dashboard_history_indexes";

let root = "";
let upgraded = "";

function migrate(file: string, schema: string): void {
    execFileSync(path.join(process.cwd(), "node_modules", ".bin", "prisma"), ["migrate", "deploy", "--schema", schema], {
        env: { ...process.env, DATABASE_URL: `file:${file}` },
        stdio: "pipe",
    });
}

beforeAll(async () => {
    root = mkdtempSync(path.join(os.tmpdir(), "dbackup-upgrade-"));
    const old = path.join(root, "v402", "prisma");
    mkdirSync(path.join(old, "migrations"), { recursive: true });
    copyFileSync(path.join(process.cwd(), "prisma", "schema.prisma"), path.join(old, "schema.prisma"));
    const migrations = path.join(process.cwd(), "prisma", "migrations");
    for (const entry of readdirSync(migrations, { withFileTypes: true })) {
        if (entry.isDirectory() ? entry.name <= LAST_OF_V402 : entry.name === "migration_lock.toml") {
            cpSync(path.join(migrations, entry.name), path.join(old, "migrations", entry.name), { recursive: true });
        }
    }
    upgraded = path.join(root, "upgraded.db");
    migrate(upgraded, path.join(old, "schema.prisma"));

    // Written raw, since the client of this version names columns this schema does not have yet.
    const db = openCopy(upgraded);
    const now = Date.now();
    await db.$executeRawUnsafe(`INSERT INTO "Group" ("id", "name", "permissions", "updatedAt") VALUES ('g-admin', 'SuperAdmin', '[]', ?)`, now);
    await db.$executeRawUnsafe(`INSERT INTO "Group" ("id", "name", "permissions", "updatedAt") VALUES ('g-ops', 'Ops', '["settings:read","settings:write","jobs:write"]', ?)`, now);
    await db.$executeRawUnsafe(
        `INSERT INTO "User" ("id", "name", "email", "emailVerified", "createdAt", "updatedAt", "twoFactorEnabled", "groupId") VALUES ('u-1', 'Anna', 'anna@example.ch', 1, ?, ?, 0, 'g-admin')`,
        now,
        now
    );
    await db.$executeRawUnsafe(
        `INSERT INTO "ApiKey" ("id", "name", "prefix", "hashedKey", "permissions", "userId", "createdAt") VALUES ('k-auto', 'Automation', 'dbk_a', 'h-a', '["jobs:write","settings:write"]', 'u-1', ?)`,
        now
    );
    await db.$executeRawUnsafe(
        `INSERT INTO "ApiKey" ("id", "name", "prefix", "hashedKey", "permissions", "userId", "createdAt") VALUES ('k-read', 'Reader', 'dbk_r', 'h-r', '["jobs:read"]', 'u-1', ?)`,
        now
    );
    await db.$disconnect();

    migrate(upgraded, path.join(process.cwd(), "prisma", "schema.prisma"));
}, 180_000);

afterAll(() => {
    rmSync(root, { recursive: true, force: true });
});

describe("the upgrade of a database from before the tenants", () => {
    it("gives an API key that could change the settings the tenant settings, like a group, and leaves the others alone", async () => {
        const db = openCopy(upgraded);
        const keys = await db.apiKey.findMany({ select: { id: true, permissions: true, tenantId: true }, orderBy: { id: "asc" } });
        const group = await db.group.findUniqueOrThrow({ where: { id: "g-ops" }, select: { permissions: true } });
        await db.$disconnect();

        expect(keys.map((key) => key.tenantId)).toEqual(["default", "default"]);
        expect(JSON.parse(keys[0].permissions)).toEqual(["jobs:write", "settings:write", "tenant-settings:write"]);
        expect(JSON.parse(keys[1].permissions)).toEqual(["jobs:read"]);
        expect(JSON.parse(group.permissions)).toEqual(expect.arrayContaining(["tenant-settings:read", "tenant-settings:write"]));
    });

    it("writes the times of the home tenant, its memberships and its groups as the app does, so they sort with the rows it writes", async () => {
        const db = openCopy(upgraded);
        const kinds = await db.$queryRawUnsafe<{ kind: string }[]>(
            `SELECT typeof("createdAt") AS kind FROM "Tenant" UNION ALL SELECT typeof("updatedAt") FROM "Tenant"
             UNION ALL SELECT typeof("createdAt") FROM "TenantMembership"
             UNION ALL SELECT typeof("createdAt") FROM "Group" UNION ALL SELECT typeof("updatedAt") FROM "Group"`
        );
        const tenant = await db.tenant.findUniqueOrThrow({ where: { id: "default" } });
        await db.$disconnect();

        expect(new Set(kinds.map((row) => row.kind))).toEqual(new Set(["integer"]));
        expect(Math.abs(Date.now() - tenant.createdAt.getTime())).toBeLessThan(10 * 60_000);
    });

    it("makes the member of SuperAdmin a platform admin in the home tenant", async () => {
        const db = openCopy(upgraded);
        const user = await db.user.findUniqueOrThrow({ where: { id: "u-1" }, select: { platformRole: true, memberships: { select: { tenantId: true } } } });
        await db.$disconnect();

        expect(user.platformRole).toBe("ADMIN");
        expect(user.memberships).toEqual([{ tenantId: "default" }]);
    });
});
