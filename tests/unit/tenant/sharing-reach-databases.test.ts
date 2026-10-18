// @vitest-environment node
/**
 * Share with customers for someone of a platform group of some tenants, against a real SQLite
 * database migrated with the migrations of this version: the databases of a shared server go to
 * and come back from the tenants the platform group reaches, never the others, also through the
 * API key of such a person. A platform admin and a platform group of all tenants keep every tenant.
 */
import { execFileSync } from "child_process";
import { mkdtempSync, rmSync } from "fs";
import os from "os";
import path from "path";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { PrismaClient } from "@prisma/client";
import { PermissionError, ValidationError } from "@/lib/logging/errors";
import { runAsTenant } from "@/lib/tenant/context";
import { tenantScopeExtension } from "@/lib/tenant/prisma-scope";
import { SHARE_PERMISSION } from "@/lib/tenant/sharing";

const app = vi.hoisted(() => ({ client: undefined as unknown, requestTenant: null as string | null }));
const mocks = vi.hoisted(() => ({ ctx: null as unknown, audit: vi.fn() }));

vi.mock("@/lib/logging/logger", () => ({
    logger: { child: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }) },
}));
// The services use the client of the app, here the one of the test database with its tenant filter.
vi.mock("@/lib/prisma", () => ({ get default() { return app.client; } }));
// No destination keeps a backup here, who holds what is the subject.
vi.mock("@/services/storage/storage-service", () => ({ storageService: { readCachedListing: vi.fn(async () => null) } }));
vi.mock("@/services/audit-service", () => ({ auditService: { logFor: mocks.audit } }));
vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
// The request of an API key, with the checks of the permissions reduced to its list.
vi.mock("@/lib/auth/access-control", () => ({
    getAuthContext: async () => mocks.ctx,
    checkPermissionWithContext: (ctx: { permissions: string[] }, permission: string) => {
        if (!ctx.permissions.includes(permission)) throw new PermissionError(permission);
    },
    checkAnyPermissionWithContext: (ctx: { permissions: string[] }, permissions: string[]) => {
        if (!permissions.some((permission) => ctx.permissions.includes(permission))) throw new PermissionError(permissions.join(" or "));
    },
}));

const { databaseAssignmentService } = await import("@/services/tenant/database-assignments");
const { moveDatabase } = await import("@/services/tenant/database-moves");
const { platformGroupService } = await import("@/services/user/platform-group-service");
const route = await import("@/app/api/adapters/[id]/database-assignments/route");

let root = "";
let base: PrismaClient;

const HOME = "default";
const day = (iso: string) => new Date(`${iso}T12:00:00.000Z`);
const NOW = day("2026-10-01");
const asHome = <T,>(fn: () => Promise<T>) => runAsTenant(HOME, fn);
/** The tenants someone looks after on the platform, as the actions and routes read it. */
const reachOf = (userId: string) => platformGroupService.reachOf(userId);

async function person(id: string, fields: { platformRole?: string; platformGroupId?: string } = {}) {
    await base.user.create({ data: { id, name: id, email: `${id}@msp.example`, emailVerified: true, createdAt: NOW, updatedAt: NOW, ...fields } });
}

beforeAll(async () => {
    root = mkdtempSync(path.join(os.tmpdir(), "dbackup-reach-db-"));
    const file = path.join(root, "reach.db");
    execFileSync(path.join(process.cwd(), "node_modules", ".bin", "prisma"), ["migrate", "deploy"], {
        env: { ...process.env, DATABASE_URL: `file:${file}` },
        stdio: "pipe",
    });
    base = new PrismaClient({ datasources: { db: { url: `file:${file}` } } });
    app.client = base.$extends(tenantScopeExtension(async () => app.requestTenant));

    for (const [id, name] of [["acme", "Acme"], ["globex", "Globex"], ["initech", "Initech"]]) await base.tenant.create({ data: { id, name } });
    // The service desk of Acme reaches Acme alone, the MSP desk every tenant.
    await base.platformGroup.create({ data: { id: "pg-acme", name: "Acme desk", platformPermissions: JSON.stringify([SHARE_PERMISSION]), allTenants: false, tenants: { create: [{ tenantId: "acme" }] } } });
    await base.platformGroup.create({ data: { id: "pg-all", name: "MSP desk", platformPermissions: JSON.stringify([SHARE_PERMISSION]), allTenants: true } });
    await person("u-desk", { platformGroupId: "pg-acme" });
    await person("u-msp", { platformGroupId: "pg-all" });
    await person("u-root", { platformRole: "ADMIN" });

    // The shared server and a second one of the same engine belong to the home tenant, which shares.
    for (const [id, name, databases] of [
        ["shared-mysql", "Shared MySQL", ["shop_acme", "shop_globex", "blog_one", "crm_acme", "free_db"]],
        ["new-mysql", "New MySQL", ["spare"]],
    ] as const) {
        await base.adapterConfig.create({ data: { id, name, type: "database", adapterId: "mysql", config: "{}" } });
        await base.databaseListCache.create({ data: { adapterConfigId: id, databasesJson: JSON.stringify(databases.map((entry) => ({ name: entry }))) } });
    }
}, 120_000);

afterAll(async () => {
    await base?.$disconnect();
    if (root) rmSync(root, { recursive: true, force: true });
});

/** Acme holds shop_acme by name and crm_acme by a rule, Globex shop_globex by name and blog_one by a rule. */
beforeEach(async () => {
    vi.clearAllMocks();
    app.requestTenant = null;
    await base.databaseAssignment.deleteMany();
    await base.databaseAssignmentRule.deleteMany();
    await base.sharedServer.deleteMany();
    await base.sharedServer.create({ data: { id: "shared-mysql", name: "Shared MySQL", adapterId: "mysql", tenantId: HOME } });
    await base.databaseAssignment.createMany({
        data: [
            { id: "a-acme", sourceId: "shared-mysql", databaseName: "shop_acme", tenantId: "acme", validFrom: day("2026-01-01"), createdAt: day("2026-01-01") },
            { id: "a-globex", sourceId: "shared-mysql", databaseName: "shop_globex", tenantId: "globex", validFrom: day("2026-01-01"), createdAt: day("2026-01-01") },
        ],
    });
    await base.databaseAssignmentRule.createMany({
        data: [
            { id: "r-blog", sourceId: "shared-mysql", pattern: "blog_*", tenantId: "globex", validFrom: day("2026-01-01"), createdAt: day("2026-01-01") },
            { id: "r-crm", sourceId: "shared-mysql", pattern: "crm_*", tenantId: "acme", validFrom: day("2026-01-01"), createdAt: day("2026-01-01") },
        ],
    });
});

/** Who holds each database of the shared server at a time, by name. */
async function holders(at = NOW): Promise<Record<string, string | null>> {
    const model = await asHome(() => databaseAssignmentService.forSource("shared-mysql", at));
    return Object.fromEntries(model.databases.map((row) => [row.name, row.owner?.tenantId ?? null]));
}

const BEFORE = { blog_one: "globex", crm_acme: "acme", free_db: null, shop_acme: "acme", shop_globex: "globex" };

describe("Share with customers in a platform group of some tenants", () => {
    it("reads its reach from the platform group, every tenant for a platform admin and a platform group of all tenants", async () => {
        expect(await reachOf("u-desk")).toEqual(["acme"]);
        expect(await reachOf("u-msp")).toBe("all");
        expect(await reachOf("u-root")).toBe("all");
    });

    it("offers only the tenants it reaches to give a database to, and still names every tenant that holds one", async () => {
        const model = await asHome(async () => databaseAssignmentService.forSource("shared-mysql", NOW, await reachOf("u-desk")));

        expect(model.customers.map((tenant) => tenant.id)).toEqual(["acme"]);
        expect(model.tenants.map((tenant) => tenant.id)).toEqual(["acme", "globex", "initech"]);
        expect(model.databases.find((row) => row.name === "shop_globex")?.owner?.tenantName).toBe("Globex");
        expect(model.rules.map((rule) => rule.tenantName).sort()).toEqual(["Acme", "Globex"]);
    });

    it("gives a database and a rule to a tenant it reaches, and takes back what that tenant holds", async () => {
        const reach = await reachOf("u-desk");
        expect(await asHome(() => databaseAssignmentService.assign("shared-mysql", [{ databaseName: "free_db", tenantId: "acme" }], "u-desk", NOW, reach))).toEqual({ changed: 1 });
        expect(await asHome(() => databaseAssignmentService.assign("shared-mysql", [{ databaseName: "shop_acme", tenantId: null }], "u-desk", NOW, reach))).toEqual({ changed: 1 });
        await asHome(() => databaseAssignmentService.addRule("shared-mysql", { pattern: "new_*", tenantId: "acme" }, NOW, reach));
        await asHome(() => databaseAssignmentService.setRuleOnDemand("shared-mysql", "r-crm", 2, reach));

        expect(await holders()).toEqual({ ...BEFORE, free_db: "acme", shop_acme: null });
    });

    it("cannot give a database or a rule to a tenant it does not reach", async () => {
        const reach = await reachOf("u-desk");
        await expect(asHome(() => databaseAssignmentService.assign("shared-mysql", [{ databaseName: "free_db", tenantId: "globex" }], "u-desk", NOW, reach)))
            .rejects.toThrow("Your platform group does not reach Globex, so you cannot give it a database.");
        await expect(asHome(() => databaseAssignmentService.addRule("shared-mysql", { pattern: "free_*", tenantId: "initech" }, NOW, reach)))
            .rejects.toThrow("Your platform group does not reach Initech, so you cannot give it a database.");

        expect(await holders()).toEqual(BEFORE);
        expect(await base.databaseAssignmentRule.count()).toBe(2);
    });

    it("cannot take a database back from a tenant it does not reach, nor give it to a tenant it reaches, by name or by a rule", async () => {
        const reach = await reachOf("u-desk");
        const assign = (databaseName: string, tenantId: string | null) => asHome(() => databaseAssignmentService.assign("shared-mysql", [{ databaseName, tenantId }], "u-desk", NOW, reach));

        await expect(assign("shop_globex", null)).rejects.toThrow("shop_globex belongs to Globex, which your platform group does not reach, so you cannot change it.");
        await expect(assign("shop_globex", "acme")).rejects.toBeInstanceOf(ValidationError);
        await expect(assign("blog_one", null)).rejects.toThrow("blog_one belongs to Globex");
        // A list that touches one of them changes nothing at all.
        await expect(asHome(() => databaseAssignmentService.assign("shared-mysql", [
            { databaseName: "free_db", tenantId: "acme" },
            { databaseName: "blog_one", tenantId: "acme" },
        ], "u-desk", NOW, reach))).rejects.toBeInstanceOf(ValidationError);

        expect(await holders()).toEqual(BEFORE);
    });

    it("leaves the rules of a tenant it does not reach alone, and adds no rule that would outrank one", async () => {
        const reach = await reachOf("u-desk");
        await expect(asHome(() => databaseAssignmentService.removeRule("shared-mysql", "r-blog", NOW, reach)))
            .rejects.toThrow("The rule blog_* gives to Globex, which your platform group does not reach, so you cannot change it.");
        await expect(asHome(() => databaseAssignmentService.setRuleOnDemand("shared-mysql", "r-blog", 2, reach))).rejects.toThrow("The rule blog_* gives to Globex");
        await expect(asHome(() => databaseAssignmentService.addRule("shared-mysql", { pattern: "blog_*", tenantId: "acme", priority: 5 }, NOW, reach)))
            .rejects.toThrow("The rule would take blog_one from Globex, which your platform group does not reach. Give it a lower priority or a narrower pattern.");

        // A rule below the one of Globex takes nothing from it.
        await asHome(() => databaseAssignmentService.addRule("shared-mysql", { pattern: "blog_*", tenantId: "acme", priority: -5 }, NOW, reach));
        expect(await holders()).toEqual(BEFORE);
        expect(await base.databaseAssignmentRule.findUnique({ where: { id: "r-blog" } })).toMatchObject({ validUntil: null, onDemandPerDay: null });
    });

    it("changes neither the backups on demand nor the server of a database a tenant it does not reach holds", async () => {
        const reach = await reachOf("u-desk");
        await expect(asHome(() => databaseAssignmentService.setOnDemand("shared-mysql", "shop_globex", 3, reach))).rejects.toThrow("shop_globex belongs to Globex");
        await expect(asHome(() => moveDatabase("shared-mysql", { databaseName: "shop_globex", toSourceId: "new-mysql" }, "u-desk", NOW, reach))).rejects.toThrow("shop_globex belongs to Globex");

        expect(await base.databaseAssignment.findUnique({ where: { id: "a-globex" } })).toMatchObject({ validUntil: null, onDemandPerDay: null, movedToSourceId: null });
        await asHome(() => databaseAssignmentService.setOnDemand("shared-mysql", "shop_acme", 3, reach));
        await asHome(() => moveDatabase("shared-mysql", { databaseName: "shop_acme", toSourceId: "new-mysql" }, "u-desk", NOW, reach));
    });

    it("keeps every tenant for a platform admin and a platform group of all tenants", async () => {
        for (const userId of ["u-root", "u-msp"]) {
            const reach = await reachOf(userId);
            const model = await asHome(() => databaseAssignmentService.forSource("shared-mysql", NOW, reach));
            expect(model.customers.map((tenant) => tenant.id)).toEqual(["acme", "globex", "initech"]);
        }
        const reach = await reachOf("u-msp");
        await asHome(() => databaseAssignmentService.assign("shared-mysql", [{ databaseName: "shop_globex", tenantId: "initech" }, { databaseName: "blog_one", tenantId: null }], "u-msp", NOW, reach));
        await asHome(() => databaseAssignmentService.addRule("shared-mysql", { pattern: "crm_*", tenantId: "initech", priority: 5 }, NOW, reach));
        await asHome(() => databaseAssignmentService.removeRule("shared-mysql", "r-blog", NOW, reach));

        expect(await holders()).toEqual({ ...BEFORE, shop_globex: "initech", blog_one: null, crm_acme: "initech" });
    });
});

describe("the API of a hosting panel with the key of a person of some tenants", () => {
    const params = { params: Promise.resolve({ id: "shared-mysql" }) };
    const keyOf = (userId: string) => {
        mocks.ctx = { userId, permissions: [SHARE_PERMISSION], isPlatformAdmin: false, authMethod: "apikey", apiKeyId: `key-${userId}`, tenantId: HOME, allTenants: false };
        app.requestTenant = HOME;
    };
    const put = (assignments: { database: string; tenantId: string | null }[]) =>
        route.PUT(new Request("http://dbackup.local/api/adapters/shared-mysql/database-assignments", { method: "PUT", body: JSON.stringify({ assignments }) }) as never, params);

    it("lists the tenants the owner of the key reaches as customers", async () => {
        keyOf("u-desk");
        const body = await (await route.GET(new Request("http://dbackup.local") as never, params)).json();

        expect(body.data.customers).toEqual([{ id: "acme", name: "Acme" }]);
        expect(body.data.tenants.map((tenant: { id: string }) => tenant.id)).toEqual(["acme", "globex", "initech"]);
    });

    it("gives to and takes from the tenants the owner of the key reaches, and refuses the others with a clear sentence", async () => {
        keyOf("u-desk");
        const given = await put([{ database: "free_db", tenantId: "acme" }]);
        expect(given.status).toBe(200);
        expect(await given.json()).toEqual({ success: true, data: { changed: 1 } });

        const refused = await put([{ database: "free_db", tenantId: "globex" }]);
        expect(refused.status).toBe(400);
        expect((await refused.json()).error).toBe("Your platform group does not reach Globex, so you cannot give it a database.");

        const takenBack = await put([{ database: "shop_globex", tenantId: null }]);
        expect(takenBack.status).toBe(400);
        expect((await takenBack.json()).error).toBe("shop_globex belongs to Globex, which your platform group does not reach, so you cannot change it.");
        expect(mocks.audit).toHaveBeenCalledTimes(1);
        // The route gives from the moment of the request on.
        expect(await holders(new Date())).toEqual({ ...BEFORE, free_db: "acme" });
    });

    it("keeps every tenant for the key of someone of a platform group of all tenants", async () => {
        keyOf("u-msp");
        expect((await put([{ database: "shop_globex", tenantId: "initech" }])).status).toBe(200);
        expect((await holders(new Date())).shop_globex).toBe("initech");
    });
});
