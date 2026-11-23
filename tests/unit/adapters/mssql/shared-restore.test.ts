import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import { join } from "node:path";

const { mockExecuteQuery, mockExecuteWithMessages, mockOwnData } = vi.hoisted(() => ({
    mockExecuteQuery: vi.fn(),
    mockExecuteWithMessages: vi.fn(),
    mockOwnData: vi.fn(),
}));

vi.mock("@/lib/adapters/database/mssql/connection", () => ({
    assertBackupSupported: vi.fn(),
    executeQuery: (...args: unknown[]) => mockExecuteQuery(...args),
    executeQueryWithMessages: (...args: unknown[]) => mockExecuteWithMessages(...args),
    executeParameterizedQuery: vi.fn(),
    supportsCompression: vi.fn(),
    getDatabases: vi.fn(),
}));

// Whether a folder reaches the own data of DBackup, see `own-data.ts`, which reads the database.
vi.mock("@/lib/adapters/own-data", () => ({ ownDataRefusal: (...args: unknown[]) => mockOwnData(...args) }));

import { createFakeHost } from "@/lib/testing/fake-host";
import { restoreOne } from "@/lib/adapters/database/mssql/restore-bak";

/**
 * A customer's restore of a shared SQL Server database never follows the file paths its backup
 * names, and leaves no TRUSTWORTHY or cross database ownership chaining behind.
 */

let mountDir: string;
let workDir: string;

function config(shared: boolean) {
    return {
        host: "sql.internal",
        port: 1433,
        user: "sa",
        password: "secret",
        backupPath: "/var/opt/mssql/backup",
        localBackupPath: mountDir,
        ...(shared ? { sharedRestore: true } : {}),
    };
}

/** A backup whose files name another database's folder and a server that answers `defaults`. */
function server(defaults: { DataPath: string | null; LogPath: string | null }, files?: { LogicalName: string; Type: string; PhysicalName: string }[]) {
    mockExecuteQuery.mockImplementation(async (_cfg, _host, query: string) => {
        if (query.includes("FILELISTONLY")) {
            return {
                recordset: files ?? [
                    { LogicalName: "shop", Type: "D", PhysicalName: "/var/opt/mssql/other/master.mdf" },
                    { LogicalName: "shop_log", Type: "L", PhysicalName: "/var/opt/mssql/other/mastlog.ldf" },
                ],
            };
        }
        // The same server made the backup, so an ordinary restore keeps the paths of the backup.
        if (query.includes("HEADERONLY")) return { recordset: [{ ServerName: "SQL01", DatabaseName: "shop" }] };
        if (query.includes("@@SERVERNAME")) return { recordset: [{ ServerName: "SQL01", PropertyName: "SQL01" }] };
        if (query.includes("InstanceDefaultDataPath")) return { recordset: [defaults] };
        return { recordset: [] };
    });
}

const queries = () => mockExecuteWithMessages.mock.calls.map((call) => call[2] as string);
const restoreQuery = () => queries().find((query) => query.startsWith("RESTORE DATABASE"));
const plainQueries = () => mockExecuteQuery.mock.calls.map((call) => call[2] as string);

async function dumpFile(): Promise<string> {
    const file = join(workDir, "restore-db-1.bak");
    await writeFile(file, "BAKDATA");
    return file;
}

beforeEach(async () => {
    vi.clearAllMocks();
    mountDir = await mkdtemp(join(os.tmpdir(), "dbackup-mssql-mount-"));
    workDir = await mkdtemp(join(os.tmpdir(), "dbackup-mssql-work-"));
    mockOwnData.mockResolvedValue(null);
    mockExecuteWithMessages.mockResolvedValue({ result: {}, messages: [] });
});

afterEach(async () => {
    await rm(mountDir, { recursive: true, force: true });
    await rm(workDir, { recursive: true, force: true });
});

describe("A customer's restore of a shared SQL Server database", () => {
    it("moves the files into the default folders of the instance, never to the paths of the backup", async () => {
        server({ DataPath: "/var/opt/mssql/data/", LogPath: "/var/opt/mssql/log/" });

        await restoreOne(config(true) as never, await dumpFile(), "shop", createFakeHost({ kind: "direct" }), undefined, undefined, "shop");

        const restore = restoreQuery()!;
        expect(restore).toContain("MOVE N'shop' TO N'/var/opt/mssql/data/shop.mdf'");
        expect(restore).toContain("MOVE N'shop_log' TO N'/var/opt/mssql/log/shop.ldf'");
        expect(restore).not.toContain("/var/opt/mssql/other");
    });

    it("puts the log into the data folder when the instance names no log folder", async () => {
        server({ DataPath: "D:\\SQLData", LogPath: null });

        await restoreOne(config(true) as never, await dumpFile(), "shop", createFakeHost({ kind: "direct" }), undefined, undefined, "shop");

        expect(restoreQuery()).toContain("MOVE N'shop_log' TO N'D:\\SQLData\\shop.ldf'");
    });

    it("refuses to restore when the instance names no data folder, instead of following the backup", async () => {
        server({ DataPath: null, LogPath: null });

        await expect(restoreOne(config(true) as never, await dumpFile(), "shop", createFakeHost({ kind: "direct" }), undefined, undefined, "shop"))
            .rejects.toThrow(/no default data directory/);
        expect(restoreQuery()).toBeUndefined();
    });

    it("refuses a backup with a FILESTREAM container, which SQL Server places by the folder of the backup", async () => {
        server({ DataPath: "/var/opt/mssql/data/", LogPath: "/var/opt/mssql/log/" }, [
            { LogicalName: "shop", Type: "D", PhysicalName: "/var/opt/mssql/data/shop.mdf" },
            { LogicalName: "shop_fs", Type: "S", PhysicalName: "/var/opt/mssql/other/fs" },
        ]);

        await expect(restoreOne(config(true) as never, await dumpFile(), "shop", createFakeHost({ kind: "direct" }), undefined, undefined, "shop"))
            .rejects.toThrow(/into the data folder of the server/);
        expect(restoreQuery()).toBeUndefined();
    });

    it("switches off TRUSTWORTHY and cross database ownership chaining after the restore", async () => {
        server({ DataPath: "/var/opt/mssql/data/", LogPath: "/var/opt/mssql/log/" });

        await restoreOne(config(true) as never, await dumpFile(), "shop]x", createFakeHost({ kind: "direct" }), undefined, undefined, "shop]x");

        const off = plainQueries().find((query) => query.includes("TRUSTWORTHY OFF"))!;
        expect(off).toContain("WHERE name = N'shop]x' AND is_trustworthy_on = 1) ALTER DATABASE [shop]]x] SET TRUSTWORTHY OFF");
        expect(off).toContain("ALTER DATABASE [shop]]x] SET DB_CHAINING OFF");
    });

    it("keeps a restore that wrote the database when the login may not change TRUSTWORTHY", async () => {
        server({ DataPath: "/var/opt/mssql/data/", LogPath: "/var/opt/mssql/log/" });
        const answer = mockExecuteQuery.getMockImplementation()!;
        mockExecuteQuery.mockImplementation(async (cfg, host, query: string) => {
            if (query.includes("TRUSTWORTHY OFF")) throw new Error("User does not have permission to alter database 'shop'");
            return answer(cfg, host, query);
        });

        await expect(restoreOne(config(true) as never, await dumpFile(), "shop", createFakeHost({ kind: "direct" }), undefined, undefined, "shop"))
            .resolves.toBeUndefined();
    });
});

describe("An ordinary SQL Server restore", () => {
    it("keeps the files where the backup says when it comes from this very server", async () => {
        server({ DataPath: "/var/opt/mssql/data/", LogPath: "/var/opt/mssql/log/" });

        await restoreOne(config(false) as never, await dumpFile(), "shop", createFakeHost({ kind: "direct" }), undefined, undefined, "shop");

        expect(restoreQuery()).not.toContain("MOVE");
        expect(plainQueries().some((query) => query.includes("TRUSTWORTHY"))).toBe(false);
    });

    it("never moves a file onto a file of another database, which REPLACE would overwrite where it is offline", async () => {
        server({ DataPath: "/var/opt/mssql/data/", LogPath: "/var/opt/mssql/log/" });
        const answer = mockExecuteQuery.getMockImplementation()!;
        mockExecuteQuery.mockImplementation(async (cfg, host, query: string) => {
            if (query.includes("sys.master_files")) return { recordset: [{ TakenPath: "/var/opt/mssql/log/shop_copy.ldf" }] };
            return answer(cfg, host, query);
        });

        await expect(restoreOne(config(false) as never, await dumpFile(), "shop_copy", createFakeHost({ kind: "direct" }), undefined, undefined, "shop"))
            .rejects.toThrow(/is a file of another database on the server/);
        expect(restoreQuery()).toBeUndefined();
        const check = plainQueries().find((query) => query.includes("sys.master_files"))!;
        expect(check).toContain("N'/var/opt/mssql/data/shop_copy.mdf', N'/var/opt/mssql/log/shop_copy.ldf'");
        expect(check).toContain("database_id <> ISNULL(DB_ID(N'shop_copy'), -1)");
    });

    it("still falls back to the folder of the backup for a rename on an instance without defaults", async () => {
        server({ DataPath: null, LogPath: null });

        await restoreOne(config(false) as never, await dumpFile(), "shop_copy", createFakeHost({ kind: "direct" }), undefined, undefined, "shop");

        expect(restoreQuery()).toContain("MOVE N'shop' TO N'/var/opt/mssql/other/shop_copy.mdf'");
    });
});
