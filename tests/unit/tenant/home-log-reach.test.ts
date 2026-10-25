// @vitest-environment node
/**
 * The log of the home tenant is the log of the platform: the sign-ins, sign-outs and failed sign-ins
 * of every account land there. Someone whose platform group reaches some tenants only and who reads
 * it sees the entries of the accounts of those tenants, their own, those of no person and nothing
 * else, against a real SQLite database migrated with the migrations of this version.
 */
import { execFileSync } from "child_process";
import { mkdtempSync, rmSync } from "fs";
import os from "os";
import path from "path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PrismaClient } from "@prisma/client";
import { runAsTenant } from "@/lib/tenant/context";
import { tenantScopeExtension } from "@/lib/tenant/prisma-scope";
import { PERMISSIONS } from "@/lib/auth/permissions";

const holder = vi.hoisted(() => ({ client: undefined as unknown }));

vi.mock("@/lib/logging/logger", () => ({
    logger: { child: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }) },
}));
// The services use the client of the app, here the one of the test database with its tenant filter.
vi.mock("@/lib/prisma", () => ({ get default() { return holder.client; } }));

const { logViewOf, FULL_VIEW } = await import("@/services/audit/log-reach");
const { listAudit, getAuditFacets, getAuditStats, getAuditWhoOptions } = await import("@/services/audit/audit-list-service");
const { getAuditEntryDetails } = await import("@/services/audit/audit-details");
const { auditCsv } = await import("@/services/audit/audit-export");
const { getAuditTimeline } = await import("@/services/audit/audit-timeline");
const { getNotificationLogs, getNotificationLogById } = await import("@/services/notifications/notification-log-service");
const { maySeePicture } = await import("@/services/user/account-visibility");
const { getUserDetails } = await import("@/services/user/user-details");
const { integrityCheckFailureTemplate } = await import("@/lib/notifications/templates/system");

let root = "";
let base: PrismaClient;

const HOME = "default";
const NOW = new Date("2026-10-10T12:00:00.000Z");
const asHome = <T,>(fn: () => Promise<T>) => runAsTenant(HOME, fn);
const FILTER = { who: [], areas: [], actions: [], quick: "all" as const, period: "all" as const };
const at = (minute: number) => new Date(NOW.getTime() - (60 - minute) * 60_000);

/** Nina of the MSP, whose platform group reaches Acme alone, reads the log of the home tenant. */
const NINA = { userId: "nina", tenantId: HOME, isPlatformAdmin: false, allTenants: false };

async function user(id: string, tenantId?: string) {
    await base.user.create({ data: { id, name: id, email: `${id}@example.ch`, emailVerified: true, createdAt: NOW, updatedAt: NOW } });
    if (tenantId) await base.tenantMembership.create({ data: { userId: id, tenantId, groupId: `g-${tenantId}` } });
}

async function entry(id: string, minute: number, data: { userId?: string | null; actorName?: string; action: string; resource?: string; resourceId?: string; details?: Record<string, unknown> }) {
    await base.auditLog.create({
        data: {
            id,
            tenantId: HOME,
            userId: data.userId ?? null,
            actorName: data.actorName ?? null,
            action: data.action,
            resource: data.resource ?? "AUTH",
            resourceId: data.resourceId ?? null,
            details: JSON.stringify(data.details ?? {}),
            ipAddress: "10.0.0.1",
            userAgent: "curl/8.5.0",
            createdAt: at(minute),
        },
    });
}

beforeAll(async () => {
    root = mkdtempSync(path.join(os.tmpdir(), "dbackup-home-log-"));
    const file = path.join(root, "log.db");
    execFileSync(path.join(process.cwd(), "node_modules", ".bin", "prisma"), ["migrate", "deploy"], {
        env: { ...process.env, DATABASE_URL: `file:${file}` },
        stdio: "pipe",
    });
    base = new PrismaClient({ datasources: { db: { url: `file:${file}` } } });
    holder.client = base.$extends(tenantScopeExtension(async () => null));

    await base.tenant.create({ data: { id: "acme", name: "Acme" } });
    await base.tenant.create({ data: { id: "globex", name: "Globex" } });
    for (const tenantId of [HOME, "acme", "globex"]) {
        await base.group.create({ data: { id: `g-${tenantId}`, name: `Staff ${tenantId}`, permissions: "[]", tenantId } });
    }
    await base.platformGroup.create({ data: { id: "pg-acme", name: "Support Acme", allTenants: false, platformPermissions: "[]", tenantPermissions: "[]" } });
    await base.platformGroupTenant.create({ data: { groupId: "pg-acme", tenantId: "acme" } });

    await user("nina");
    await base.user.update({ where: { id: "nina" }, data: { platformGroupId: "pg-acme" } });
    await user("anna", "acme");
    await user("gus", "globex");
    await user("hans", HOME);
    await user("lone");

    await entry("anna-in", 1, { userId: "anna", action: "LOGIN", details: { method: "password" } });
    await entry("gus-in", 2, { userId: "gus", action: "LOGIN", details: { method: "password" } });
    await entry("hans-in", 3, { userId: "hans", action: "LOGIN", details: { method: "password" } });
    await entry("lone-in", 4, { userId: "lone", action: "LOGIN", details: { method: "password" } });
    await entry("nina-in", 5, { userId: "nina", action: "LOGIN", details: { method: "password" } });
    await entry("gus-failed", 6, { action: "LOGIN_FAILED", resourceId: "gus", details: { method: "password", email: "gus@example.ch", reason: "wrong_password" } });
    await entry("anna-failed", 7, { action: "LOGIN_FAILED", resourceId: "anna", details: { method: "password", email: "anna@example.ch", reason: "wrong_password" } });
    await entry("unknown-failed", 8, { action: "LOGIN_FAILED", details: { method: "password", email: "who@example.ch", reason: "unknown_email" } });
    await entry("system", 9, { action: "UPDATE", resource: "SYSTEM", resourceId: "system.clean_audit_logs", details: { task: "Clean Old Data", name: "Clean Old Data" } });
    await entry("tom-deleted", 10, { actorName: "Tom", action: "UPDATE", resource: "SYSTEM", details: { name: "General" } });
    await entry("gus-out", 11, { userId: "gus", action: "LOGOUT" });

    for (const [id, eventType, executionId] of [["n-update", "update_available", null], ["n-storage", "storage_limit_warning", null], ["n-login", "user_login", null]] as const) {
        await base.notificationLog.create({ data: { id, tenantId: HOME, eventType, channelName: "Mail", adapterId: "email", status: "Success", title: id, message: id, executionId } });
    }
    await base.execution.create({ data: { id: "home-run", tenantId: HOME, type: "Backup", status: "Success", logs: "[]" } });
    await base.notificationLog.create({ data: { id: "n-run", tenantId: HOME, eventType: "backup_success", channelName: "Mail", adapterId: "email", status: "Success", title: "run", message: "run", executionId: "home-run" } });
}, 120_000);

afterAll(async () => {
    await base?.$disconnect();
    if (root) rmSync(root, { recursive: true, force: true });
});

const ids = (rows: { id: string }[]) => rows.map((row) => row.id).sort();

describe("the log of the home tenant for a platform group of some tenants", () => {
    it("lists the entries of the accounts it reaches, the own ones and those of no person, nothing else", async () => {
        const view = await asHome(() => logViewOf(NINA));
        const { rows, total } = await asHome(() => listAudit({ ...FILTER, page: 1, pageSize: 100 }, NOW, view));

        expect(ids(rows)).toEqual(["anna-failed", "anna-in", "nina-in", "system", "unknown-failed"]);
        expect(total).toBe(5);
    });

    it("counts an account of no tenant as one of the home tenant", async () => {
        const view = { ...(await asHome(() => logViewOf(NINA))), reach: ["acme", HOME] };
        const { rows } = await asHome(() => listAudit({ ...FILTER, page: 1, pageSize: 100 }, NOW, view));

        expect(ids(rows)).toEqual(["anna-failed", "anna-in", "hans-in", "lone-in", "nina-in", "system", "unknown-failed"]);
    });

    it("finds nobody beyond the reach by the email search", async () => {
        const view = await asHome(() => logViewOf(NINA));
        const { rows } = await asHome(() => listAudit({ ...FILTER, page: 1, pageSize: 100, search: "gus@" }, NOW, view));

        expect(rows).toEqual([]);
    });

    it("offers in the Who filter, counts and draws only what it lists", async () => {
        const view = await asHome(() => logViewOf(NINA));
        const [who, facets, stats, timeline] = await asHome(() => Promise.all([
            getAuditWhoOptions(view),
            getAuditFacets(FILTER, NOW, false, view),
            getAuditStats(NOW, view),
            getAuditTimeline("2026-10-10", "2026-10-10", "UTC", FILTER, NOW, view),
        ]));

        expect(who.map((option) => option.value).sort()).toEqual(["unknown", "user:anna", "user:nina"]);
        expect(facets.who).toEqual({ unknown: 3, "user:anna": 1, "user:nina": 1 });
        expect(stats.entries).toBe(5);
        expect(stats.signIns).toEqual(expect.objectContaining({ count: 2, people: 2 }));
        expect(stats.failed.count).toBe(2);
        expect(timeline.rows.map((row) => row.actor.key).sort()).toEqual(["unknown", "user:anna", "user:nina"]);
    });

    it("opens no entry beyond the reach, and exports none", async () => {
        const view = await asHome(() => logViewOf(NINA));

        expect(await asHome(() => getAuditEntryDetails("gus-in", view))).toBeNull();
        expect(await asHome(() => getAuditEntryDetails("gus-failed", view))).toBeNull();
        expect(await asHome(() => getAuditEntryDetails("anna-in", view))).toEqual(expect.objectContaining({ id: "anna-in" }));

        const { csv, count } = await asHome(() => auditCsv(FILTER, NOW, view));
        expect(count).toBe(5);
        expect(csv).not.toContain("gus");
        expect(csv).not.toContain("hans");
    });

    it("leaves the log as it was for a platform group of all tenants and a platform admin", async () => {
        await base.platformGroup.update({ where: { id: "pg-acme" }, data: { allTenants: true } });
        try {
            const view = await asHome(() => logViewOf(NINA));
            expect(view.reach).toBeNull();
            expect((await asHome(() => listAudit({ ...FILTER, page: 1, pageSize: 100 }, NOW, view))).total).toBe(11);
        } finally {
            await base.platformGroup.update({ where: { id: "pg-acme" }, data: { allTenants: false } });
        }
        expect((await asHome(() => logViewOf({ ...NINA, isPlatformAdmin: true }))).reach).toBeNull();
        expect((await asHome(() => listAudit({ ...FILTER, page: 1, pageSize: 100 }, NOW, FULL_VIEW))).total).toBe(11);
    });

    it("shows the picture of an account only when its entries are in the log it reads", async () => {
        const viewer = { ...NINA, permissions: [PERMISSIONS.AUDIT.READ] };

        expect(await maySeePicture(viewer, "anna")).toBe(true);
        expect(await maySeePicture(viewer, "gus")).toBe(false);
        // Hans works in the home tenant, where she works too, so she sees him like on its Users tab.
        expect(await maySeePicture(viewer, "hans")).toBe(true);
    });

    it("keeps to the notifications of runs of the home tenant and of no tenant at all", async () => {
        const view = await asHome(() => logViewOf(NINA));

        const { data } = await asHome(() => getNotificationLogs({}, view));
        expect(ids(data)).toEqual(["n-run", "n-update"]);
        expect(await asHome(() => getNotificationLogById("n-storage", view))).toBeNull();
        expect((await asHome(() => getNotificationLogs({}, FULL_VIEW))).total).toBe(4);
    });
});

describe("the entries of the home log about a tenant beyond the reach", () => {
    // Her own entries, so only the tenant they are about can hide them.
    const ABOUT = ["about-acme", "about-globex", "names-acme", "names-globex", "about-globex-by-nobody"];

    beforeAll(async () => {
        await entry("about-acme", 20, { userId: "nina", action: "UPDATE", resource: "TENANT", resourceId: "acme", details: { name: "Acme AG", renamedFrom: "Acme" } });
        await entry("about-globex", 21, { userId: "nina", action: "UPDATE", resource: "TENANT", resourceId: "globex", details: { name: "Globex AG", renamedFrom: "Globex" } });
        await entry("names-acme", 22, { userId: "nina", action: "UPDATE", resource: "ADAPTER", resourceId: "srv", details: { change: "Databases assigned", databases: [{ name: "shop", tenantId: "acme" }] } });
        await entry("names-globex", 23, { userId: "nina", action: "UPDATE", resource: "ADAPTER", resourceId: "srv", details: { change: "Databases assigned", databases: [{ name: "crm", tenantId: "globex" }] } });
        await entry("about-globex-by-nobody", 24, { action: "DELETE", resource: "TENANT", resourceId: "globex", details: { name: "Globex" } });
    });

    afterAll(async () => {
        await base.auditLog.deleteMany({ where: { id: { in: ABOUT } } });
    });

    it("hides the entries about a tenant beyond the reach, whoever acted, and keeps those about a tenant it reaches", async () => {
        const view = await asHome(() => logViewOf(NINA));
        const { rows } = await asHome(() => listAudit({ ...FILTER, page: 1, pageSize: 100 }, NOW, view));

        expect(ids(rows).filter((id) => ABOUT.includes(id))).toEqual(["about-acme", "names-acme"]);
        expect(await asHome(() => getAuditEntryDetails("about-globex", view))).toBeNull();
        expect(await asHome(() => getAuditEntryDetails("about-acme", view))).toEqual(expect.objectContaining({ id: "about-acme" }));
        // A platform admin reads all of them.
        const all = await asHome(() => listAudit({ ...FILTER, page: 1, pageSize: 100 }, NOW, FULL_VIEW));
        expect(ids(all.rows).filter((id) => ABOUT.includes(id))).toEqual([...ABOUT].sort());
    });

    it("keeps them out of the activity of the panel of a user too", async () => {
        const view = await asHome(() => logViewOf(NINA));

        const details = await asHome(() => getUserDetails("nina", null, NOW.getTime(), view));
        expect(details?.activity.map((entry) => entry.id).sort()).toEqual(["about-acme", "names-acme", "nina-in"]);
        const full = await asHome(() => getUserDetails("nina", null, NOW.getTime()));
        expect(full?.activity.map((entry) => entry.id)).toEqual(expect.arrayContaining(["about-globex", "names-globex"]));
    });
});

describe("the notice of a failed integrity check in the home log", () => {
    beforeAll(async () => {
        // The message of the platform names every other tenant with copies that failed.
        const payload = integrityCheckFailureTemplate({
            totalFiles: 50, failed: 3, passed: 47, skipped: 0, triggerType: "Scheduler", errors: [],
            tenants: [{ tenant: "Acme", failed: 2, totalFiles: 40 }, { tenant: "Globex", failed: 1, totalFiles: 9 }],
        });
        await base.notificationLog.create({
            data: {
                id: "n-integrity", tenantId: HOME, eventType: "integrity_check_failure", channelName: "Mail", adapterId: "email", status: "Success",
                title: payload.title, message: payload.message, fields: JSON.stringify(payload.fields), executionId: "home-run",
                renderedHtml: "<p>Acme: 2 of 40, Globex: 1 of 9</p>", renderedPayload: JSON.stringify({ text: "Acme, Globex" }),
            },
        });
    });

    afterAll(async () => {
        await base.notificationLog.deleteMany({ where: { id: "n-integrity" } });
    });

    it("names the other tenants to a reader of some tenants only by their count", async () => {
        const view = await asHome(() => logViewOf(NINA));

        const entry = await asHome(() => getNotificationLogById("n-integrity", view));
        const listed = (await asHome(() => getNotificationLogs({}, view))).data.find((row) => row.id === "n-integrity");
        for (const shown of [entry, listed]) {
            expect(JSON.stringify(shown)).not.toMatch(/Acme|Globex/);
            expect(JSON.parse(shown!.fields!)).toEqual(expect.arrayContaining([expect.objectContaining({ name: "Other tenants", value: "2 other tenants" })]));
            expect(shown!.renderedHtml).toBeNull();
            expect(shown!.renderedPayload).toBeNull();
        }

        // A reader of every tenant reads the names.
        const full = await asHome(() => getNotificationLogById("n-integrity", FULL_VIEW));
        expect(full!.fields).toContain("Acme: 2 of 40, Globex: 1 of 9");
        expect(full!.renderedHtml).toContain("Globex");
    });
});
