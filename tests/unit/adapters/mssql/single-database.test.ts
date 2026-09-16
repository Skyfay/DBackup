import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import { join } from "node:path";

const { mockExecuteQuery, mockExecuteWithMessages, mockSupportsCompression, mockAssertSupported } = vi.hoisted(() => ({
    mockExecuteQuery: vi.fn(),
    mockExecuteWithMessages: vi.fn(),
    mockSupportsCompression: vi.fn(),
    mockAssertSupported: vi.fn(),
}));

vi.mock("@/lib/adapters/database/mssql/connection", () => ({
    assertBackupSupported: (...args: unknown[]) => mockAssertSupported(...args),
    executeQuery: (...args: unknown[]) => mockExecuteQuery(...args),
    executeQueryWithMessages: (...args: unknown[]) => mockExecuteWithMessages(...args),
    executeParameterizedQuery: vi.fn(),
    supportsCompression: (...args: unknown[]) => mockSupportsCompression(...args),
    getDatabases: vi.fn(),
}));

import { createFakeHost, type FakeHost } from "@/lib/testing/fake-host";
import { dumpOne } from "@/lib/adapters/database/mssql/dump-one";
import { restoreOne } from "@/lib/adapters/database/mssql/restore-bak";

let mountDir: string;
let workDir: string;

function config() {
    return {
        host: "sql.internal",
        port: 1433,
        user: "sa",
        password: "secret",
        backupPath: "/var/opt/mssql/backup",
        localBackupPath: mountDir,
    };
}

function queries(): string[] {
    return mockExecuteWithMessages.mock.calls.map(c => c[2] as string);
}

/** Stand in for SQL Server writing the .bak into the shared directory. */
function serverWritesBackup() {
    mockExecuteWithMessages.mockImplementation(async (_cfg, _host, query: string) => {
        const match = /DISK\s*=\s*N?'([^']+)'/.exec(query);
        if (match && query.startsWith("BACKUP")) {
            await writeFile(join(mountDir, match[1].split("/").pop()!), "BAKDATA");
        }
        return { result: {}, messages: [] };
    });
}

function sshHostThatDelivers(): FakeHost {
    const host = createFakeHost({ kind: "ssh" });
    const original = host.getFile.bind(host);
    host.getFile = async (hostPath: string, localPath: string) => {
        await original(hostPath, localPath);
        await writeFile(localPath, "BAKDATA");
    };
    return host;
}

beforeEach(async () => {
    vi.clearAllMocks();
    mountDir = await mkdtemp(join(os.tmpdir(), "dbackup-mssql-mount-"));
    workDir = await mkdtemp(join(os.tmpdir(), "dbackup-mssql-work-"));
    mockAssertSupported.mockResolvedValue(undefined);
    mockSupportsCompression.mockResolvedValue(true);
    mockExecuteWithMessages.mockResolvedValue({ result: {}, messages: [] });
    mockExecuteQuery.mockResolvedValue({
        recordset: [
            { LogicalName: "shop", Type: "D", PhysicalName: "/var/opt/mssql/data/shop.mdf" },
            { LogicalName: "shop_log", Type: "L", PhysicalName: "/var/opt/mssql/data/shop.ldf" },
        ],
    });
});

afterEach(async () => {
    await rm(mountDir, { recursive: true, force: true });
    await rm(workDir, { recursive: true, force: true });
});

describe("MSSQL single-database backup", () => {
    it("backs up one database to a plain .bak through a shared mount and clears the mount", async () => {
        serverWritesBackup();
        const out = join(workDir, "0001.bak");

        const { size } = await dumpOne(config() as never, "shop", out, createFakeHost({ kind: "direct" }));

        expect(queries()[0]).toContain("BACKUP DATABASE [shop]");
        expect(await readFile(out, "utf8")).toBe("BAKDATA");
        expect(size).toBe(7);
        expect(await readdir(mountDir)).toEqual([]);
    });

    it("fetches the .bak over SSH and removes it from the server", async () => {
        const host = sshHostThatDelivers();
        await dumpOne(config() as never, "shop", join(workDir, "0001.bak"), host);

        expect(host.calls.getFile).toHaveLength(1);
        expect(host.calls.removed).toEqual([host.calls.getFile[0].hostPath]);
    });

    it("removes the server-side .bak even when fetching it fails", async () => {
        const host = createFakeHost({ kind: "ssh" });
        host.getFile = async () => { throw new Error("No such file"); };

        await expect(dumpOne(config() as never, "shop", join(workDir, "0001.bak"), host))
            .rejects.toThrow(/not the same directory/);
        expect(host.calls.removed).toHaveLength(1);
    });

    it("explains a mount that does not show the backup SQL Server wrote", async () => {
        await expect(dumpOne(config() as never, "shop", join(workDir, "0001.bak"), createFakeHost({ kind: "direct" })))
            .rejects.toThrow(/localBackupPath/);
    });

    it("keeps a database name with path separators out of the server-side filename", async () => {
        serverWritesBackup();
        await dumpOne(config() as never, "a/b", join(workDir, "0001.bak"), createFakeHost({ kind: "direct" }));

        const disk = /DISK\s*=\s*N?'([^']+)'/.exec(queries()[0])![1];
        expect(disk.split("/").pop()).not.toContain("a/b");
    });
});

describe("MSSQL single-database restore", () => {
    async function dumpFile(): Promise<string> {
        const file = join(workDir, "restore-db-1.bak");
        await writeFile(file, "BAKDATA");
        return file;
    }

    it("restores under the original name without moving files", async () => {
        await restoreOne(config() as never, await dumpFile(), "shop", createFakeHost({ kind: "direct" }), undefined, undefined, "shop");

        const restore = queries().find(q => q.startsWith("RESTORE DATABASE"))!;
        expect(restore).toContain("RESTORE DATABASE [shop]");
        expect(restore).not.toContain("MOVE");
        expect(await readdir(mountDir)).toEqual([]);
    });

    it("moves the files when restoring into a renamed database", async () => {
        mockExecuteQuery.mockImplementation(async (_cfg, _host, query: string) => {
            if (query.includes("FILELISTONLY")) {
                return {
                    recordset: [
                        { LogicalName: "shop", Type: "D", PhysicalName: "/var/opt/mssql/data/shop.mdf" },
                        { LogicalName: "shop_log", Type: "L", PhysicalName: "/var/opt/mssql/data/shop.ldf" },
                    ],
                };
            }
            return { recordset: [{ DataPath: "/var/opt/mssql/data/", LogPath: "/var/opt/mssql/data/" }] };
        });

        await restoreOne(config() as never, await dumpFile(), "shop_copy", createFakeHost({ kind: "direct" }), undefined, undefined, "shop");

        expect(queries().find(q => q.startsWith("RESTORE DATABASE"))).toContain("MOVE");
    });

    it("uploads the dump over SSH under a unique name and removes it afterwards", async () => {
        const host = createFakeHost({ kind: "ssh" });
        await restoreOne(config() as never, await dumpFile(), "shop", host, undefined, undefined, "shop");

        expect(host.calls.putFile).toHaveLength(1);
        expect(host.calls.putFile[0].hostPath).toMatch(/\/var\/opt\/mssql\/backup\/dbackup-restore-[0-9a-f-]+\.bak$/);
        expect(host.calls.removed).toEqual([host.calls.putFile[0].hostPath]);
    });

    it("throws when SQL Server rejects the restore, and still cleans up", async () => {
        mockExecuteWithMessages.mockRejectedValue(new Error("Cannot open backup device"));
        const host = createFakeHost({ kind: "ssh" });

        await expect(restoreOne(config() as never, await dumpFile(), "shop", host, undefined, undefined, "shop"))
            .rejects.toThrow("Cannot open backup device");
        expect(host.calls.removed).toHaveLength(1);
    });

    it("refuses a target name SQL Server cannot accept", async () => {
        await expect(restoreOne(config() as never, await dumpFile(), "", createFakeHost({ kind: "direct" })))
            .rejects.toThrow(/Invalid database name/);
    });
});
