// @vitest-environment node
/**
 * The sign-in providers someone of a platform group of some tenants sees with the right to see the
 * sign-in providers, against a real SQLite database migrated with the migrations of this version:
 * those of the platform and of the tenants the platform group reaches, with the people who work
 * there, never a provider of another tenant. A reach of every tenant keeps every provider.
 */
import { execFileSync } from "child_process";
import { mkdtempSync, rmSync } from "fs";
import os from "os";
import path from "path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PrismaClient } from "@prisma/client";
import { tenantScopeExtension } from "@/lib/tenant/prisma-scope";

const app = vi.hoisted(() => ({ client: undefined as unknown }));
vi.mock("@/lib/logging/logger", () => ({
    logger: { child: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }) },
}));
vi.mock("@/lib/prisma", () => ({ get default() { return app.client; } }));

const { getSsoProvidersModel } = await import("@/services/sso/sso-providers-model");

let root = "";
let base: PrismaClient;
const NOW = new Date();

async function person(id: string, tenantIds: string[], providers: string[]) {
    await base.user.create({ data: { id, name: id, email: `${id}@example.ch`, emailVerified: true, createdAt: NOW, updatedAt: NOW } });
    for (const tenantId of tenantIds) await base.tenantMembership.create({ data: { userId: id, tenantId, groupId: `g-${tenantId}` } });
    for (const providerId of providers) await base.account.create({ data: { id: `${id}-${providerId}`, accountId: id, providerId, userId: id, createdAt: NOW, updatedAt: NOW } });
    await base.auditLog.create({ data: { userId: id, action: "LOGIN", resource: "USER", details: JSON.stringify({ method: "sso" }) } });
}

async function provider(id: string, tenantId: string | null) {
    await base.ssoProvider.create({
        data: { id, providerId: id, name: id, adapterId: "generic", adapterConfig: "{}", issuer: `https://${id}.example.ch`, clientId: "dbackup", tenantId, defaultGroupId: `g-${tenantId ?? "default"}` },
    });
}

beforeAll(async () => {
    root = mkdtempSync(path.join(os.tmpdir(), "dbackup-sso-reach-"));
    const file = path.join(root, "sso.db");
    execFileSync(path.join(process.cwd(), "node_modules", ".bin", "prisma"), ["migrate", "deploy"], {
        env: { ...process.env, DATABASE_URL: `file:${file}` },
        stdio: "pipe",
    });
    base = new PrismaClient({ datasources: { db: { url: `file:${file}` } } });
    app.client = base.$extends(tenantScopeExtension(async () => null));

    for (const [id, name] of [["acme", "Acme"], ["globex", "Globex"]]) await base.tenant.create({ data: { id, name } });
    for (const tenantId of ["default", "acme", "globex"]) await base.group.create({ data: { id: `g-${tenantId}`, name: `Staff of ${tenantId}`, permissions: "[]", tenantId } });
    // The provider of the platform, which places new people in the home tenant, and one of each customer.
    await provider("platform-id", null);
    await provider("acme-entra", "acme");
    await provider("globex-okta", "globex");
    await person("tom", ["acme"], ["platform-id", "acme-entra"]);
    await person("gina", ["globex"], ["platform-id", "globex-okta"]);
    // An account of no tenant is one of the people of the home tenant.
    await person("hans", [], ["platform-id"]);
    await person("desk", [], ["platform-id"]);
}, 120_000);

afterAll(async () => {
    await base?.$disconnect();
    if (root) rmSync(root, { recursive: true, force: true });
});

const linked = (model: Awaited<ReturnType<typeof getSsoProvidersModel>>, providerId: string) =>
    model.providers.find((row) => row.providerId === providerId)?.linked.map((entry) => entry.id).sort();

describe("the sign-in providers a platform group of some tenants sees", () => {
    it("lists the providers of the platform and of the tenants it reaches, never one of another tenant", async () => {
        const model = await getSsoProvidersModel(true, { reach: ["acme"], viewerId: "desk" });

        expect(model.providers.map((row) => row.providerId).sort()).toEqual(["acme-entra", "platform-id"]);
        expect(model.tenants.map((tenant) => tenant.id).sort()).toEqual(["acme", "default"]);
        expect(model.stats.tenantsWithOwn).toBe(1);
    });

    it("lists beside a provider only the people of the tenants it reaches and the own account", async () => {
        const model = await getSsoProvidersModel(true, { reach: ["acme"], viewerId: "desk" });

        expect(linked(model, "platform-id")).toEqual(["desk", "tom"]);
        expect(linked(model, "acme-entra")).toEqual(["tom"]);
        expect(model.stats.linked).toBe(2);
        expect(model.stats.signIns).toBe(2);
    });

    it("names the groups of the tenants it reaches and the one the provider of the platform places people in, no other", async () => {
        const model = await getSsoProvidersModel(true, { reach: ["acme"], viewerId: "desk" });

        expect(model.manage?.groups.map((group) => group.id).sort()).toEqual(["g-acme", "g-default"]);
        expect(model.providers.find((row) => row.providerId === "platform-id")?.group).toEqual({ id: "g-default", name: "Staff of default" });
    });

    it("lists an account of no tenant, like the people of the MSP, as one of the home tenant", async () => {
        const withHome = await getSsoProvidersModel(true, { reach: ["default", "globex"], viewerId: "desk" });
        expect(linked(withHome, "platform-id")).toEqual(["desk", "gina", "hans"]);

        const withoutHome = await getSsoProvidersModel(true, { reach: ["globex"], viewerId: "desk" });
        expect(linked(withoutHome, "platform-id")).toEqual(["desk", "gina"]);
    });

    it("keeps every provider and every person for a platform admin and a platform group of all tenants", async () => {
        const model = await getSsoProvidersModel(true, { reach: "all", viewerId: "root" });

        expect(model.providers.map((row) => row.providerId).sort()).toEqual(["acme-entra", "globex-okta", "platform-id"]);
        expect(linked(model, "platform-id")).toEqual(["desk", "gina", "hans", "tom"]);
        // The migration makes the full access group of the home tenant.
        expect(model.manage?.groups.map((group) => group.id).sort()).toEqual(["admin-default", "g-acme", "g-default", "g-globex"]);
        expect(model.stats.signIns).toBe(4);
        // As it was before the reach, when no scope is passed.
        expect((await getSsoProvidersModel(true)).providers).toHaveLength(3);
    });
});
