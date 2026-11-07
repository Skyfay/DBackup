// @vitest-environment node
/**
 * What the platform does not let a tenant add, the server refuses, against a real SQLite database
 * migrated with the migrations of this version: through the API, a clone, a restore from Recently
 * deleted and a new API key, whatever the page offers. What the tenant has keeps working.
 */
import { execFileSync } from "child_process";
import { mkdtempSync, rmSync } from "fs";
import os from "os";
import path from "path";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { PrismaClient } from "@prisma/client";
import { runAsTenant } from "@/lib/tenant/context";
import { tenantScopeExtension } from "@/lib/tenant/prisma-scope";

vi.stubEnv("ENCRYPTION_KEY", "a".repeat(64));

vi.mock("@/lib/logging/logger", () => ({
    logger: { child: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }) },
}));

const app = vi.hoisted(() => ({ client: null as unknown as object }));
vi.mock("@/lib/prisma", () => ({
    default: new Proxy({}, {
        get: (_target, key) => {
            const value = Reflect.get(app.client, key);
            return typeof value === "function" ? value.bind(app.client) : value;
        },
    }),
}));

/** The request comes from the admin of Globex, with an API key or a session, who may do everything there. */
const request = vi.hoisted(() => ({ ctx: { userId: "globex-admin", tenantId: "globex", permissions: [] as string[] } }));
vi.mock("next/headers", () => ({ headers: vi.fn(async () => new Headers()) }));
vi.mock("@/lib/server/request-headers", () => ({ requestHeaders: vi.fn(async () => new Headers()) }));
vi.mock("@/lib/auth/access-control", () => ({
    getAuthContext: vi.fn(async () => request.ctx),
    checkPermissionWithContext: vi.fn(),
    hasPermissionWithContext: vi.fn(() => false),
}));
vi.mock("@/services/audit-service", () => ({ auditService: { log: vi.fn(), logFor: vi.fn() } }));
vi.mock("@/lib/server/scheduler", () => ({ scheduler: { refresh: vi.fn(async () => undefined) } }));

const { POST: createRoute } = await import("@/app/api/adapters/route");
const { POST: cloneRoute } = await import("@/app/api/adapters/[id]/clone/route");
const { restoreFromTrash } = await import("@/services/trash/trash-service");
const { apiKeyService } = await import("@/services/auth/api-key-service");

let root = "";
let base: PrismaClient;

beforeAll(async () => {
    root = mkdtempSync(path.join(os.tmpdir(), "dbackup-allowances-"));
    const file = path.join(root, "allowances.db");
    execFileSync(path.join(process.cwd(), "node_modules", ".bin", "prisma"), ["migrate", "deploy"], {
        env: { ...process.env, DATABASE_URL: `file:${file}` },
        stdio: "pipe",
    });
    base = new PrismaClient({ datasources: { db: { url: `file:${file}` } } });
    app.client = base.$extends(tenantScopeExtension(async () => request.ctx.tenantId));
    const now = new Date("2026-10-17T10:00:00.000Z");
    await base.tenant.update({ where: { id: "default" }, data: { name: "Acme Hosting" } });
    await base.tenant.create({ data: { id: "globex", name: "Globex", addsDatabases: false, addsDestinations: false, addsApiKeys: false } });
    await base.user.create({ data: { id: "globex-admin", name: "Gina", email: "gina@globex.example", emailVerified: true, createdAt: now, updatedAt: now } });
    // What Globex had before the platform switched it off keeps working.
    await base.adapterConfig.create({ data: { tenantId: "globex", id: "globex-db", name: "Shop", type: "database", adapterId: "mysql", config: "{}" } });
}, 120_000);

afterAll(async () => {
    await base?.$disconnect();
    if (root) rmSync(root, { recursive: true, force: true });
});

beforeEach(() => {
    request.ctx = { userId: "globex-admin", tenantId: "globex", permissions: [] };
});

const create = (body: Record<string, unknown>) =>
    createRoute(new NextRequest("http://localhost/api/adapters", { method: "POST", body: JSON.stringify(body), headers: { "content-type": "application/json" } }));

const count = (where: Record<string, unknown>) => base.adapterConfig.count({ where: { tenantId: "globex", ...where } });

describe("what the platform does not let a tenant add", () => {
    it("is refused through the API, with who decides it", async () => {
        const response = await create({ name: "Second shop", type: "database", adapterId: "mysql", config: { host: "db.globex.example", port: 3306, user: "backup" } });
        expect(response.status).toBe(400);
        expect((await response.json()).error).toBe("Globex adds no database connections of its own. Acme Hosting decides that, ask them for one.");
        expect(await count({ type: "database" })).toBe(1);
    });

    it("is refused for a destination, while a directory source it may add still goes in", async () => {
        const destination = await create({ name: "Own NAS", type: "storage", adapterId: "sftp", storageRole: "DESTINATION", config: { host: "nas.globex.example", port: 22, username: "backup", password: "secret", pathPrefix: "/backups" } });
        expect(destination.status).toBe(400);
        // A storage connection without a role is a destination, the default of the column.
        const defaulted = await create({ name: "Own NAS", type: "storage", adapterId: "sftp", config: { host: "nas.globex.example", port: 22, username: "backup", password: "secret", pathPrefix: "/backups" } });
        expect(defaulted.status).toBe(400);
        const source = await create({ name: "Files", type: "storage", adapterId: "sftp", storageRole: "SOURCE", config: { host: "files.globex.example", port: 22, username: "backup", password: "secret", pathPrefix: "/srv" } });
        expect(source.status).toBeLessThan(300);
        expect(await count({ type: "storage", storageRole: "DESTINATION" })).toBe(0);
        expect(await count({ type: "storage", storageRole: "SOURCE" })).toBe(1);
    });

    it("is refused as a copy of a connection the tenant has", async () => {
        const response = await cloneRoute(
            new NextRequest("http://localhost/api/adapters/globex-db/clone", { method: "POST", body: JSON.stringify({ name: "Shop copy" }), headers: { "content-type": "application/json" } }),
            { params: Promise.resolve({ id: "globex-db" }) },
        );
        expect(response.status).toBe(400);
        expect(await count({ type: "database" })).toBe(1);
    });

    it("is refused as a connection back from Recently deleted", async () => {
        const record = { tenantId: "globex", id: "globex-old", name: "Old shop", type: "database", adapterId: "mysql", config: "{}", primaryCredentialId: null, sshCredentialId: null };
        await base.deletedRecord.create({ data: { tenantId: "globex", id: "trash-old", kind: "connection", recordId: "globex-old", name: "Old shop", data: JSON.stringify({ record }), permission: "sources:write" } });

        const result = await runAsTenant("globex", () => restoreFromTrash(["trash-old"]));

        expect(result.restored).toEqual([]);
        expect(result.failed).toEqual([{ id: "trash-old", name: "Old shop", error: "Globex adds no database connections of its own. Acme Hosting decides that, ask them for one." }]);
        expect(await base.adapterConfig.count({ where: { id: "globex-old" } })).toBe(0);
    });

    it("is refused as a new API key", async () => {
        await expect(runAsTenant("globex", () => apiKeyService.create({ name: "CI", permissions: ["jobs:read"], userId: "globex-admin" } as never)))
            .rejects.toThrow("Globex makes no API keys. Acme Hosting decides that.");
        expect(await base.apiKey.count({ where: { tenantId: "globex" } })).toBe(0);
    });

    it("stops the keys the tenant has too, and lets them work again once the platform turns them on", async () => {
        await base.tenant.update({ where: { id: "globex" }, data: { addsApiKeys: true } });
        const { rawKey } = await runAsTenant("globex", () => apiKeyService.create({ name: "Panel", permissions: ["jobs:read"], userId: "globex-admin" } as never));
        await expect(apiKeyService.validate(rawKey)).resolves.toMatchObject({ tenantId: "globex" });

        await base.tenant.update({ where: { id: "globex" }, data: { addsApiKeys: false } });
        await expect(apiKeyService.validate(rawKey)).rejects.toMatchObject({ reason: "blocked", message: "API keys are switched off for this tenant" });

        await base.tenant.update({ where: { id: "globex" }, data: { addsApiKeys: true } });
        await expect(apiKeyService.validate(rawKey)).resolves.toMatchObject({ tenantId: "globex" });
        await base.tenant.update({ where: { id: "globex" }, data: { addsApiKeys: false } });
    });

    it("leaves the home tenant free, which the platform never limits", async () => {
        request.ctx = { userId: "globex-admin", tenantId: "default", permissions: [] };
        const response = await create({ name: "Platform shop", type: "database", adapterId: "mysql", config: { host: "db.acme.example", port: 3306, user: "backup" } });
        expect(response.status).toBeLessThan(300);
    });
});
