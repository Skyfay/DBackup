import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/adapters/database/firebird/connection", () => ({
    runQuery: vi.fn(),
}));

import { getTables, getTableData } from "@/lib/adapters/database/firebird/browser";
import { runQuery } from "@/lib/adapters/database/firebird/connection";

const baseConfig = {
    host: "localhost",
    port: 3050,
    user: "SYSDBA",
    password: "masterkey",
    databases: [{ name: "testdb", path: "/var/lib/firebird/data/testdb.fdb" }],
    connectionMode: "direct",
};

function mockOutputs(...stdouts: string[]) {
    const mocked = vi.mocked(runQuery);
    stdouts.forEach((stdout) => mocked.mockResolvedValueOnce(stdout));
}

describe("Firebird browser - getTables", () => {
    beforeEach(() => vi.clearAllMocks());

    it("returns parsed table list, trimming isql's fixed-width padding", async () => {
        mockOutputs("PROBE_TABLE\tTABLE                                                     \n");

        const result = await getTables(baseConfig as any, "testdb");

        expect(result).toEqual([{ name: "PROBE_TABLE", type: "table" }]);
    });

    it("maps VIEW type correctly", async () => {
        mockOutputs("PROBE_VIEW\tVIEW\n");

        const result = await getTables(baseConfig as any, "testdb");

        expect(result[0].type).toBe("view");
    });

    it("ignores empty lines in output", async () => {
        mockOutputs("\n\nORDERS\tTABLE\n\n");

        const result = await getTables(baseConfig as any, "testdb");

        expect(result).toHaveLength(1);
        expect(result[0].name).toBe("ORDERS");
    });

    it("returns empty array when output is blank", async () => {
        mockOutputs("");

        const result = await getTables(baseConfig as any, "testdb");

        expect(result).toEqual([]);
    });

    it("surfaces isql failures as errors", async () => {
        vi.mocked(runQuery).mockRejectedValueOnce(new Error("connection refused"));

        await expect(getTables(baseConfig as any, "testdb")).rejects.toThrow("connection refused");
    });
});

describe("Firebird browser - getTableData", () => {
    beforeEach(() => vi.clearAllMocks());

    const options = {
        database: "testdb",
        table: "PROBE_TABLE",
        page: 1,
        pageSize: 10,
    };

    it("returns rows, totalCount and columns from LIST-mode output", async () => {
        // Column query: name, type, subtype, length, precision, scale, nullable, pk
        const colStdout = "ID\t8\t0\t4\t0\t0\tY\tPRI\nNAME\t37\t0\t50\t0\t0\tY\t\n";
        const countStdout = "                    2\n";
        const dataStdout =
            "ID                              1\nNAME                            alice\n\n" +
            "ID                              2\nNAME                            bob\n";

        mockOutputs(colStdout, countStdout, dataStdout);

        const result = await getTableData(baseConfig as any, options as any);

        expect(result.totalCount).toBe(2);
        expect(result.columns).toHaveLength(2);
        expect(result.columns[0]).toMatchObject({ name: "ID", dataType: "INTEGER", primaryKey: true });
        expect(result.columns[1]).toMatchObject({ name: "NAME", dataType: "VARCHAR(50)", primaryKey: false });
        expect(result.rows).toEqual([
            { ID: "1", NAME: "alice" },
            { ID: "2", NAME: "bob" },
        ]);
    });

    it("maps NUMERIC/DECIMAL types using scale and precision", async () => {
        const colStdout = "AMOUNT\t16\t1\t8\t10\t-2\tY\t\n";
        mockOutputs(colStdout, "0\n", "");

        const result = await getTableData(baseConfig as any, options as any);

        expect(result.columns[0].dataType).toBe("NUMERIC(10,2)");
    });

    it("treats <null> as null", async () => {
        const colStdout = "NAME\t37\t0\t50\t0\t0\tY\t\n";
        const countStdout = "1\n";
        const dataStdout = "NAME                            <null>\n";

        mockOutputs(colStdout, countStdout, dataStdout);

        const result = await getTableData(baseConfig as any, options as any);

        expect(result.rows[0].NAME).toBeNull();
    });

    it("builds a ROWS clause reflecting page/pageSize", async () => {
        mockOutputs("", "0\n", "");

        await getTableData(baseConfig as any, { ...options, page: 3, pageSize: 20 } as any);

        const dataCall = vi.mocked(runQuery).mock.calls[2];
        expect(dataCall[2]).toContain("ROWS 41 TO 60");
    });

    it("applies sortBy and sortDir to the data query", async () => {
        mockOutputs("", "0\n", "");

        await getTableData(baseConfig as any, { ...options, sortBy: "NAME", sortDir: "desc" } as any);

        const dataCall = vi.mocked(runQuery).mock.calls[2];
        expect(dataCall[2]).toContain('ORDER BY "NAME" DESC');
    });
});

describe("Firebird browser - SQL escaping", () => {
    beforeEach(() => vi.clearAllMocks());

    it("escapes single quotes in table name (columnsQuery)", async () => {
        mockOutputs("", "0\n", "");

        await getTableData(baseConfig as any, {
            database: "testdb",
            table: "O'REILLY",
            page: 1,
            pageSize: 10,
        } as any);

        const colCall = vi.mocked(runQuery).mock.calls[0];
        expect(colCall[2]).toContain("O''REILLY");
    });

    it("escapes double quotes in identifiers used for quoting", async () => {
        mockOutputs("", "0\n", "");

        await getTableData(baseConfig as any, {
            database: "testdb",
            table: 'WEIRD"NAME',
            page: 1,
            pageSize: 10,
        } as any);

        const dataCall = vi.mocked(runQuery).mock.calls[2];
        expect(dataCall[2]).toContain('"WEIRD""NAME"');
    });
});
