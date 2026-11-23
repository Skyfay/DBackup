import { describe, it, expect, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({ executeQuery: vi.fn() }));

vi.mock("@/lib/adapters/database/mssql/connection", () => ({
    executeQuery: (...args: unknown[]) => mocks.executeQuery(...args),
}));

import {
    buildMoveTargets,
    getInstanceDefaultPaths,
    joinServerPath,
    serverDirname,
    type RestoreFileEntry,
} from "@/lib/adapters/database/mssql/server-paths";
import { createFakeHost } from "@/lib/testing/fake-host";
import type { MSSQLConfig } from "@/lib/adapters/definitions";

const config = { host: "sql.example.com", port: 1433, user: "dbackup" } as MSSQLConfig;

function dataFile(overrides: Partial<RestoreFileEntry> = {}): RestoreFileEntry {
    return { logicalName: "Shop", type: "D", physicalName: "/var/opt/mssql/data/Shop.mdf", ...overrides };
}

function logFile(overrides: Partial<RestoreFileEntry> = {}): RestoreFileEntry {
    return { logicalName: "Shop_log", type: "L", physicalName: "/var/opt/mssql/data/Shop_log.ldf", ...overrides };
}

describe("joinServerPath", () => {
    it("leaves POSIX paths exactly as path.posix.join produced them", () => {
        // Every existing source has a POSIX backup path, so this branch has to
        // stay byte for byte identical or every stored config changes behaviour.
        expect(joinServerPath("/var/opt/mssql/backup", "shop.bak")).toBe("/var/opt/mssql/backup/shop.bak");
        expect(joinServerPath("/var/opt/mssql/backup/", "shop.bak")).toBe("/var/opt/mssql/backup/shop.bak");
    });

    it("uses backslashes for a Windows drive path", () => {
        expect(joinServerPath("D:\\SQLBackup", "shop.bak")).toBe("D:\\SQLBackup\\shop.bak");
        expect(joinServerPath("D:\\SQLBackup\\", "shop.bak")).toBe("D:\\SQLBackup\\shop.bak");
    });

    it("keeps a UNC share intact", () => {
        expect(joinServerPath("\\\\synology-nas\\sql-backup", "shop.bak")).toBe("\\\\synology-nas\\sql-backup\\shop.bak");
    });

    it("keeps forward slashes on a drive path that was written with them", () => {
        // A drive letter does not decide the separator. `D:/SQLBackup` is the
        // spelling that also works over SFTP, where a backslash is an ordinary
        // character, so it has to survive untouched.
        expect(joinServerPath("D:/SQLBackup", "shop.bak")).toBe("D:/SQLBackup/shop.bak");
    });
});

describe("serverDirname", () => {
    it("returns the directory of a POSIX path", () => {
        expect(serverDirname("/var/opt/mssql/data/Shop.mdf")).toBe("/var/opt/mssql/data");
    });

    it("returns the directory of a Windows path", () => {
        expect(serverDirname("D:\\SQL\\DATA\\Shop.mdf")).toBe("D:\\SQL\\DATA");
        expect(serverDirname("\\\\nas\\share\\Shop.mdf")).toBe("\\\\nas\\share");
    });

    it("keeps a filesystem root, which is its own separator", () => {
        expect(serverDirname("/Shop.mdf")).toBe("/");
    });

    it("returns null for a bare file name", () => {
        expect(serverDirname("Shop.mdf")).toBeNull();
    });
});

describe("buildMoveTargets", () => {
    it("places files in the instance default directory on a Windows server", () => {
        // The regression: this used to be a hardcoded /var/opt/mssql/data, which a
        // Windows server resolves against the current drive and rejects with
        // operating system error 3.
        const targets = buildMoveTargets([dataFile(), logFile()], "Shop_Copy", {
            data: "D:\\SQL\\DATA\\",
            log: "E:\\SQL\\LOGS\\",
        });

        expect(targets).toEqual([
            { logicalName: "Shop", physicalPath: "D:\\SQL\\DATA\\Shop_Copy.mdf" },
            { logicalName: "Shop_log", physicalPath: "E:\\SQL\\LOGS\\Shop_Copy.ldf" },
        ]);
    });

    it("falls back to the directory the backup came from", () => {
        // SQL Server 2008 R2 has no InstanceDefaultDataPath, and some instances
        // answer NULL for it. The file's own directory is right whenever the
        // restore targets the server that wrote the backup.
        const targets = buildMoveTargets(
            [dataFile({ physicalName: "D:\\SQL\\DATA\\Shop.mdf" }), logFile({ physicalName: "E:\\SQL\\LOGS\\Shop_log.ldf" })],
            "Shop_Copy",
            {},
        );

        expect(targets).toEqual([
            { logicalName: "Shop", physicalPath: "D:\\SQL\\DATA\\Shop_Copy.mdf" },
            { logicalName: "Shop_log", physicalPath: "E:\\SQL\\LOGS\\Shop_Copy.ldf" },
        ]);
    });

    it("still places files correctly on a Linux server", () => {
        const targets = buildMoveTargets([dataFile(), logFile()], "Shop_Copy", { data: "/var/opt/mssql/data/" });

        expect(targets).toEqual([
            { logicalName: "Shop", physicalPath: "/var/opt/mssql/data/Shop_Copy.mdf" },
            { logicalName: "Shop_log", physicalPath: "/var/opt/mssql/data/Shop_Copy.ldf" },
        ]);
    });

    it("gives every data file its own name", () => {
        // Both used to be moved onto the same .mdf, which SQL Server refuses.
        const targets = buildMoveTargets(
            [dataFile(), dataFile({ logicalName: "Shop_2", physicalName: "/var/opt/mssql/data/Shop_2.ndf" }), logFile()],
            "Shop_Copy",
            { data: "/var/opt/mssql/data" },
        );

        expect(targets.map((t) => t.physicalPath)).toEqual([
            "/var/opt/mssql/data/Shop_Copy.mdf",
            "/var/opt/mssql/data/Shop_Copy_2.ndf",
            "/var/opt/mssql/data/Shop_Copy.ldf",
        ]);
    });

    it("names a second log file apart from the log of a database called <name>_2", () => {
        const shop = buildMoveTargets(
            [dataFile(), logFile(), logFile({ logicalName: "Shop_log2", physicalName: "/var/opt/mssql/data/Shop_log2.ldf" })],
            "Shop",
            { data: "/var/opt/mssql/data" },
        );
        const shop2 = buildMoveTargets([dataFile(), logFile()], "Shop_2", { data: "/var/opt/mssql/data" });

        expect(shop.map((t) => t.physicalPath)).toEqual([
            "/var/opt/mssql/data/Shop.mdf",
            "/var/opt/mssql/data/Shop.ldf",
            "/var/opt/mssql/data/Shop_log2.ldf",
        ]);
        const own = new Set(shop.map((t) => t.physicalPath));
        expect(shop2.some((t) => own.has(t.physicalPath))).toBe(false);
    });

    it("rejects a rename it cannot place, naming the way out", () => {
        const filestream = dataFile({ logicalName: "Shop_fs", type: "S", physicalName: "/var/opt/mssql/data/Shop_fs" });

        expect(() => buildMoveTargets([filestream], "Shop_Copy", { data: "/var/opt/mssql/data" }))
            .toThrow(/original database name/);
    });

    it("names why the files move when they come from another server or one whose name could not be read", () => {
        const filestream = dataFile({ logicalName: "Shop_fs", type: "S", physicalName: "D:\\SQLData\\Shop_fs" });

        for (const [reason, words] of [["other", "comes from another server"], ["unknown", "comes from a server whose name could not be read"]] as const) {
            expect(() => buildMoveTargets([filestream], "Shop", { data: "/var/opt/mssql/data" }, { reason })).toThrow(words);
            expect(() => buildMoveTargets([filestream], "Shop", { data: "/var/opt/mssql/data" }, { reason })).not.toThrow(/original database name/);
            // Without any folder to place a file in, the way out is the folders of the instance.
            expect(() => buildMoveTargets([dataFile({ physicalName: "Shop.mdf" })], "Shop", {}, { reason })).toThrow(new RegExp(`server properties, since the backup ${words}`));
        }
    });
});

describe("getInstanceDefaultPaths", () => {
    beforeEach(() => {
        mocks.executeQuery.mockReset();
    });

    it("reads both directories from the instance", async () => {
        mocks.executeQuery.mockResolvedValue({
            recordset: [{ DataPath: "D:\\SQL\\DATA\\", LogPath: "E:\\SQL\\LOGS\\" }],
        });

        const paths = await getInstanceDefaultPaths(config, createFakeHost({ kind: "direct" }));

        expect(paths).toEqual({ data: "D:\\SQL\\DATA\\", log: "E:\\SQL\\LOGS\\" });
    });

    it("reports nothing when the server answers NULL", async () => {
        // SERVERPROPERTY answers NULL for a property the server has never heard
        // of, so a pre-2012 instance lands here rather than in the catch.
        mocks.executeQuery.mockResolvedValue({ recordset: [{ DataPath: null, LogPath: null }] });

        expect(await getInstanceDefaultPaths(config, createFakeHost({ kind: "direct" }))).toEqual({});
    });

    it("reports nothing when the query fails", async () => {
        mocks.executeQuery.mockRejectedValue(new Error("permission denied"));

        expect(await getInstanceDefaultPaths(config, createFakeHost({ kind: "direct" }))).toEqual({});
    });
});
