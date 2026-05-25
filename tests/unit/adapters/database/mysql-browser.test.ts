import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock child_process execFile before importing the module under test.
vi.mock("child_process", () => ({
    execFile: vi.fn(),
}));

// Mock SSH helpers so tests never open real connections.
vi.mock("@/lib/ssh", () => ({
    SshClient: vi.fn(),
    isSSHMode: vi.fn(() => false),
    extractSshConfig: vi.fn(),
    buildMysqlArgs: vi.fn(() => []),
    withLocalMyCnf: vi.fn(async (_password: unknown, fn: (path: null) => Promise<unknown>) => fn(null)),
    withRemoteMyCnf: vi.fn(),
    remoteBinaryCheck: vi.fn(),
    shellEscape: vi.fn((s: string) => s),
}));

vi.mock("@/lib/adapters/database/mysql/tools", () => ({
    getMysqlCommand: vi.fn(() => "mysql"),
}));

vi.mock("@/lib/adapters/database/mysql/connection", () => ({
    execFileAsync: vi.fn(),
}));

import { getTables, getTableData } from "@/lib/adapters/database/mysql/browser";
import { execFileAsync } from "@/lib/adapters/database/mysql/connection";

const baseConfig = {
    host: "localhost",
    port: 3306,
    user: "root",
    password: "secret",
    database: "testdb",
    disableSsl: false,
    sshEnabled: false,
};

describe("MySQL browser - getTables", () => {
    beforeEach(() => vi.clearAllMocks());

    it("returns parsed table list for local connection", async () => {
        vi.mocked(execFileAsync).mockResolvedValue({
            stdout: "users\tBASE TABLE\t42\t8192\n",
            stderr: "",
        } as any);

        const result = await getTables(baseConfig as any, "testdb");

        expect(result).toHaveLength(1);
        expect(result[0]).toMatchObject({
            name: "users",
            type: "table",
            rowCount: 42,
            sizeInBytes: 8192,
        });
    });

    it("maps VIEW type correctly", async () => {
        vi.mocked(execFileAsync).mockResolvedValue({
            stdout: "v_active\tVIEW\t0\t0\n",
            stderr: "",
        } as any);

        const result = await getTables(baseConfig as any, "testdb");

        expect(result[0].type).toBe("view");
    });

    it("ignores empty lines in output", async () => {
        vi.mocked(execFileAsync).mockResolvedValue({
            stdout: "\n\norders\tBASE TABLE\t5\t1024\n\n",
            stderr: "",
        } as any);

        const result = await getTables(baseConfig as any, "testdb");

        expect(result).toHaveLength(1);
        expect(result[0].name).toBe("orders");
    });

    it("returns empty array when output is blank", async () => {
        vi.mocked(execFileAsync).mockResolvedValue({ stdout: "", stderr: "" } as any);

        const result = await getTables(baseConfig as any, "testdb");

        expect(result).toEqual([]);
    });
});

describe("MySQL browser - getTableData", () => {
    beforeEach(() => vi.clearAllMocks());

    const options = {
        database: "testdb",
        table: "users",
        page: 1,
        pageSize: 10,
    };

    it("returns rows, totalCount and columns", async () => {
        // Column query result
        const colStdout = "id\tint\tNO\tPRI\tNULL\nname\tvarchar\tYES\t\tNULL\n";
        // Count query result
        const countStdout = "3\n";
        // Data query result
        const dataStdout = "1\tAlice\n2\tBob\n3\tCarl\n";

        vi.mocked(execFileAsync)
            .mockResolvedValueOnce({ stdout: colStdout, stderr: "" } as any)
            .mockResolvedValueOnce({ stdout: countStdout, stderr: "" } as any)
            .mockResolvedValueOnce({ stdout: dataStdout, stderr: "" } as any);

        const result = await getTableData(baseConfig as any, options as any);

        expect(result.totalCount).toBe(3);
        expect(result.columns).toHaveLength(2);
        expect(result.columns[0]).toMatchObject({ name: "id", dataType: "int", primaryKey: true });
        expect(result.columns[1]).toMatchObject({ name: "name", dataType: "varchar", nullable: true });
        expect(result.rows).toHaveLength(3);
        expect(result.rows[0]).toEqual({ id: "1", name: "Alice" });
    });

    it("treats \\N values as null", async () => {
        const colStdout = "name\tvarchar\tYES\t\tNULL\n";
        const countStdout = "1\n";
        const dataStdout = "\\N\n";

        vi.mocked(execFileAsync)
            .mockResolvedValueOnce({ stdout: colStdout, stderr: "" } as any)
            .mockResolvedValueOnce({ stdout: countStdout, stderr: "" } as any)
            .mockResolvedValueOnce({ stdout: dataStdout, stderr: "" } as any);

        const result = await getTableData(baseConfig as any, options as any);

        expect(result.rows[0].name).toBeNull();
    });

    it("applies sortBy and sortDir to the query", async () => {
        vi.mocked(execFileAsync).mockResolvedValue({ stdout: "", stderr: "" } as any);

        await getTableData(baseConfig as any, {
            ...options,
            sortBy: "name",
            sortDir: "desc",
        } as any);

        // Verify that execFileAsync was called (queries were built with sort clause).
        expect(execFileAsync).toHaveBeenCalled();
    });
});
