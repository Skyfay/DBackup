// @vitest-environment node
/**
 * The database reads of the explorer take a saved source by its id, or the adapter and the config
 * of a form. A config of a form names the host, the file and the program it runs with, so only
 * someone who may change connections of that kind sends one, inside one tenant. Someone who may
 * only see the sources read SQLite files of the server DBackup runs on with it before, its own
 * database included, with a program of their choosing.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { PermissionError } from "@/lib/logging/errors";
import { AdapterAnswerError } from "@/lib/adapters/adapter-answer";

type Ctx = { userId: string; tenantId: string | null; allTenants: boolean; isPlatformAdmin: boolean; permissions: string[]; authMethod: "session" };

const mocks = vi.hoisted(() => ({
    ctx: null as null | Ctx,
    readDatabaseStats: vi.fn(),
    listTables: vi.fn(),
    readTableData: vi.fn(),
    logFor: vi.fn(),
}));

vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
vi.mock("@/lib/auth/access-control", () => {
    const has = (ctx: Ctx, permission: string) => (ctx.isPlatformAdmin && !ctx.allTenants) || ctx.permissions.includes(permission);
    return {
        getAuthContext: async () => mocks.ctx,
        hasPermissionWithContext: has,
        checkPermissionWithContext: (ctx: Ctx, permission: string) => {
            if (!has(ctx, permission)) throw new PermissionError(permission);
        },
        tenantOf: (ctx: Ctx) => {
            if (!ctx.tenantId) throw new PermissionError("a tenant");
            return ctx.tenantId;
        },
    };
});
vi.mock("@/lib/adapters", () => ({ registerAdapters: vi.fn() }));
vi.mock("@/lib/logging/logger", () => ({ logger: { child: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }) } }));
vi.mock("@/services/audit-service", () => ({ auditService: { logFor: mocks.logFor } }));
vi.mock("@/services/audit/record-names", () => ({
    connectionNames: async (ids: string[]) => new Map(ids.map((id) => [id, "Shop DB"])),
    // The source of a customer, which a platform admin reads from All tenants.
    connectionPlace: async (id: string) => (id === "src-globex" ? { name: "Globex DB", tenantId: "globex" } : { name: "Shop DB", tenantId: "default" }),
}));
vi.mock("@/services/adapters/adapter-audit", () => ({ connectionName: async () => "Shop DB" }));
vi.mock("@/services/databases/database-read-service", () => ({
    readDatabaseStats: (...args: unknown[]) => mocks.readDatabaseStats(...args),
    listTables: (...args: unknown[]) => mocks.listTables(...args),
    readTableData: (...args: unknown[]) => mocks.readTableData(...args),
}));

const stats = await import("@/app/api/adapters/database-stats/route");
const tables = await import("@/app/api/adapters/database-tables/route");
const rows = await import("@/app/api/adapters/database-table-data/route");

const post = (body: unknown) => new NextRequest("http://localhost/api", { method: "POST", body: JSON.stringify(body), headers: { "Content-Type": "application/json" } });
const someone = (...permissions: string[]): Ctx => ({ userId: "lena", tenantId: "default", allTenants: false, isPlatformAdmin: false, permissions, authMethod: "session" });
const READ = [PERMISSIONS.SOURCES.READ, PERMISSIONS.SOURCES.VIEW];

/** SQLite pointed at the database of DBackup, with a program of the caller's choosing. */
const DBACKUP_DB = { adapterId: "sqlite", config: { mode: "local", path: "/app/data/dbackup.db", sqliteBinaryPath: "/tmp/evil" } };

/** The entry of each read of the explorer: the list of databases a run, the tables and rows a hand out. */
const EXPORTS = {
    "database-stats": ["EXECUTE", { action: "databases_read", name: "Shop DB", success: true }],
    "database-tables": ["EXPORT", { action: "table_list", name: "Shop DB", database: "main" }],
    "database-table-data": ["EXPORT", { action: "table_data", name: "Shop DB", database: "main", table: "user", page: 1 }],
} as const;

const routes = [
    { name: "database-stats", send: (body: object) => stats.POST(post(body)), service: () => mocks.readDatabaseStats },
    { name: "database-tables", send: (body: object) => tables.POST(post({ database: "main", ...body })), service: () => mocks.listTables },
    { name: "database-table-data", send: (body: object) => rows.POST(post({ database: "main", table: "user", ...body })), service: () => mocks.readTableData },
] as const;

describe.each(routes)("POST /api/adapters/$name", ({ name, send, service }) => {
    beforeEach(() => {
        mocks.logFor.mockReset();
        mocks.readDatabaseStats.mockReset().mockResolvedValue({ ok: true, value: { databases: [] } });
        mocks.listTables.mockReset().mockResolvedValue({ ok: true, value: [] });
        mocks.readTableData.mockReset().mockResolvedValue({ ok: true, value: { rows: [], columns: [], totalCount: 0 } });
    });

    it("refuses a config of a form to someone who may only see the sources, in the home tenant too", async () => {
        mocks.ctx = someone(...READ);

        const response = await send(DBACKUP_DB);

        expect(response.status).toBe(403);
        expect(service()).not.toHaveBeenCalled();
    });

    it("reads a saved source by its id for them as before", async () => {
        mocks.ctx = someone(...READ);

        expect((await send({ sourceId: "src-1" })).status).toBe(200);
        expect(service()).toHaveBeenCalled();
    });

    it("writes what was read of a database into the audit log, named by the source, the database and the table", async () => {
        mocks.ctx = someone(...READ);

        await send({ sourceId: "src-1" });

        const [action, entry] = EXPORTS[name];
        expect(mocks.logFor).toHaveBeenCalledWith(mocks.ctx, action, "SOURCE", entry, "src-1", { tenantId: "default" });
    });

    it("runs a config of a form for someone who may change sources", async () => {
        mocks.ctx = someone(...READ, PERMISSIONS.SOURCES.WRITE);

        expect((await send({ adapterId: "mysql", config: { host: "db.example" } })).status).toBe(200);
        expect(service()).toHaveBeenCalled();
    });

    it("runs no config of a form in All tenants, also with the right to change sources", async () => {
        mocks.ctx = { ...someone(...READ, PERMISSIONS.SOURCES.WRITE), tenantId: null, allTenants: true, isPlatformAdmin: true };

        expect((await send({ adapterId: "mysql", config: { host: "db.example" } })).status).toBe(403);
        expect(service()).not.toHaveBeenCalled();
    });

    it("passes what the server said, and keeps any other failure in the log", async () => {
        mocks.ctx = someone(...READ);

        service().mockRejectedValueOnce(new AdapterAnswerError("mysql", "read", "Access denied for user 'shop'"));
        const refused = await send({ sourceId: "src-1" });
        expect(refused.status).toBe(500);
        expect((await refused.json()).message).toBe("Access denied for user 'shop'");

        service().mockRejectedValueOnce(new Error("SQLITE_CANTOPEN: /app/data/dbackup.db"));
        const broken = await send({ sourceId: "src-1" });
        expect(broken.status).toBe(500);
        expect((await broken.json()).message).not.toContain("dbackup.db");
    });

    it("answers 403, not 500, to someone who may not see the sources at all", async () => {
        mocks.ctx = someone();

        expect((await send({ sourceId: "src-1" })).status).toBe(403);
        expect(service()).not.toHaveBeenCalled();
        expect(mocks.logFor).not.toHaveBeenCalled();
    });
});

describe.each(routes)("a read of POST /api/adapters/$name from All tenants", ({ name, send }) => {
    beforeEach(() => {
        mocks.logFor.mockReset();
        mocks.readDatabaseStats.mockReset().mockResolvedValue({ ok: true, value: { databases: [] } });
        mocks.listTables.mockReset().mockResolvedValue({ ok: true, value: [] });
        mocks.readTableData.mockReset().mockResolvedValue({ ok: true, value: { rows: [], columns: [], totalCount: 0 } });
    });

    it("goes into the log of the tenant of the source, never the home log", async () => {
        mocks.ctx = { ...someone(...READ), tenantId: null, allTenants: true, isPlatformAdmin: true };

        expect((await send({ sourceId: "src-globex" })).status).toBe(200);

        const [action, entry] = EXPORTS[name];
        expect(mocks.logFor).toHaveBeenCalledWith(mocks.ctx, action, "SOURCE", { ...entry, name: "Globex DB" }, "src-globex", { tenantId: "globex" });
    });
});
