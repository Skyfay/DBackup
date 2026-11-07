// @vitest-environment node
/**
 * Groups of tenants against a real SQLite database migrated with the migrations of this version:
 * every tenant has groups of its own, starts with Admin and the groups the platform gives every
 * tenant, and gives a person only a group of itself.
 */
import { execFileSync } from "child_process";
import { mkdtempSync, rmSync } from "fs";
import os from "os";
import path from "path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PrismaClient } from "@prisma/client";
import { runAsSystem, runAsTenant } from "@/lib/tenant/context";
import { tenantScopeExtension } from "@/lib/tenant/prisma-scope";

const holder = vi.hoisted(() => ({ client: undefined as unknown as PrismaClient }));

vi.mock("@/lib/logging/logger", () => ({
    logger: { child: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }) },
}));
vi.mock("@/lib/prisma", () => ({ get default() { return holder.client; } }));
vi.mock("@/lib/server/scheduler", () => ({ scheduler: { refresh: vi.fn() } }));
vi.mock("@/services/dashboard/cache", () => ({ invalidateDashboardCache: vi.fn() }));

const { tenantService } = await import("@/services/tenant/tenant-service");
const { membershipService } = await import("@/services/tenant/membership-service");
const { groupService } = await import("@/services/user/group-service");

/** Who changes a membership: the admin of a customer, held by the guard, or a platform admin, who manages every tenant. */
const CUSTOMER_ADMIN = { platformAdmin: false };
const PLATFORM_ADMIN = { platformAdmin: true };

let root = "";
let base: PrismaClient;
const now = new Date("2026-10-15T10:00:00.000Z");

beforeAll(async () => {
    root = mkdtempSync(path.join(os.tmpdir(), "dbackup-tenant-groups-"));
    const file = path.join(root, "groups.db");
    execFileSync(path.join(process.cwd(), "node_modules", ".bin", "prisma"), ["migrate", "deploy"], {
        env: { ...process.env, DATABASE_URL: `file:${file}` },
        stdio: "pipe",
    });
    base = new PrismaClient({ datasources: { db: { url: `file:${file}` } } });
    holder.client = base.$extends(tenantScopeExtension(async () => null)) as unknown as PrismaClient;
    await base.user.create({ data: { id: "u-lena", name: "Lena", email: "lena@example.ch", emailVerified: true, createdAt: now, updatedAt: now } });
}, 120_000);

afterAll(async () => {
    await base?.$disconnect();
    if (root) rmSync(root, { recursive: true, force: true });
});

/** A group of the tenant by the name Viewer, which the tests below give and take. */
const viewerIn = (tenantId: string) => base.group.create({ data: { tenantId, name: "Viewer", permissions: JSON.stringify(["sources:read", "jobs:read"]) } });

describe("the groups of a tenant", () => {
    it("starts a new tenant with Admin alone, who may do everything there, while no group for every tenant exists", async () => {
        const acme = await tenantService.create("Acme");
        const groups = await base.group.findMany({ where: { tenantId: acme.id }, orderBy: { name: "asc" } });

        expect(groups.map((group) => [group.name, group.fullAccess])).toEqual([["Admin", true]]);
        await viewerIn(acme.id);
    });

    it("lets every tenant use a name once, also a name another tenant has", async () => {
        const globex = await tenantService.create("Globex");
        await viewerIn(globex.id);
        await runAsTenant(globex.id, () => groupService.create({ name: "Operators", permissions: ["jobs:read"] }));
        const acme = (await base.tenant.findFirstOrThrow({ where: { name: "Acme" } })).id;

        await expect(runAsTenant(acme, () => groupService.create({ name: "Operators", permissions: ["jobs:read"] }))).resolves.toMatchObject({ name: "Operators" });
        await expect(runAsTenant(acme, () => groupService.create({ name: "Operators", permissions: [] }))).rejects.toThrow('A group with the name "Operators" already exists.');
    });

    it("gives a person in a tenant only a group of that tenant", async () => {
        const acme = (await base.tenant.findFirstOrThrow({ where: { name: "Acme" } })).id;
        const globexViewer = await base.group.findFirstOrThrow({ where: { name: "Viewer", NOT: { tenantId: acme } } });
        const acmeViewer = await base.group.findFirstOrThrow({ where: { name: "Viewer", tenantId: acme } });

        await expect(membershipService.setRole("u-lena", acme, globexViewer.id, CUSTOMER_ADMIN)).rejects.toThrow("The group no longer exists.");
        await membershipService.setRole("u-lena", acme, acmeViewer.id, CUSTOMER_ADMIN);
        expect(await base.tenantMembership.findUnique({ where: { userId_tenantId: { userId: "u-lena", tenantId: acme } } })).toMatchObject({ groupId: acmeViewer.id });
    });

    it("keeps someone who manages the members for the admin of a customer, while a platform admin may leave the tenant empty", async () => {
        const globex = (await base.tenant.findFirstOrThrow({ where: { name: "Globex" } })).id;
        const [admin, viewer] = await Promise.all([
            base.group.findFirstOrThrow({ where: { tenantId: globex, fullAccess: true } }),
            base.group.findFirstOrThrow({ where: { tenantId: globex, name: "Viewer" } }),
        ]);
        await base.user.create({ data: { id: "u-ada", name: "Ada", email: "ada@example.ch", emailVerified: true, createdAt: now, updatedAt: now } });
        await membershipService.setRole("u-ada", globex, admin.id, PLATFORM_ADMIN);

        const refused = "Nobody else manages the members of this tenant. Give someone that right first.";
        await expect(membershipService.setRole("u-ada", globex, viewer.id, CUSTOMER_ADMIN)).rejects.toThrow(refused);
        await expect(membershipService.setRole("u-ada", globex, null, CUSTOMER_ADMIN)).rejects.toThrow(refused);

        await membershipService.setRole("u-ada", globex, null, PLATFORM_ADMIN);
        expect(await base.tenantMembership.count({ where: { tenantId: globex } })).toBe(0);
    });

    it("takes the groups of a tenant along when the tenant is deleted", async () => {
        const acme = (await base.tenant.findFirstOrThrow({ where: { name: "Acme" } })).id;
        await tenantService.delete(acme);

        expect(await base.group.count({ where: { tenantId: acme } })).toBe(0);
        expect(await runAsSystem(() => base.group.count())).toBeGreaterThan(0);
    });
});
