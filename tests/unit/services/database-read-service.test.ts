// @vitest-environment node
/**
 * A read by the config of a form runs the program a saved connection names or the default one,
 * never one the request brings along, and is checked against the server DBackup runs on first.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
    offHost: vi.fn(),
    getTables: vi.fn(),
    getTableData: vi.fn(),
    getDatabases: vi.fn(),
}));

vi.mock("@/lib/adapters", () => ({ registerAdapters: vi.fn() }));
vi.mock("@/lib/adapters/config-resolver", async (importOriginal) => ({
    ...(await importOriginal<typeof import("@/lib/adapters/config-resolver")>()),
    assertConfigOffHost: (...args: unknown[]) => mocks.offHost(...args),
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
