import { describe, it, expect, vi, beforeEach } from "vitest";
import { PostgresConfig } from "@/lib/adapters/definitions";

// --- Hoisted mocks ---

const {
    mockExecFileAsync,
    mockIsMultiDbTar,
    mockExtractSelectedDatabases,
    mockCreateTempDir,
    mockCleanupTempDir,
    mockShouldRestoreDatabase,
    mockGetTargetDatabaseName,
    mockSpawnProcess,
    mockFsOpen,
    mockIsSSHMode,
    mockSshExec,
    PassThrough,
} = vi.hoisted(() => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { PassThrough } = require("stream") as {
        PassThrough: typeof import("stream").PassThrough;
    };
    return {
        mockExecFileAsync: vi.fn(),
        mockIsMultiDbTar: vi.fn(),
        mockExtractSelectedDatabases: vi.fn(),
        mockCreateTempDir: vi.fn(),
        mockCleanupTempDir: vi.fn(),
        mockShouldRestoreDatabase: vi.fn(),
        mockGetTargetDatabaseName: vi.fn(),
        mockSpawnProcess: vi.fn(),
        mockFsOpen: vi.fn(),
        mockIsSSHMode: vi.fn(),
        mockSshExec: vi.fn(),
        PassThrough,
    };
});

vi.mock("@/lib/adapters/database/postgres/connection", () => ({
    execFileAsync: (...args: any[]) => mockExecFileAsync(...args),
}));

vi.mock("@/lib/adapters/database/postgres/dialects", () => ({
    getDialect: vi.fn(() => ({
        getConnectionArgs: vi.fn(() => ["-h", "localhost", "-p", "5432", "-U", "postgres"]),
    })),
}));

vi.mock("@/lib/adapters/database/common/tar-utils", () => ({
    isMultiDbTar: (...args: any[]) => mockIsMultiDbTar(...args),
    extractSelectedDatabases: (...args: any[]) => mockExtractSelectedDatabases(...args),
    createTempDir: (...args: any[]) => mockCreateTempDir(...args),
    cleanupTempDir: (...args: any[]) => mockCleanupTempDir(...args),
    shouldRestoreDatabase: (...args: any[]) => mockShouldRestoreDatabase(...args),
    getTargetDatabaseName: (...args: any[]) => mockGetTargetDatabaseName(...args),
}));

vi.mock("child_process", () => ({
    spawn: (...args: any[]) => mockSpawnProcess(...args),
    default: { spawn: (...args: any[]) => mockSpawnProcess(...args) },
}));

vi.mock("@/lib/ssh", () => ({
    SshClient: class {
        connect = vi.fn().mockResolvedValue(undefined);
        exec = (...args: any[]) => mockSshExec(...args);
        uploadFile = vi.fn().mockResolvedValue(undefined);
        end = vi.fn();
    },
    isSSHMode: (...args: any[]) => mockIsSSHMode(...args),
    extractSshConfig: vi.fn(() => ({ host: "jump.example.com", port: 22 })),
    buildPsqlArgs: vi.fn(() => ["-h", "db.internal", "-U", "postgres"]),
    remoteEnv: vi.fn((_env: any, cmd: string) => cmd),
    remoteBinaryCheck: vi.fn().mockResolvedValue("pg_restore"),
    shellEscape: vi.fn((s: string) => s),
}));

vi.mock("fs/promises", () => ({
    default: {
        open: (...args: any[]) => mockFsOpen(...args),
        stat: vi.fn(),
    },
    open: (...args: any[]) => mockFsOpen(...args),
    stat: vi.fn(),
}));

vi.mock("crypto", () => ({
    randomUUID: vi.fn(() => "test-uuid-1234"),
    default: { randomUUID: vi.fn(() => "test-uuid-1234") },
}));

import { prepareRestore, restore, restoreOne } from "@/lib/adapters/database/postgres/restore";

// -------------------------------------------------------------------------
// Helpers
// -------------------------------------------------------------------------

type RestoreConfig = PostgresConfig & {
    detectedVersion?: string;
    privilegedAuth?: { user: string; password: string };
    databaseMapping?: Array<{
        originalName: string;
        targetName: string;
        selected: boolean;
    }>;
};

function buildConfig(overrides: Partial<RestoreConfig> = {}): RestoreConfig {
    return {
        host: "localhost",
        port: 5432,
        user: "postgres",
        password: "secret",
        database: "testdb",
        ...overrides,
    } as RestoreConfig;
}

/** Returns a mock FileHandle that writes `magic` bytes into the read buffer. */
function makeFsHandle(magic: string) {
    return {
        read: vi.fn().mockImplementation((buffer: Buffer) => {
            Buffer.from(magic).copy(buffer, 0);
            return Promise.resolve({ bytesRead: magic.length });
        }),
        close: vi.fn().mockResolvedValue(undefined),
    };
}

/** Creates a mock pg_restore spawn process. */
function makeRestoreProcess(exitCode = 0, stderrData?: string) {
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

// -------------------------------------------------------------------------
// prepareRestore()
// -------------------------------------------------------------------------

describe("prepareRestore()", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockIsSSHMode.mockReturnValue(false);
    });

    it("skips CREATE DATABASE when the database already exists", async () => {
        // First call: SELECT check returns "1" (DB exists)
        mockExecFileAsync.mockResolvedValue({ stdout: "1\n", stderr: "" });

        await prepareRestore(buildConfig(), ["mydb"]);

        // Only the SELECT check should be called, not CREATE DATABASE
        expect(mockExecFileAsync).toHaveBeenCalledTimes(1);
        expect(mockExecFileAsync).toHaveBeenCalledWith(
            "psql",
            expect.arrayContaining(["-c", expect.stringContaining("SELECT 1")]),
            expect.any(Object)
        );
    });

    it("creates the database when it does not exist", async () => {
        mockExecFileAsync
            .mockResolvedValueOnce({ stdout: "", stderr: "" }) // SELECT -> not found
            .mockResolvedValueOnce({ stdout: "", stderr: "" }); // CREATE DATABASE

        await prepareRestore(buildConfig(), ["newdb"]);

        expect(mockExecFileAsync).toHaveBeenCalledTimes(2);
        expect(mockExecFileAsync).toHaveBeenNthCalledWith(
            2,
            "psql",
            expect.arrayContaining(["-c", expect.stringContaining('CREATE DATABASE "newdb"')]),
            expect.any(Object)
        );
    });

    it("handles multiple databases in a single call", async () => {
        // DB1 exists, DB2 does not
        mockExecFileAsync
            .mockResolvedValueOnce({ stdout: "1\n", stderr: "" }) // db1 check -> exists
            .mockResolvedValueOnce({ stdout: "", stderr: "" })    // db2 check -> not found
            .mockResolvedValueOnce({ stdout: "", stderr: "" });   // db2 CREATE

        await prepareRestore(buildConfig(), ["db1", "db2"]);

        expect(mockExecFileAsync).toHaveBeenCalledTimes(3);
    });

    it("uses privileged credentials when provided", async () => {
        mockExecFileAsync.mockResolvedValue({ stdout: "1\n", stderr: "" });

        await prepareRestore(
            buildConfig({ privilegedAuth: { user: "superuser", password: "adminpw" } }),
            ["mydb"]
        );

        expect(mockExecFileAsync).toHaveBeenCalledWith(
            "psql",
            expect.any(Array),
            expect.objectContaining({ env: expect.objectContaining({ PGPASSWORD: "adminpw" }) })
        );
    });

    it("throws a permission error when CREATE DATABASE is denied", async () => {
        mockExecFileAsync
            .mockResolvedValueOnce({ stdout: "", stderr: "" }) // SELECT -> not found
            .mockRejectedValueOnce({ stderr: "ERROR: permission denied to create database" });

        await expect(prepareRestore(buildConfig(), ["restricted"])).rejects.toThrow(
            /Access denied/i
        );
    });

    it("silently continues when CREATE DATABASE returns 'already exists'", async () => {
        mockExecFileAsync
            .mockResolvedValueOnce({ stdout: "", stderr: "" }) // SELECT -> not found
            .mockRejectedValueOnce({ stderr: "ERROR: database 'mydb' already exists" });

        await expect(prepareRestore(buildConfig(), ["mydb"])).resolves.toBeUndefined();
    });

    it("re-throws unknown errors from psql", async () => {
        mockExecFileAsync.mockRejectedValue({ stderr: "FATAL: out of memory", message: "crash" });

        await expect(prepareRestore(buildConfig(), ["mydb"])).rejects.toBeDefined();
    });

    // SSH path
    it("uses SSH path when SSH mode is active", async () => {
        mockIsSSHMode.mockReturnValue(true);
        // SSH exec: DB exists check returns "1"
        mockSshExec.mockResolvedValue({ code: 0, stdout: "1", stderr: "" });
        await expect(prepareRestore(buildConfig(), ["mydb"])).resolves.toBeUndefined();
    });

    it("creates database via SSH when it does not exist on remote", async () => {
        mockIsSSHMode.mockReturnValue(true);
        mockSshExec
            .mockResolvedValueOnce({ code: 0, stdout: "", stderr: "" }) // check -> not found
            .mockResolvedValueOnce({ code: 0, stdout: "", stderr: "" }); // CREATE

        await prepareRestore(buildConfig(), ["newdb"]);

        expect(mockSshExec).toHaveBeenCalledTimes(2);
    });

    it("throws permission error via SSH when CREATE is denied", async () => {
        mockIsSSHMode.mockReturnValue(true);
        mockSshExec
            .mockResolvedValueOnce({ code: 0, stdout: "", stderr: "" }) // check -> not found
            .mockResolvedValueOnce({ code: 1, stdout: "", stderr: "permission denied to create database" });

        await expect(prepareRestore(buildConfig(), ["restricted"])).rejects.toThrow(/Access denied/i);
    });

    it("silently continues via SSH when database already exists on CREATE", async () => {
        mockIsSSHMode.mockReturnValue(true);
        mockSshExec
            .mockResolvedValueOnce({ code: 0, stdout: "", stderr: "" }) // check -> not found
            .mockResolvedValueOnce({ code: 1, stdout: "", stderr: "database already exists" });

        await expect(prepareRestore(buildConfig(), ["mydb"])).resolves.toBeUndefined();
    });

    it("throws a generic error via SSH when CREATE DATABASE fails with unexpected reason", async () => {
        mockIsSSHMode.mockReturnValue(true);
        mockSshExec
            .mockResolvedValueOnce({ code: 0, stdout: "", stderr: "" }) // check -> not found
            .mockResolvedValueOnce({ code: 1, stdout: "", stderr: "disk full, cannot create database" });

        await expect(prepareRestore(buildConfig(), ["mydb"])).rejects.toThrow("Failed to create database");
    });
});

// -------------------------------------------------------------------------
// restore() - single custom-format backup
// -------------------------------------------------------------------------

// -------------------------------------------------------------------------
// restoreOne() - capability export for combined DB+directory restores (JobSource)
// -------------------------------------------------------------------------

describe("restoreOne()", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockIsSSHMode.mockReturnValue(false);
        mockSpawnProcess.mockImplementation(() => makeRestoreProcess(0));
    });

    it("restores the given file into the given target database directly", async () => {
        await expect(restoreOne(buildConfig(), "/tmp/db.dump", "targetdb")).resolves.toBeUndefined();

        expect(mockSpawnProcess).toHaveBeenCalledWith(
            "pg_restore",
            expect.arrayContaining(["-d", "targetdb"]),
            expect.any(Object)
        );
        // Unlike restore(), restoreOne does not check/create the target database itself.
        expect(mockExecFileAsync).not.toHaveBeenCalled();
    });

    it("works without an onLog callback", async () => {
        await expect(restoreOne(buildConfig(), "/tmp/db.dump", "targetdb")).resolves.toBeUndefined();
    });

    it("uses privilegedAuth credentials when provided", async () => {
        await restoreOne(
            buildConfig({ privilegedAuth: { user: "admin", password: "adminpw" } }),
            "/tmp/db.dump",
            "targetdb"
        );

        const [, , spawnOptions] = mockSpawnProcess.mock.calls[0] as any[];
        expect(spawnOptions.env.PGPASSWORD).toBe("adminpw");
    });
});

describe("restore() - single custom format", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockIsSSHMode.mockReturnValue(false);
        mockIsMultiDbTar.mockResolvedValue(false);
        mockCleanupTempDir.mockResolvedValue(undefined);
        mockExecFileAsync.mockResolvedValue({ stdout: "1\n", stderr: "" }); // DB exists
        // Default: file is PGDMP (custom format)
        mockFsOpen.mockResolvedValue(makeFsHandle("PGDMP"));
        mockSpawnProcess.mockImplementation(() => makeRestoreProcess(0));
    });

    it("restores a single custom-format backup successfully", async () => {
        const result = await restore(buildConfig({ database: "testdb" }), "/backups/dump.pgdmp");

        expect(result.success).toBe(true);
        expect(mockSpawnProcess).toHaveBeenCalledWith(
            "pg_restore",
            expect.arrayContaining(["-d", "testdb"]),
            expect.any(Object)
        );
    });

    it("includes --clean and --if-exists in pg_restore args", async () => {
        await restore(buildConfig({ database: "testdb" }), "/backups/dump.pgdmp");

        expect(mockSpawnProcess).toHaveBeenCalledWith(
            "pg_restore",
            expect.arrayContaining(["--clean", "--if-exists"]),
            expect.any(Object)
        );
    });

    it("returns failure for plain SQL format (not PGDMP)", async () => {
        mockFsOpen.mockResolvedValue(makeFsHandle("--SQL"));

        const result = await restore(buildConfig({ database: "testdb" }), "/backups/dump.sql");

        expect(result.success).toBe(false);
        expect(result.error).toMatch(/Plain SQL format is no longer supported/i);
    });

    it("returns success on pg_restore exit code 0", async () => {
        mockSpawnProcess.mockImplementation(() => makeRestoreProcess(0));

        const result = await restore(buildConfig({ database: "testdb" }), "/backups/dump.pgdmp");

        expect(result.success).toBe(true);
    });

    it("treats pg_restore exit code 1 with warnings as success", async () => {
        mockSpawnProcess.mockImplementation(() =>
            makeRestoreProcess(1, "pg_restore: warning: errors ignored on restore: 1")
        );

        const result = await restore(buildConfig({ database: "testdb" }), "/backups/dump.pgdmp");

        expect(result.success).toBe(true);
    });

    it("logs specific warning for transaction_timeout issue", async () => {
        mockSpawnProcess.mockImplementation(() =>
            makeRestoreProcess(
                1,
                "pg_restore: warning: errors ignored on restore: 1\nERROR: unrecognized configuration parameter \"transaction_timeout\""
            )
        );
        const logs: string[] = [];

        const result = await restore(
            buildConfig({ database: "testdb" }),
            "/backups/dump.pgdmp",
            (msg) => logs.push(msg)
        );

        expect(result.success).toBe(true);
        expect(logs.some((l) => l.includes("transaction_timeout"))).toBe(true);
    });

    it("returns failure for pg_restore exit code 2", async () => {
        mockSpawnProcess.mockImplementation(() => makeRestoreProcess(2));

        const result = await restore(buildConfig({ database: "testdb" }), "/backups/dump.pgdmp");

        expect(result.success).toBe(false);
        expect(result.error).toMatch(/pg_restore exited with code 2/i);
    });

    it("includes stderr in error message when pg_restore fails with non-empty stderr", async () => {
        mockSpawnProcess.mockImplementation(() =>
            makeRestoreProcess(2, "FATAL: database 'testdb' does not exist")
        );

        const result = await restore(buildConfig({ database: "testdb" }), "/backups/dump.pgdmp");

        expect(result.success).toBe(false);
        expect(result.error).toContain("pg_restore exited with code 2");
        expect(result.error).toContain("FATAL: database 'testdb' does not exist");
    });

    it("returns failure when pg_restore emits an error event", async () => {
        const proc = new PassThrough() as any;
        proc.stderr = new PassThrough();
        proc.stdout = new PassThrough();
        proc.kill = vi.fn();
        process.nextTick(() => {
            proc.emit("error", new Error("spawn pg_restore ENOENT"));
        });
        mockSpawnProcess.mockImplementation(() => proc);

        const result = await restore(buildConfig({ database: "testdb" }), "/backups/dump.pgdmp");

        expect(result.success).toBe(false);
        expect(result.error).toContain("ENOENT");
    });

    it("logs stdout output from pg_restore", async () => {
        const proc = new PassThrough() as any;
        proc.stderr = new PassThrough();
        proc.stdout = new PassThrough();
        proc.kill = vi.fn();
        process.nextTick(() => {
            proc.stdout.emit("data", Buffer.from("restoring table users\n"));
            proc.emit("close", 0);
        });
        mockSpawnProcess.mockImplementation(() => proc);

        const logs: string[] = [];
        await restore(buildConfig({ database: "testdb" }), "/backups/dump.pgdmp", (msg) =>
            logs.push(msg)
        );

        expect(logs.some((l) => l.includes("restoring table users"))).toBe(true);
    });

    it("filters NOTICE messages from pg_restore stderr", async () => {
        mockSpawnProcess.mockImplementation(() =>
            makeRestoreProcess(0, "pg_restore: NOTICE: table 'foo' does not exist")
        );
        const logs: string[] = [];

        await restore(buildConfig({ database: "testdb" }), "/backups/dump.pgdmp", (msg) =>
            logs.push(msg)
        );

        expect(logs.some((l) => l.includes("NOTICE"))).toBe(false);
    });

    it("logs warning when no password is provided", async () => {
        const logs: string[] = [];

        await restore(
            buildConfig({ database: "testdb", password: undefined }),
            "/backups/dump.pgdmp",
            (msg) => logs.push(msg)
        );

        expect(logs.some((l) => l.toLowerCase().includes("no password"))).toBe(true);
    });

    // -------------------------------------------------------------------------
    // Database mapping
    // -------------------------------------------------------------------------

    it("uses targetName from mapping as the target database", async () => {
        const config = buildConfig({
            database: undefined,
            databaseMapping: [
                { originalName: "shop", targetName: "shop_restored", selected: true },
            ],
        });

        await restore(config, "/backups/dump.pgdmp");

        expect(mockSpawnProcess).toHaveBeenCalledWith(
            "pg_restore",
            expect.arrayContaining(["-d", "shop_restored"]),
            expect.any(Object)
        );
    });

    it("falls back to originalName when targetName is empty", async () => {
        const config = buildConfig({
            database: undefined,
            databaseMapping: [
                { originalName: "shop", targetName: "", selected: true },
            ],
        });

        await restore(config, "/backups/dump.pgdmp");

        expect(mockSpawnProcess).toHaveBeenCalledWith(
            "pg_restore",
            expect.arrayContaining(["-d", "shop"]),
            expect.any(Object)
        );
    });

    it("returns failure when no databases are selected in mapping", async () => {
        const config = buildConfig({
            database: undefined,
            databaseMapping: [
                { originalName: "shop", targetName: "shop", selected: false },
            ],
        });

        const result = await restore(config, "/backups/dump.pgdmp");

        expect(result.success).toBe(false);
        expect(result.error).toMatch(/No databases selected/i);
    });

    it("returns failure when multiple databases are selected for a single-db backup", async () => {
        const config = buildConfig({
            database: undefined,
            databaseMapping: [
                { originalName: "db1", targetName: "db1", selected: true },
                { originalName: "db2", targetName: "db2", selected: true },
            ],
        });

        const result = await restore(config, "/backups/dump.pgdmp");

        expect(result.success).toBe(false);
        expect(result.error).toMatch(/cannot be restored to multiple databases/i);
    });

    it("falls back to 'postgres' database when no config.database and no mapping", async () => {
        const config = buildConfig({ database: undefined });

        await restore(config, "/backups/dump.pgdmp");

        expect(mockSpawnProcess).toHaveBeenCalledWith(
            "pg_restore",
            expect.arrayContaining(["-d", "postgres"]),
            expect.any(Object)
        );
    });

    it("uses privilegedAuth password for PGPASSWORD env var", async () => {
        const config = buildConfig({
            database: "testdb",
            privilegedAuth: { user: "superuser", password: "adminpw" },
        });

        await restore(config, "/backups/dump.pgdmp");

        expect(mockSpawnProcess).toHaveBeenCalledWith(
            "pg_restore",
            expect.any(Array),
            expect.objectContaining({
                env: expect.objectContaining({ PGPASSWORD: "adminpw" }),
            })
        );
    });
});

// -------------------------------------------------------------------------
// restore() - TAR archive (multi-database)
// -------------------------------------------------------------------------

describe("restore() - TAR archive", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockIsSSHMode.mockReturnValue(false);
        mockIsMultiDbTar.mockResolvedValue(true);
        mockCreateTempDir.mockResolvedValue("/tmp/pg-restore-abc");
        mockCleanupTempDir.mockResolvedValue(undefined);
        mockExtractSelectedDatabases.mockResolvedValue({
            manifest: {
                databases: [
                    { name: "shop", filename: "shop.dump" },
                    { name: "analytics", filename: "analytics.dump" },
                ],
            },
            files: ["/tmp/pg-restore-abc/shop.dump", "/tmp/pg-restore-abc/analytics.dump"],
        });
        mockShouldRestoreDatabase.mockReturnValue(true);
        mockGetTargetDatabaseName.mockImplementation((name: string) => name);
        mockExecFileAsync.mockResolvedValue({ stdout: "1\n", stderr: "" }); // DB exists check
        mockFsOpen.mockResolvedValue(makeFsHandle("PGDMP"));
        mockSpawnProcess.mockImplementation(() => makeRestoreProcess(0));
    });

    it("restores all databases from a TAR archive", async () => {
        const result = await restore(buildConfig(), "/backups/multi.tar");

        expect(result.success).toBe(true);
        expect(mockSpawnProcess).toHaveBeenCalledTimes(2);
    });

    it("skips databases excluded by shouldRestoreDatabase", async () => {
        mockShouldRestoreDatabase
            .mockReturnValueOnce(true)  // shop: include
            .mockReturnValueOnce(false); // analytics: skip

        const result = await restore(buildConfig(), "/backups/multi.tar");

        expect(result.success).toBe(true);
        expect(mockSpawnProcess).toHaveBeenCalledTimes(1);
    });

    it("calls onProgress after each database restore", async () => {
        const progressValues: number[] = [];

        await restore(
            buildConfig(),
            "/backups/multi.tar",
            undefined,
            (pct) => progressValues.push(pct)
        );

        expect(progressValues).toHaveLength(2);
        expect(progressValues[0]).toBe(50);
        expect(progressValues[1]).toBe(100);
    });

    it("extracts only selected databases when mapping is provided", async () => {
        const config = buildConfig({
            databaseMapping: [
                { originalName: "shop", targetName: "shop", selected: true },
                { originalName: "analytics", targetName: "analytics", selected: false },
            ],
        });

        await restore(config, "/backups/multi.tar");

        const [, , selectedNames] = mockExtractSelectedDatabases.mock.calls[0] as any[];
        expect(selectedNames).toContain("shop");
        expect(selectedNames).not.toContain("analytics");
    });

    it("cleans up temp directory after successful TAR restore", async () => {
        await restore(buildConfig(), "/backups/multi.tar");

        expect(mockCleanupTempDir).toHaveBeenCalledWith("/tmp/pg-restore-abc");
    });

    it("cleans up temp directory when a restore fails mid-way", async () => {
        mockSpawnProcess
            .mockImplementationOnce(() => makeRestoreProcess(0))
            .mockImplementationOnce(() => makeRestoreProcess(2));

        await restore(buildConfig(), "/backups/multi.tar");

        expect(mockCleanupTempDir).toHaveBeenCalledWith("/tmp/pg-restore-abc");
    });
});

// -------------------------------------------------------------------------
// restore() - isCustomFormat helper (via file magic bytes)
// -------------------------------------------------------------------------

describe("restore() - format detection", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockIsSSHMode.mockReturnValue(false);
        mockIsMultiDbTar.mockResolvedValue(false);
        mockCleanupTempDir.mockResolvedValue(undefined);
        mockExecFileAsync.mockResolvedValue({ stdout: "1\n", stderr: "" });
        mockSpawnProcess.mockImplementation(() => makeRestoreProcess(0));
    });

    it("detects custom format when file starts with PGDMP magic bytes", async () => {
        mockFsOpen.mockResolvedValue(makeFsHandle("PGDMP"));

        const result = await restore(buildConfig({ database: "testdb" }), "/backups/dump.pgdmp");

        expect(result.success).toBe(true);
        expect(mockSpawnProcess).toHaveBeenCalledWith("pg_restore", expect.any(Array), expect.any(Object));
    });

    it("treats file as plain SQL when magic bytes do not match PGDMP", async () => {
        mockFsOpen.mockResolvedValue(makeFsHandle("-- PO"));

        const result = await restore(buildConfig({ database: "testdb" }), "/backups/dump.sql");

        expect(result.success).toBe(false);
        expect(result.error).toMatch(/Plain SQL/i);
    });

    it("treats file as plain SQL when fs.open throws", async () => {
        mockFsOpen.mockRejectedValue(new Error("ENOENT: no such file"));

        const result = await restore(buildConfig({ database: "testdb" }), "/backups/missing.dump");

        expect(result.success).toBe(false);
        expect(result.error).toMatch(/Plain SQL/i);
    });
});

// -------------------------------------------------------------------------
// restore() - SSH restore path (restoreSingleDatabaseSSH)
// -------------------------------------------------------------------------

describe("restore() - SSH path", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockIsSSHMode.mockReturnValue(true);
        mockIsMultiDbTar.mockResolvedValue(false);
        mockCleanupTempDir.mockResolvedValue(undefined);
        mockFsOpen.mockResolvedValue(makeFsHandle("PGDMP"));
        // Default: all SSH exec calls succeed (DB exists check + pg_restore + cleanup)
        mockSshExec.mockResolvedValue({ code: 0, stdout: "1", stderr: "" });
    });

    it("restores a single database via SSH successfully", async () => {
        const result = await restore(buildConfig({ database: "testdb" }), "/backups/dump.pgdmp");

        expect(result.success).toBe(true);
        // uploadFile should be called to transfer the dump to remote
        // (checked indirectly via success)
    });

    it("returns failure when remote pg_restore exits with code 2", async () => {
        mockSshExec
            .mockResolvedValueOnce({ code: 0, stdout: "1", stderr: "" }) // DB exists
            .mockResolvedValueOnce({ code: 2, stdout: "", stderr: "fatal error" }) // pg_restore fails
            .mockResolvedValue({ code: 0, stdout: "", stderr: "" }); // cleanup

        const result = await restore(buildConfig({ database: "testdb" }), "/backups/dump.pgdmp");

        expect(result.success).toBe(false);
        expect(result.error).toMatch(/exited with code 2/i);
    });

    it("treats remote pg_restore exit code 1 with warning as success", async () => {
        mockSshExec
            .mockResolvedValueOnce({ code: 0, stdout: "1", stderr: "" }) // DB exists
            .mockResolvedValueOnce({
                code: 1,
                stdout: "",
                stderr: "pg_restore: warning: errors ignored on restore: 1",
            }) // pg_restore with warnings
            .mockResolvedValue({ code: 0, stdout: "", stderr: "" }); // cleanup

        const result = await restore(buildConfig({ database: "testdb" }), "/backups/dump.pgdmp");

        expect(result.success).toBe(true);
    });

    it("logs transaction_timeout warning via SSH", async () => {
        mockSshExec
            .mockResolvedValueOnce({ code: 0, stdout: "1", stderr: "" }) // DB exists
            .mockResolvedValueOnce({
                code: 1,
                stdout: "",
                stderr: "pg_restore: warning: errors ignored on restore: 1\nERROR: unrecognized configuration parameter \"transaction_timeout\"",
            })
            .mockResolvedValue({ code: 0, stdout: "", stderr: "" }); // cleanup

        const logs: string[] = [];
        const result = await restore(
            buildConfig({ database: "testdb" }),
            "/backups/dump.pgdmp",
            (msg) => logs.push(msg)
        );

        expect(result.success).toBe(true);
        expect(logs.some((l) => l.includes("transaction_timeout"))).toBe(true);
    });

    it("logs non-NOTICE stderr lines from SSH pg_restore", async () => {
        mockSshExec
            .mockResolvedValueOnce({ code: 0, stdout: "1", stderr: "" })
            .mockResolvedValueOnce({ code: 0, stdout: "", stderr: "restoring table users\n" })
            .mockResolvedValue({ code: 0, stdout: "", stderr: "" });

        const logs: string[] = [];
        await restore(
            buildConfig({ database: "testdb" }),
            "/backups/dump.pgdmp",
            (msg) => logs.push(msg)
        );

        expect(logs.some((l) => l.includes("restoring table users"))).toBe(true);
    });

    it("uses privilegedAuth password via SSH", async () => {
        mockSshExec
            .mockResolvedValueOnce({ code: 0, stdout: "1", stderr: "" })
            .mockResolvedValue({ code: 0, stdout: "", stderr: "" });

        const config = buildConfig({
            database: "testdb",
            privilegedAuth: { user: "superuser", password: "adminpw" },
        });

        const result = await restore(config, "/backups/dump.pgdmp");

        expect(result.success).toBe(true);
    });
});
