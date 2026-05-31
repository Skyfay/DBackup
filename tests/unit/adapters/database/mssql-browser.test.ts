import { describe, it, expect, vi, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// Hoisted mock state
// ---------------------------------------------------------------------------
const {
    mockConnect,
    mockClose,
    mockQuery,
    mockInput,
} = vi.hoisted(() => ({
    mockConnect: vi.fn().mockResolvedValue(undefined),
    mockClose: vi.fn().mockResolvedValue(undefined),
    mockQuery: vi.fn().mockResolvedValue({ recordset: [] }),
    mockInput: vi.fn(),
}));

vi.mock("mssql", () => {
    class MockConnectionPool {
        connect = mockConnect;
        close = mockClose;
        request() {
            return {
                input: (...args: unknown[]) => { mockInput(...args); return this.request(); },
                query: (...args: unknown[]) => mockQuery(...args),
            };
        }
    }
    return { default: { ConnectionPool: MockConnectionPool, NVarChar: "NVarChar" }, NVarChar: "NVarChar" };
});

vi.mock("@/lib/adapters/database/mssql/connection", () => ({
    buildConnectionConfig: vi.fn(() => ({})),
}));

import { getTables, getTableData } from "@/lib/adapters/database/mssql/browser";

const baseConfig = {
    host: "localhost",
    port: 1433,
    user: "sa",
    password: "secret",
    encrypt: false,
    trustServerCertificate: true,
};

describe("MSSQL browser - getTables", () => {
    beforeEach(() => vi.clearAllMocks());

    it("returns parsed table list for dbo schema", async () => {
        mockQuery.mockResolvedValue({
            recordset: [
                { schema_name: "dbo", name: "Products", table_type: "BASE TABLE", row_count: 10, size_bytes: 8192 },
            ],
        });

        const result = await getTables(baseConfig as any, "testdb");

        expect(result).toHaveLength(1);
        expect(result[0]).toMatchObject({
            name: "Products",
            type: "table",
            rowCount: 10,
            sizeInBytes: 8192,
        });
    });

    it("prefixes non-dbo schema tables with schema name", async () => {
        mockQuery.mockResolvedValue({
            recordset: [
                { schema_name: "hr", name: "Employees", table_type: "BASE TABLE", row_count: 50, size_bytes: 16384 },
            ],
        });

        const result = await getTables(baseConfig as any, "testdb");

        expect(result).toHaveLength(1);
        expect(result[0].name).toBe("hr.Employees");
        expect(result[0].type).toBe("table");
        expect(result[0].rowCount).toBe(50);
    });

    it("converts BIGINT size_bytes strings to numbers", async () => {
        mockQuery.mockResolvedValue({
            recordset: [
                { schema_name: "dbo", name: "BigTable", table_type: "BASE TABLE", row_count: "1000", size_bytes: "49631498240" },
            ],
        });

        const result = await getTables(baseConfig as any, "testdb");

        expect(typeof result[0].sizeInBytes).toBe("number");
        expect(result[0].sizeInBytes).toBe(49631498240);
    });

    it("maps VIEW type correctly", async () => {
        mockQuery.mockResolvedValue({
            recordset: [{ schema_name: "dbo", name: "v_active", table_type: "VIEW", row_count: 0, size_bytes: 0 }],
        });

        const result = await getTables(baseConfig as any, "testdb");

        expect(result[0].type).toBe("view");
    });

    it("returns empty list when recordset is empty", async () => {
        mockQuery.mockResolvedValue({ recordset: [] });

        const result = await getTables(baseConfig as any, "testdb");

        expect(result).toEqual([]);
    });
});

describe("MSSQL browser - getTableData", () => {
    beforeEach(() => vi.clearAllMocks());

    const options = {
        database: "testdb",
        table: "Products",
        page: 1,
        pageSize: 10,
    };

    it("returns rows, totalCount and columns", async () => {
        const colRecordset = [
            { COLUMN_NAME: "id", DATA_TYPE: "int", IS_NULLABLE: "NO", COLUMN_KEY: "PRI", COLUMN_DEFAULT: null },
            { COLUMN_NAME: "name", DATA_TYPE: "nvarchar", IS_NULLABLE: "YES", COLUMN_KEY: "", COLUMN_DEFAULT: null },
        ];
        let callCount = 0;
        mockQuery.mockImplementation(() => {
            callCount++;
            if (callCount === 1) return Promise.resolve({ recordset: colRecordset });
            if (callCount === 2) return Promise.resolve({ recordset: [{ total: 5 }] });
            return Promise.resolve({ recordset: [{ id: 1, name: "Widget" }] });
        });

        const result = await getTableData(baseConfig as any, options as any);

        expect(result.totalCount).toBe(5);
        expect(result.columns).toHaveLength(2);
        expect(result.columns[0]).toMatchObject({ name: "id", primaryKey: true });
        expect(result.rows[0]).toEqual({ id: 1, name: "Widget" });
    });

    it("adds search parameter when search is provided", async () => {
        mockQuery.mockResolvedValue({ recordset: [] });

        await getTableData(baseConfig as any, {
            ...options,
            search: "wid",
            searchColumn: "name",
            matchMode: "contains",
        } as any);

        expect(mockInput).toHaveBeenCalledWith("searchTerm", expect.anything(), "%wid%");
    });

    it("resolves correct schema for non-dbo table names", async () => {
        mockQuery.mockResolvedValue({ recordset: [] });

        await getTableData(baseConfig as any, {
            ...options,
            table: "hr.Employees",
        } as any);

        // All three queries should reference [hr].[Employees] not [dbo].[Employees]
        const calls: string[] = mockQuery.mock.calls.map(c => c[0] as string);
        expect(calls.some(q => q.includes("[hr].[Employees]"))).toBe(true);
        expect(calls.every(q => !q.includes("[dbo].[Employees]"))).toBe(true);
    });
});
