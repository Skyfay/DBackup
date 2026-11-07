// @vitest-environment node
/**
 * The writers of the entries of the log of the home tenant that are about a customer: what they
 * write is read back through the filter of someone whose platform group reaches some tenants only,
 * so an entry about a tenant beyond the reach stays hidden and an entry about a tenant of the reach
 * shows, the own one included. Against a real SQLite database migrated with the migrations of this
 * version, with the real actions, routes and services.
 */
import { execFileSync } from "child_process";
import { mkdtempSync, rmSync } from "fs";
import os from "os";
import path from "path";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { PrismaClient } from "@prisma/client";
import { PermissionError } from "@/lib/logging/errors";
import { runAsTenant } from "@/lib/tenant/context";
import { tenantScopeExtension } from "@/lib/tenant/prisma-scope";
import { SHARE_PERMISSION } from "@/lib/tenant/sharing";

const holder = vi.hoisted(() => ({ client: undefined as unknown, base: undefined as unknown, requestTenant: null as string | null, written: 0 }));
const mocks = vi.hoisted(() => ({ viewer: null as unknown, ctx: null as unknown }));

vi.mock("@/lib/logging/logger", () => ({
    logger: { child: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }) },
}));
vi.mock("@/lib/prisma", () => ({ get default() { return holder.client; } }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
// No destination keeps a backup here, who holds what is the subject.
vi.mock("@/services/storage/storage-service", () => ({ storageService: { readCachedListing: vi.fn(async () => null) } }));
// The entries go into the test database as the audit service would write them, into the log of the
// tenant of the origin, else of the home tenant the change ran in.
vi.mock("@/services/audit-service", () => ({
    auditService: {
        log: async (userId: string, action: string, resource: string, details: Record<string, unknown>, resourceId: string | undefined, origin?: { tenantId?: string }) => {
            holder.written += 1;
            await (holder.base as PrismaClient).auditLog.create({
                data: { id: `entry-${String(holder.written).padStart(3, "0")}`, tenantId: origin?.tenantId ?? "default", userId, action, resource, resourceId, details: JSON.stringify(details) },
            });
        },
    },
}));
// The caller of an action or a route, with the checks of the permissions reduced to its list.
vi.mock("@/lib/auth/access-control", async (importOriginal) => ({
    tenantOf: (await importOriginal<typeof import("@/lib/auth/access-control")>()).tenantOf,
    checkPermission: async () => mocks.viewer,
    tenantRefusal: () => null,
    hasPermissionWithContext: () => true,
    getAuthContext: async () => mocks.ctx,
    checkPermissionWithContext: (ctx: { permissions: string[] }, permission: string) => {
        if (!ctx.permissions.includes(permission)) throw new PermissionError(permission);
    },
    checkAnyPermissionWithContext: (ctx: { permissions: string[] }, permissions: string[]) => {
        if (!permissions.some((permission) => ctx.permissions.includes(permission))) throw new PermissionError(permissions.join(" or "));
    },
}));

const { assignDatabases } = await import("@/app/actions/tenant/database-assignments");
const route = await import("@/app/api/adapters/[id]/database-assignments/route");
const { deleteSsoProvider, toggleSsoProvider } = await import("@/app/actions/auth/oidc");
const { settleProviders } = await import("@/services/user/group-service");
const { logViewOf, FULL_VIEW } = await import("@/services/audit/log-reach");
const { listAudit } = await import("@/services/audit/audit-list-service");

let root = "";
let base: PrismaClient;

const HOME = "default";
const asHome = <T,>(fn: () => Promise<T>) => runAsTenant(HOME, fn);
const FILTER = { who: [], areas: [], actions: [], quick: "all" as const, period: "all" as const, page: 1, pageSize: 100 };
/** Dana of the MSP, whose platform group reaches Acme alone, reads the log of the home tenant. */
const DANA = { userId: "u-desk", tenantId: HOME, isPlatformAdmin: false, allTenants: false };
/** A platform admin of the MSP, who changes what Dana may not and also works in Acme, so Dana sees the entries of the account. */
const ROOT = { id: "u-root", isPlatformAdmin: true, tenantId: HOME, allTenants: false, permissions: [] };

beforeAll(async () => {
    root = mkdtempSync(path.join(os.tmpdir(), "dbackup-named-writers-"));
    const file = path.join(root, "writers.db");
    execFileSync(path.join(process.cwd(), "node_modules", ".bin", "prisma"), ["migrate", "deploy"], {
        env: { ...process.env, DATABASE_URL: `file:${file}` },
        stdio: "pipe",
    });
    base = new PrismaClient({ datasources: { db: { url: `file:${file}` } } });
    holder.base = base;
    holder.client = base.$extends(tenantScopeExtension(async () => holder.requestTenant));

    for (const [id, name] of [["acme", "Acme"], ["globex", "Globex"]]) await base.tenant.create({ data: { id, name } });
    await base.platformGroup.create({ data: { id: "pg-acme", name: "Acme desk", platformPermissions: JSON.stringify([SHARE_PERMISSION]), allTenants: false, tenants: { create: [{ tenantId: "acme" }] } } });
    const now = new Date();
    await base.user.create({ data: { id: "u-desk", name: "Dana", email: "dana@msp.example", emailVerified: true, createdAt: now, updatedAt: now, platformGroupId: "pg-acme" } });
    await base.user.create({ data: { id: "u-root", name: "Root", email: "root@msp.example", emailVerified: true, createdAt: now, updatedAt: now, platformRole: "ADMIN" } });
    await base.group.create({ data: { id: "g-acme", name: "Admin", permissions: "[]", tenantId: "acme" } });
    await base.tenantMembership.create({ data: { userId: "u-root", tenantId: "acme", groupId: "g-acme" } });

    // The shared server belongs to the home tenant, which shares.
    await base.adapterConfig.create({ data: { id: "shared-mysql", name: "Shared MySQL", type: "database", adapterId: "mysql", config: "{}" } });
    await base.databaseListCache.create({ data: { adapterConfigId: "shared-mysql", databasesJson: JSON.stringify(["shop_acme", "shop_globex", "free_db"].map((name) => ({ name }))) } });
}, 120_000);

afterAll(async () => {
    await base?.$disconnect();
    if (root) rmSync(root, { recursive: true, force: true });
});

beforeEach(async () => {
    holder.requestTenant = null;
    await base.auditLog.deleteMany({});
    await base.databaseAssignment.deleteMany();
    await base.sharedServer.deleteMany();
    await base.ssoProvider.deleteMany();
    await base.sharedServer.create({ data: { id: "shared-mysql", name: "Shared MySQL", adapterId: "mysql", tenantId: HOME } });
    const since = new Date("2026-01-01T12:00:00.000Z");
    await base.databaseAssignment.createMany({
        data: [
            { id: "a-acme", sourceId: "shared-mysql", databaseName: "shop_acme", tenantId: "acme", validFrom: since, createdAt: since },
            { id: "a-globex", sourceId: "shared-mysql", databaseName: "shop_globex", tenantId: "globex", validFrom: since, createdAt: since },
        ],
    });
});

/** The details of the entries a view lists of the log of the home tenant, oldest first. */
async function seen(view: Awaited<ReturnType<typeof logViewOf>>) {
    const { rows } = await asHome(() => listAudit(FILTER, new Date(), view));
    const ids = rows.map((row) => row.id);
    const written = await base.auditLog.findMany({ where: { id: { in: ids } }, orderBy: { id: "asc" } });
    return written.map((row) => JSON.parse(row.details ?? "{}") as Record<string, unknown>);
}
const danaSees = async () => seen(await asHome(() => logViewOf(DANA)));

describe("a batch of assignments in the log of the home tenant", () => {
    it("names every tenant of a mixed batch at the top level, so a reader of one of them does not read it", async () => {
        mocks.viewer = ROOT;
        // Free_db goes to Acme, shop_globex comes back from Globex.
        const result = await asHome(() => assignDatabases("shared-mysql", [{ databaseName: "free_db", tenantId: "acme" }, { databaseName: "shop_globex", tenantId: null }]));
        expect(result).toEqual({ success: true, data: { changed: 2 } });

        const [entry] = await seen(FULL_VIEW);
        expect(entry).toEqual({
            name: "Shared MySQL",
            change: "Databases assigned",
            databases: [{ name: "free_db", to: "acme" }, { name: "shop_globex", to: null }],
            tenantIds: ["acme", "globex"],
        });
        // The filter reads a tenant by its text, so none sits inside the list.
        expect(JSON.stringify(entry.databases)).not.toContain("tenantId");
        expect(await danaSees()).toEqual([]);
    });

    it("shows a take-back to the reader who reaches the tenant it took the database from, its author included", async () => {
        mocks.ctx = { userId: "u-desk", permissions: [SHARE_PERMISSION], isPlatformAdmin: false, authMethod: "session", tenantId: HOME, allTenants: false };
        holder.requestTenant = HOME;
        const params = { params: Promise.resolve({ id: "shared-mysql" }) };

        const answer = await route.PUT(new Request("http://dbackup.local/api/adapters/shared-mysql/database-assignments", {
            method: "PUT", body: JSON.stringify({ assignments: [{ database: "shop_acme", tenantId: null }] }),
        }) as never, params);
        expect(await answer.json()).toEqual({ success: true, data: { changed: 1 } });

        holder.requestTenant = null;
        expect(await danaSees()).toEqual([
            { name: "Shared MySQL", change: "Databases assigned", databases: [{ name: "shop_acme", to: null }], tenantId: "acme" },
        ]);
    });

    it("writes nothing for a batch that changed nothing", async () => {
        mocks.viewer = ROOT;
        expect(await asHome(() => assignDatabases("shared-mysql", [{ databaseName: "shop_acme", tenantId: "acme" }]))).toEqual({ success: true, data: { changed: 0 } });
        expect(await seen(FULL_VIEW)).toEqual([]);
    });
});

describe("a sign-in provider in the log of the home tenant", () => {
    const provider = (id: string, tenantId: string | null, defaultGroupId: string | null = null) =>
        base.ssoProvider.create({ data: { id, providerId: `${id}-oidc`, adapterId: "keycloak", name: id, domain: `${id}.example`, tenantId, defaultGroupId } });

    it("names the tenant of the provider when it is switched off or deleted, and hides it from a reader beyond that tenant", async () => {
        mocks.viewer = ROOT;
        await provider("globex-login", "globex");
        await provider("acme-login", "acme");

        expect(await asHome(() => toggleSsoProvider("globex-login", false))).toEqual({ success: true });
        expect(await asHome(() => deleteSsoProvider("globex-login"))).toEqual({ success: true });
        expect(await asHome(() => toggleSsoProvider("acme-login", false))).toEqual({ success: true });

        expect(await seen(FULL_VIEW)).toEqual([
            { name: "globex-login", enabled: false, tenantId: "globex" },
            { name: "globex-login", providerId: "globex-login-oidc", tenantId: "globex" },
            { name: "acme-login", enabled: false, tenantId: "acme" },
        ]);
        expect(await danaSees()).toEqual([{ name: "acme-login", enabled: false, tenantId: "acme" }]);
    });

    it("names no tenant for a provider of the platform, which every reader of the log sees", async () => {
        mocks.viewer = ROOT;
        await provider("staff-login", null);

        expect(await asHome(() => toggleSsoProvider("staff-login", false))).toEqual({ success: true });
        expect(await asHome(() => deleteSsoProvider("staff-login"))).toEqual({ success: true });

        expect(await danaSees()).toEqual([
            { name: "staff-login", enabled: false },
            { name: "staff-login", providerId: "staff-login-oidc" },
        ]);
    });

    it("carries the tenant of each provider the delete of a group changed, for its entry", async () => {
        await provider("globex-login", "globex", "g-ops");
        await provider("staff-login", null, "g-ops");

        const moves = await settleProviders(base as unknown as Parameters<typeof settleProviders>[0], { id: "g-ops", name: "Operators" }, null);

        expect(moves.map((move) => [move.name, move.tenantId]).sort()).toEqual([["globex-login", "globex"], ["staff-login", null]]);
    });
});
