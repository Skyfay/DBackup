import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { createWriteStream } from "node:fs";
import { pipeline } from "node:stream/promises";
import { pack } from "tar-stream";
import os from "node:os";
import { join } from "node:path";

const { mockExecuteQuery, mockExecuteWithMessages, mockExecuteParameterized, mockAssertSupported } = vi.hoisted(() => ({
    mockExecuteQuery: vi.fn(),
    mockExecuteWithMessages: vi.fn(),
    mockExecuteParameterized: vi.fn(),
    mockAssertSupported: vi.fn(),
}));

vi.mock("@/lib/adapters/database/mssql/connection", () => ({
    assertBackupSupported: (...args: unknown[]) => mockAssertSupported(...args),
    executeQuery: (...args: unknown[]) => mockExecuteQuery(...args),
    executeQueryWithMessages: (...args: unknown[]) => mockExecuteWithMessages(...args),
    executeParameterizedQuery: (...args: unknown[]) => mockExecuteParameterized(...args),
}));

import { createFakeHost, type FakeHost } from "@/lib/testing/fake-host";
import { restore, prepareRestore } from "@/lib/adapters/database/mssql/restore";
import { CompositeHost, DirectHost } from "@/lib/transport";

let mountDir: string;
let srcDir: string;

/** The queries that reached SQL Server. */
function restoreQueries(): string[] {
    return mockExecuteWithMessages.mock.calls.map(c => c[2] as string);
}

function config() {
    return {
        host: "sql.internal",
        port: 1433,
        user: "sa",
        password: "secret",
        database: "testdb",
        backupPath: "/var/opt/mssql/backup",
        localBackupPath: mountDir,
    };
}

beforeEach(async () => {
    vi.clearAllMocks();
    mountDir = await mkdtemp(join(os.tmpdir(), "dbackup-mssql-mount-"));
    srcDir = await mkdtemp(join(os.tmpdir(), "dbackup-mssql-src-"));

    mockAssertSupported.mockResolvedValue(undefined);
    mockExecuteParameterized.mockResolvedValue({ recordset: [{ state_desc: "ONLINE" }] });
    mockExecuteQuery.mockResolvedValue({
        recordset: [
            { LogicalName: "testdb", Type: "D", PhysicalName: "/var/opt/mssql/data/testdb.mdf" },
            { LogicalName: "testdb_log", Type: "L", PhysicalName: "/var/opt/mssql/data/testdb.ldf" },
        ],
    });
    mockExecuteWithMessages.mockResolvedValue({ result: {}, messages: [] });
});

afterEach(async () => {
    await rm(mountDir, { recursive: true, force: true });
    await rm(srcDir, { recursive: true, force: true });
});

async function makeBackupFile(): Promise<string> {
    const file = join(srcDir, "testdb.bak");
    await writeFile(file, "BAKDATA");
    return file;
}

describe("MSSQL prepareRestore", () => {
    it("accepts a database that is online", async () => {
        await expect(prepareRestore(config() as never, ["testdb"], createFakeHost({ kind: "direct" })))
            .resolves.toBeUndefined();
    });

    it("rejects a database that is not online", async () => {
        mockExecuteParameterized.mockResolvedValue({ recordset: [{ state_desc: "RESTORING" }] });

        await expect(prepareRestore(config() as never, ["testdb"], createFakeHost({ kind: "direct" })))
            .rejects.toThrow(/not online.*RESTORING/);
    });

    it("accepts a database that does not exist yet", async () => {
        mockExecuteParameterized.mockResolvedValue({ recordset: [] });

        await expect(prepareRestore(config() as never, ["newdb"], createFakeHost({ kind: "direct" })))
            .resolves.toBeUndefined();
    });

    it("refuses an unsupported engine before inspecting any target", async () => {
        // Preflight runs before an Execution row exists, so refusing here leaves
        // no failed run behind for the user to interpret.
        mockAssertSupported.mockRejectedValue(new Error("Azure SQL Managed Instance is not supported."));

        await expect(prepareRestore(config() as never, ["testdb"], createFakeHost({ kind: "direct" })))
            .rejects.toThrow("Azure SQL Managed Instance is not supported");
        expect(mockExecuteParameterized).not.toHaveBeenCalled();
    });
});

describe("MSSQL restore with a shared mount", () => {
    it("stages the backup into the mount under a name of its own, runs RESTORE and deletes the copy", async () => {
        const host = createFakeHost({ kind: "direct" });
        // What the mount holds while SQL Server reads the file.
        let staged: string[] = [];
        mockExecuteWithMessages.mockImplementation(async () => {
            staged = await readdir(mountDir);
            return { result: {}, messages: [] };
        });
        const result = await restore(config() as never, await makeBackupFile(), host);

        expect(result.success).toBe(true);
        expect(restoreQueries()[0]).toContain("RESTORE DATABASE");
        expect(staged).toHaveLength(1);
        expect(staged[0]).toMatch(/^dbackup-restore-[0-9a-f-]{36}\.bak$/);
        expect(restoreQueries()[0]).toContain(`/var/opt/mssql/backup/${staged[0]}`);
        expect(host.calls.putFile).toHaveLength(0);
        expect(await readdir(mountDir)).toHaveLength(0);
        // The file the caller handed in stays, it is not the restore's to delete.
        expect(await readFile(join(srcDir, "testdb.bak"), "utf-8")).toBe("BAKDATA");
    });

    it("never lets a name from an older archive pick the file it writes in the mount, and leaves nothing behind", async () => {
        // A file of the mount the archive names, which a copy under the name of the archive would overwrite.
        await writeFile(join(mountDir, "keep_2026-01-01.bak"), "KEEP");
        const tarPath = join(srcDir, "older.tar");
        const tar = pack();
        tar.entry({ name: "keep_2026-01-01.bak" }, "EVIL");
        tar.finalize();
        await pipeline(tar, createWriteStream(tarPath));

        const result = await restore({ ...config(), database: "keep" } as never, tarPath, createFakeHost({ kind: "direct" }));

        expect(result.success).toBe(true);
        expect(restoreQueries()[0]).toMatch(/dbackup-restore-[0-9a-f-]{36}\.bak/);
        expect(await readdir(mountDir)).toEqual(["keep_2026-01-01.bak"]);
        expect(await readFile(join(mountDir, "keep_2026-01-01.bak"), "utf-8")).toBe("KEEP");
    });

    it("removes only the local copy, since both paths are one file", async () => {
        const host = createFakeHost({ kind: "direct" });
        await restore(config() as never, await makeBackupFile(), host);

        expect(host.calls.removed).toHaveLength(0);
    });

    it("reports a failing restore", async () => {
        mockExecuteWithMessages.mockRejectedValue(new Error("Cannot open backup device"));

        const result = await restore(config() as never, await makeBackupFile(), createFakeHost({ kind: "direct" }));

        expect(result.success).toBe(false);
        expect(result.error).toContain("Cannot open backup device");
    });
});

describe.each([
    ["a full SSH connection", () => createFakeHost({ kind: "ssh" })],
    ["the legacy SSH file transfer", () => {
        const files = createFakeHost({ kind: "ssh" });
        const composite = new CompositeHost(new DirectHost(), files);
        Object.defineProperty(composite, "calls", { get: () => files.calls });
        return composite as unknown as FakeHost;
    }],
])("MSSQL restore over %s", (_label, makeHost) => {
    it("uploads the backup file to the server", async () => {
        const host = makeHost();
        const result = await restore(config() as never, await makeBackupFile(), host);

        expect(result.success).toBe(true);
        expect(host.calls.putFile).toHaveLength(1);
        expect(host.calls.putFile[0].hostPath).toContain("/var/opt/mssql/backup/");
    });

    it("removes the uploaded file afterwards", async () => {
        const host = makeHost();
        await restore(config() as never, await makeBackupFile(), host);

        expect(host.calls.removed.some(p => p.includes("/var/opt/mssql/backup/"))).toBe(true);
    });

    it("does not touch the mount directory", async () => {
        const host = makeHost();
        await restore(config() as never, await makeBackupFile(), host);

        expect(await readdir(mountDir)).toHaveLength(0);
    });
});
