import { describe, it, expect, vi, beforeEach } from "vitest";
import { MSSQLConfig } from "@/lib/adapters/definitions";

// ---------------------------------------------------------------------------
// Hoisted mock setup for the `mssql` package
//
// The connection module does:
//   pool = new sql.ConnectionPool(connConfig);
//   await pool.connect();
//   const request = pool.request();
//   request.on("info", handler);  // for executeQueryWithMessages
//   const result = await request.query(sql);
//   request.input(key, value);    // for executeParameterizedQuery
//   await pool.close();
// ---------------------------------------------------------------------------

const {
    mockConnect,
    mockClose,
    mockQuery,
    mockInput,
    capturedOnHandlers,
} = vi.hoisted(() => {
    const capturedOnHandlers: Record<string, ((...args: unknown[]) => void)[]> = {};
    return {
        mockConnect: vi.fn(),
        mockClose: vi.fn(),
        mockQuery: vi.fn(),
        mockInput: vi.fn(),
        capturedOnHandlers,
    };
});

vi.mock("mssql", () => {
    class MockConnectionPool {
        connect = mockConnect;
        close = mockClose;
        request() {
            return {
                on(event: string, handler: (...args: unknown[]) => void) {
                    if (!capturedOnHandlers[event]) capturedOnHandlers[event] = [];
                    capturedOnHandlers[event].push(handler);
                },
                query: mockQuery,
                input: mockInput,
            };
        }
    }
    return { default: { ConnectionPool: MockConnectionPool } };
});

import {
    buildConnectionConfig,
    test,
    getDatabases,
    getDatabasesWithStats,
    executeQuery,
    executeQueryWithMessages,
    executeParameterizedQuery,
    supportsCompression,
} from "@/lib/adapters/database/mssql/connection";

function buildConfig(overrides: Partial<MSSQLConfig> = {}): MSSQLConfig {
    return {
        host: "db.example.com",
        port: 1433,
        user: "sa",
        password: "StrongP@ssw0rd",
        database: "master",
        encrypt: true,
        trustServerCertificate: false,
        backupPath: "/var/opt/mssql/backup",
        fileTransferMode: "local",
        requestTimeout: 300000,
        ...overrides,
    };
}

// ---------------------------------------------------------------------------
// buildConnectionConfig
// ---------------------------------------------------------------------------

describe("buildConnectionConfig", () => {
    it("maps host, port, user, and password", () => {
        const cfg = buildConnectionConfig(buildConfig());
        expect(cfg.server).toBe("db.example.com");
        expect(cfg.port).toBe(1433);
        expect(cfg.user).toBe("sa");
        expect(cfg.password).toBe("StrongP@ssw0rd");
    });

    it("uses port 1433 as default when port is omitted", () => {
        const cfg = buildConnectionConfig(buildConfig({ port: undefined as any }));
        expect(cfg.port).toBe(1433);
    });

    it("uses empty string when password is omitted", () => {
        const cfg = buildConnectionConfig(buildConfig({ password: undefined }));
        expect(cfg.password).toBe("");
    });

    it("always connects to master for admin operations", () => {
        const cfg = buildConnectionConfig(buildConfig({ database: "userdb" }));
        expect(cfg.database).toBe("master");
    });

    it("forwards encrypt and trustServerCertificate options", () => {
        const cfg = buildConnectionConfig(buildConfig({ encrypt: false, trustServerCertificate: true }));
        expect(cfg.options?.encrypt).toBe(false);
        expect(cfg.options?.trustServerCertificate).toBe(true);
    });

    it("defaults encrypt to true and trustServerCertificate to false", () => {
        const cfg = buildConnectionConfig(buildConfig({ encrypt: undefined as any, trustServerCertificate: undefined as any }));
        expect(cfg.options?.encrypt).toBe(true);
        expect(cfg.options?.trustServerCertificate).toBe(false);
    });

    it("uses requestTimeout from config", () => {
        const cfg = buildConnectionConfig(buildConfig({ requestTimeout: 60000 }));
        expect(cfg.options?.requestTimeout).toBe(60000);
    });

    it("defaults requestTimeout to 300000 when not set", () => {
        const cfg = buildConnectionConfig(buildConfig({ requestTimeout: undefined as any }));
        expect(cfg.options?.requestTimeout).toBe(300000);
    });
});

// ---------------------------------------------------------------------------
// test()
// ---------------------------------------------------------------------------

describe("test()", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        Object.keys(capturedOnHandlers).forEach((k) => delete capturedOnHandlers[k]);
        mockConnect.mockResolvedValue(undefined);
        mockClose.mockResolvedValue(undefined);
    });

    function makeVersionResult(overrides: Record<string, unknown> = {}) {
        return {
            recordset: [{
                Version: "Microsoft SQL Server 2022 (RTM) ...",
                ProductVersion: "16.0.1000.6",
                Edition: "Developer Edition (64-bit)",
                EngineEdition: 3,
                ...overrides,
            }],
        };
    }

    it("returns success with version for a working connection", async () => {
        mockQuery.mockResolvedValue(makeVersionResult());
        const result = await test(buildConfig());
        expect(result.success).toBe(true);
        expect(result.message).toContain("successful");
        expect(result.version).toBe("16.0.1000");
    });

    it("detects SQL Server 2022 from the version string", async () => {
        mockQuery.mockResolvedValue(makeVersionResult({ Version: "Microsoft SQL Server 2022 ..." }));
        const result = await test(buildConfig());
        expect(result.message).toContain("2022");
    });

    it("detects SQL Server 2019 from the version string", async () => {
        mockQuery.mockResolvedValue(makeVersionResult({ Version: "Microsoft SQL Server 2019 ..." }));
        const result = await test(buildConfig());
        expect(result.message).toContain("2019");
    });

    it("detects SQL Server 2017 from the version string", async () => {
        mockQuery.mockResolvedValue(makeVersionResult({
            Version: "Microsoft SQL Server 2017 ...",
            ProductVersion: "14.0.3356.20",
        }));
        const result = await test(buildConfig());
        expect(result.message).toContain("2017");
    });

    it("identifies Express edition", async () => {
        mockQuery.mockResolvedValue(makeVersionResult({ Edition: "Express Edition (64-bit)", EngineEdition: 1 }));
        const result = await test(buildConfig());
        expect(result.edition).toBe("Express");
    });

    it("identifies Standard edition", async () => {
        mockQuery.mockResolvedValue(makeVersionResult({ Edition: "Standard Edition (64-bit)", EngineEdition: 2 }));
        const result = await test(buildConfig());
        expect(result.edition).toBe("Standard");
    });

    it("identifies Enterprise edition", async () => {
        mockQuery.mockResolvedValue(makeVersionResult({ Edition: "Enterprise Edition (64-bit)", EngineEdition: 3 }));
        const result = await test(buildConfig());
        expect(result.edition).toBe("Enterprise");
    });

    it("identifies Developer edition", async () => {
        mockQuery.mockResolvedValue(makeVersionResult({ Edition: "Developer Edition (64-bit)", EngineEdition: 3 }));
        const result = await test(buildConfig());
        expect(result.edition).toBe("Developer");
    });

    it("identifies Web edition", async () => {
        mockQuery.mockResolvedValue(makeVersionResult({ Edition: "Web Edition", EngineEdition: 4 }));
        const result = await test(buildConfig());
        expect(result.edition).toBe("Web");
    });

    it("identifies Azure SQL Edge via EngineEdition 9", async () => {
        mockQuery.mockResolvedValue(makeVersionResult({
            Version: "Microsoft Azure SQL Edge ...",
            EngineEdition: 9,
            Edition: "Azure SQL Edge",
        }));
        const result = await test(buildConfig());
        expect(result.edition).toBe("Azure SQL Edge");
    });

    it("falls back to first word of edition string for unknown editions", async () => {
        mockQuery.mockResolvedValue(makeVersionResult({ Edition: "Unknown Special Edition", EngineEdition: 2 }));
        const result = await test(buildConfig());
        expect(result.edition).toBe("Unknown");
    });

    it("handles missing version in ProductVersion gracefully", async () => {
        mockQuery.mockResolvedValue(makeVersionResult({ ProductVersion: "" }));
        const result = await test(buildConfig());
        expect(result.success).toBe(true);
    });

    it("returns failure with ECONNREFUSED hint", async () => {
        mockConnect.mockRejectedValue(new Error("ECONNREFUSED 127.0.0.1:1433"));
        const result = await test(buildConfig());
        expect(result.success).toBe(false);
        expect(result.message).toContain("Connection refused");
    });

    it("returns failure with Login failed hint", async () => {
        mockConnect.mockRejectedValue(new Error("Login failed for user 'sa'"));
        const result = await test(buildConfig());
        expect(result.success).toBe(false);
        expect(result.message).toContain("Login failed");
    });

    it("returns failure with certificate hint", async () => {
        mockConnect.mockRejectedValue(new Error("SSL certificate error: self-signed certificate"));
        const result = await test(buildConfig());
        expect(result.success).toBe(false);
        expect(result.message).toContain("Certificate error");
    });

    it("returns generic failure message for unknown errors", async () => {
        mockConnect.mockRejectedValue(new Error("Unexpected network error"));
        const result = await test(buildConfig());
        expect(result.success).toBe(false);
        expect(result.message).toContain("Connection failed");
    });

    it("closes the pool even on error", async () => {
        mockConnect.mockRejectedValue(new Error("ECONNREFUSED"));
        await test(buildConfig());
        expect(mockClose).toHaveBeenCalled();
    });
});

// ---------------------------------------------------------------------------
// getDatabases()
// ---------------------------------------------------------------------------

describe("getDatabases()", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockConnect.mockResolvedValue(undefined);
        mockClose.mockResolvedValue(undefined);
    });

    it("returns user database names from the recordset", async () => {
        mockQuery.mockResolvedValue({ recordset: [{ name: "SalesDB" }, { name: "HRdb" }] });
        const result = await getDatabases(buildConfig());
        expect(result).toEqual(["SalesDB", "HRdb"]);
    });

    it("returns empty array when no user databases exist", async () => {
        mockQuery.mockResolvedValue({ recordset: [] });
        const result = await getDatabases(buildConfig());
        expect(result).toEqual([]);
    });

    it("returns empty array when query throws", async () => {
        mockConnect.mockRejectedValue(new Error("Connection refused"));
        const result = await getDatabases(buildConfig());
        expect(result).toEqual([]);
    });

    it("closes the pool even on error", async () => {
        mockConnect.mockResolvedValue(undefined);
        mockQuery.mockRejectedValue(new Error("Query failed"));
        await getDatabases(buildConfig());
        expect(mockClose).toHaveBeenCalled();
    });
});

// ---------------------------------------------------------------------------
// getDatabasesWithStats()
// ---------------------------------------------------------------------------

describe("getDatabasesWithStats()", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockConnect.mockResolvedValue(undefined);
        mockClose.mockResolvedValue(undefined);
    });

    it("returns database info with size and table count", async () => {
        mockQuery
            .mockResolvedValueOnce({
                recordset: [{ name: "SalesDB", size_bytes: 1048576 }],
            })
            .mockResolvedValueOnce({ recordset: [{ cnt: 12 }] });

        const result = await getDatabasesWithStats(buildConfig());

        expect(result).toHaveLength(1);
        expect(result[0].name).toBe("SalesDB");
        expect(result[0].sizeInBytes).toBe(1048576);
        expect(result[0].tableCount).toBe(12);
    });

    it("defaults tableCount to 0 when table query fails (permission error)", async () => {
        mockQuery
            .mockResolvedValueOnce({
                recordset: [{ name: "LockedDB", size_bytes: 524288 }],
            })
            .mockRejectedValueOnce(new Error("Database is inaccessible"));

        const result = await getDatabasesWithStats(buildConfig());

        expect(result[0].name).toBe("LockedDB");
        expect(result[0].tableCount).toBe(0);
    });

    it("defaults sizeInBytes to 0 when size is null", async () => {
        mockQuery
            .mockResolvedValueOnce({
                recordset: [{ name: "EmptyDB", size_bytes: null }],
            })
            .mockResolvedValueOnce({ recordset: [{ cnt: 0 }] });

        const result = await getDatabasesWithStats(buildConfig());
        expect(result[0].sizeInBytes).toBe(0);
    });

    it("throws when connection fails", async () => {
        mockConnect.mockRejectedValue(new Error("Connection refused"));
        await expect(getDatabasesWithStats(buildConfig())).rejects.toThrow("Connection refused");
    });
});

// ---------------------------------------------------------------------------
// executeQuery()
// ---------------------------------------------------------------------------

describe("executeQuery()", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockConnect.mockResolvedValue(undefined);
        mockClose.mockResolvedValue(undefined);
    });

    it("executes a query and returns the result", async () => {
        const expected = { recordset: [{ id: 1 }] };
        mockQuery.mockResolvedValue(expected);

        const result = await executeQuery(buildConfig(), "SELECT 1 AS id");
        expect(result).toBe(expected);
    });

    it("connects to a specific database when database param is provided", async () => {
        mockQuery.mockResolvedValue({ recordset: [] });
        await executeQuery(buildConfig(), "SELECT 1", "SalesDB");
        // Pool was created and connected - just verify no throw
        expect(mockConnect).toHaveBeenCalled();
    });

    it("closes the pool after execution", async () => {
        mockQuery.mockResolvedValue({ recordset: [] });
        await executeQuery(buildConfig(), "SELECT 1");
        expect(mockClose).toHaveBeenCalled();
    });
});

// ---------------------------------------------------------------------------
// executeQueryWithMessages()
// ---------------------------------------------------------------------------

describe("executeQueryWithMessages()", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        Object.keys(capturedOnHandlers).forEach((k) => delete capturedOnHandlers[k]);
        mockConnect.mockResolvedValue(undefined);
        mockClose.mockResolvedValue(undefined);
    });

    it("returns result and empty messages array on success", async () => {
        const expected = { recordset: [{ id: 1 }] };
        mockQuery.mockResolvedValue(expected);

        const { result, messages } = await executeQueryWithMessages(buildConfig(), "BACKUP DATABASE ...");
        expect(result).toBe(expected);
        expect(messages).toEqual([]);
    });

    it("captures info messages via the request.on(info) handler", async () => {
        mockQuery.mockImplementation(async () => {
            // Trigger the info handler registered by executeQueryWithMessages
            const infoHandlers = capturedOnHandlers["info"] || [];
            for (const h of infoHandlers) {
                h({ message: "10 percent processed.", number: 0, state: 1, class: 0 });
            }
            return { recordset: [] };
        });

        const received: string[] = [];
        const { messages } = await executeQueryWithMessages(
            buildConfig(),
            "BACKUP DATABASE ...",
            undefined,
            undefined,
            (msg: any) => received.push(msg.message)
        );

        expect(received).toContain("10 percent processed.");
        expect(messages[0].message).toBe("10 percent processed.");
    });

    it("overrides requestTimeout when provided", async () => {
        mockQuery.mockResolvedValue({ recordset: [] });
        // Just verify it runs without error when requestTimeout=0 is given
        await expect(
            executeQueryWithMessages(buildConfig(), "BACKUP ...", undefined, 0)
        ).resolves.toBeDefined();
    });

    it("connects to a specific database when database param is given", async () => {
        mockQuery.mockResolvedValue({ recordset: [] });
        await executeQueryWithMessages(buildConfig(), "SELECT 1", "SalesDB");
        expect(mockConnect).toHaveBeenCalled();
    });

    it("enhances error message with captured server messages (class > 0)", async () => {
        mockQuery.mockImplementation(async () => {
            const infoHandlers = capturedOnHandlers["info"] || [];
            for (const h of infoHandlers) {
                h({ message: "Cannot open backup device.", number: 3201, state: 1, class: 16 });
            }
            throw new Error("BACKUP DATABASE is terminating abnormally");
        });

        await expect(
            executeQueryWithMessages(buildConfig(), "BACKUP DATABASE ...")
        ).rejects.toThrow("Details: Cannot open backup device.");
    });

    it("prepends preceding errors from mssql RequestError", async () => {
        const err: any = new Error("BACKUP DATABASE is terminating abnormally");
        err.precedingErrors = [
            { message: "Operating system error 5: Access denied." },
        ];
        mockQuery.mockRejectedValue(err);

        await expect(
            executeQueryWithMessages(buildConfig(), "BACKUP DATABASE ...")
        ).rejects.toThrow("Access denied");
    });

    it("closes the pool on error", async () => {
        mockQuery.mockRejectedValue(new Error("query failed"));
        await expect(
            executeQueryWithMessages(buildConfig(), "BACKUP DATABASE ...")
        ).rejects.toThrow();
        expect(mockClose).toHaveBeenCalled();
    });
});

// ---------------------------------------------------------------------------
// executeParameterizedQuery()
// ---------------------------------------------------------------------------

describe("executeParameterizedQuery()", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockConnect.mockResolvedValue(undefined);
        mockClose.mockResolvedValue(undefined);
    });

    it("returns result for a parameterized query", async () => {
        const expected = { recordset: [{ state_desc: "ONLINE" }] };
        mockQuery.mockResolvedValue(expected);

        const result = await executeParameterizedQuery(
            buildConfig(),
            "SELECT state_desc FROM sys.databases WHERE name = @dbName",
            { dbName: "SalesDB" }
        );
        expect(result).toBe(expected);
        expect(mockInput).toHaveBeenCalledWith("dbName", "SalesDB");
    });

    it("binds multiple parameters", async () => {
        mockQuery.mockResolvedValue({ recordset: [] });
        await executeParameterizedQuery(
            buildConfig(),
            "SELECT * FROM t WHERE a = @a AND b = @b",
            { a: "foo", b: 42 }
        );
        expect(mockInput).toHaveBeenCalledWith("a", "foo");
        expect(mockInput).toHaveBeenCalledWith("b", 42);
    });

    it("connects to a specific database when database param is provided", async () => {
        mockQuery.mockResolvedValue({ recordset: [] });
        await executeParameterizedQuery(buildConfig(), "SELECT 1", {}, "SalesDB");
        expect(mockConnect).toHaveBeenCalled();
    });
});

// ---------------------------------------------------------------------------
// supportsCompression()
// ---------------------------------------------------------------------------

describe("supportsCompression()", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockConnect.mockResolvedValue(undefined);
        mockClose.mockResolvedValue(undefined);
    });

    it("returns false for Express edition", async () => {
        mockQuery.mockResolvedValue({
            recordset: [{ Edition: "Express Edition (64-bit)", EngineEdition: 4 }],
        });
        expect(await supportsCompression(buildConfig())).toBe(false);
    });

    it("returns false for Web edition", async () => {
        mockQuery.mockResolvedValue({
            recordset: [{ Edition: "Web Edition", EngineEdition: 4 }],
        });
        expect(await supportsCompression(buildConfig())).toBe(false);
    });

    it("returns false for Azure SQL Edge (EngineEdition 9)", async () => {
        mockQuery.mockResolvedValue({
            recordset: [{ Edition: "Azure SQL Edge", EngineEdition: 9 }],
        });
        expect(await supportsCompression(buildConfig())).toBe(false);
    });

    it("returns true for Standard edition (EngineEdition 2)", async () => {
        mockQuery.mockResolvedValue({
            recordset: [{ Edition: "Standard Edition", EngineEdition: 2 }],
        });
        expect(await supportsCompression(buildConfig())).toBe(true);
    });

    it("returns true for Enterprise edition (EngineEdition 3)", async () => {
        mockQuery.mockResolvedValue({
            recordset: [{ Edition: "Enterprise Edition", EngineEdition: 3 }],
        });
        expect(await supportsCompression(buildConfig())).toBe(true);
    });

    it("returns true for Azure SQL Managed Instance (EngineEdition 8)", async () => {
        mockQuery.mockResolvedValue({
            recordset: [{ Edition: "Azure SQL Managed Instance", EngineEdition: 8 }],
        });
        expect(await supportsCompression(buildConfig())).toBe(true);
    });

    it("returns false for EngineEdition 1 (Express)", async () => {
        mockQuery.mockResolvedValue({
            recordset: [{ Edition: "Developer Edition", EngineEdition: 1 }],
        });
        expect(await supportsCompression(buildConfig())).toBe(false);
    });

    it("returns false when the query throws", async () => {
        mockConnect.mockRejectedValue(new Error("Connection refused"));
        expect(await supportsCompression(buildConfig())).toBe(false);
    });
});
