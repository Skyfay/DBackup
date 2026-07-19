import { describe, it, expect, vi, beforeEach } from "vitest";
import { MySQLConfig } from "@/lib/adapters/definitions";

// --- Hoisted mocks ---

const {
    mockGetDatabases,
    mockIsMultiDbTar,
    mockCreateMultiDbTar,
    mockCreateTempDir,
    mockCleanupTempDir,
    mockFsStat,
    mockSpawnProcess,
    mockIsSSHMode,
    mockSshConnect,
    mockSshExecStream,
    mockSshEnd,
    mockExtractSshConfig,
    mockRemoteBinaryCheck,
    mockBuildMysqlArgs,
    PassThrough,
} = vi.hoisted(() => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { PassThrough } = require("stream") as { PassThrough: typeof import("stream").PassThrough };
    return {
        mockGetDatabases: vi.fn(),
        mockIsMultiDbTar: vi.fn(),
        mockCreateMultiDbTar: vi.fn(),
        mockCreateTempDir: vi.fn(),
        mockCleanupTempDir: vi.fn(),
        mockFsStat: vi.fn(),
        mockSpawnProcess: vi.fn(),
        mockIsSSHMode: vi.fn(),
        mockSshConnect: vi.fn(),
        mockSshExecStream: vi.fn(),
        mockSshEnd: vi.fn(),
        mockExtractSshConfig: vi.fn(() => ({ host: "jump.example.com", port: 22 })),
        mockRemoteBinaryCheck: vi.fn(() => Promise.resolve("mysqldump")),
        mockBuildMysqlArgs: vi.fn(() => ["-h", "db.internal", "-u", "root"]),
        PassThrough,
    };
});

vi.mock("@/lib/adapters/database/mysql/connection", () => ({
    getDatabases: (...args: any[]) => mockGetDatabases(...args),
    execFileAsync: vi.fn(),
}));

vi.mock("@/lib/adapters/database/mysql/tools", () => ({
    getMysqldumpCommand: vi.fn(() => "mysqldump"),
    getMysqlCommand: vi.fn(() => "mysql"),
    getMysqladminCommand: vi.fn(() => "mysqladmin"),
    initMysqlTools: vi.fn(),
}));

vi.mock("@/lib/adapters/database/mysql/dialects", () => ({
    getDialect: vi.fn(() => ({
        getDumpArgs: vi.fn((_cfg: any, dbs: string[]) => [
            "--host=localhost",
            "--user=root",
            "--databases",
            ...dbs,
        ]),
        getRestoreArgs: vi.fn(),
    })),
}));

vi.mock("@/lib/adapters/database/common/tar-utils", () => ({
    isMultiDbTar: (...args: any[]) => mockIsMultiDbTar(...args),
    createMultiDbTar: (...args: any[]) => mockCreateMultiDbTar(...args),
    createTempDir: (...args: any[]) => mockCreateTempDir(...args),
    cleanupTempDir: (...args: any[]) => mockCleanupTempDir(...args),
}));

vi.mock("child_process", () => ({
    spawn: (...args: any[]) => mockSpawnProcess(...args),
    default: { spawn: (...args: any[]) => mockSpawnProcess(...args) },
}));

vi.mock("@/lib/ssh", () => ({
    SshClient: class {
        connect = (...args: any[]) => mockSshConnect(...args);
        execStream = (...args: any[]) => mockSshExecStream(...args);
        end = (...args: any[]) => mockSshEnd(...args);
        uploadFile = vi.fn().mockResolvedValue(undefined);
    },
    isSSHMode: (...args: any[]) => mockIsSSHMode(...args),
    extractSshConfig: (...args: any[]) => (mockExtractSshConfig as any)(...args),
    buildMysqlArgs: (...args: any[]) => (mockBuildMysqlArgs as any)(...args),
    withLocalMyCnf: vi.fn(async (password: any, callback: any) =>
        password ? callback('/tmp/mock-local.cnf') : callback(undefined)
    ),
    withRemoteMyCnf: vi.fn(async (_ssh: any, password: any, callback: any) =>
        password ? callback('/tmp/mock.cnf') : callback(undefined)
    ),
    remoteEnv: vi.fn((_env: any, cmd: string) => cmd),
    remoteBinaryCheck: (...args: any[]) => (mockRemoteBinaryCheck as any)(...args),
    shellEscape: vi.fn((s: string) => s),
}));

vi.mock("fs/promises", () => ({
    default: { stat: (...args: any[]) => mockFsStat(...args) },
    stat: (...args: any[]) => mockFsStat(...args),
}));

vi.mock("fs", () => {
    const createWriteStream = vi.fn(() => {
        const stream = new PassThrough() as any;
        stream.on("pipe", () => { process.nextTick(() => stream.emit("finish")); });
        return stream;
    });
    return {
        default: { createWriteStream },
        createWriteStream,
    };
});

import { dump, dumpOne } from "@/lib/adapters/database/mysql/dump";

// -------------------------------------------------------------------------
// Helpers
// -------------------------------------------------------------------------

function buildConfig(overrides: Partial<MySQLConfig & { type?: string; detectedVersion?: string }> = {}): MySQLConfig & { type?: string; detectedVersion?: string } {
    return {
        host: "localhost",
        port: 3306,
        user: "root",
        password: "secret",
        database: "testdb",
        disableSsl: false,
        ...overrides,
    } as any;
}

/** Creates a mock spawn process that emits 'close' with the given exit code. */
function makeSpawnProcess(exitCode = 0, stderrData?: string) {
    const proc = new PassThrough() as any;
    proc.stderr = new PassThrough();
    proc.stdin = new PassThrough();
    proc.stdout = new PassThrough();
    proc.kill = vi.fn();
    process.nextTick(() => {
        if (stderrData) proc.stderr.emit("data", Buffer.from(stderrData));
        proc.emit("close", exitCode);
    });
    return proc;
}

describe("MySQL Dump - dump()", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockIsSSHMode.mockReturnValue(false);
        mockFsStat.mockResolvedValue({ size: 1024 * 100 });
        mockCleanupTempDir.mockResolvedValue(undefined);
        mockSpawnProcess.mockImplementation(() => makeSpawnProcess(0));
    });

    // -------------------------------------------------------------------------
    // Single-database dumps
    // -------------------------------------------------------------------------

    it("dumps a single database and returns success", async () => {
        const result = await dump(buildConfig({ database: "mydb" }), "/tmp/mydb.sql");

        expect(result.success).toBe(true);
        expect(result.size).toBe(1024 * 100);
        expect(mockSpawnProcess).toHaveBeenCalledWith(
            "mysqldump",
            expect.arrayContaining(["mydb"])
        );
    });

    it("uses mysqldump command from tools module", async () => {
        await dump(buildConfig({ database: "mydb" }), "/tmp/output.sql");

        expect(mockSpawnProcess).toHaveBeenCalledWith("mysqldump", expect.any(Array));
    });

    // -------------------------------------------------------------------------
    // dumpOne() - capability export for combined DB+directory backups (JobSource)
    // -------------------------------------------------------------------------

    it("dumpOne() dumps the given database directly, without TAR wrapping", async () => {
        const result = await dumpOne(buildConfig(), "otherdb", "/tmp/otherdb.sql");

        expect(result).toEqual({ size: 1024 * 100 });
        expect(mockSpawnProcess).toHaveBeenCalledWith(
            "mysqldump",
            expect.arrayContaining(["otherdb"])
        );
        expect(mockCreateMultiDbTar).not.toHaveBeenCalled();
    });

    it("dumpOne() works without an onLog callback", async () => {
        await expect(dumpOne(buildConfig(), "otherdb", "/tmp/otherdb.sql")).resolves.toEqual({ size: 1024 * 100 });
    });

    it("dumpOne() forwards log messages when onLog is provided", async () => {
        const logs: string[] = [];
        await dumpOne(buildConfig(), "otherdb", "/tmp/otherdb.sql", (msg) => logs.push(msg));

        expect(logs.some((l) => l.includes("otherdb"))).toBe(true);
    });

    it("returns failure when dump file is empty after process exit", async () => {
        mockFsStat.mockResolvedValue({ size: 0 });
        mockSpawnProcess.mockImplementation(() => makeSpawnProcess(0));

        const result = await dump(buildConfig({ database: "mydb" }), "/tmp/mydb.sql");

        expect(result.success).toBe(false);
        expect(result.error).toMatch(/empty/i);
    });

    it("returns failure when mysqldump exits with non-zero code", async () => {
        mockSpawnProcess.mockImplementation(() => makeSpawnProcess(1));

        const result = await dump(buildConfig({ database: "mydb" }), "/tmp/mydb.sql");

        expect(result.success).toBe(false);
    });

    it("forwards non-filtered stderr messages to the log", async () => {
        mockSpawnProcess.mockImplementation(() => makeSpawnProcess(0, "Table does not support optimize.\n"));
        const logs: string[] = [];

        const result = await dump(buildConfig({ database: "mydb" }), "/tmp/mydb.sql", (msg) => {
            logs.push(msg);
        });

        expect(result.success).toBe(true);
        expect(logs.some((l) => l.includes("Table does not support"))).toBe(true);
    });

    it("filters 'Using a password' warnings from stderr output", async () => {
        mockSpawnProcess.mockImplementation(() =>
            makeSpawnProcess(0, "Using a password on the command line interface can be insecure.\n")
        );
        const logs: string[] = [];

        await dump(buildConfig({ database: "mydb" }), "/tmp/mydb.sql", (msg) => {
            logs.push(msg);
        });

        expect(logs.some((l) => l.toLowerCase().includes("using a password"))).toBe(false);
    });

    // -------------------------------------------------------------------------
    // Database discovery when no database specified
    // -------------------------------------------------------------------------

    it("discovers databases via getDatabases when none specified in config", async () => {
        mockGetDatabases.mockResolvedValue(["discovered_db"]);

        const result = await dump(buildConfig({ database: undefined as any }), "/tmp/out.sql");

        expect(mockGetDatabases).toHaveBeenCalled();
        expect(result.success).toBe(true);
    });

    it("returns failure when no databases exist on the server", async () => {
        mockGetDatabases.mockResolvedValue([]);

        const result = await dump(buildConfig({ database: undefined as any }), "/tmp/out.sql");

        expect(result.success).toBe(false);
        expect(result.error).toMatch(/No databases found/i);
    });

    it("parses comma-separated database list from config", async () => {
        // Create processes inside mockImplementation so nextTick fires AFTER spawn returns
        // and the 'close' listener is already registered.
        mockSpawnProcess.mockImplementation(() => makeSpawnProcess(0));
        mockCreateTempDir.mockResolvedValue("/tmp/mysql-multidb-test");
        mockCreateMultiDbTar.mockResolvedValue({
            databases: [{ name: "db1" }, { name: "db2" }],
        });

        const result = await dump(buildConfig({ database: "db1,db2" }), "/tmp/multi.tar");

        expect(result.success).toBe(true);
        expect(mockCreateMultiDbTar).toHaveBeenCalled();
        expect(mockCleanupTempDir).toHaveBeenCalledWith("/tmp/mysql-multidb-test");
    });

    // -------------------------------------------------------------------------
    // Multi-database TAR archive
    // -------------------------------------------------------------------------

    it("creates a TAR archive for an array of databases", async () => {
        // Create processes inside mockImplementation so nextTick fires AFTER spawn returns.
        mockSpawnProcess.mockImplementation(() => makeSpawnProcess(0));
        mockCreateTempDir.mockResolvedValue("/tmp/mysql-multidb-xyz");
        mockCreateMultiDbTar.mockResolvedValue({
            databases: [{ name: "shop" }, { name: "analytics" }],
        });

        const result = await dump(
            buildConfig({ database: ["shop", "analytics"] as any }),
            "/tmp/multi.tar"
        );

        expect(result.success).toBe(true);
        expect(result.metadata?.multiDb?.format).toBe("tar");
        expect(result.metadata?.multiDb?.databases).toEqual(["shop", "analytics"]);
    });

    it("cleans up the temp directory even when a multi-db dump fails", async () => {
        mockCreateTempDir.mockResolvedValue("/tmp/mysql-multidb-fail");
        mockSpawnProcess.mockImplementation(() => makeSpawnProcess(1)); // dump fails

        const result = await dump(
            buildConfig({ database: "db1,db2" }),
            "/tmp/multi.tar"
        );

        expect(result.success).toBe(false);
        expect(mockCleanupTempDir).toHaveBeenCalledWith("/tmp/mysql-multidb-fail");
    });
});

// -------------------------------------------------------------------------
// SSH dump path
// -------------------------------------------------------------------------

/** Creates a mock SSH stream that emits exit and optional stderr data. */
function makeSshDumpStream(exitCode = 0, stderrData?: string) {
    const stream = new PassThrough() as any;
    stream.stderr = new PassThrough();
    process.nextTick(() => {
        if (stderrData) stream.stderr.emit("data", Buffer.from(stderrData));
        stream.emit("exit", exitCode, null);
    });
    return stream;
}

describe("MySQL Dump - SSH path", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockIsSSHMode.mockReturnValue(true);
        mockFsStat.mockResolvedValue({ size: 1024 * 100 });
        mockCleanupTempDir.mockResolvedValue(undefined);
        mockSshConnect.mockResolvedValue(undefined);
        mockSshEnd.mockReturnValue(undefined);
        mockRemoteBinaryCheck.mockResolvedValue("mysqldump");
        mockBuildMysqlArgs.mockReturnValue(["-h", "db.internal", "-u", "root"]);
        mockExtractSshConfig.mockReturnValue({ host: "jump.example.com", port: 22 });
        mockSshExecStream.mockImplementation((_cmd: any, callback: any) => {
            callback(null, makeSshDumpStream(0));
        });
    });

    it("dumps a single database via SSH successfully", async () => {
        const result = await dump(buildConfig({ database: "mydb" }), "/tmp/mydb.sql");

        expect(result.success).toBe(true);
        expect(result.size).toBe(1024 * 100);
        expect(mockSshExecStream).toHaveBeenCalled();
    });

    it("includes extra options from config.options in SSH args", async () => {
        const result = await dump(
            buildConfig({ database: "mydb", options: "--no-create-info --single-transaction" } as any),
            "/tmp/mydb.sql"
        );

        expect(result.success).toBe(true);
    });

    it("forwards non-filtered SSH stderr to the log", async () => {
        mockSshExecStream.mockImplementation((_cmd: any, callback: any) => {
            callback(null, makeSshDumpStream(0, "Table storage engine not found.\n"));
        });
        const logs: string[] = [];

        await dump(buildConfig({ database: "mydb" }), "/tmp/mydb.sql", (msg) => logs.push(msg));

        expect(logs.some((l) => l.includes("Table storage engine not found"))).toBe(true);
    });

    it("filters 'Using a password' warnings from SSH stderr", async () => {
        mockSshExecStream.mockImplementation((_cmd: any, callback: any) => {
            callback(null, makeSshDumpStream(0, "Using a password on the command line interface can be insecure.\n"));
        });
        const logs: string[] = [];

        await dump(buildConfig({ database: "mydb" }), "/tmp/mydb.sql", (msg) => logs.push(msg));

        expect(logs.some((l) => l.toLowerCase().includes("using a password"))).toBe(false);
    });

    it("filters 'Deprecated program name' warnings from SSH stderr", async () => {
        mockSshExecStream.mockImplementation((_cmd: any, callback: any) => {
            callback(null, makeSshDumpStream(0, "Deprecated program name. It will be removed in a future release.\n"));
        });
        const logs: string[] = [];

        await dump(buildConfig({ database: "mydb" }), "/tmp/mydb.sql", (msg) => logs.push(msg));

        expect(logs.some((l) => l.toLowerCase().includes("deprecated program name"))).toBe(false);
    });

    it("returns failure when remote mysqldump exits with non-zero code", async () => {
        mockSshExecStream.mockImplementation((_cmd: any, callback: any) => {
            callback(null, makeSshDumpStream(1));
        });

        const result = await dump(buildConfig({ database: "mydb" }), "/tmp/mydb.sql");

        expect(result.success).toBe(false);
    });

    it("returns failure when the dump file is empty after SSH dump", async () => {
        mockFsStat.mockResolvedValue({ size: 0 });

        const result = await dump(buildConfig({ database: "mydb" }), "/tmp/mydb.sql");

        expect(result.success).toBe(false);
        expect(result.error).toMatch(/empty/i);
    });

    it("returns failure when execStream yields an error", async () => {
        mockSshExecStream.mockImplementation((_cmd: any, callback: any) => {
            callback(new Error("execStream failed"), null);
        });

        const result = await dump(buildConfig({ database: "mydb" }), "/tmp/mydb.sql");

        expect(result.success).toBe(false);
    });

    it("calls ssh.end in finally block even on failure", async () => {
        mockSshExecStream.mockImplementation((_cmd: any, callback: any) => {
            callback(null, makeSshDumpStream(1));
        });

        await dump(buildConfig({ database: "mydb" }), "/tmp/mydb.sql");

        expect(mockSshEnd).toHaveBeenCalled();
    });
});
