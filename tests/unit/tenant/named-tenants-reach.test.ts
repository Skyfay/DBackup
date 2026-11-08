// @vitest-environment node
/**
 * Entries of the log of the home tenant that name a customer by its name, like a rule of a shared
 * server, a restore over databases of customers or the move of a sign-in provider, carry the id of
 * that customer beside the name. Someone whose platform group reaches some tenants only reads such
 * an entry when every tenant it names is of the reach. Against a real SQLite database migrated
 * with the migrations of this version.
 */
import { execFileSync } from "child_process";
import { mkdtempSync, rmSync } from "fs";
import os from "os";
import path from "path";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { PrismaClient } from "@prisma/client";
import { runAsTenant } from "@/lib/tenant/context";
import { tenantScopeExtension } from "@/lib/tenant/prisma-scope";

const holder = vi.hoisted(() => ({ client: undefined as unknown, base: undefined as unknown, written: 0 }));

vi.mock("@/lib/logging/logger", () => ({
    logger: { child: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }) },
}));
vi.mock("@/lib/prisma", () => ({ get default() { return holder.client; } }));
// The entries go into the test database as the audit service would write them, into the log of the
// tenant of the origin, else of the home tenant the change ran in.
vi.mock("@/services/audit-service", () => ({
    auditService: {
        log: async (userId: string, action: string, resource: string, details: Record<string, unknown>, resourceId: string, origin?: { tenantId?: string }) => {
            holder.written += 1;
            await (holder.base as PrismaClient).auditLog.create({
                data: { id: `named-${holder.written}`, tenantId: origin?.tenantId ?? "default", userId, action, resource, resourceId, details: JSON.stringify(details) },
            });
        },
    },
}));

const { logRuleAdded, logRuleRemoved } = await import("@/services/tenant/assignment-audit");
const { namedTenants } = await import("@/lib/core/audit-tenants");
const { auditVisibleWhere, logViewOf, FULL_VIEW } = await import("@/services/audit/log-reach");
const { listAudit } = await import("@/services/audit/audit-list-service");

let root = "";
let base: PrismaClient;

const HOME = "default";
const asHome = <T,>(fn: () => Promise<T>) => runAsTenant(HOME, fn);
const FILTER = { who: [], areas: [], actions: [], quick: "all" as const, period: "all" as const, page: 1, pageSize: 100 };
/** Nina of the MSP, whose platform group reaches Acme and Initech, reads the log of the home tenant. */
const NINA = { userId: "nina", tenantId: HOME, isPlatformAdmin: false, allTenants: false };

beforeAll(async () => {
    root = mkdtempSync(path.join(os.tmpdir(), "dbackup-named-tenants-"));
    const file = path.join(root, "log.db");
    execFileSync(path.join(process.cwd(), "node_modules", ".bin", "prisma"), ["migrate", "deploy"], {
        env: { ...process.env, DATABASE_URL: `file:${file}` },
        stdio: "pipe",
    });
    base = new PrismaClient({ datasources: { db: { url: `file:${file}` } } });
    holder.base = base;
    holder.client = base.$extends(tenantScopeExtension(async () => null));

    await base.tenant.create({ data: { id: "acme", name: "Acme" } });
    await base.tenant.create({ data: { id: "globex", name: "Globex" } });
    await base.tenant.create({ data: { id: "initech", name: "Initech" } });
    await base.platformGroup.create({ data: { id: "pg-support", name: "Support", allTenants: false, platformPermissions: "[]", tenantPermissions: "[]" } });
    await base.platformGroupTenant.create({ data: { groupId: "pg-support", tenantId: "acme" } });
    await base.platformGroupTenant.create({ data: { groupId: "pg-support", tenantId: "initech" } });
    const now = new Date();
    await base.user.create({ data: { id: "nina", name: "Nina", email: "nina@example.ch", emailVerified: true, createdAt: now, updatedAt: now, platformGroupId: "pg-support" } });
}, 120_000);

afterAll(async () => {
    await base?.$disconnect();
    if (root) rmSync(root, { recursive: true, force: true });
});

beforeEach(async () => {
    await base.auditLog.deleteMany({});
});

/** Writes an entry of Nina into the log of the home tenant, as a route or an action would. */
async function entry(id: string, details: Record<string, unknown>, resource = "BACKUP", action = "RESTORE") {
    await base.auditLog.create({ data: { id, tenantId: HOME, userId: "nina", action, resource, details: JSON.stringify(details) } });
}

/** The ids of the entries a view lists of the log of the home tenant. */
async function seen(view: Awaited<ReturnType<typeof logViewOf>>) {
    const { rows } = await asHome(() => listAudit(FILTER, new Date(), view));
    return rows.map((row) => row.id).sort();
}

describe("the tenants an entry names by their ids", () => {
    it("keeps one tenant in tenantId and several in tenantIds, each once and sorted", () => {
        expect(namedTenants([])).toEqual({});
        expect(namedTenants([null, undefined, ""])).toEqual({});
        expect(namedTenants(["acme", "acme"])).toEqual({ tenantId: "acme" });
        expect(namedTenants(["globex", null, "acme", "globex"])).toEqual({ tenantIds: ["acme", "globex"] });
    });
});

describe("an entry that names a customer by its name in the log of the home tenant", () => {
    it("hides a rule of a shared server given to a customer beyond the reach", async () => {
        await asHome(() => logRuleAdded({ id: "nina" }, "server", { pattern: "shop_*", tenantId: "globex", tenantName: "Globex", onDemandPerDay: null }));
        await asHome(() => logRuleRemoved({ id: "nina" }, "server", { pattern: "crm_*", tenantId: "acme", tenantName: "Acme" }));
        const written = await base.auditLog.findMany({ orderBy: { id: "asc" } });
        const byTenant = (tenant: string) => written.find((row) => JSON.parse(row.details ?? "{}").tenant === tenant)?.id;

        expect(await seen(await asHome(() => logViewOf(NINA)))).toEqual([byTenant("Acme")]);
        expect(await seen(FULL_VIEW)).toEqual([byTenant("Acme"), byTenant("Globex")].sort());
    });

    it("hides a restore over databases of customers when one of them is beyond the reach", async () => {
        await entry("restore-mixed", { name: "nightly.tar", customers: ["Acme", "Globex"], ...namedTenants(["acme", "globex"]) });
        await entry("restore-reached", { name: "nightly.tar", customers: ["Acme", "Initech"], ...namedTenants(["initech", "acme"]) });
        await entry("restore-one", { name: "nightly.tar", customers: ["Acme"], ...namedTenants(["acme"]) });
        await entry("restore-beyond", { name: "nightly.tar", customers: ["Globex"], ...namedTenants(["globex"]) });
        await entry("restore-plain", { name: "nightly.tar" });

        expect(await seen(await asHome(() => logViewOf(NINA)))).toEqual(["restore-one", "restore-plain", "restore-reached"]);
        expect(await seen(FULL_VIEW)).toEqual(["restore-beyond", "restore-mixed", "restore-one", "restore-plain", "restore-reached"]);
    });

    it("hides an entry whose tenantIds tells no tenants, rather than reading it as one that names none", async () => {
        await entry("listed-text", { name: "nightly.tar", tenantIds: "acme" });
        await entry("listed-mixed", { name: "nightly.tar", tenantIds: ["acme", 7] });
        await entry("listed-nested", { name: "nightly.tar", restore: { tenantIds: ["acme"] } });
        await entry("listed-reached", { name: "nightly.tar", ...namedTenants(["acme", "initech"]) });

        expect(await seen(await asHome(() => logViewOf(NINA)))).toEqual(["listed-reached"]);
        expect(await seen(FULL_VIEW)).toEqual(["listed-mixed", "listed-nested", "listed-reached", "listed-text"]);
    });

    it("reads what a view keeps once per view, so the readers of one request share it, and a new view reads it again", async () => {
        const view = await asHome(() => logViewOf(NINA));
        const first = await asHome(() => auditVisibleWhere(view));
        expect(await asHome(() => auditVisibleWhere(view))).toBe(first);
        expect(await seen(view)).toEqual([]);

        await entry("restore-later", { name: "nightly.tar", ...namedTenants(["acme", "initech"]) });
        const next = await asHome(() => logViewOf(NINA));
        expect(await asHome(() => auditVisibleWhere(next))).not.toBe(first);
        expect(await seen(next)).toEqual(["restore-later"]);
        expect(await asHome(() => auditVisibleWhere(FULL_VIEW))).toBeNull();
    });

    it("hides a sign-in provider moved from a reached tenant to one beyond the reach", async () => {
        const moved = { name: "Keycloak", changes: [{ field: "Belongs to", from: "Acme", to: "Globex" }] };
        await entry("provider-moved", { ...moved, ...namedTenants(["acme", "globex"]) }, "SSO_PROVIDER", "UPDATE");
        await entry("provider-edited", { name: "Keycloak", changes: [{ field: "Email domain", from: "a.ch", to: "b.ch" }] }, "SSO_PROVIDER", "UPDATE");

        expect(await seen(await asHome(() => logViewOf(NINA)))).toEqual(["provider-edited"]);
        // A search for the name of the tenant beyond finds nothing either.
        const { rows } = await asHome(() => listAudit({ ...FILTER, search: "Globex" }, new Date(), FULL_VIEW));
        expect(rows.map((row) => row.id)).toEqual(["provider-moved"]);
        const searched = await asHome(async () => listAudit({ ...FILTER, search: "Globex" }, new Date(), await logViewOf(NINA)));
        expect(searched.rows).toEqual([]);
    });
});
