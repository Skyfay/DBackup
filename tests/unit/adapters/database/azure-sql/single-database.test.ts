import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import { join } from "node:path";

const { mockPool, mockQuery, PoolCtor, mockImport, mockExport } = vi.hoisted(() => {
    const mockQuery = vi.fn();
    const mockRequest = vi.fn(() => ({ query: mockQuery, input: vi.fn().mockReturnThis(), on: vi.fn() }));
    const mockPool = { connect: vi.fn(), close: vi.fn(), request: mockRequest };
    const PoolCtor = vi.fn(function () { return mockPool; });
    return { mockPool, mockQuery, PoolCtor, mockImport: vi.fn(), mockExport: vi.fn() };
});

vi.mock("mssql", () => ({
    default: { ConnectionPool: PoolCtor, NVarChar: "nvarchar" },
    ConnectionPool: PoolCtor,
    NVarChar: "nvarchar",
}));

vi.mock("@/lib/adapters/database/azure-sql/exporter", () => ({
    resolveExporter: () => ({ id: "sqlpackage", importDatabase: mockImport, exportDatabase: mockExport }),
}));

import { createFakeHost } from "@/lib/testing/fake-host";
import { dumpOne } from "@/lib/adapters/database/azure-sql/dump";
import { restoreOne } from "@/lib/adapters/database/azure-sql/restore";

let workDir: string;

function config(extra: Record<string, unknown> = {}) {
    return {
        host: "myserver.database.windows.net",
        port: 1433,
        user: "backupadmin",
        password: "s3cret",
        requestTimeout: 300000,
        ...extra,
    } as never;
}

beforeEach(async () => {
    vi.clearAllMocks();
    workDir = await mkdtemp(join(os.tmpdir(), "dbackup-azure-single-"));
    mockPool.connect.mockResolvedValue(undefined);
    mockPool.close.mockResolvedValue(undefined);
    mockQuery.mockResolvedValue({ recordset: [] });
    mockImport.mockResolvedValue(undefined);
    mockExport.mockImplementation(async (_cfg, dbName: string, destPath: string) => {
        await writeFile(destPath, `BACPAC:${dbName}`);
    });
});

afterEach(async () => {
    await rm(workDir, { recursive: true, force: true });
});

describe("Azure SQL single-database backup", () => {
    it("exports exactly the named database to a plain BACPAC", async () => {
        const out = join(workDir, "0001.bacpac");

        const { size } = await dumpOne(config(), "shop", out, createFakeHost({ kind: "direct" }));

        expect(mockExport).toHaveBeenCalledTimes(1);
        expect(mockExport.mock.calls[0][1]).toBe("shop");
        expect(size).toBe("BACPAC:shop".length);
    });

    it("warns that a live export is not transactionally consistent", async () => {
        const logs: { msg: string; level?: string }[] = [];
        await dumpOne(config(), "shop", join(workDir, "0001.bacpac"), createFakeHost({ kind: "direct" }), (msg, level) => logs.push({ msg, level }));

        expect(logs.some((l) => l.level === "warning" && /not transactionally consistent/.test(l.msg))).toBe(true);
    });

    it("fails on an empty export instead of storing it", async () => {
        mockExport.mockImplementation(async (_cfg, _db, destPath: string) => { await writeFile(destPath, ""); });

        await expect(dumpOne(config(), "shop", join(workDir, "0001.bacpac"), createFakeHost({ kind: "direct" })))
            .rejects.toThrow(/empty file/);
    });
});

describe("Azure SQL single-database restore", () => {
    it("drops an existing target and imports into it", async () => {
        mockQuery.mockResolvedValueOnce({ recordset: [{ name: "shop_copy" }] });
        const file = join(workDir, "restore-db-1.bacpac");
        await writeFile(file, "BACPAC");

        await restoreOne(config(), file, "shop_copy", createFakeHost({ kind: "direct" }));

        expect(mockQuery.mock.calls.map((c) => c[0])).toContain("DROP DATABASE [shop_copy]");
        expect(mockImport.mock.calls[0][1]).toBe(file);
        expect(mockImport.mock.calls[0][2]).toBe("shop_copy");
    });

    it("imports with the privileged credentials when they were given", async () => {
        const file = join(workDir, "restore-db-1.bacpac");
        await writeFile(file, "BACPAC");

        await restoreOne(
            config({ privilegedAuth: { user: "admin", password: "pw" } }),
            file,
            "shop",
            createFakeHost({ kind: "direct" })
        );

        expect(mockImport.mock.calls[0][0]).toMatchObject({ user: "admin", password: "pw" });
    });

    it("throws when the import fails", async () => {
        mockImport.mockRejectedValue(new Error("SqlPackage exited with code 1"));
        const file = join(workDir, "restore-db-1.bacpac");
        await writeFile(file, "BACPAC");

        await expect(restoreOne(config(), file, "shop", createFakeHost({ kind: "direct" })))
            .rejects.toThrow("SqlPackage exited with code 1");
    });
});
