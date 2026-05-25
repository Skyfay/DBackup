import { describe, it, expect, vi, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// Hoisted mock state
// ---------------------------------------------------------------------------
const { mockExecFile, mockIsSSHMode } = vi.hoisted(() => ({
    mockExecFile: vi.fn(),
    mockIsSSHMode: vi.fn().mockReturnValue(false),
}));

// Include `default` export so CJS interop works correctly.
vi.mock("child_process", () => ({
    execFile: mockExecFile,
    default: { execFile: mockExecFile },
}));

vi.mock("@/lib/ssh", () => ({
    SshClient: class {
        connect = vi.fn();
        exec = vi.fn();
        end = vi.fn();
    },
    isSSHMode: (...args: unknown[]) => mockIsSSHMode(...args),
    extractSqliteSshConfig: vi.fn(),
    remoteBinaryCheck: vi.fn(),
    shellEscape: vi.fn((s: string) => s),
}));

import { getTables, getTableData } from "@/lib/adapters/database/sqlite/browser";

/**
 * Helper: queue callback-style results for execFile calls.
 * util.promisify(execFile) resolves with { stdout, stderr } so the callback
 * must receive the result as a single object (matching Node's custom promisify).
 */
function queueExecResponses(...responses: Array<{ stdout: string; stderr?: string }>) {
    for (const r of responses) {
        mockExecFile.mockImplementationOnce((...args: unknown[]) => {
            const cb = args[args.length - 1] as (
                err: null,
                result: { stdout: string; stderr: string }
            ) => void;
            cb(null, { stdout: r.stdout, stderr: r.stderr ?? "" });
        });
    }
}

const baseConfig = {
    path: "/data/app.db",
    mode: "local",
    sqliteBinaryPath: "sqlite3",
};

describe("SQLite browser - getTables", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockIsSSHMode.mockReturnValue(false);
    });

    it("returns parsed tables from sqlite_master output", async () => {
        queueExecResponses(
            { stdout: "users|table\norders|table\n" }, // list tables
            { stdout: "5\n12\n" }                      // row counts
        );

        const result = await getTables(baseConfig as any, "");

        expect(result).toHaveLength(2);
        expect(result[0]).toMatchObject({ name: "users", type: "table", rowCount: 5 });
        expect(result[1]).toMatchObject({ name: "orders", type: "table", rowCount: 12 });
    });

    it("maps 'view' type correctly", async () => {
        queueExecResponses({ stdout: "v_active|view\n" });

        const result = await getTables(baseConfig as any, "");

        expect(result[0].type).toBe("view");
    });

    it("returns empty array when no tables exist", async () => {
        queueExecResponses({ stdout: "" });

        const result = await getTables(baseConfig as any, "");

        expect(result).toEqual([]);
    });

    it("ignores empty lines", async () => {
        queueExecResponses(
            { stdout: "\nusers|table\n\n" },
            { stdout: "7\n" }
        );

        const result = await getTables(baseConfig as any, "");

        expect(result).toHaveLength(1);
    });
});

describe("SQLite browser - getTableData", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockIsSSHMode.mockReturnValue(false);
    });

    const options = {
        database: "",
        table: "users",
        page: 1,
        pageSize: 5,
    };

    it("returns columns and rows from PRAGMA and SELECT output", async () => {
        queueExecResponses(
            { stdout: "0|id|INTEGER|1|NULL|1\n1|name|TEXT|0|NULL|0\n" }, // PRAGMA
            { stdout: "3\n" },                                            // COUNT(*)
            { stdout: "1\tAlice\n2\tBob\n3\tCarl\n" }                    // SELECT *
        );

        const result = await getTableData(baseConfig as any, options as any);

        expect(result.totalCount).toBe(3);
        expect(result.columns).toHaveLength(2);
        expect(result.columns[0]).toMatchObject({ name: "id", primaryKey: true });
        expect(result.rows).toHaveLength(3);
        expect(result.rows[0]).toEqual({ id: "1", name: "Alice" });
    });

    it("handles search with 'equals' matchMode", async () => {
        queueExecResponses(
            { stdout: "0|name|TEXT|0|NULL|0\n" },
            { stdout: "1\n" },
            { stdout: "Alice\n" }
        );

        const result = await getTableData(baseConfig as any, {
            ...options,
            search: "Alice",
            searchColumn: "name",
            matchMode: "equals",
        } as any);

        expect(result.rows).toHaveLength(1);
    });
});
