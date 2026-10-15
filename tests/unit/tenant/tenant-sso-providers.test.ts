// @vitest-environment node
/**
 * Sign-in providers of tenants against a real SQLite database migrated with the migrations of this
 * version: who a provider adds lands in its tenant with its group, an account of its domain joins
 * that tenant on its first sign-in through it, and deleting the tenant takes its providers and their
 * links along but leaves the accounts.
 */
import { execFileSync } from "child_process";
import { mkdtempSync, rmSync } from "fs";
import os from "os";
import path from "path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PrismaClient } from "@prisma/client";
import { runAsSystem } from "@/lib/tenant/context";
import { tenantScopeExtension } from "@/lib/tenant/prisma-scope";

const holder = vi.hoisted(() => ({ client: undefined as unknown as PrismaClient }));

vi.mock("@/lib/logging/logger", () => ({
    logger: { child: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }) },
}));
vi.mock("@/lib/prisma", () => ({ get default() { return holder.client; } }));
vi.mock("@/lib/server/scheduler", () => ({ scheduler: { refresh: vi.fn() } }));
vi.mock("@/services/dashboard/cache", () => ({ invalidateDashboardCache: vi.fn() }));

const { tenantService } = await import("@/services/tenant/tenant-service");
const { placeSsoUser } = await import("@/lib/auth/sso-guard");
const { joinSsoTenant } = await import("@/lib/auth/sso-tenant-guard");
const { settlePlacement } = await import("@/services/sso/sso-provider-rules");

let root = "";
let base: PrismaClient;
let acme = "";
let acmeViewer = "";
const now = new Date("2026-10-15T10:00:00.000Z");
const CALLBACK = { path: "/sso/callback/:providerId", params: { providerId: "entra-acme" } };

const person = (id: string, email: string, platformRole: string | null = null) =>
    base.user.create({ data: { id, name: id, email, emailVerified: true, createdAt: now, updatedAt: now, platformRole } });
const membershipsOf = (userId: string) => base.tenantMembership.findMany({ where: { userId }, select: { tenantId: true, groupId: true }, orderBy: { tenantId: "asc" } });

beforeAll(async () => {
    root = mkdtempSync(path.join(os.tmpdir(), "dbackup-tenant-sso-"));
    const file = path.join(root, "sso.db");
    execFileSync(path.join(process.cwd(), "node_modules", ".bin", "prisma"), ["migrate", "deploy"], {
        env: { ...process.env, DATABASE_URL: `file:${file}` },
        stdio: "pipe",
    });
    base = new PrismaClient({ datasources: { db: { url: `file:${file}` } } });
    holder.client = base.$extends(tenantScopeExtension(async () => null)) as unknown as PrismaClient;

    acme = (await tenantService.create("Acme GmbH")).id;
    acmeViewer = (await base.group.findFirstOrThrow({ where: { tenantId: acme, name: "Viewer" } })).id;
    await base.ssoProvider.create({
        data: { providerId: "entra-acme", name: "Acme Entra ID", adapterId: "generic", domain: "acme.ch", tenantId: acme, allowProvisioning: true, defaultGroupId: acmeViewer },
    });
}, 120_000);

afterAll(async () => {
    await base?.$disconnect();
    if (root) rmSync(root, { recursive: true, force: true });
});

describe("the sign-in provider of a tenant", () => {
    it("checks a provider of a tenant against the groups and domains in the database", async () => {
        const homeGroup = await base.group.findFirstOrThrow({ where: { tenantId: "default" } });
        const acmeProvider = { tenantId: acme, domain: "acme.ch", allowProvisioning: true, defaultGroupId: acmeViewer };

        expect(await settlePlacement({ ...acmeProvider, domain: "acme.de" }, null)).toMatchObject({ ok: true, tenantName: "Acme GmbH" });
        expect(await settlePlacement(acmeProvider, null)).toEqual({ ok: false, error: "Acme Entra ID signs in acme.ch already. A domain belongs to one provider." });
        expect(await settlePlacement({ ...acmeProvider, domain: "acme.de", defaultGroupId: homeGroup.id }, null)).toEqual({ ok: false, error: "The group is no group of Acme GmbH. Pick one of its groups." });
    });

    it("puts someone new it adds into its tenant with its group, and writes that into the log of the tenant", async () => {
        await person("u-lena", "lena.graf@acme.ch");

        await placeSsoUser({ id: "u-lena", name: "Lena Graf", email: "lena.graf@acme.ch" }, CALLBACK);

        expect(await membershipsOf("u-lena")).toEqual([{ tenantId: acme, groupId: acmeViewer }]);
        const entry = await runAsSystem(() => base.auditLog.findFirstOrThrow({ where: { userId: "u-lena" } }));
        expect(entry.tenantId).toBe(acme);
        expect(JSON.parse(entry.details ?? "{}")).toMatchObject({ via: "sso", provider: "Acme Entra ID", group: "Viewer" });
        // Someone new is a member now, so the link that follows adds nothing.
        await joinSsoTenant({ userId: "u-lena" }, CALLBACK);
        expect(await membershipsOf("u-lena")).toHaveLength(1);
    });

    it("adds an account of its domain that signs in through it for the first time to its tenant, and keeps its other tenants", async () => {
        const homeGroup = await base.group.findFirstOrThrow({ where: { tenantId: "default" } });
        await person("u-tom", "tom@acme.ch");
        await base.tenantMembership.create({ data: { userId: "u-tom", tenantId: "default", groupId: homeGroup.id } });

        await joinSsoTenant({ userId: "u-tom" }, CALLBACK);
        await joinSsoTenant({ userId: "u-tom" }, CALLBACK);

        expect(await membershipsOf("u-tom")).toEqual(
            [{ tenantId: acme, groupId: acmeViewer }, { tenantId: "default", groupId: homeGroup.id }].sort((a, b) => a.tenantId.localeCompare(b.tenantId))
        );
        const joined = await runAsSystem(() => base.auditLog.findMany({ where: { userId: "u-tom", tenantId: acme } }));
        expect(joined.map((entry) => JSON.parse(entry.details ?? "{}").change)).toEqual(["Joined through single sign-on"]);
    });

    it("never adds a platform admin or an account of another domain to its tenant", async () => {
        await person("u-manu", "manu@acme.ch", "ADMIN");
        await person("u-sara", "sara@globex.ch");

        await joinSsoTenant({ userId: "u-manu" }, CALLBACK);
        await joinSsoTenant({ userId: "u-sara" }, CALLBACK);

        expect(await membershipsOf("u-manu")).toEqual([]);
        expect(await membershipsOf("u-sara")).toEqual([]);
    });

    it("takes its providers and their links along when the tenant is deleted, and leaves the accounts", async () => {
        await base.account.create({ data: { id: "a-lena", accountId: "sub-lena", providerId: "entra-acme", userId: "u-lena", createdAt: now, updatedAt: now } });
        await base.account.create({ data: { id: "a-lena-pw", accountId: "u-lena", providerId: "credential", userId: "u-lena", password: "hash", createdAt: now, updatedAt: now } });

        await tenantService.delete(acme);

        expect(await base.ssoProvider.count({ where: { tenantId: acme } })).toBe(0);
        expect(await base.account.findMany({ where: { userId: "u-lena" }, select: { providerId: true } })).toEqual([{ providerId: "credential" }]);
        expect(await base.user.count({ where: { id: { in: ["u-lena", "u-tom"] } } })).toBe(2);
        expect(await membershipsOf("u-tom")).toEqual([expect.objectContaining({ tenantId: "default" })]);
    });
});
