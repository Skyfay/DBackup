// @vitest-environment node
/**
 * A read of the databases of a server reaches it with the login of the source, from a connection
 * form, a saved source or the restore page. Like the test of a connection, each read that ran goes
 * into the audit log, whether the server answered or not, and a read that never reached the server
 * writes nothing.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { PermissionError } from "@/lib/logging/errors";

type Ctx = { userId: string; tenantId: string | null; allTenants: boolean; isPlatformAdmin: boolean; permissions: string[]; authMethod: "session" };

const mocks = vi.hoisted(() => ({
    ctx: null as null | Ctx,
    getDatabases: vi.fn(),
    listSourceDatabases: vi.fn(),
    readDatabaseStats: vi.fn(),
    savedConnection: vi.fn(),
    logFor: vi.fn(),
}));

vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
vi.mock("@/lib/auth/access-control", () => {
    const has = (ctx: Ctx, permission: string) => ctx.isPlatformAdmin || ctx.permissions.includes(permission);
    return {
        getAuthContext: async () => mocks.ctx,
        hasPermissionWithContext: has,
        checkPermissionWithContext: (ctx: Ctx, permission: string) => {
            if (!has(ctx, permission)) throw new PermissionError(permission);
        },
        tenantOf: (ctx: Ctx) => ctx.tenantId,
    };
});
vi.mock("@/lib/adapters", () => ({ registerAdapters: vi.fn() }));
vi.mock("@/lib/core/registry", () => ({ registry: { get: () => ({ id: "mysql", getDatabases: mocks.getDatabases }) } }));
vi.mock("@/lib/transport", () => ({ withHost: (_adapter: unknown, _config: unknown, run: (host: undefined) => unknown) => run(undefined) }));
vi.mock("@/lib/adapters/config-resolver", () => ({
    applyStoredSecrets: async (_adapterId: string, _id: string, config: unknown) => config,
    overlayCredentialsOnConfig: async (_adapterId: string, config: unknown) => config,
}));
vi.mock("@/lib/server/config-backup-target-guard", () => ({ savedLoginRefusal: async () => null, storedSecretsRefusal: async () => null }));
vi.mock("@/services/audit-service", () => ({ auditService: { logFor: mocks.logFor } }));
vi.mock("@/services/adapters/adapter-audit", () => ({ connectionName: async (id: string) => (id === "src-1" ? "Shop MySQL" : null) }));
// The source and its tenant, whose log keeps the entry of a read, also from All tenants.
vi.mock("@/services/audit/record-names", () => ({ connectionPlace: async (id: string) => (id === "src-1" ? { name: "Shop MySQL", tenantId: "acme" } : null) }));
vi.mock("@/services/adapters/adapter-list", () => ({ getSavedConnection: (...args: unknown[]) => mocks.savedConnection(...args) }));
vi.mock("@/services/databases/database-read-service", () => ({
    listSourceDatabases: (...args: unknown[]) => mocks.listSourceDatabases(...args),
    readDatabaseStats: (...args: unknown[]) => mocks.readDatabaseStats(...args),
}));

const { POST: accessCheck } = await import("@/app/api/adapters/access-check/route");
const { POST: databaseStats } = await import("@/app/api/adapters/database-stats/route");
const { GET: sourceDatabases } = await import("@/app/api/adapters/[id]/databases/route");

const post = (body: unknown) => new NextRequest("http://localhost/api", { method: "POST", body: JSON.stringify(body), headers: { "Content-Type": "application/json" } });
const EDITOR: Ctx = { userId: "lena", tenantId: "acme", allTenants: false, isPlatformAdmin: false, permissions: ["sources:view", "sources:read", "sources:write"], authMethod: "session" };
const FORM = { adapterId: "mysql", config: { host: "db.example" } };

beforeEach(() => {
    vi.clearAllMocks();
    mocks.ctx = EDITOR;
    mocks.getDatabases.mockResolvedValue(["shop"]);
    mocks.listSourceDatabases.mockResolvedValue(["shop"]);
    mocks.readDatabaseStats.mockResolvedValue({ ok: true, value: { databases: [] } });
    mocks.savedConnection.mockResolvedValue({ id: "src-1", adapterId: "mysql", name: "Shop MySQL" });
});

describe("the access check of a connection form", () => {
    it("notes a read of a new connection once it ran", async () => {
        expect((await accessCheck(post(FORM))).status).toBe(200);

        expect(mocks.logFor).toHaveBeenCalledWith(EDITOR, "EXECUTE", "SOURCE", { action: "databases_read", form: true, adapter: "mysql", success: true }, undefined, { tenantId: undefined });
    });

    it("names the saved source of the form, and notes a read the server refused", async () => {
        mocks.getDatabases.mockRejectedValueOnce(new Error("Access denied for user 'backup'"));

        expect((await accessCheck(post({ ...FORM, configId: "src-1" }))).status).toBe(500);

        expect(mocks.logFor).toHaveBeenCalledWith(EDITOR, "EXECUTE", "SOURCE", { action: "databases_read", name: "Shop MySQL", adapter: "mysql", success: false }, "src-1", { tenantId: "acme" });
    });

    it("notes nothing for someone it refuses", async () => {
        mocks.ctx = { ...EDITOR, permissions: ["sources:view"] };

        expect((await accessCheck(post(FORM))).status).toBe(403);
        expect(mocks.logFor).not.toHaveBeenCalled();
    });
});

describe("the databases of a saved source", () => {
    it("notes the read with the source once it ran", async () => {
        const response = await sourceDatabases(new NextRequest("http://localhost/api"), { params: Promise.resolve({ id: "src-1" }) });

        expect(response.status).toBe(200);
        expect(mocks.logFor).toHaveBeenCalledWith(EDITOR, "EXECUTE", "SOURCE", { action: "databases_read", name: "Shop MySQL", adapter: "mysql", success: true }, "src-1", { tenantId: "acme" });
    });

    it("notes a read the server refused too", async () => {
        mocks.listSourceDatabases.mockRejectedValueOnce(new Error("connect ECONNREFUSED"));

        await sourceDatabases(new NextRequest("http://localhost/api"), { params: Promise.resolve({ id: "src-1" }) });

        expect(mocks.logFor).toHaveBeenCalledWith(EDITOR, "EXECUTE", "SOURCE", expect.objectContaining({ action: "databases_read", success: false }), "src-1", { tenantId: "acme" });
    });
});

describe("the databases of a server with their size", () => {
    it("notes a read of a saved source once it ran", async () => {
        expect((await databaseStats(post({ sourceId: "src-1" }))).status).toBe(200);

        expect(mocks.logFor).toHaveBeenCalledWith(EDITOR, "EXECUTE", "SOURCE", { action: "databases_read", name: "Shop MySQL", success: true }, "src-1", { tenantId: "acme" });
    });

    it("notes a read the server refused", async () => {
        mocks.readDatabaseStats.mockRejectedValueOnce(new Error("timeout"));

        await databaseStats(post(FORM));

        expect(mocks.logFor).toHaveBeenCalledWith(EDITOR, "EXECUTE", "SOURCE", { action: "databases_read", form: true, adapter: "mysql", success: false }, undefined, { tenantId: undefined });
    });

    it("notes nothing when the read never reached the server", async () => {
        mocks.readDatabaseStats.mockResolvedValueOnce({ ok: false, reason: "source-missing" });

        expect((await databaseStats(post({ sourceId: "gone" }))).status).toBe(404);
        expect(mocks.logFor).not.toHaveBeenCalled();
    });
});
