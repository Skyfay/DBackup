// @vitest-environment node
/**
 * The upgrade of a database of v4.0.2, before the tenants, with every migration of this version:
 * everything lands in the home tenant, the API keys keep what they could do like the groups, and the
 * rows the migrations write carry their times like the rows the app writes. What hangs off a user
 * survives the rebuild of the user table, and SuperAdmin becomes Admin, a group that had the name
 * before giving it up, whichever names are taken. An account whose owner set its email is
 * unverified, and a configuration backup of then finds its groups again.
 */
import { execFileSync } from "child_process";
import { copyFileSync, cpSync, mkdirSync, mkdtempSync, readdirSync, rmSync } from "fs";
import os from "os";
import path from "path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { openCopy } from "@/services/config/database-copy";
import { createImportContext } from "@/services/config/import-context";
import { importUsers } from "@/services/config/import-users";
import type { AppConfigurationBackup } from "@/lib/types/config-backup";
import type { Tx } from "@/lib/prisma-tx";

/** The last migration of v4.0.2, before the tenants. */
const LAST_OF_V402 = "20261011095131_dashboard_history_indexes";

let root = "";
let upgraded = "";
/** A database of v4.0.2 that already has a group named Admin beside SuperAdmin. */
let clash = "";
/** A database of v4.0.2 whose groups take Admin and both names Admin gives way to beside SuperAdmin. */
let crowded = "";
/** A database of v4.0.2 whose log holds changes of the emails of its accounts. */
let emails = "";

function migrate(file: string, schema: string): void {
    execFileSync(path.join(process.cwd(), "node_modules", ".bin", "prisma"), ["migrate", "deploy", "--schema", schema], {
        env: { ...process.env, DATABASE_URL: `file:${file}` },
        stdio: "pipe",
    });
}

/** The users of a database of v4.0.2 with what they sign in with, written raw, since the client of this version names columns this schema does not have yet. */
async function seed(file: string, groups: { id: string; name: string; permissions: string[] }[], members: Record<string, string>): Promise<void> {
    const db = openCopy(file);
    const now = Date.now();
    for (const group of groups) {
        await db.$executeRawUnsafe(`INSERT INTO "Group" ("id", "name", "permissions", "updatedAt") VALUES (?, ?, ?, ?)`, group.id, group.name, JSON.stringify(group.permissions), now);
    }
    for (const [user, group] of Object.entries(members)) {
        await db.$executeRawUnsafe(
            `INSERT INTO "User" ("id", "name", "email", "emailVerified", "createdAt", "updatedAt", "twoFactorEnabled", "groupId") VALUES (?, ?, ?, 1, ?, ?, 1, ?)`,
            user,
            user,
            `${user}@example.ch`,
            now,
            now,
            group
        );
        await db.$executeRawUnsafe(
            `INSERT INTO "Session" ("id", "expiresAt", "token", "createdAt", "updatedAt", "userId") VALUES (?, ?, ?, ?, ?, ?)`,
            `s-${user}`,
            now + 86_400_000,
            `token-${user}`,
            now,
            now,
            user
        );
        await db.$executeRawUnsafe(
            `INSERT INTO "Account" ("id", "accountId", "providerId", "userId", "password", "createdAt", "updatedAt") VALUES (?, ?, 'credential', ?, 'hash', ?, ?)`,
            `a-${user}`,
            user,
            user,
            now,
            now
        );
        await db.$executeRawUnsafe(
            `INSERT INTO "Passkey" ("id", "publicKey", "userId", "credentialID", "counter", "deviceType", "backedUp") VALUES (?, 'key', ?, ?, 0, 'singleDevice', 0)`,
            `p-${user}`,
            user,
            `cred-${user}`
        );
        await db.$executeRawUnsafe(`INSERT INTO "TwoFactor" ("id", "secret", "backupCodes", "userId") VALUES (?, 'secret', 'codes', ?)`, `t-${user}`, user);
        await db.$executeRawUnsafe(`INSERT INTO "Avatar" ("userId", "mimeType", "size", "data", "updatedAt") VALUES (?, 'image/png', 4, X'89504E47', ?)`, user, now);
    }
    await db.$disconnect();
}

/**
 * The emails the accounts have now and what the log of v4.0.2 says about them. The profile logs the
 * change with what it was, the dialog of the users the email it saved, and the creation the email.
 */
async function seedEmailLog(file: string): Promise<void> {
    const db = openCopy(file);
    const current: Record<string, string> = {
        "u-profile": "profile-new@example.ch",
        "u-dialog": "dialog-new@example.ch",
        "u-later-admin": "later@example.ch",
        "u-setup-moved": "setup-new@example.ch",
    };
    for (const [user, email] of Object.entries(current)) await db.$executeRawUnsafe(`UPDATE "User" SET "email" = ? WHERE "id" = ?`, email, user);
    const start = Date.now() - 86_400_000;
    const entries: [string, string, string, string, unknown][] = [
        ["u-admin", "CREATE", "USER", "u-dialog", { name: "u-dialog", email: "u-dialog@example.ch", groupId: "g-ops" }],
        ["u-admin", "CREATE", "USER", "u-resave", { name: "u-resave", email: "u-resave@example.ch", groupId: "g-ops" }],
        // Changed in the profile, then only the name.
        ["u-profile", "UPDATE", "USER", "u-profile", { name: "u-profile", changes: [{ field: "Email", from: "u-profile@example.ch", to: "profile-new@example.ch" }] }],
        ["u-profile", "UPDATE", "USER", "u-profile", { name: "Paula", changes: [{ field: "Name", from: "u-profile", to: "Paula" }] }],
        // Changed in the dialog of the users, which names the email.
        ["u-dialog", "UPDATE", "USER", "u-dialog", { name: "u-dialog", email: "dialog-new@example.ch" }],
        // Changed by its owner, then by an admin.
        ["u-later-admin", "UPDATE", "USER", "u-later-admin", { name: "u-later-admin", changes: [{ field: "Email", from: "u-later-admin@example.ch", to: "mine@example.ch" }] }],
        ["u-admin", "UPDATE", "USER", "u-later-admin", { name: "u-later-admin", email: "later@example.ch" }],
        // Saved in the dialog with the email the admin gave it, a new name only.
        ["u-resave", "UPDATE", "USER", "u-resave", { name: "Renamed", email: "u-resave@example.ch" }],
        // Changed by its owner to an email it no longer has.
        ["u-elsewhere", "UPDATE", "USER", "u-elsewhere", { name: "u-elsewhere", changes: [{ field: "Email", from: "u-elsewhere@example.ch", to: "picked@example.ch" }] }],
        ["u-untouched", "UPDATE", "USER", "u-untouched", "no json"],
        // The first account, made at setup with no entry of its own, saved in the dialog with its email, a new name only.
        ["u-setup", "UPDATE", "USER", "u-setup", { name: "Setup Admin", email: "u-setup@example.ch" }],
        // Made at setup too, saved in the dialog as it was, then with a new email.
        ["u-setup-moved", "UPDATE", "USER", "u-setup-moved", { name: "u-setup-moved", email: "u-setup-moved@example.ch" }],
        ["u-setup-moved", "UPDATE", "USER", "u-setup-moved", { name: "u-setup-moved", email: "setup-new@example.ch" }],
    ];
    let n = 0;
    for (const [userId, action, resource, resourceId, details] of entries) {
        n++;
        await db.$executeRawUnsafe(
            `INSERT INTO "AuditLog" ("id", "userId", "action", "resource", "resourceId", "details", "createdAt") VALUES (?, ?, ?, ?, ?, ?, ?)`,
            `log-${n}`,
            userId,
            action,
            resource,
            resourceId,
            typeof details === "string" ? details : JSON.stringify(details),
            start + n * 60_000
        );
    }
    await db.$disconnect();
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
    const empty = path.join(root, "v402.db");
    migrate(empty, path.join(old, "schema.prisma"));
    upgraded = path.join(root, "upgraded.db");
    clash = path.join(root, "clash.db");
    crowded = path.join(root, "crowded.db");
    copyFileSync(empty, upgraded);
    copyFileSync(empty, clash);
    copyFileSync(empty, crowded);
    emails = path.join(root, "emails.db");
    copyFileSync(empty, emails);

    await seed(
        upgraded,
        [
            { id: "g-admin", name: "SuperAdmin", permissions: [] },
            { id: "g-ops", name: "Ops", permissions: ["settings:read", "settings:write", "jobs:write"] },
        ],
        { "u-1": "g-admin", "u-2": "g-ops" }
    );
    const db = openCopy(upgraded);
    const now = Date.now();
    await db.$executeRawUnsafe(
        `INSERT INTO "ApiKey" ("id", "name", "prefix", "hashedKey", "permissions", "userId", "createdAt") VALUES ('k-auto', 'Automation', 'dbk_a', 'h-a', '["jobs:write","settings:write"]', 'u-1', ?)`,
        now
    );
    await db.$executeRawUnsafe(
        `INSERT INTO "ApiKey" ("id", "name", "prefix", "hashedKey", "permissions", "userId", "createdAt") VALUES ('k-read', 'Reader', 'dbk_r', 'h-r', '["jobs:read"]', 'u-2', ?)`,
        now
    );
    await db.$disconnect();

    await seed(
        clash,
        [
            { id: "g-admin", name: "SuperAdmin", permissions: [] },
            { id: "g-named-admin", name: "Admin", permissions: ["jobs:read"] },
        ],
        { "u-1": "g-admin", "u-2": "g-named-admin" }
    );

    await seed(
        crowded,
        [
            { id: "g-super-1234", name: "SuperAdmin", permissions: [] },
            { id: "g-named-admin", name: "Admin", permissions: ["jobs:read"] },
            { id: "g-before", name: "Admin (before update)", permissions: ["jobs:read"] },
            { id: "g-was-super", name: "Admin (was SuperAdmin)", permissions: ["jobs:read"] },
        ],
        { "u-1": "g-super-1234", "u-2": "g-named-admin", "u-3": "g-was-super" }
    );

    await seed(
        emails,
        [
            { id: "g-admin", name: "SuperAdmin", permissions: [] },
            { id: "g-ops", name: "Ops", permissions: ["jobs:read"] },
        ],
        Object.fromEntries(["u-admin", "u-profile", "u-dialog", "u-later-admin", "u-resave", "u-elsewhere", "u-untouched", "u-setup", "u-setup-moved"].map((user) => [user, user === "u-admin" ? "g-admin" : "g-ops"]))
    );
    await seedEmailLog(emails);

    migrate(upgraded, path.join(process.cwd(), "prisma", "schema.prisma"));
    migrate(clash, path.join(process.cwd(), "prisma", "schema.prisma"));
    migrate(crowded, path.join(process.cwd(), "prisma", "schema.prisma"));
    migrate(emails, path.join(process.cwd(), "prisma", "schema.prisma"));
}, 240_000);

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

    it("keeps the sessions, sign-ins, passkeys, second factors, API keys and avatars of every user through the rebuild of the user table", async () => {
        const db = openCopy(upgraded);
        const owners = async (rows: Promise<{ userId: string }[]>) => (await rows).map((row) => row.userId).sort();
        const found = {
            sessions: await owners(db.session.findMany({ select: { userId: true } })),
            accounts: await owners(db.account.findMany({ select: { userId: true } })),
            passkeys: await owners(db.passkey.findMany({ select: { userId: true } })),
            twoFactors: await owners(db.twoFactor.findMany({ select: { userId: true } })),
            apiKeys: await owners(db.apiKey.findMany({ select: { userId: true } })),
            avatars: await owners(db.avatar.findMany({ select: { userId: true } })),
        };
        const users = await db.user.findMany({ select: { id: true, twoFactorEnabled: true }, orderBy: { id: "asc" } });
        const dangling = await db.$queryRawUnsafe<unknown[]>(`PRAGMA foreign_key_check`);
        await db.$disconnect();

        expect(users).toEqual([
            { id: "u-1", twoFactorEnabled: true },
            { id: "u-2", twoFactorEnabled: true },
        ]);
        for (const rows of Object.values(found)) expect(rows).toEqual(["u-1", "u-2"]);
        expect(dangling).toEqual([]);
    });

    it("renames SuperAdmin to Admin with every permission of the home tenant", async () => {
        const db = openCopy(upgraded);
        const group = await db.group.findUniqueOrThrow({ where: { id: "g-admin" }, select: { name: true, fullAccess: true, tenantId: true } });
        const member = await db.tenantMembership.findUniqueOrThrow({ where: { userId_tenantId: { userId: "u-1", tenantId: "default" } }, select: { groupId: true } });
        await db.$disconnect();

        expect(group).toEqual({ name: "Admin", fullAccess: true, tenantId: "default" });
        expect(member.groupId).toBe("g-admin");
    });

    it("names SuperAdmin Admin when a group Admin exists, which becomes Admin (before update) with its members", async () => {
        const db = openCopy(clash);
        const groups = await db.group.findMany({ select: { id: true, name: true, fullAccess: true }, orderBy: { id: "asc" } });
        const memberships = await db.tenantMembership.findMany({ select: { userId: true, groupId: true }, orderBy: { userId: "asc" } });
        const users = await db.user.findMany({ select: { id: true, platformRole: true }, orderBy: { id: "asc" } });
        await db.$disconnect();

        expect(groups).toEqual([
            { id: "g-admin", name: "Admin", fullAccess: true },
            { id: "g-named-admin", name: "Admin (before update)", fullAccess: false },
        ]);
        expect(memberships).toEqual([
            { userId: "u-1", groupId: "g-admin" },
            { userId: "u-2", groupId: "g-named-admin" },
        ]);
        expect(users).toEqual([
            { id: "u-1", platformRole: "ADMIN" },
            { id: "u-2", platformRole: null },
        ]);
    });

    it("names a group Admin after its id when a group has the name it gives way to, instead of stopping the upgrade half way", async () => {
        const db = openCopy(crowded);
        const groups = await db.group.findMany({ select: { id: true, name: true, fullAccess: true }, orderBy: { id: "asc" } });
        const users = await db.user.findMany({ select: { id: true, platformRole: true }, orderBy: { id: "asc" } });
        await db.$disconnect();

        expect(groups).toEqual([
            { id: "g-before", name: "Admin (before update)", fullAccess: false },
            { id: "g-named-admin", name: "Admin (before update g-named-)", fullAccess: false },
            { id: "g-super-1234", name: "Admin", fullAccess: true },
            { id: "g-was-super", name: "Admin (was SuperAdmin)", fullAccess: false },
        ]);
        expect(users).toEqual([
            { id: "u-1", platformRole: "ADMIN" },
            { id: "u-2", platformRole: null },
            { id: "u-3", platformRole: null },
        ]);
    });

    it("unverifies the email of an account whose owner set the email it has, unless an admin changed it later", async () => {
        const db = openCopy(emails);
        const users = await db.user.findMany({ select: { id: true, emailVerified: true }, orderBy: { id: "asc" } });
        await db.$disconnect();

        expect(Object.fromEntries(users.map((user) => [user.id, user.emailVerified]))).toEqual({
            "u-admin": true,
            "u-dialog": false,
            "u-elsewhere": true,
            "u-later-admin": true,
            "u-profile": false,
            "u-resave": true,
            "u-setup": true,
            "u-setup-moved": false,
            "u-untouched": true,
        });
    });

    it("writes the times of the templates and presets an installation starts with as the app does", async () => {
        const db = openCopy(upgraded);
        const kinds = await db.$queryRawUnsafe<{ kind: string }[]>(
            ["RetentionPolicy", "NamingTemplate", "SchedulePreset", "ExcludePatternPreset"]
                .map((table) => `SELECT typeof("createdAt") AS kind FROM "${table}" UNION ALL SELECT typeof("updatedAt") FROM "${table}"`)
                .join(" UNION ALL ")
        );
        const policy = await db.retentionPolicy.findFirstOrThrow({ orderBy: { createdAt: "asc" } });
        await db.$disconnect();

        expect(kinds.length).toBeGreaterThan(0);
        expect(new Set(kinds.map((row) => row.kind))).toEqual(new Set(["integer"]));
        expect(Math.abs(Date.now() - policy.createdAt.getTime())).toBeLessThan(10 * 60_000);
    });
});

describe("a configuration backup of v4.0.2 restored after the upgrade", () => {
    it("brings its group Admin back into the group of the same id, now Admin (before update), not into the group with every permission", async () => {
        const file = path.join(root, "restored.db");
        copyFileSync(clash, file);
        const db = openCopy(file);
        const now = new Date();
        const data = {
            groups: [{ id: "g-named-admin", name: "Admin", permissions: '["jobs:read","jobs:write"]', createdAt: now, updatedAt: now }],
            users: [{ id: "u-2", name: "u-2", email: "u-2@example.ch", emailVerified: true, createdAt: now, updatedAt: now, twoFactorEnabled: true, groupId: "g-named-admin", accounts: [] }],
            apiKeys: [],
        } as unknown as AppConfigurationBackup;
        const ctx = createImportContext(db as unknown as Tx, data, { settings: false, adapters: false, jobs: false, users: true, sso: false, profiles: false, statistics: false });

        // The client of a copy has none of the extensions of the app, which the type of a transaction names.
        await db.$transaction((tx) => importUsers({ ...ctx, tx: tx as unknown as Tx }));
        const groups = await db.group.findMany({ select: { id: true, name: true, permissions: true, fullAccess: true }, orderBy: { id: "asc" } });
        const member = await db.tenantMembership.findUniqueOrThrow({ where: { userId_tenantId: { userId: "u-2", tenantId: "default" } }, select: { groupId: true } });
        await db.$disconnect();

        expect(groups.map(({ id, name, fullAccess }) => ({ id, name, fullAccess }))).toEqual([
            { id: "g-admin", name: "Admin", fullAccess: true },
            { id: "g-named-admin", name: "Admin (before update)", fullAccess: false },
        ]);
        expect(JSON.parse(groups[1].permissions)).toEqual(["jobs:read", "jobs:write"]);
        expect(member.groupId).toBe("g-named-admin");
        expect(ctx.notes).toEqual(["The group Admin of the file came back as Admin (before update), since another group is named Admin here."]);
    });
});
