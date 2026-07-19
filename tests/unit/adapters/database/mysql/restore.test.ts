import { describe, it, expect, vi, beforeEach } from "vitest";
import { MySQLConfig } from "@/lib/adapters/definitions";

// --- Hoisted mocks ---

const {
    mockEnsureDatabase,
    mockIsMultiDbTar,
    mockExtractSelectedDatabases,
    mockCreateTempDir,
    mockCleanupTempDir,
    mockShouldRestoreDatabase,
    mockGetTargetDatabaseName,
    mockSpawnProcess,
    mockWaitForProcess,
    mockFsStat,
    mockCreateReadStream,
    mockIsSSHMode,
    mockSshConnect,
    mockSshExec,
    mockSshExecStream,
    mockSshUploadFile,
    mockSshEnd,
    mockExtractSshConfig,
    mockRemoteBinaryCheck,
    mockBuildMysqlArgs,
    PassThrough,
} = vi.hoisted(() => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { PassThrough } = require("stream") as { PassThrough: typeof import("stream").PassThrough };
    return {
        mockEnsureDatabase: vi.fn(),
        mockIsMultiDbTar: vi.fn(),
        mockExtractSelectedDatabases: vi.fn(),
        mockCreateTempDir: vi.fn(),
        mockCleanupTempDir: vi.fn(),
        mockShouldRestoreDatabase: vi.fn(),
        mockGetTargetDatabaseName: vi.fn(),
        mockSpawnProcess: vi.fn(),
        mockWaitForProcess: vi.fn(),
        mockFsStat: vi.fn(),
        mockCreateReadStream: vi.fn(),
        mockIsSSHMode: vi.fn(),
        mockSshConnect: vi.fn(),
        mockSshExec: vi.fn(),
        mockSshExecStream: vi.fn(),
        mockSshUploadFile: vi.fn(),
        mockSshEnd: vi.fn(),
        mockExtractSshConfig: vi.fn(() => ({ host: "jump.example.com", port: 22 })),
        mockRemoteBinaryCheck: vi.fn(() => Promise.resolve("mysql")),
        mockBuildMysqlArgs: vi.fn(() => ["-h", "db.internal", "-u", "root"]),
        PassThrough,
    };
});

vi.mock("@/lib/adapters/database/mysql/connection", () => ({
    ensureDatabase: (...args: any[]) => mockEnsureDatabase(...args),
    execFileAsync: vi.fn(),
}));

vi.mock("@/lib/adapters/database/mysql/tools", () => ({
    getMysqlCommand: vi.fn(() => "mysql"),
    getMysqldumpCommand: vi.fn(() => "mysqldump"),
    getMysqladminCommand: vi.fn(() => "mysqladmin"),
    initMysqlTools: vi.fn(),
}));

vi.mock("@/lib/adapters/database/mysql/dialects", () => ({
    getDialect: vi.fn(() => ({
        getDumpArgs: vi.fn(),
        getRestoreArgs: vi.fn(() => ["--host=localhost", "--user=root", "testdb"]),
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

vi.mock("@/lib/adapters/process", () => ({
    waitForProcess: (...args: any[]) => mockWaitForProcess(...args),
}));

vi.mock("@/lib/ssh", () => ({
    SshClient: class {
        connect = (...args: any[]) => mockSshConnect(...args);
        exec = (...args: any[]) => mockSshExec(...args);
        execStream = (...args: any[]) => mockSshExecStream(...args);
        uploadFile = (...args: any[]) => mockSshUploadFile(...args);
        end = (...args: any[]) => mockSshEnd(...args);
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

vi.mock("fs", () => ({
    default: { createReadStream: (...args: any[]) => mockCreateReadStream(...args) },
    createReadStream: (...args: any[]) => mockCreateReadStream(...args),
}));

vi.mock("crypto", () => ({
    randomUUID: vi.fn(() => "test-uuid-1234"),
    default: { randomUUID: vi.fn(() => "test-uuid-1234") },
}));

import { prepareRestore, restore, restoreOne } from "@/lib/adapters/database/mysql/restore";

// -------------------------------------------------------------------------
// Helpers
// -------------------------------------------------------------------------

function buildConfig(overrides: Record<string, any> = {}): MySQLConfig & Record<string, any> {
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

function makeSpawnProcess() {
    const proc = new PassThrough() as any;
    proc.stderr = new PassThrough();
    proc.stdin = new PassThrough();
    proc.stdout = new PassThrough();
    proc.kill = vi.fn();
    return proc;
}

// -------------------------------------------------------------------------
// prepareRestore()
// -------------------------------------------------------------------------

describe("prepareRestore()", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockIsSSHMode.mockReturnValue(false);
        mockEnsureDatabase.mockResolvedValue(undefined);
    });

    it("calls ensureDatabase for each database in the list", async () => {
        const config = buildConfig();

        await prepareRestore(config, ["db1", "db2"]);

        expect(mockEnsureDatabase).toHaveBeenCalledTimes(2);
        expect(mockEnsureDatabase).toHaveBeenCalledWith(config, "db1", "root", "secret", false, []);
        expect(mockEnsureDatabase).toHaveBeenCalledWith(config, "db2", "root", "secret", false, []);
    });

    it("uses privilegedAuth credentials when provided", async () => {
        const config = buildConfig({
            privilegedAuth: { user: "admin", password: "adminpw" },
        });

        await prepareRestore(config, ["mydb"]);

        expect(mockEnsureDatabase).toHaveBeenCalledWith(
            config, "mydb", "admin", "adminpw", true, []
        );
    });

    it("does nothing when the database list is empty", async () => {
        await prepareRestore(buildConfig(), []);

        expect(mockEnsureDatabase).not.toHaveBeenCalled();
    });
});

// -------------------------------------------------------------------------
// restore() - error paths
// -------------------------------------------------------------------------

describe("restore() - error paths", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockIsSSHMode.mockReturnValue(false);
        mockIsMultiDbTar.mockResolvedValue(false);
    });

    it("returns failure when no target database is specified", async () => {
        const config = buildConfig({ database: undefined });

        const result = await restore(config, "/fake/dump.sql");

        expect(result.success).toBe(false);
        expect(result.error).toMatch(/No target database specified/i);
    });

    it("returns failure when no databases are selected in dbMapping", async () => {
        const config = buildConfig({
            database: undefined,
            databaseMapping: [
                { originalName: "shop", targetName: "shop", selected: false },
            ],
        });

        const result = await restore(config, "/fake/dump.sql");

        expect(result.success).toBe(false);
        expect(result.error).toMatch(/No databases selected/i);
    });
});

// -------------------------------------------------------------------------
// restore() - single database success
// -------------------------------------------------------------------------

describe("restore() - single database", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockIsSSHMode.mockReturnValue(false);
        mockIsMultiDbTar.mockResolvedValue(false);
        mockEnsureDatabase.mockResolvedValue(undefined);
        mockFsStat.mockResolvedValue({ size: 1024 });
        mockWaitForProcess.mockResolvedValue(undefined);
        mockCreateReadStream.mockImplementation(() => {
            const stream = new PassThrough();
            process.nextTick(() => stream.end(Buffer.from("sql-content")));
            return stream;
        });
        mockSpawnProcess.mockImplementation(() => makeSpawnProcess());
    });

    it("restores a single database successfully", async () => {
        const result = await restore(buildConfig({ database: "testdb" }), "/backups/dump.sql");

        expect(result.success).toBe(true);
        expect(mockSpawnProcess).toHaveBeenCalledWith("mysql", expect.any(Array), expect.any(Object));
    });

    it("uses the target name from databaseMapping when provided", async () => {
        const config = buildConfig({
            database: undefined,
            databaseMapping: [
                { originalName: "shop", targetName: "shop_restored", selected: true },
            ],
        });

        const result = await restore(config, "/backups/dump.sql");

        expect(result.success).toBe(true);
        expect(mockEnsureDatabase).toHaveBeenCalledWith(
            config, "shop_restored", "root", "secret", false, expect.any(Array)
        );
    });

    it("falls back to originalName when targetName is empty in mapping", async () => {
        const config = buildConfig({
            database: undefined,
            databaseMapping: [
                { originalName: "shop", targetName: "", selected: true },
            ],
        });

        const result = await restore(config, "/backups/dump.sql");

        expect(result.success).toBe(true);
        expect(mockEnsureDatabase).toHaveBeenCalledWith(
            config, "shop", expect.any(String), expect.any(String), expect.any(Boolean), expect.any(Array)
        );
    });

    // -------------------------------------------------------------------------
    // createStderrHandler behavior (tested via waitForProcess callback)
    // -------------------------------------------------------------------------

    it("forwards stderr lines as log entries", async () => {
        mockWaitForProcess.mockImplementation((_proc, _name, onLog) => {
            if (onLog) onLog("Importing table data\n");
            return Promise.resolve();
        });

        const result = await restore(buildConfig({ database: "testdb" }), "/backups/dump.sql");

        expect(result.success).toBe(true);
        expect(result.logs.some((l) => l.includes("Importing table data"))).toBe(true);
    });

    it("filters benign 'Using a password' warnings from stderr", async () => {
        mockWaitForProcess.mockImplementation((_proc, _name, onLog) => {
            if (onLog) onLog("Using a password on the command line interface can be insecure.\n");
            return Promise.resolve();
        });

        const result = await restore(buildConfig({ database: "testdb" }), "/backups/dump.sql");

        expect(result.logs.some((l) => l.toLowerCase().includes("using a password"))).toBe(false);
    });

    it("filters 'Deprecated program name' warnings from stderr", async () => {
        mockWaitForProcess.mockImplementation((_proc, _name, onLog) => {
            if (onLog) onLog("Deprecated program name. It will be removed in a future release.\n");
            return Promise.resolve();
        });

        const result = await restore(buildConfig({ database: "testdb" }), "/backups/dump.sql");

        expect(result.logs.some((l) => l.toLowerCase().includes("deprecated program name"))).toBe(false);
    });

    it("prefixes ERROR lines and logs them at error level via onLog callback", async () => {
        mockWaitForProcess.mockImplementation((_proc, _name, onLog) => {
            if (onLog) onLog("ERROR 1045 (28000): Access denied for user\n");
            return Promise.resolve();
        });

        const logCalls: { msg: string; level?: string }[] = [];
        await restore(buildConfig({ database: "testdb" }), "/backups/dump.sql", (msg, level) => {
            logCalls.push({ msg, level });
        });

        const errorEntry = logCalls.find((l) => l.msg.includes("ERROR 1045"));
        expect(errorEntry).toBeDefined();
        expect(errorEntry?.level).toBe("error");
    });

    it("truncates stderr lines that exceed 500 characters", async () => {
        const longLine = "x".repeat(600);
        mockWaitForProcess.mockImplementation((_proc, _name, onLog) => {
            if (onLog) onLog(`${longLine}\n`);
            return Promise.resolve();
        });

        const result = await restore(buildConfig({ database: "testdb" }), "/backups/dump.sql");

        const truncatedEntry = result.logs.find((l) => l.includes("(truncated)"));
        expect(truncatedEntry).toBeDefined();
    });

    it("suppresses stderr lines beyond 50 and logs a suppression summary", async () => {
        mockWaitForProcess.mockImplementation((_proc, _name, onLog) => {
            if (onLog) {
                // Send 55 normal lines to exceed MAX_STDERR_LOG_LINES (50)
                for (let i = 0; i < 55; i++) {
                    onLog(`Warning line ${i}\n`);
                }
            }
            return Promise.resolve();
        });

        const result = await restore(buildConfig({ database: "testdb" }), "/backups/dump.sql");

        const suppressEntry = result.logs.find((l) => l.includes("suppressed"));
        expect(suppressEntry).toBeDefined();
        expect(suppressEntry).toMatch(/5 additional stderr line\(s\) suppressed/);
    });

    it("flushes remaining buffered stderr content after process completes", async () => {
        mockWaitForProcess.mockImplementation((_proc, _name, onLog) => {
            // Send text without a trailing newline - will be held in buffer until flush
            if (onLog) onLog("partial-line-no-newline");
            return Promise.resolve();
        });

        const result = await restore(buildConfig({ database: "testdb" }), "/backups/dump.sql");

        expect(result.logs.some((l) => l.includes("partial-line-no-newline"))).toBe(true);
    });
});

// -------------------------------------------------------------------------
// restore() - Multi-DB TAR archive
// -------------------------------------------------------------------------

// -------------------------------------------------------------------------
// restoreOne() - capability export for combined DB+directory restores (JobSource)
// -------------------------------------------------------------------------

describe("restoreOne()", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockIsSSHMode.mockReturnValue(false);
        mockFsStat.mockResolvedValue({ size: 1024 });
        mockWaitForProcess.mockResolvedValue(undefined);
        mockCreateReadStream.mockImplementation(() => {
            const stream = new PassThrough();
            process.nextTick(() => stream.end(Buffer.from("sql-content")));
            return stream;
        });
        mockSpawnProcess.mockImplementation(() => makeSpawnProcess());
    });

    it("restores the given file into the given target database directly", async () => {
        await expect(restoreOne(buildConfig(), "/tmp/db.sql", "targetdb")).resolves.toBeUndefined();

        expect(mockSpawnProcess).toHaveBeenCalledWith("mysql", expect.any(Array), expect.any(Object));
        // Unlike restore(), restoreOne does not create the target database itself.
        expect(mockEnsureDatabase).not.toHaveBeenCalled();
    });

    it("works without onLog/onProgress callbacks", async () => {
        await expect(restoreOne(buildConfig(), "/tmp/db.sql", "targetdb")).resolves.toBeUndefined();
    });

    it("passes the original database name through for USE/CREATE DATABASE rewriting", async () => {
        const logs: string[] = [];
        await restoreOne(buildConfig(), "/tmp/db.sql", "renamed_db", (msg) => logs.push(msg), undefined, "original_db");

        expect(logs.some((l) => l.includes("renamed_db"))).toBe(true);
    });
});

describe("restore() - Multi-DB TAR archive", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockIsSSHMode.mockReturnValue(false);
        mockIsMultiDbTar.mockResolvedValue(true);
        mockEnsureDatabase.mockResolvedValue(undefined);
        mockCleanupTempDir.mockResolvedValue(undefined);
        mockFsStat.mockResolvedValue({ size: 1024 });
        mockWaitForProcess.mockResolvedValue(undefined);
        mockCreateReadStream.mockImplementation(() => {
            const stream = new PassThrough();
            process.nextTick(() => stream.end(Buffer.from("sql-content")));
            return stream;
        });
        mockSpawnProcess.mockImplementation(() => makeSpawnProcess());
        mockShouldRestoreDatabase.mockReturnValue(true);
        mockGetTargetDatabaseName.mockImplementation((name: string) => name);
    });

    it("restores all databases from a TAR archive", async () => {
        const tempDir = "/tmp/mysql-restore-test";
        mockCreateTempDir.mockResolvedValue(tempDir);
        mockExtractSelectedDatabases.mockResolvedValue({
            manifest: {
                databases: [
                    { name: "shop", filename: "shop.sql" },
                    { name: "analytics", filename: "analytics.sql" },
                ],
            },
            files: [
                `${tempDir}/shop.sql`,
                `${tempDir}/analytics.sql`,
            ],
        });

        const result = await restore(buildConfig(), "/backups/multi.tar");

        expect(result.success).toBe(true);
        expect(mockEnsureDatabase).toHaveBeenCalledTimes(2);
        expect(result.logs.some((l) => l.includes("shop"))).toBe(true);
        expect(result.logs.some((l) => l.includes("analytics"))).toBe(true);
    });

    it("skips databases that should not be restored according to shouldRestoreDatabase", async () => {
        const tempDir = "/tmp/mysql-restore-skip";
        mockCreateTempDir.mockResolvedValue(tempDir);
        mockExtractSelectedDatabases.mockResolvedValue({
            manifest: {
                databases: [
                    { name: "shop", filename: "shop.sql" },
                    { name: "skip_me", filename: "skip_me.sql" },
                ],
            },
            files: [`${tempDir}/shop.sql`, `${tempDir}/skip_me.sql`],
        });
        mockShouldRestoreDatabase.mockImplementation((name: string) => name === "shop");

        const result = await restore(buildConfig(), "/backups/multi.tar");

        expect(result.success).toBe(true);
        expect(mockEnsureDatabase).toHaveBeenCalledTimes(1);
        // "skip_me" may appear in the manifest summary log, but must not appear in a "Restored" entry
        expect(result.logs.some((l) => l.startsWith("Restored database:") && l.includes("skip_me"))).toBe(false);
    });

    it("cleans up the temp directory even when a restore fails", async () => {
        const tempDir = "/tmp/mysql-restore-fail";
        mockCreateTempDir.mockResolvedValue(tempDir);
        mockExtractSelectedDatabases.mockRejectedValue(new Error("extraction failed"));

        const result = await restore(buildConfig(), "/backups/multi.tar");

        expect(result.success).toBe(false);
        expect(mockCleanupTempDir).toHaveBeenCalledWith(tempDir);
    });

    it("returns failure when the database file is missing from the extracted archive", async () => {
        const tempDir = "/tmp/mysql-restore-missing";
        mockCreateTempDir.mockResolvedValue(tempDir);
        mockExtractSelectedDatabases.mockResolvedValue({
            manifest: { databases: [{ name: "shop", filename: "shop.sql" }] },
            files: [], // no files extracted
        });

        const result = await restore(buildConfig(), "/backups/multi.tar");

        expect(result.success).toBe(false);
        expect(result.error).toMatch(/not found in archive/i);
    });

    it("logs selective extraction when databaseMapping filters by selected databases", async () => {
        const tempDir = "/tmp/mysql-restore-selective";
        mockCreateTempDir.mockResolvedValue(tempDir);
        mockExtractSelectedDatabases.mockResolvedValue({
            manifest: {
                databases: [
                    { name: "shop", filename: "shop.sql" },
                    { name: "analytics", filename: "analytics.sql" },
                ],
            },
            files: [`${tempDir}/shop.sql`],
        });
        mockShouldRestoreDatabase.mockImplementation((name: string) => name === "shop");
        mockGetTargetDatabaseName.mockImplementation((name: string) => name);

        const config = buildConfig({
            databaseMapping: [
                { originalName: "shop", targetName: "shop", selected: true },
                { originalName: "analytics", targetName: "analytics", selected: false },
            ],
        });

        const result = await restore(config, "/backups/multi.tar");

        expect(result.success).toBe(true);
        expect(result.logs.some((l) => l.includes("Selectively extracted"))).toBe(true);
    });
});

// -------------------------------------------------------------------------
// restore() - progress tracking (non-SSH)
// -------------------------------------------------------------------------

describe("restore() - progress tracking", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockIsSSHMode.mockReturnValue(false);
        mockIsMultiDbTar.mockResolvedValue(false);
        mockEnsureDatabase.mockResolvedValue(undefined);
        mockFsStat.mockResolvedValue({ size: 1024 });
        mockWaitForProcess.mockResolvedValue(undefined);
        // Use Promise.resolve().then() so data arrives as a microtask queued
        // before the waitForProcess continuation (jsdom runs nextTick after microtasks).
        mockCreateReadStream.mockImplementation(() => {
            const stream = new PassThrough();
            Promise.resolve().then(() => {
                stream.push(Buffer.from("sql-content"));
                stream.push(null);
            });
            return stream;
        });
        mockSpawnProcess.mockImplementation(() => {
            const proc = new PassThrough() as any;
            proc.stderr = new PassThrough();
            proc.stdin = new PassThrough();
            proc.stdout = new PassThrough();
            proc.kill = vi.fn();
            return proc;
        });
    });

    it("calls onProgress with increasing percentages as data is read", async () => {
        const progressValues: number[] = [];

        const result = await restore(
            buildConfig({ database: "testdb" }),
            "/backups/dump.sql",
            undefined,
            (p) => progressValues.push(p)
        );

        expect(result.success).toBe(true);
        expect(progressValues.some((p) => p > 0)).toBe(true);
    });
});

// -------------------------------------------------------------------------
// createStderrHandler - edge cases via waitForProcess mock
// -------------------------------------------------------------------------

describe("createStderrHandler - edge cases", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockIsSSHMode.mockReturnValue(false);
        mockIsMultiDbTar.mockResolvedValue(false);
        mockEnsureDatabase.mockResolvedValue(undefined);
        mockFsStat.mockResolvedValue({ size: 1024 });
        mockCreateReadStream.mockImplementation(() => {
            const stream = new PassThrough();
            process.nextTick(() => stream.end(Buffer.from("sql-content")));
            return stream;
        });
        mockSpawnProcess.mockImplementation(() => {
            const proc = new PassThrough() as any;
            proc.stderr = new PassThrough();
            proc.stdin = new PassThrough();
            proc.stdout = new PassThrough();
            proc.kill = vi.fn();
            return proc;
        });
    });

    it("flushes ERROR lines in buffer at error level", async () => {
        // No trailing newline - goes into buffer until flush()
        mockWaitForProcess.mockImplementation((_proc, _name, onData) => {
            if (onData) onData("ERROR 1005 (23000): Cannot create table");
            return Promise.resolve();
        });

        const logCalls: { msg: string; level?: string }[] = [];
        await restore(buildConfig({ database: "testdb" }), "/backups/dump.sql", (msg, level) => {
            logCalls.push({ msg, level });
        });

        const errorEntry = logCalls.find((l) => l.msg.includes("ERROR 1005") && l.level === "error");
        expect(errorEntry).toBeDefined();
    });

    it("suppresses buffered content in flush when already over the stderr line limit", async () => {
        mockWaitForProcess.mockImplementation((_proc, _name, onData) => {
            if (onData) {
                // 51 lines fills the buffer past MAX_STDERR_LOG_LINES (50)
                for (let i = 0; i < 51; i++) {
                    onData(`Normal line ${i}\n`);
                }
                // Partial line without newline stays in buffer until flush()
                onData("overflow-partial");
            }
            return Promise.resolve();
        });

        const result = await restore(buildConfig({ database: "testdb" }), "/backups/dump.sql");

        const suppressEntry = result.logs.find((l) => l.includes("suppressed"));
        expect(suppressEntry).toBeDefined();
    });
});

// -------------------------------------------------------------------------
// restore() - SSH path
// -------------------------------------------------------------------------

/** Creates a mock SSH restore stream that emits exit with the given code. */
function makeSshRestoreStream(exitCode = 0, stderrData?: string) {
    const stream = new PassThrough() as any;
    stream.stderr = new PassThrough();
    process.nextTick(() => {
        if (stderrData) stream.stderr.emit("data", Buffer.from(stderrData));
        stream.emit("exit", exitCode, null);
    });
    return stream;
}

describe("restore() - SSH path", () => {
    const TOTAL_SIZE = 1024 * 100;

    // Standard exec sequence for a successful SSH restore
    function setupSuccessExec() {
        mockSshExec
            .mockResolvedValueOnce({ code: 0, stdout: "max_allowed_packet=67108864", stderr: "" })
            .mockResolvedValueOnce({ code: 0, stdout: String(TOTAL_SIZE), stderr: "" })
            .mockResolvedValue({ code: 0, stdout: "", stderr: "" });
    }

    beforeEach(() => {
        vi.clearAllMocks();
        mockSshExec.mockReset();
        mockIsSSHMode.mockReturnValue(true);
        mockIsMultiDbTar.mockResolvedValue(false);
        mockEnsureDatabase.mockResolvedValue(undefined);
        mockFsStat.mockResolvedValue({ size: TOTAL_SIZE });
        mockSshConnect.mockResolvedValue(undefined);
        mockSshEnd.mockReturnValue(undefined);
        mockRemoteBinaryCheck.mockResolvedValue("mysql");
        mockBuildMysqlArgs.mockReturnValue(["-h", "db.internal", "-u", "root"]);
        mockExtractSshConfig.mockReturnValue({ host: "jump.example.com", port: 22 });
        mockSshUploadFile.mockImplementation((_src: any, _dest: any, progress?: any) => {
            if (progress) progress(TOTAL_SIZE / 2, TOTAL_SIZE);
            return Promise.resolve();
        });
        mockSshExecStream.mockImplementation((_cmd: any, callback: any) => {
            callback(null, makeSshRestoreStream(0));
        });
    });

    it("restores a single database via SSH successfully", async () => {
        setupSuccessExec();

        const result = await restore(buildConfig({ database: "testdb" }), "/backups/dump.sql");

        expect(result.success).toBe(true);
        expect(mockSshUploadFile).toHaveBeenCalled();
        expect(mockSshExecStream).toHaveBeenCalled();
        expect(mockSshEnd).toHaveBeenCalled();
    });

    it("calls onProgress during SSH upload and restore phases", async () => {
        setupSuccessExec();
        const progressValues: number[] = [];

        const result = await restore(
            buildConfig({ database: "testdb" }),
            "/backups/dump.sql",
            undefined,
            (p) => progressValues.push(p)
        );

        expect(result.success).toBe(true);
        expect(progressValues.some((p) => p > 0 && p <= 100)).toBe(true);
    });

    it("continues when diagnostics query throws", async () => {
        mockSshExec
            .mockRejectedValueOnce(new Error("diagnostics failed"))
            .mockResolvedValueOnce({ code: 0, stdout: String(TOTAL_SIZE), stderr: "" })
            .mockResolvedValue({ code: 0, stdout: "", stderr: "" });

        const result = await restore(buildConfig({ database: "testdb" }), "/backups/dump.sql");

        expect(result.success).toBe(true);
    });

    it("logs server settings when diagnostics succeed", async () => {
        setupSuccessExec();

        const result = await restore(buildConfig({ database: "testdb" }), "/backups/dump.sql");

        expect(result.success).toBe(true);
        expect(result.logs.some((l) => l.includes("Server settings"))).toBe(true);
    });

    it("returns failure on upload size mismatch", async () => {
        mockSshExec
            .mockResolvedValueOnce({ code: 0, stdout: "max_allowed_packet=67108864", stderr: "" })
            .mockResolvedValueOnce({ code: 0, stdout: "999", stderr: "" }) // wrong size
            .mockResolvedValueOnce({ code: 0, stdout: "alive", stderr: "" }) // post-failure alive check
            .mockResolvedValueOnce({ code: 0, stdout: "", stderr: "" }) // OOM check (empty)
            .mockResolvedValue({ code: 0, stdout: "", stderr: "" }); // cleanup

        const result = await restore(buildConfig({ database: "testdb" }), "/backups/dump.sql");

        expect(result.success).toBe(false);
        expect(result.error).toMatch(/mismatch/i);
    });

    it("returns failure when remote mysql exits with non-zero code", async () => {
        mockSshExecStream.mockImplementation((_cmd: any, callback: any) => {
            callback(null, makeSshRestoreStream(1));
        });
        mockSshExec
            .mockResolvedValueOnce({ code: 0, stdout: "max_allowed_packet=67108864", stderr: "" })
            .mockResolvedValueOnce({ code: 0, stdout: String(TOTAL_SIZE), stderr: "" })
            .mockResolvedValueOnce({ code: 0, stdout: "alive", stderr: "" }) // post-failure alive check
            .mockResolvedValueOnce({ code: 0, stdout: "", stderr: "" }) // OOM check
            .mockResolvedValue({ code: 0, stdout: "", stderr: "" }); // cleanup

        const result = await restore(buildConfig({ database: "testdb" }), "/backups/dump.sql");

        expect(result.success).toBe(false);
    });

    it("logs post-failure status when mysql server is still alive", async () => {
        mockSshExecStream.mockImplementation((_cmd: any, callback: any) => {
            callback(null, makeSshRestoreStream(1));
        });
        mockSshExec
            .mockResolvedValueOnce({ code: 0, stdout: "max_allowed_packet=67108864", stderr: "" })
            .mockResolvedValueOnce({ code: 0, stdout: String(TOTAL_SIZE), stderr: "" })
            .mockResolvedValueOnce({ code: 0, stdout: "alive", stderr: "" }) // alive check passes
            .mockResolvedValueOnce({ code: 0, stdout: "oom killed process mysqld", stderr: "" }) // dmesg with OOM
            .mockResolvedValue({ code: 0, stdout: "", stderr: "" });

        const result = await restore(buildConfig({ database: "testdb" }), "/backups/dump.sql");

        expect(result.success).toBe(false);
        expect(result.logs.some((l) => l.includes("still running"))).toBe(true);
        expect(result.logs.some((l) => l.includes("OOM killer"))).toBe(true);
    });

    it("logs post-failure status when mysql server is not responding", async () => {
        mockSshExecStream.mockImplementation((_cmd: any, callback: any) => {
            callback(null, makeSshRestoreStream(1));
        });
        mockSshExec
            .mockResolvedValueOnce({ code: 0, stdout: "max_allowed_packet=67108864", stderr: "" })
            .mockResolvedValueOnce({ code: 0, stdout: String(TOTAL_SIZE), stderr: "" })
            .mockResolvedValueOnce({ code: 0, stdout: "no output here", stderr: "" }) // not "alive"
            .mockResolvedValue({ code: 0, stdout: "", stderr: "" });

        const result = await restore(buildConfig({ database: "testdb" }), "/backups/dump.sql");

        expect(result.success).toBe(false);
        expect(result.logs.some((l) => l.includes("NOT responding"))).toBe(true);
    });

    it("logs when alive check itself throws", async () => {
        mockSshExecStream.mockImplementation((_cmd: any, callback: any) => {
            callback(null, makeSshRestoreStream(1));
        });
        mockSshExec
            .mockResolvedValueOnce({ code: 0, stdout: "max_allowed_packet=67108864", stderr: "" })
            .mockResolvedValueOnce({ code: 0, stdout: String(TOTAL_SIZE), stderr: "" })
            .mockRejectedValueOnce(new Error("ssh timeout")) // alive check throws
            .mockResolvedValue({ code: 0, stdout: "", stderr: "" });

        const result = await restore(buildConfig({ database: "testdb" }), "/backups/dump.sql");

        expect(result.success).toBe(false);
        expect(result.logs.some((l) => l.includes("Could not reach MySQL server"))).toBe(true);
    });

    it("redacts password from SSH stderr output", async () => {
        setupSuccessExec();
        const logs: string[] = [];
        mockSshExecStream.mockImplementation((_cmd: any, callback: any) => {
            callback(null, makeSshRestoreStream(0, "mysql password secret\n"));
        });

        await restore(
            buildConfig({ database: "testdb", password: "secret" }),
            "/backups/dump.sql",
            (msg) => logs.push(msg)
        );

        expect(logs.every((l) => !l.includes("secret"))).toBe(true);
    });

    it("continues when stat check throws a non-mismatch error", async () => {
        mockSshExec
            .mockResolvedValueOnce({ code: 0, stdout: "max_allowed_packet=67108864", stderr: "" })
            .mockRejectedValueOnce(new Error("stat command not found")) // stat throws - non-critical
            .mockResolvedValue({ code: 0, stdout: "", stderr: "" });

        const result = await restore(buildConfig({ database: "testdb" }), "/backups/dump.sql");

        expect(result.success).toBe(true);
    });

    it("falls back to 'mysql' binary when remoteBinaryCheck throws in post-failure diagnostics", async () => {
        mockSshExecStream.mockImplementation((_cmd: any, callback: any) => {
            callback(null, makeSshRestoreStream(1));
        });
        // remoteBinaryCheck: first call (setup) succeeds, second call (post-failure) throws
        mockRemoteBinaryCheck
            .mockResolvedValueOnce("mysql") // initial setup
            .mockRejectedValueOnce(new Error("binary not found")); // post-failure alive check
        mockSshExec
            .mockResolvedValueOnce({ code: 0, stdout: "max_allowed_packet=67108864", stderr: "" })
            .mockResolvedValueOnce({ code: 0, stdout: String(TOTAL_SIZE), stderr: "" })
            .mockResolvedValueOnce({ code: 0, stdout: "", stderr: "" }) // alive check with fallback "mysql"
            .mockResolvedValue({ code: 0, stdout: "", stderr: "" });

        const result = await restore(buildConfig({ database: "testdb" }), "/backups/dump.sql");

        expect(result.success).toBe(false);
    });
});
