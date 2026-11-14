// @vitest-environment node
/**
 * Deleting a tenant against a real SQLite database migrated with the migrations of this version:
 * an account a customer made, which worked in the deleted tenant alone, never comes to the home
 * tenant with the password, the sessions or the second factors its maker chose, and with an email
 * a sign-in provider of the platform would link. Accounts that also work elsewhere, or that the
 * platform holds, stay as they are.
 */
import { execFileSync } from "child_process";
import { mkdtempSync, rmSync } from "fs";
import os from "os";
import path from "path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PrismaClient } from "@prisma/client";
import { tenantScopeExtension } from "@/lib/tenant/prisma-scope";

const holder = vi.hoisted(() => ({ client: undefined as unknown }));

vi.mock("@/lib/logging/logger", () => ({
    logger: { child: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }) },
}));
vi.mock("@/lib/prisma", () => ({ get default() { return holder.client; } }));
vi.mock("@/services/storage/storage-service", () => ({ storageService: { readCachedListing: vi.fn(async () => null) } }));
vi.mock("@/lib/server/scheduler", () => ({ scheduler: { refresh: vi.fn() } }));
vi.mock("@/services/dashboard/cache", () => ({ invalidateDashboardCache: vi.fn() }));
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

let root = "";
let base: PrismaClient;

const now = new Date("2026-10-15T10:00:00.000Z");
const later = new Date("2026-12-15T10:00:00.000Z");

/** An account with a password, an open session, an authenticator app and a passkey, in these tenants. */
async function seedAccount(id: string, tenants: string[], platform: { platformRole?: string; platformGroupId?: string } = {}) {
    await base.user.create({
        data: { id, name: id, email: `${id}@msp.test`, emailVerified: true, twoFactorEnabled: true, passkeyTwoFactor: true, createdAt: now, updatedAt: now, ...platform },
    });
    for (const tenantId of tenants) await base.tenantMembership.create({ data: { userId: id, tenantId, groupId: `${tenantId}-group` } });
    await base.account.create({ data: { id: `cred-${id}`, accountId: id, providerId: "credential", userId: id, password: "hash-set-by-customer", createdAt: now, updatedAt: now } });
    await base.session.create({ data: { id: `sess-${id}`, token: `token-${id}`, userId: id, activeTenantId: tenants[0] ?? null, expiresAt: later, createdAt: now, updatedAt: now } });
    await base.twoFactor.create({ data: { id: `totp-${id}`, userId: id, secret: "not-a-real-secret", backupCodes: "[]", verified: true } });
    await base.passkey.create({ data: { id: `pk-${id}`, userId: id, publicKey: "key", credentialID: `cid-${id}`, counter: 0, deviceType: "singleDevice", backedUp: false } });
}

const signInOf = async (id: string) => {
    const user = await base.user.findUniqueOrThrow({
        where: { id },
        select: { emailVerified: true, twoFactorEnabled: true, passkeyTwoFactor: true, memberships: { select: { tenantId: true } }, accounts: { select: { id: true } }, sessions: { select: { id: true } }, twoFactor: { select: { id: true } }, passkeys: { select: { id: true } } },
    });
    return {
        emailVerified: user.emailVerified,
        secondFactor: !!user.twoFactorEnabled || !!user.passkeyTwoFactor,
        tenants: user.memberships.map((membership) => membership.tenantId),
        credentials: user.accounts.length,
        sessions: user.sessions.length,
        factors: (user.twoFactor ? 1 : 0) + user.passkeys.length,
    };
};

const UNTOUCHED = { emailVerified: true, secondFactor: true, credentials: 1, sessions: 1, factors: 2 };

beforeAll(async () => {
    root = mkdtempSync(path.join(os.tmpdir(), "dbackup-tenant-delete-accounts-"));
    const file = path.join(root, "tenants.db");
    execFileSync(path.join(process.cwd(), "node_modules", ".bin", "prisma"), ["migrate", "deploy"], {
        env: { ...process.env, DATABASE_URL: `file:${file}` },
        stdio: "pipe",
    });
    base = new PrismaClient({ datasources: { db: { url: `file:${file}` } } });
    holder.client = base.$extends(tenantScopeExtension(async () => null));
    for (const tenantId of ["cust-a", "cust-b"]) {
        await base.tenant.create({ data: { id: tenantId, name: tenantId } });
        await base.group.create({ data: { tenantId, id: `${tenantId}-group`, name: "Operators", permissions: "[]" } });
    }
    await base.platformGroup.create({ data: { id: "pg-tech", name: "Technicians" } });
    await seedAccount("v-plant", ["cust-a"]);
    await seedAccount("v-both", ["cust-a", "cust-b"]);
    await seedAccount("v-live", ["cust-b"]);
    await seedAccount("v-tech", ["cust-a"], { platformGroupId: "pg-tech" });
    await seedAccount("v-admin", ["cust-a"], { platformRole: "ADMIN" });
    await seedAccount("v-none", []);
    await tenantService.delete("cust-a", new Date("2026-10-20T10:00:00.000Z"));
}, 120_000);

afterAll(async () => {
    await base?.$disconnect();
    if (root) rmSync(root, { recursive: true, force: true });
});

describe("the accounts of a deleted customer tenant", () => {
    it("leaves an account that worked there alone without a password, a session, a second factor or a verified email", async () => {
        expect(await signInOf("v-plant")).toEqual({ emailVerified: false, secondFactor: false, tenants: [], credentials: 0, sessions: 0, factors: 0 });
    });

    it("keeps the sign-in of an account that also works in another tenant", async () => {
        expect(await signInOf("v-both")).toEqual({ ...UNTOUCHED, tenants: ["cust-b"] });
    });

    it("keeps the sign-in of the people of the platform who worked in it", async () => {
        for (const id of ["v-tech", "v-admin"]) expect(await signInOf(id), id).toEqual({ ...UNTOUCHED, tenants: [] });
    });

    it("touches no account of another tenant or of no tenant", async () => {
        expect(await signInOf("v-live")).toEqual({ ...UNTOUCHED, tenants: ["cust-b"] });
        expect(await signInOf("v-none")).toEqual({ ...UNTOUCHED, tenants: [] });
    });
});
