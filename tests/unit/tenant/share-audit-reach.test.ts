// @vitest-environment node
/**
 * A change of who gets a destination or a channel of the home tenant writes into the log of the
 * home tenant, the log of the platform. Someone whose platform group reaches some tenants only
 * reads there the entries about those, so each entry names one tenant by its id, never a list of
 * names of tenants beyond the reach. Against a real SQLite database migrated with the migrations
 * of this version.
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
                data: { id: `share-${holder.written}`, tenantId: origin?.tenantId ?? "default", userId, action, resource, resourceId, details: JSON.stringify(details) },
            });
        },
    },
}));

const { logShareChange } = await import("@/services/sharing/share-audit");
const { logViewOf, FULL_VIEW } = await import("@/services/audit/log-reach");
const { listAudit } = await import("@/services/audit/audit-list-service");

let root = "";
let base: PrismaClient;

const HOME = "default";
const asHome = <T,>(fn: () => Promise<T>) => runAsTenant(HOME, fn);
const FILTER = { who: [], areas: [], actions: [], quick: "all" as const, period: "all" as const, page: 1, pageSize: 100 };
/** Nina of the MSP, whose platform group reaches Acme alone, reads the log of the home tenant. */
const NINA = { userId: "nina", tenantId: HOME, isPlatformAdmin: false, allTenants: false };
const loss = (tenantId: string, name: string) => ({ tenantId, name, jobs: [], templates: [], backups: 0, used: true, noted: true });

beforeAll(async () => {
    root = mkdtempSync(path.join(os.tmpdir(), "dbackup-share-audit-"));
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
    await base.platformGroup.create({ data: { id: "pg-acme", name: "Support Acme", allTenants: false, platformPermissions: "[]", tenantPermissions: "[]" } });
    await base.platformGroupTenant.create({ data: { groupId: "pg-acme", tenantId: "acme" } });
    const now = new Date();
    await base.user.create({ data: { id: "nina", name: "Nina", email: "nina@example.ch", emailVerified: true, createdAt: now, updatedAt: now, platformGroupId: "pg-acme" } });
}, 120_000);

afterAll(async () => {
    await base?.$disconnect();
    if (root) rmSync(root, { recursive: true, force: true });
});

beforeEach(async () => {
    await base.auditLog.deleteMany({});
});

/** What a view lists of the log of the home tenant, as `[action, tenants]` of each share entry. */
async function sharesSeen(view: Awaited<ReturnType<typeof logViewOf>>) {
    const { rows } = await asHome(() => listAudit(FILTER, new Date(), view));
    const entries = await base.auditLog.findMany({ where: { id: { in: rows.map((row) => row.id) }, tenantId: HOME } });
    return entries.map((entry) => JSON.parse(entry.details ?? "{}")).map((details) => [details.action, details.tenants]).sort();
}

describe("the share entries in the log of the home tenant", () => {
    it("names no tenant beyond the reach of the reader when the connection goes to several tenants", async () => {
        await asHome(() => logShareChange({ id: "nina" }, "nas", {
            name: "NAS", kind: "destination", gained: ["Acme", "Globex"],
            gainedTenants: [{ tenantId: "acme", name: "Acme" }, { tenantId: "globex", name: "Globex" }], losses: [],
        }, { allTenants: false }));

        expect(await sharesSeen(await asHome(() => logViewOf(NINA)))).toEqual([["share", "Acme"]]);
        expect(await sharesSeen(FULL_VIEW)).toEqual([["share", "Acme"], ["share", "Globex"]]);
    });

    it("names no tenant beyond the reach of the reader when several tenants lose it", async () => {
        await asHome(() => logShareChange({ id: "nina" }, "nas", {
            name: "NAS", kind: "destination", gained: [], gainedTenants: [], losses: [loss("acme", "Acme"), loss("globex", "Globex")],
        }, { allTenants: false }));

        expect(await sharesSeen(await asHome(() => logViewOf(NINA)))).toEqual([["unshare", "Acme"]]);
        expect(await sharesSeen(FULL_VIEW)).toEqual([["unshare", "Acme"], ["unshare", "Globex"]]);
        // Each customer still hears of its own loss in its own log.
        expect(await base.auditLog.count({ where: { tenantId: "globex" } })).toBe(1);
        expect(await base.auditLog.count({ where: { tenantId: "acme" } })).toBe(1);
    });

    it("keeps a share with every tenant, which names none, for every reader", async () => {
        await asHome(() => logShareChange({ id: "nina" }, "nas", {
            name: "NAS", kind: "destination", gained: ["Acme", "Globex"],
            gainedTenants: [{ tenantId: "acme", name: "Acme" }, { tenantId: "globex", name: "Globex" }], losses: [],
        }, { allTenants: true }));

        expect(await sharesSeen(await asHome(() => logViewOf(NINA)))).toEqual([["share", "all tenants"]]);
    });
});

describe("a save of a share that changes nobody", () => {
    const shareOf = (details: string | null) => {
        const parsed = JSON.parse(details ?? "{}");
        return [parsed.action, parsed.changes ?? null];
    };

    it("writes nothing for a share with every tenant that stays one", async () => {
        await asHome(() => logShareChange({ id: "nina" }, "nas", {
            name: "NAS", kind: "destination", gained: [], gainedTenants: [], losses: [], wasAllTenants: true,
        }, { allTenants: true }));

        expect(await base.auditLog.count()).toBe(0);
    });

    it("writes one entry with the change of the terms in the log of the tenant that shares", async () => {
        await asHome(() => logShareChange({ id: "nina" }, "nas", {
            name: "NAS", kind: "destination", gained: [], gainedTenants: [], losses: [], wasAllTenants: false,
            terms: { before: { encryptedOnly: false, ownRecipients: true }, after: { encryptedOnly: true, ownRecipients: true } },
        }, { allTenants: false }));

        const entries = await base.auditLog.findMany({});
        expect(entries.map((entry) => [entry.tenantId, ...shareOf(entry.details)])).toEqual([
            [HOME, "shareTerms", [{ field: "Only encrypted backups", from: "Off", to: "On" }]],
        ]);
    });

    it("names whose recipients an email channel mails, also for a share with every tenant", async () => {
        await asHome(() => logShareChange({ id: "nina" }, "mail", {
            name: "Mail", kind: "channel", gained: [], gainedTenants: [], losses: [], wasAllTenants: true,
            terms: { before: { encryptedOnly: false, ownRecipients: true }, after: { encryptedOnly: false, ownRecipients: false } },
        }, { allTenants: true }));

        const entries = await base.auditLog.findMany({});
        expect(entries.map((entry) => shareOf(entry.details))).toEqual([
            ["shareTerms", [{ field: "Who gets the mail", from: "The recipients each tenant picks", to: "The recipients set here" }]],
        ]);
    });

    it("writes no terms entry when the term of its kind stayed the same", async () => {
        await asHome(() => logShareChange({ id: "nina" }, "nas", {
            name: "NAS", kind: "destination", gained: [], gainedTenants: [], losses: [],
            terms: { before: { encryptedOnly: true, ownRecipients: true }, after: { encryptedOnly: true, ownRecipients: false } },
        }, { allTenants: false }));

        expect(await base.auditLog.count()).toBe(0);
    });
});
