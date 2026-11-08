import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import { basename, dirname, join } from "node:path";
import { existsSync } from "node:fs";

const { mockExecuteWithMessages, mockGetDatabases, mockSupportsCompression, mockAssertSupported } = vi.hoisted(() => ({
    mockExecuteWithMessages: vi.fn(),
    mockGetDatabases: vi.fn(),
    mockSupportsCompression: vi.fn(),
    mockAssertSupported: vi.fn(),
}));

vi.mock("@/lib/adapters/database/mssql/connection", () => ({
    assertBackupSupported: (...args: unknown[]) => mockAssertSupported(...args),
    executeQueryWithMessages: (...args: unknown[]) => mockExecuteWithMessages(...args),
    getDatabases: (...args: unknown[]) => mockGetDatabases(...args),
    supportsCompression: (...args: unknown[]) => mockSupportsCompression(...args),
}));

import { createFakeHost, type FakeHost } from "@/lib/testing/fake-host";
import { dump } from "@/lib/adapters/database/mssql/dump";
import { CompositeHost, DirectHost } from "@/lib/transport";

/**
 * These run against a real temp directory rather than a mocked filesystem, so
 * the shared-mount path is exercised for what it actually is: SQL Server writes
 * the .bak and DBackup reads the very same file from its own side.
 */

let mountDir: string;
let outDir: string;

/** The queries that reached SQL Server. */
function queries(): string[] {
    return mockExecuteWithMessages.mock.calls.map(c => c[2] as string);
}

/** Stand in for SQL Server writing the .bak into the shared directory. */
function serverWritesBackup() {
    mockExecuteWithMessages.mockImplementation(async (_cfg, _host, query: string) => {
        const match = /DISK\s*=\s*N?'([^']+)'/.exec(query);
        if (match) {
            await writeFile(join(mountDir, match[1].split("/").pop()!), "BAKDATA");
        }
        return { result: {}, messages: [] };
    });
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
    outDir = await mkdtemp(join(os.tmpdir(), "dbackup-mssql-out-"));
    mockSupportsCompression.mockResolvedValue(true);
    mockAssertSupported.mockResolvedValue(undefined);
    mockExecuteWithMessages.mockResolvedValue({ result: {}, messages: [] });
});

afterEach(async () => {
    await rm(mountDir, { recursive: true, force: true });
    await rm(outDir, { recursive: true, force: true });
});

describe("MSSQL dump against an unsupported engine", () => {
    it("refuses before sending a single statement", async () => {
        // Azure SQL Database used to get all the way to BACKUP DATABASE and fail
        // there with "not supported in this version of SQL Server", which names
        // neither the product nor the way forward.
        serverWritesBackup();
        mockAssertSupported.mockRejectedValue(
            new Error("Azure SQL Database is not supported by this adapter. It has no BACKUP DATABASE statement at all."),
        );

        const result = await dump(config() as never, join(outDir, "out.bak"), createFakeHost({ kind: "direct" }));

        expect(result.success).toBe(false);
        expect(result.error).toContain("Azure SQL Database is not supported");
        expect(queries()).toHaveLength(0);
    });
});

describe("MSSQL dump with a shared mount", () => {
    beforeEach(serverWritesBackup);

    it("runs BACKUP DATABASE and reads the file in place", async () => {
        // Copying would be wrong here: the two paths are one file seen from two
        // sides, so a copy would truncate the source.
        const host = createFakeHost({ kind: "direct" });
        const out = join(outDir, "out.bak");

        const result = await dump(config() as never, out, host);

        expect(result.success).toBe(true);
        expect(queries()[0]).toContain("BACKUP DATABASE [testdb]");
        expect(host.calls.getFile).toHaveLength(0);
        expect(await readFile(out, "utf8")).toBe("BAKDATA");
    });

    it("removes only the local file, since both paths are one file", async () => {
        const host = createFakeHost({ kind: "direct" });
        await dump(config() as never, join(outDir, "out.bak"), host);

        expect(host.calls.removed).toHaveLength(0);
    });

    it("discovers the databases when none are selected", async () => {
        mockGetDatabases.mockResolvedValue(["testdb"]);
        const host = createFakeHost({ kind: "direct" });

        await dump({ ...config(), database: "" } as never, join(outDir, "out.bak"), host);
        expect(mockGetDatabases).toHaveBeenCalledWith(expect.anything(), host);
    });

    it("skips compression on an edition that does not support it", async () => {
        mockSupportsCompression.mockResolvedValue(false);

        const logs: string[] = [];
        await dump(config() as never, join(outDir, "out.bak"), createFakeHost({ kind: "direct" }), (m) => logs.push(m));

        expect(logs.join("\n")).toContain("Compression disabled");
    });

    it("explains the mount when the file never appears", async () => {
        // SQL Server writes nothing, which is what a wrong localBackupPath looks like.
        mockExecuteWithMessages.mockResolvedValue({ result: {}, messages: [] });

        const result = await dump(config() as never, join(outDir, "out.bak"), createFakeHost({ kind: "direct" }));

        expect(result.success).toBe(false);
        expect(result.error).toContain("localBackupPath");
    });
});

describe.each([
    ["a full SSH connection", () => createFakeHost({ kind: "ssh" })],
    ["the legacy SSH file transfer", () => {
        const files = createFakeHost({ kind: "ssh" });
        const composite = new CompositeHost(new DirectHost(), files);
        // Reuse the fake's recorder for the file side.
        Object.defineProperty(composite, "calls", { get: () => files.calls });
        return composite as unknown as FakeHost;
    }],
])("MSSQL dump over %s", (_label, makeHost) => {
    /** Over SSH the .bak is fetched, so the fake writes it where it lands. */
    function hostThatDelivers(): FakeHost {
        const host = makeHost();
        const original = host.getFile.bind(host);
        host.getFile = async (hostPath: string, localPath: string) => {
            await original(hostPath, localPath);
            await writeFile(localPath, "BAKDATA");
        };
        return host;
    }

    it("fetches the backup file from the server", async () => {
        const host = hostThatDelivers();
        const result = await dump(config() as never, join(outDir, "out.bak"), host);

        expect(result.success).toBe(true);
        expect(host.calls.getFile).toHaveLength(1);
        expect(host.calls.getFile[0].hostPath).toContain("/var/opt/mssql/backup/");
    });

    it("stages into a private folder of the temporary folder rather than the mount path, and removes it", async () => {
        const host = hostThatDelivers();
        await dump(config() as never, join(outDir, "out.bak"), host);

        const staged = host.calls.getFile[0].localPath;
        expect(dirname(dirname(staged))).toBe(os.tmpdir());
        expect(basename(dirname(staged))).toMatch(/^mssql-dump-/);
        expect(existsSync(dirname(staged))).toBe(false);
    });

    it("keeps a database name with separators to one file name of that folder", async () => {
        const host = hostThatDelivers();
        const result = await dump({ ...config(), database: "../../shop" } as never, join(outDir, "out.bak"), host);

        expect(result.success).toBe(true);
        const staged = host.calls.getFile[0].localPath;
        expect(basename(dirname(staged))).toMatch(/^mssql-dump-/);
        expect(basename(staged)).toMatch(/^\.\._\.\._shop_.*\.bak$/);
    });

    it("removes the server-side backup file afterwards", async () => {
        const host = hostThatDelivers();
        await dump(config() as never, join(outDir, "out.bak"), host);

        expect(host.calls.removed.some(p => p.includes("/var/opt/mssql/backup/"))).toBe(true);
    });

    it("logs the transfer mode", async () => {
        const logs: string[] = [];
        await dump(config() as never, join(outDir, "out.bak"), hostThatDelivers(), (m) => logs.push(m));

        expect(logs.join("\n")).toContain("File transfer mode: SSH");
    });
});
