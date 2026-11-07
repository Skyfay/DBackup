// @vitest-environment node
/**
 * An API key with rights of the platform end to end, against a real SQLite database migrated with
 * the migrations of this version: the key is found by its secret, capped to what its owner may in
 * the home tenant at every request, reaches the tenants of its owner's platform group, and its
 * changes land in the audit log with the key. A key of a customer never manages a tenant, and a
 * key whose owner lost the right stops at the next request.
 */
import { execFileSync } from "child_process";
import { mkdtempSync, rmSync } from "fs";
import os from "os";
import path from "path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { PrismaClient } from "@prisma/client";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { tenantScopeExtension } from "@/lib/tenant/prisma-scope";

const app = vi.hoisted(() => ({ client: undefined as unknown, headers: new Headers() }));
vi.mock("@/lib/logging/logger", () => ({
    logger: { child: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }) },
}));
vi.mock("@/lib/prisma", () => ({ get default() { return app.client; } }));
vi.mock("next/headers", () => ({ headers: async () => app.headers }));
// No session: every request here comes with an API key.
vi.mock("@/lib/auth", () => ({ auth: { api: { getSession: async () => null } } }));

const { apiKeyService } = await import("@/services/auth/api-key-service");
const { runAsTenant } = await import("@/lib/tenant/context");
const tenantsRoute = await import("@/app/api/tenants/route");
const tenantRoute = await import("@/app/api/tenants/[id]/route");
const invitationsRoute = await import("@/app/api/tenants/[id]/invitations/route");

const P = PERMISSIONS;
let root = "";
let base: PrismaClient;
const NOW = new Date();
let ninaKey = "";
let ninaKeyId = "";
let tomKey = "";

/** Sends the next request with this key, like `Authorization: Bearer`. */
function as(rawKey: string) {
    app.headers = new Headers({ authorization: `Bearer ${rawKey}`, "user-agent": "msp-automation" });
}

const request = (method: string, url: string, body?: unknown) =>
    new NextRequest(`http://localhost${url}`, { method, ...(body === undefined ? {} : { body: JSON.stringify(body), headers: { "content-type": "application/json" } }) });
const params = (id: string) => ({ params: Promise.resolve({ id }) });

beforeAll(async () => {
    root = mkdtempSync(path.join(os.tmpdir(), "dbackup-platform-key-"));
    const file = path.join(root, "platform-key.db");
    execFileSync(path.join(process.cwd(), "node_modules", ".bin", "prisma"), ["migrate", "deploy"], {
        env: { ...process.env, DATABASE_URL: `file:${file}` },
        stdio: "pipe",
    });
    base = new PrismaClient({ datasources: { db: { url: `file:${file}` } } });
    // Like the client of the app: the tenant of the request narrows every query.
    app.client = base.$extends(tenantScopeExtension(async () => (await import("@/lib/tenant/current")).requestScope()));

    for (const [id, name] of [["acme", "Acme"], ["globex", "Globex"]]) await base.tenant.create({ data: { id, name } });
    await base.group.create({ data: { id: "g-acme-admin", name: "Admin", permissions: "[]", fullAccess: true, tenantId: "acme" } });
    await base.group.create({ data: { id: "g-acme-ops", name: "Operators", permissions: JSON.stringify([P.USERS.READ]), tenantId: "acme" } });
    // Nina of the MSP: her platform group manages the tenants and the users of Acme, and no other tenant.
    await base.platformGroup.create({
        data: {
            id: "pg-support", name: "Support",
            platformPermissions: JSON.stringify([P.PLATFORM.TENANTS_READ, P.PLATFORM.TENANTS_WRITE]),
            tenantPermissions: JSON.stringify([P.USERS.READ, P.USERS.WRITE]),
            allTenants: false,
            tenants: { create: [{ tenantId: "acme" }] },
        },
    });
    await base.user.create({ data: { id: "nina", name: "Nina", email: "nina@msp.example", emailVerified: true, createdAt: NOW, updatedAt: NOW, platformGroupId: "pg-support" } });
    // Tom, the admin of Acme.
    await base.user.create({ data: { id: "tom", name: "Tom", email: "tom@acme.example", emailVerified: true, createdAt: NOW, updatedAt: NOW, memberships: { create: { tenantId: "acme", groupId: "g-acme-admin" } } } });

    const made = await runAsTenant("default", () => apiKeyService.create({ name: "MSP automation", permissions: [P.PLATFORM.TENANTS_READ, P.PLATFORM.TENANTS_WRITE], userId: "nina" }));
    ninaKey = made.rawKey;
    ninaKeyId = made.apiKey.id;
    // A key of the customer that stores a right of the platform, which it never gets.
    tomKey = (await runAsTenant("acme", () => apiKeyService.create({ name: "Acme panel", permissions: [P.PLATFORM.TENANTS_READ, P.USERS.READ], userId: "tom" }))).rawKey;
}, 120_000);

afterAll(async () => {
    await base?.$disconnect();
    if (root) rmSync(root, { recursive: true, force: true });
});

describe("a key of the home tenant that manages the tenants", () => {
    it("lists the tenants the platform group of its owner reaches, nothing else", async () => {
        as(ninaKey);
        const response = await tenantsRoute.GET();
        const body = await response.json();

        expect(response.status).toBe(200);
        expect(body.data.map((tenant: { id: string }) => tenant.id)).toEqual(["acme"]);
        expect(body.data[0]).toEqual(expect.objectContaining({ name: "Acme", members: 1, allowances: expect.any(Object), network: expect.any(Object) }));
    });

    it("renames a tenant it reaches into the log of the home tenant with the key, and reads another as gone", async () => {
        as(ninaKey);
        expect((await tenantRoute.PATCH(request("PATCH", "/api/tenants/globex", { name: "Globex AG" }), params("globex"))).status).toBe(404);
        const response = await tenantRoute.PATCH(request("PATCH", "/api/tenants/acme", { name: "Acme AG" }), params("acme"));

        expect(response.status).toBe(200);
        expect((await base.tenant.findUniqueOrThrow({ where: { id: "acme" } })).name).toBe("Acme AG");
        expect((await base.tenant.findUniqueOrThrow({ where: { id: "globex" } })).name).toBe("Globex");
        const entry = await base.auditLog.findFirstOrThrow({ where: { resource: "TENANT", resourceId: "acme", action: "UPDATE" } });
        expect(entry).toEqual(expect.objectContaining({ tenantId: "default", userId: "nina", apiKeyId: ninaKeyId, apiKeyName: "MSP automation", userAgent: "msp-automation" }));
        expect(JSON.parse(entry.details ?? "{}")).toEqual({ name: "Acme AG", renamedFrom: "Acme" });
    });

    it("creates no tenant, since its owner reaches some tenants only", async () => {
        as(ninaKey);
        expect((await tenantsRoute.POST(request("POST", "/api/tenants", { name: "Initech" }))).status).toBe(403);
        expect(await base.tenant.count({ where: { name: "Initech" } })).toBe(0);
    });

    it("makes an invitation of a tenant it reaches, with a group its owner may give there", async () => {
        as(ninaKey);
        const response = await invitationsRoute.POST(request("POST", "/api/tenants/acme/invitations", { groupId: "g-acme-ops", days: 3 }), params("acme"));
        const body = await response.json();

        expect(response.status).toBe(201);
        expect(body.data.path).toBe(`/invite?token=${body.data.token}`);
        const stored = await base.tenantInvitation.findUniqueOrThrow({ where: { id: body.data.id } });
        expect(stored).toEqual(expect.objectContaining({ tenantId: "acme", groupId: "g-acme-ops", createdById: "nina", createdByName: "Nina" }));
        // Only the hash of the token stays.
        expect(stored.tokenHash).not.toBe(body.data.token);
        const entry = await base.auditLog.findFirstOrThrow({ where: { resource: "TENANT", action: "CREATE", tenantId: "acme" } });
        expect(entry.apiKeyId).toBe(ninaKeyId);
        // A group that may do more than her platform group gives in Acme stays out of reach.
        expect((await invitationsRoute.POST(request("POST", "/api/tenants/acme/invitations", { groupId: "g-acme-admin" }), params("acme"))).status).toBe(403);
    });

    it("stops at the next request once its owner lost the right", async () => {
        await base.user.update({ where: { id: "nina" }, data: { platformGroupId: null } });
        as(ninaKey);
        expect((await tenantsRoute.GET()).status).toBe(403);
        await base.user.update({ where: { id: "nina" }, data: { platformGroupId: "pg-support" } });
        as(ninaKey);
        expect((await tenantsRoute.GET()).status).toBe(200);
    });
});

describe("a key of a customer", () => {
    it("never manages a tenant, whatever it stores", async () => {
        as(tomKey);
        expect((await tenantsRoute.GET()).status).toBe(403);
        expect((await tenantRoute.PATCH(request("PATCH", "/api/tenants/acme", { name: "Mine" }), params("acme"))).status).toBe(403);
    });

    it("lists the open invitations of its own tenant with users:read, never of another", async () => {
        as(tomKey);
        const own = await invitationsRoute.GET(request("GET", "/api/tenants/acme/invitations"), params("acme"));
        expect(own.status).toBe(200);
        expect((await own.json()).data).toHaveLength(1);
        expect((await invitationsRoute.GET(request("GET", "/api/tenants/globex/invitations"), params("globex"))).status).toBe(403);
    });
});
