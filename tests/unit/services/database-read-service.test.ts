// @vitest-environment node
/**
 * A read by the config of a form runs the program a saved connection names or the default one,
 * never one the request brings along, and is checked against the server DBackup runs on first.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AdapterError, ValidationError } from "@/lib/logging/errors";

const mocks = vi.hoisted(() => ({
    offHost: vi.fn(),
    getTables: vi.fn(),
    getTableData: vi.fn(),
    getDatabases: vi.fn(),
    findSource: vi.fn(),
    storedConfig: vi.fn(),
    mayReachHost: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({ default: { adapterConfig: { findUnique: (...args: unknown[]) => mocks.findSource(...args) } } }));
vi.mock("@/lib/adapters", () => ({ registerAdapters: vi.fn() }));
vi.mock("@/lib/adapters/config-resolver", async (importOriginal) => ({
    ...(await importOriginal<typeof import("@/lib/adapters/config-resolver")>()),
    assertConfigOffHost: (...args: unknown[]) => mocks.offHost(...args),
    resolveAdapterConfig: (...args: unknown[]) => mocks.storedConfig(...args),
    mayReachHost: () => mocks.mayReachHost(),
}));
vi.mock("@/lib/core/registry", () => ({
    registry: {
        get: (id: string) => (id === "sqlite" ? { id, getTables: mocks.getTables, getTableData: mocks.getTableData, getDatabases: mocks.getDatabases } : undefined),
    },
}));
vi.mock("@/lib/transport", () => ({
    withHost: async (_adapter: unknown, _config: unknown, fn: (host: unknown) => Promise<unknown>) => fn({}),
}));

const { listTables, readDatabaseStats, readTableData } = await import("@/services/databases/database-read-service");

const FORM = { mode: "ssh", host: "files.acme", path: "/srv/app.db", sqliteBinaryPath: "/tmp/evil" };
const WITHOUT_PROGRAM = { mode: "ssh", host: "files.acme", path: "/srv/app.db" };

describe("a read by the config of a form", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.offHost.mockResolvedValue(undefined);
        mocks.getTables.mockResolvedValue([]);
        mocks.getTableData.mockResolvedValue({ rows: [], columns: [], totalCount: 0 });
        mocks.getDatabases.mockResolvedValue(["app"]);
    });

    it("lists tables without the program the request names", async () => {
        await listTables({ adapterId: "sqlite", config: FORM }, "app");

        expect(mocks.offHost).toHaveBeenCalledWith("sqlite", WITHOUT_PROGRAM);
        expect(mocks.getTables).toHaveBeenCalledWith(WITHOUT_PROGRAM, "app", {});
    });

    it("reads rows and the databases without it too", async () => {
        await readTableData({ adapterId: "sqlite", config: FORM }, { database: "app", table: "user", page: 1, pageSize: 50 });
        expect(mocks.getTableData).toHaveBeenCalledWith(WITHOUT_PROGRAM, expect.anything(), {});

        await readDatabaseStats({ adapterId: "sqlite", config: FORM });
        expect(mocks.getDatabases).toHaveBeenCalledWith(WITHOUT_PROGRAM, {});
    });

    it("never reaches the server when the check refuses the config", async () => {
        mocks.offHost.mockRejectedValue(new Error("SQLite in local mode reads a file on the server DBackup runs on"));

        await expect(listTables({ adapterId: "sqlite", config: { ...FORM, mode: "local" } }, "app")).rejects.toThrow("SQLite in local mode");
        expect(mocks.getTables).not.toHaveBeenCalled();
    });
});

describe("the tables of a saved connection that reaches the server DBackup runs on", () => {
    const options = { database: "app", table: "user", page: 1, pageSize: 50 };

    beforeEach(() => {
        vi.clearAllMocks();
        mocks.findSource.mockResolvedValue({ id: "local-db", adapterId: "sqlite" });
        mocks.storedConfig.mockResolvedValue({ mode: "local", path: "/data/app.db" });
        mocks.getTables.mockResolvedValue([]);
        mocks.getTableData.mockResolvedValue({ rows: [], columns: [], totalCount: 0 });
    });

    it("are refused to a member before the program on the server runs", async () => {
        mocks.mayReachHost.mockResolvedValue(false);

        await expect(listTables({ sourceId: "local-db" }, "app")).rejects.toThrow("only a platform admin browses its tables");
        await expect(readTableData({ sourceId: "local-db" }, options)).rejects.toBeInstanceOf(ValidationError);
        expect(mocks.getTables).not.toHaveBeenCalled();
        expect(mocks.getTableData).not.toHaveBeenCalled();
    });

    it("are read for a platform admin with a session in the home tenant", async () => {
        mocks.mayReachHost.mockResolvedValue(true);

        await expect(listTables({ sourceId: "local-db" }, "app")).resolves.toEqual({ ok: true, value: [] });
    });

    it("stay open to a member for a saved connection over SSH", async () => {
        mocks.mayReachHost.mockResolvedValue(false);
        mocks.storedConfig.mockResolvedValue({ mode: "ssh", host: "files.acme", path: "/srv/app.db" });

        await expect(readTableData({ sourceId: "local-db" }, options)).resolves.toMatchObject({ ok: true });
    });
});

describe("a read that the server refused", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.offHost.mockResolvedValue(undefined);
    });

    it("comes back as the answer of the adapter, so the route passes the words of the server", async () => {
        mocks.getTables.mockRejectedValue(new Error("file is not a database"));
        mocks.getTableData.mockRejectedValue(new Error("no such table: user"));
        mocks.getDatabases.mockRejectedValue(new Error("Permission denied (publickey)"));

        await expect(listTables({ adapterId: "sqlite", config: FORM }, "app")).rejects.toBeInstanceOf(AdapterError);
        await expect(listTables({ adapterId: "sqlite", config: FORM }, "app")).rejects.toThrow("file is not a database");
        await expect(readTableData({ adapterId: "sqlite", config: FORM }, { database: "app", table: "user", page: 1, pageSize: 50 })).rejects.toBeInstanceOf(AdapterError);
        await expect(readDatabaseStats({ adapterId: "sqlite", config: FORM })).rejects.toBeInstanceOf(AdapterError);
    });

    it("keeps a refusal of DBackup as it is", async () => {
        mocks.getTables.mockRejectedValue(new ValidationError("The host is in the local network"));

        await expect(listTables({ adapterId: "sqlite", config: FORM }, "app")).rejects.toBeInstanceOf(ValidationError);
    });
});
