import { describe, it, expect, vi, beforeEach } from "vitest";
import { PostgresConfig } from "@/lib/adapters/definitions";

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
    mockSshExecStream,
    PassThrough,
} = vi.hoisted(() => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { PassThrough } = require("stream") as {
        PassThrough: typeof import("stream").PassThrough;
    };
    return {
        mockGetDatabases: vi.fn(),
        mockIsMultiDbTar: vi.fn(),
        mockCreateMultiDbTar: vi.fn(),
        mockCreateTempDir: vi.fn(),
        mockCleanupTempDir: vi.fn(),
        mockFsStat: vi.fn(),
        mockSpawnProcess: vi.fn(),
        mockIsSSHMode: vi.fn(),
        mockSshExecStream: vi.fn(),
        PassThrough,
    };
});

vi.mock("@/lib/adapters/database/postgres/connection", () => ({
    getDatabases: (...args: any[]) => mockGetDatabases(...args),
    execFileAsync: vi.fn(),
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
        connect = vi.fn().mockResolvedValue(undefined);
        exec = vi.fn().mockResolvedValue({ code: 0, stdout: "", stderr: "" });
        execStream = (...args: any[]) => mockSshExecStream(...args);
        end = vi.fn();
    },
    isSSHMode: (...args: any[]) => mockIsSSHMode(...args),
    extractSshConfig: vi.fn(() => ({ host: "jump.example.com", port: 22 })),
    buildPsqlArgs: vi.fn(() => ["-h", "db.internal", "-U", "postgres"]),
    remoteEnv: vi.fn((_env: any, cmd: string) => cmd),
    remoteBinaryCheck: vi.fn().mockResolvedValue("pg_dump"),
    shellEscape: vi.fn((s: string) => s),
}));

vi.mock("fs/promises", () => ({
    default: { stat: (...args: any[]) => mockFsStat(...args) },
    stat: (...args: any[]) => mockFsStat(...args),
}));

vi.mock("fs", () => {
    const createWriteStream = vi.fn(() => {
        const stream = new PassThrough() as any;
        stream.on("pipe", () => {
            process.nextTick(() => stream.emit("finish"));
        });
        return stream;
    });
    return {
        default: { createWriteStream },
        createWriteStream,
    };
});

import { dump, dumpOne } from "@/lib/adapters/database/postgres/dump";

// -------------------------------------------------------------------------
// Helpers
// -------------------------------------------------------------------------

type DumpConfig = PostgresConfig & { detectedVersion?: string; pgCompression?: string };

function buildConfig(overrides: Partial<DumpConfig> = {}): DumpConfig {
    return {
        host: "localhost",
        port: 5432,
        user: "postgres",
        password: "secret",
        database: "testdb",
        ...overrides,
    } as DumpConfig;
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

/** Creates a mock spawn process that emits 'error'. */
function makeSpawnProcessWithError(errMessage: string) {
    const proc = new PassThrough() as any;
    proc.stderr = new PassThrough();
    proc.stdin = new PassThrough();
    proc.stdout = new PassThrough();
    proc.kill = vi.fn();
    process.nextTick(() => {
        proc.emit("error", new Error(errMessage));
    });
    return proc;
}

// -------------------------------------------------------------------------
// Single-database dumps
// -------------------------------------------------------------------------

describe("PostgreSQL Dump - single database", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockIsSSHMode.mockReturnValue(false);
        mockFsStat.mockResolvedValue({ size: 1024 * 100 });
        mockCleanupTempDir.mockResolvedValue(undefined);
        mockSpawnProcess.mockImplementation(() => makeSpawnProcess(0));
    });

    it("dumps a single database and returns success", async () => {
        const result = await dump(buildConfig({ database: "mydb" }), "/tmp/mydb.dump");

        expect(result.success).toBe(true);
        expect(result.size).toBe(1024 * 100);
        expect(mockSpawnProcess).toHaveBeenCalledWith(
            "pg_dump",
            expect.arrayContaining(["-d", "mydb"]),
            expect.any(Object)
        );
    });

    it("uses custom format flag (-F c) in pg_dump args", async () => {
        await dump(buildConfig({ database: "mydb" }), "/tmp/mydb.dump");

        expect(mockSpawnProcess).toHaveBeenCalledWith(
            "pg_dump",
            expect.arrayContaining(["-F", "c"]),
            expect.any(Object)
        );
    });

    it("handles database as a single-element array", async () => {
        const result = await dump(
            buildConfig({ database: ["appdb"] as any }),
            "/tmp/appdb.dump"
        );

        expect(result.success).toBe(true);
        expect(mockSpawnProcess).toHaveBeenCalledWith(
            "pg_dump",
            expect.arrayContaining(["-d", "appdb"]),
            expect.any(Object)
        );
    });

    it("uses fallback when database string is whitespace-only", async () => {
        // Whitespace-only string: split+trim+filter yields empty array, fallback branch assigns it directly
        const result = await dump(
            buildConfig({ database: "   " }),
            "/tmp/fallback.dump"
        );

        expect(result.success).toBe(true);
        expect(mockSpawnProcess).toHaveBeenCalled();
    });

    it("returns failure when pg_dump exits with non-zero code", async () => {
        mockSpawnProcess.mockImplementation(() => makeSpawnProcess(1));

        const result = await dump(buildConfig({ database: "mydb" }), "/tmp/mydb.dump");

        expect(result.success).toBe(false);
        expect(result.error).toMatch(/exited with code 1/i);
    });

    it("returns failure when pg_dump process emits an error event", async () => {
        mockSpawnProcess.mockImplementation(() =>
            makeSpawnProcessWithError("spawn pg_dump ENOENT")
        );

        const result = await dump(buildConfig({ database: "mydb" }), "/tmp/mydb.dump");

        expect(result.success).toBe(false);
        expect(result.error).toContain("spawn pg_dump ENOENT");
    });

    it("forwards non-NOTICE stderr messages to the log callback", async () => {
        mockSpawnProcess.mockImplementation(() =>
            makeSpawnProcess(0, "WARNING: table 'legacy' contains deprecated type\n")
        );
        const logs: string[] = [];

        const result = await dump(buildConfig({ database: "mydb" }), "/tmp/mydb.dump", (msg) => {
            logs.push(msg);
        });

        expect(result.success).toBe(true);
        expect(logs.some((l) => l.includes("WARNING"))).toBe(true);
    });

    it("filters NOTICE messages from stderr output", async () => {
        mockSpawnProcess.mockImplementation(() =>
            makeSpawnProcess(0, "pg_dump: NOTICE: table 'foo' does not exist\n")
        );
        const logs: string[] = [];

        await dump(buildConfig({ database: "mydb" }), "/tmp/mydb.dump", (msg) => {
            logs.push(msg);
        });

        expect(logs.some((l) => l.includes("NOTICE"))).toBe(false);
    });

    // -------------------------------------------------------------------------
    // buildCompressionArgs - tested via spawn args
    // -------------------------------------------------------------------------

    it("uses default compression level 6 when pgCompression is undefined", async () => {
        await dump(buildConfig({ database: "mydb" }), "/tmp/out.dump");

        expect(mockSpawnProcess).toHaveBeenCalledWith(
            "pg_dump",
            expect.arrayContaining(["-Z", "6"]),
            expect.any(Object)
        );
    });

    it("uses default compression level 6 when pgCompression is empty string", async () => {
        await dump(buildConfig({ database: "mydb", pgCompression: "" }), "/tmp/out.dump");

        expect(mockSpawnProcess).toHaveBeenCalledWith(
            "pg_dump",
            expect.arrayContaining(["-Z", "6"]),
            expect.any(Object)
        );
    });

    it("uses compression level 0 for NONE", async () => {
        await dump(buildConfig({ database: "mydb", pgCompression: "NONE" }), "/tmp/out.dump");

        expect(mockSpawnProcess).toHaveBeenCalledWith(
            "pg_dump",
            expect.arrayContaining(["-Z", "0"]),
            expect.any(Object)
        );
    });

    it("uses numeric syntax for GZIP:5", async () => {
        await dump(buildConfig({ database: "mydb", pgCompression: "GZIP:5" }), "/tmp/out.dump");

        expect(mockSpawnProcess).toHaveBeenCalledWith(
            "pg_dump",
            expect.arrayContaining(["-Z", "5"]),
            expect.any(Object)
        );
    });

    it("uses lz4 syntax for LZ4:1", async () => {
        await dump(buildConfig({ database: "mydb", pgCompression: "LZ4:1" }), "/tmp/out.dump");

        expect(mockSpawnProcess).toHaveBeenCalledWith(
            "pg_dump",
            expect.arrayContaining(["-Z", "lz4:1"]),
            expect.any(Object)
        );
    });

    it("uses zstd syntax for ZSTD:3", async () => {
        await dump(buildConfig({ database: "mydb", pgCompression: "ZSTD:3" }), "/tmp/out.dump");

        expect(mockSpawnProcess).toHaveBeenCalledWith(
            "pg_dump",
            expect.arrayContaining(["-Z", "zstd:3"]),
            expect.any(Object)
        );
    });

    it("falls back to level 6 for unknown compression algorithm", async () => {
        await dump(buildConfig({ database: "mydb", pgCompression: "BROTLI:5" }), "/tmp/out.dump");

        expect(mockSpawnProcess).toHaveBeenCalledWith(
            "pg_dump",
            expect.arrayContaining(["-Z", "6"]),
            expect.any(Object)
        );
    });

    it("falls back to level 6 when pgCompression has no colon separator", async () => {
        await dump(buildConfig({ database: "mydb", pgCompression: "GZIP" }), "/tmp/out.dump");

        expect(mockSpawnProcess).toHaveBeenCalledWith(
            "pg_dump",
            expect.arrayContaining(["-Z", "6"]),
            expect.any(Object)
        );
    });

    it("appends unquoted options to pg_dump args", async () => {
        await dump(
            buildConfig({ database: "mydb", options: "--no-privileges --no-owner" }),
            "/tmp/out.dump"
        );

        expect(mockSpawnProcess).toHaveBeenCalledWith(
            "pg_dump",
            expect.arrayContaining(["--no-privileges", "--no-owner"]),
            expect.any(Object)
        );
    });

    it("strips surrounding double quotes from option parts", async () => {
        await dump(
            buildConfig({ database: "mydb", options: '"--schema=public"' }),
            "/tmp/out.dump"
        );

        expect(mockSpawnProcess).toHaveBeenCalledWith(
            "pg_dump",
            expect.arrayContaining(["--schema=public"]),
            expect.any(Object)
        );
    });

    it("strips surrounding single quotes from option parts", async () => {
        await dump(
            buildConfig({ database: "mydb", options: "'--schema=public'" }),
            "/tmp/out.dump"
        );

        expect(mockSpawnProcess).toHaveBeenCalledWith(
            "pg_dump",
            expect.arrayContaining(["--schema=public"]),
            expect.any(Object)
        );
    });
});

// -------------------------------------------------------------------------
// dumpOne() - capability export for combined DB+directory backups (JobSource)
// -------------------------------------------------------------------------

describe("PostgreSQL Dump - dumpOne()", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockIsSSHMode.mockReturnValue(false);
        mockFsStat.mockResolvedValue({ size: 1024 * 100 });
        mockSpawnProcess.mockImplementation(() => makeSpawnProcess(0));
    });

    it("dumps the given database directly, without TAR wrapping", async () => {
        const result = await dumpOne(buildConfig(), "otherdb", "/tmp/otherdb.dump");

        expect(result).toEqual({ size: 1024 * 100 });
        expect(mockSpawnProcess).toHaveBeenCalledWith(
            "pg_dump",
            expect.arrayContaining(["-d", "otherdb"]),
            expect.any(Object)
        );
        expect(mockCreateMultiDbTar).not.toHaveBeenCalled();
    });

    it("works without an onLog callback", async () => {
        await expect(dumpOne(buildConfig(), "otherdb", "/tmp/otherdb.dump")).resolves.toEqual({ size: 1024 * 100 });
    });

    it("injects PGPASSWORD into the environment when a password is set", async () => {
        await dumpOne(buildConfig({ password: "hunter2" }), "otherdb", "/tmp/otherdb.dump");

        const [, , spawnOptions] = mockSpawnProcess.mock.calls[0] as any[];
        expect(spawnOptions.env.PGPASSWORD).toBe("hunter2");
    });
});

// -------------------------------------------------------------------------
// Multi-database dumps (TAR archive)
// -------------------------------------------------------------------------

describe("PostgreSQL Dump - multi-database TAR archive", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockIsSSHMode.mockReturnValue(false);
        mockFsStat.mockResolvedValue({ size: 1024 * 500 });
        mockCreateTempDir.mockResolvedValue("/tmp/pg-multidb-abc");
        mockCleanupTempDir.mockResolvedValue(undefined);
        mockCreateMultiDbTar.mockResolvedValue({
            databases: [{ name: "db1" }, { name: "db2" }],
            totalSize: 512000,
        });
        mockSpawnProcess.mockImplementation(() => makeSpawnProcess(0));
    });

    it("creates a TAR archive when multiple databases are specified", async () => {
        const result = await dump(
            buildConfig({ database: "db1,db2" }),
            "/tmp/multi.tar"
        );

        expect(result.success).toBe(true);
        expect(mockCreateTempDir).toHaveBeenCalled();
        expect(mockCreateMultiDbTar).toHaveBeenCalled();
    });

    it("passes correct tar entries to createMultiDbTar", async () => {
        await dump(buildConfig({ database: "db1,db2" }), "/tmp/multi.tar");

        const [tarFiles] = mockCreateMultiDbTar.mock.calls[0] as any[];
        expect(tarFiles).toHaveLength(2);
        expect(tarFiles[0]).toMatchObject({ dbName: "db1", format: "custom" });
        expect(tarFiles[1]).toMatchObject({ dbName: "db2", format: "custom" });
    });

    it("cleans up temp directory after successful multi-db dump", async () => {
        await dump(buildConfig({ database: "db1,db2" }), "/tmp/multi.tar");

        expect(mockCleanupTempDir).toHaveBeenCalledWith("/tmp/pg-multidb-abc");
    });

    it("cleans up temp directory even when an individual dump fails", async () => {
        mockSpawnProcess.mockImplementation(() => makeSpawnProcess(1));

        await dump(buildConfig({ database: "db1,db2" }), "/tmp/multi.tar");

        expect(mockCleanupTempDir).toHaveBeenCalledWith("/tmp/pg-multidb-abc");
    });

    it("handles database as an array of multiple names", async () => {
        const result = await dump(
            buildConfig({ database: ["shop", "analytics"] as any }),
            "/tmp/multi.tar"
        );

        expect(result.success).toBe(true);
        expect(mockCreateMultiDbTar).toHaveBeenCalled();
    });
});

// -------------------------------------------------------------------------
// Auto-discovery (no database specified)
// -------------------------------------------------------------------------

describe("PostgreSQL Dump - auto-discovery", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockIsSSHMode.mockReturnValue(false);
        mockFsStat.mockResolvedValue({ size: 512 });
        mockCleanupTempDir.mockResolvedValue(undefined);
        mockSpawnProcess.mockImplementation(() => makeSpawnProcess(0));
    });

    it("auto-discovers databases when none are configured", async () => {
        mockGetDatabases.mockResolvedValue(["postgres", "app_db"]);
        mockCreateTempDir.mockResolvedValue("/tmp/pg-auto-abc");
        mockCreateMultiDbTar.mockResolvedValue({
            databases: [{ name: "postgres" }, { name: "app_db" }],
            totalSize: 2048,
        });

        const result = await dump(buildConfig({ database: "" }), "/tmp/auto.tar");

        expect(result.success).toBe(true);
        expect(mockGetDatabases).toHaveBeenCalled();
    });

    it("auto-discovers when database is undefined", async () => {
        mockGetDatabases.mockResolvedValue(["singledb"]);
        mockFsStat.mockResolvedValue({ size: 1024 });

        const result = await dump(
            buildConfig({ database: undefined }),
            "/tmp/single-discovered.dump"
        );

        expect(result.success).toBe(true);
        expect(mockGetDatabases).toHaveBeenCalled();
    });

    it("returns failure when auto-discovery finds no databases", async () => {
        mockGetDatabases.mockResolvedValue([]);

        const result = await dump(buildConfig({ database: "" }), "/tmp/none.dump");

        expect(result.success).toBe(false);
        expect(result.error).toMatch(/No databases found/i);
    });
});

// -------------------------------------------------------------------------
// SSH dump path
// -------------------------------------------------------------------------

describe("PostgreSQL Dump - SSH path", () => {
    /** Creates a mock SSH stream that emits 'exit' with the given code. */
    function makeSshStream(exitCode = 0, stderrData?: string) {
        const stream = new PassThrough() as any;
        stream.stderr = new PassThrough();
        process.nextTick(() => {
            if (stderrData) stream.stderr.emit("data", Buffer.from(stderrData));
            stream.emit("exit", exitCode);
        });
        return stream;
    }

    beforeEach(() => {
        vi.clearAllMocks();
        mockIsSSHMode.mockReturnValue(true);
        mockFsStat.mockResolvedValue({ size: 2048 });
        mockCleanupTempDir.mockResolvedValue(undefined);
        mockSshExecStream.mockImplementation((_cmd: string, cb: (err: null, stream: any) => void) => {
            cb(null, makeSshStream(0));
        });
    });

    it("runs pg_dump via SSH and returns success", async () => {
        const result = await dump(buildConfig({ database: "mydb" }), "/tmp/mydb.dump");

        expect(result.success).toBe(true);
        expect(mockSshExecStream).toHaveBeenCalled();
    });

    it("returns failure when remote pg_dump exits with non-zero code", async () => {
        mockSshExecStream.mockImplementation((_cmd: string, cb: (err: null, stream: any) => void) => {
            cb(null, makeSshStream(1));
        });

        const result = await dump(buildConfig({ database: "mydb" }), "/tmp/mydb.dump");

        expect(result.success).toBe(false);
        expect(result.error).toMatch(/exited with code 1/i);
    });

    it("returns failure when execStream calls back with an error", async () => {
        mockSshExecStream.mockImplementation((_cmd: string, cb: (err: Error, stream: null) => void) => {
            cb(new Error("SSH channel error"), null);
        });

        const result = await dump(buildConfig({ database: "mydb" }), "/tmp/mydb.dump");

        expect(result.success).toBe(false);
        expect(result.error).toContain("SSH channel error");
    });

    it("forwards non-NOTICE stderr from remote pg_dump to log", async () => {
        mockSshExecStream.mockImplementation((_cmd: string, cb: (err: null, stream: any) => void) => {
            cb(null, makeSshStream(0, "WARNING: remote issue\n"));
        });
        const logs: string[] = [];

        const result = await dump(
            buildConfig({ database: "mydb" }),
            "/tmp/mydb.dump",
            (msg) => logs.push(msg)
        );

        expect(result.success).toBe(true);
        expect(logs.some((l) => l.includes("WARNING: remote issue"))).toBe(true);
    });

    it("omits NOTICE messages from remote stderr", async () => {
        mockSshExecStream.mockImplementation((_cmd: string, cb: (err: null, stream: any) => void) => {
            cb(null, makeSshStream(0, "NOTICE: table x created\n"));
        });
        const logs: string[] = [];

        await dump(buildConfig({ database: "mydb" }), "/tmp/mydb.dump", (msg) => logs.push(msg));

        expect(logs.some((l) => l.includes("NOTICE"))).toBe(false);
    });

    it("appends options to SSH pg_dump args", async () => {
        const result = await dump(
            buildConfig({ database: "mydb", options: "--no-owner" }),
            "/tmp/mydb.dump"
        );

        expect(result.success).toBe(true);
    });

    it("strips double-quoted and single-quoted options in SSH pg_dump args", async () => {
        const result = await dump(
            buildConfig({ database: "mydb", options: '"--schema=public" \'--no-acl\' --no-owner' }),
            "/tmp/mydb.dump"
        );

        expect(result.success).toBe(true);
    });
});
