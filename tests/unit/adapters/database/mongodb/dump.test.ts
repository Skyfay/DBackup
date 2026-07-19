import { describe, it, expect, vi, beforeEach } from "vitest";
import { MongoDBConfig } from "@/lib/adapters/definitions";

// --- Hoisted mocks ---

const {
    mockGetDatabases,
    mockIsMultiDbTar,
    mockCreateMultiDbTar,
    mockCreateTempDir,
    mockCleanupTempDir,
    mockFsStat,
    mockSpawnProcess,
    mockWaitForProcess,
    mockIsSSHMode,
    mockExtractSshConfig,
    mockBuildMongoArgs,
    mockRemoteBinaryCheck,
    mockShellEscape,
    mockSshConnect,
    mockSshExecStream,
    mockSshEnd,
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
        mockWaitForProcess: vi.fn(),
        mockIsSSHMode: vi.fn(),
        mockExtractSshConfig: vi.fn(),
        mockBuildMongoArgs: vi.fn(),
        mockRemoteBinaryCheck: vi.fn(),
        mockShellEscape: vi.fn((s: string) => s),
        mockSshConnect: vi.fn(),
        mockSshExecStream: vi.fn(),
        mockSshEnd: vi.fn(),
        PassThrough,
    };
});

vi.mock("@/lib/adapters/database/mongodb/connection", () => ({
    getDatabases: (...args: any[]) => mockGetDatabases(...args),
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

vi.mock("@/lib/adapters/process", () => ({
    waitForProcess: (...args: any[]) => mockWaitForProcess(...args),
}));

vi.mock("@/lib/ssh", () => ({
    SshClient: class {
        connect(...args: any[]) { return mockSshConnect(...args); }
        execStream(...args: any[]) { return mockSshExecStream(...args); }
        end() { return mockSshEnd(); }
    },
    isSSHMode: (...args: any[]) => mockIsSSHMode(...args),
    extractSshConfig: (...args: any[]) => mockExtractSshConfig(...args),
    buildMongoArgs: (...args: any[]) => mockBuildMongoArgs(...args),
    remoteBinaryCheck: (...args: any[]) => mockRemoteBinaryCheck(...args),
    shellEscape: (s: any) => mockShellEscape(s),
}));

vi.mock("fs/promises", () => ({
    default: {
        stat: (...args: any[]) => mockFsStat(...args),
    },
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

import { dump, dumpOne } from "@/lib/adapters/database/mongodb/dump";

function buildConfig(overrides: Partial<MongoDBConfig> = {}): MongoDBConfig {
    return {
        connectionMode: "direct",
        host: "localhost",
        port: 27017,
        database: "testdb",
        ...overrides,
    };
}

function makeSpawnProcess() {
    const proc = new PassThrough() as any;
    proc.stderr = new PassThrough();
    proc.stdin = new PassThrough();
    proc.stdout = new PassThrough();
    proc.kill = vi.fn();
    return proc;
}

describe("MongoDB Dump - dump()", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockIsSSHMode.mockReturnValue(false);
        mockWaitForProcess.mockResolvedValue(undefined);
        mockFsStat.mockResolvedValue({ size: 512000 });
        mockCleanupTempDir.mockResolvedValue(undefined);
        const proc = makeSpawnProcess();
        mockSpawnProcess.mockReturnValue(proc);
    });

    it("dumps a single database successfully", async () => {
        const config = buildConfig({ database: "mydb" });
        const proc = makeSpawnProcess();
        mockSpawnProcess.mockReturnValue(proc);

        const result = await dump(config, "/tmp/output.archive");

        expect(result.success).toBe(true);
        expect(result.size).toBe(512000);
        expect(mockSpawnProcess).toHaveBeenCalledWith(
            "mongodump",
            expect.arrayContaining(["--db", "mydb"])
        );
    });

    it("includes --uri when config has uri", async () => {
        const config = buildConfig({ uri: "mongodb://user:pass@host/db", database: "db" });
        const proc = makeSpawnProcess();
        mockSpawnProcess.mockReturnValue(proc);

        const result = await dump(config, "/tmp/output.archive");

        expect(result.success).toBe(true);
        expect(mockSpawnProcess).toHaveBeenCalledWith(
            "mongodump",
            expect.arrayContaining(["--uri=mongodb://user:pass@host/db"])
        );
    });

    it("includes auth args when user and password are set", async () => {
        const config = buildConfig({
            database: "mydb",
            user: "admin",
            password: "secret",
            authenticationDatabase: "admin",
        });
        const proc = makeSpawnProcess();
        mockSpawnProcess.mockReturnValue(proc);

        const result = await dump(config, "/tmp/output.archive");

        expect(result.success).toBe(true);
        expect(mockSpawnProcess).toHaveBeenCalledWith(
            "mongodump",
            expect.arrayContaining([
                "--username", "admin",
                "--password", "secret",
                "--authenticationDatabase", "admin",
            ])
        );
    });

    it("discovers all databases when none selected", async () => {
        const config = buildConfig({ database: "" });
        mockGetDatabases.mockResolvedValue(["db1"]);
        const proc = makeSpawnProcess();
        mockSpawnProcess.mockReturnValue(proc);

        const result = await dump(config, "/tmp/output.archive");

        expect(mockGetDatabases).toHaveBeenCalled();
        expect(result.success).toBe(true);
    });

    it("continues even if getDatabases fails when no database selected", async () => {
        const config = buildConfig({ database: "" });
        mockGetDatabases.mockRejectedValue(new Error("Could not connect"));
        const proc = makeSpawnProcess();
        mockSpawnProcess.mockReturnValue(proc);

        const result = await dump(config, "/tmp/output.archive");

        // Should still attempt dump (mongodump without --db dumps all)
        expect(result.success).toBe(true);
    });

    it("creates TAR archive for multiple databases", async () => {
        const config = buildConfig({ database: "db1,db2" });
        const tempPath = "/tmp/mongo-multidb-xyz";
        mockCreateTempDir.mockResolvedValue(tempPath);
        mockCreateMultiDbTar.mockResolvedValue({ databases: [{ name: "db1" }, { name: "db2" }], totalSize: 1024 });

        const proc1 = makeSpawnProcess();
        const proc2 = makeSpawnProcess();
        mockSpawnProcess
            .mockReturnValueOnce(proc1)
            .mockReturnValueOnce(proc2);

        const result = await dump(config, "/tmp/multi.tar");

        expect(result.success).toBe(true);
        expect(mockCreateTempDir).toHaveBeenCalled();
        expect(mockCreateMultiDbTar).toHaveBeenCalled();
        expect(mockCleanupTempDir).toHaveBeenCalledWith(tempPath);
    });

    it("parses custom options and passes them as separate args", async () => {
        const config = buildConfig({ database: "mydb", options: "--ssl --sslCAFile /certs/ca.pem" });
        const proc = makeSpawnProcess();
        mockSpawnProcess.mockReturnValue(proc);

        await dump(config, "/tmp/output.archive");

        expect(mockSpawnProcess).toHaveBeenCalledWith(
            "mongodump",
            expect.arrayContaining(["--ssl"])
        );
    });

    it("returns failure when dump file is empty", async () => {
        mockFsStat.mockResolvedValue({ size: 0 });
        const proc = makeSpawnProcess();
        mockSpawnProcess.mockReturnValue(proc);

        const result = await dump(buildConfig({ database: "mydb" }), "/tmp/output.archive");

        expect(result.success).toBe(false);
        expect(result.error).toMatch(/empty/i);
    });

    it("returns failure when waitForProcess throws", async () => {
        mockWaitForProcess.mockRejectedValue(new Error("mongodump exited with code 1"));
        const proc = makeSpawnProcess();
        mockSpawnProcess.mockReturnValue(proc);

        const result = await dump(buildConfig({ database: "mydb" }), "/tmp/output.archive");

        expect(result.success).toBe(false);
        expect(result.error).toContain("mongodump exited");
    });

    it("cleans up temp dir even when TAR creation fails", async () => {
        const config = buildConfig({ database: "db1,db2" });
        const tempPath = "/tmp/mongo-multidb-xyz";
        mockCreateTempDir.mockResolvedValue(tempPath);
        const proc = makeSpawnProcess();
        mockSpawnProcess.mockReturnValue(proc);
        mockCreateMultiDbTar.mockRejectedValue(new Error("tar error"));

        const result = await dump(config, "/tmp/multi.tar");

        expect(result.success).toBe(false);
        expect(mockCleanupTempDir).toHaveBeenCalledWith(tempPath);
    });

    it("accepts database as array", async () => {
        const config = buildConfig({ database: ["db1", "db2"] } as any);
        const tempPath = "/tmp/mongo-multidb-array";
        mockCreateTempDir.mockResolvedValue(tempPath);
        mockCreateMultiDbTar.mockResolvedValue({ databases: [{}, {}], totalSize: 2048 });
        const proc = makeSpawnProcess();
        mockSpawnProcess.mockReturnValue(proc);

        const result = await dump(config, "/tmp/multi.tar");

        expect(result.success).toBe(true);
        expect(mockCreateTempDir).toHaveBeenCalled();
    });

    describe("SSH mode", () => {
        beforeEach(() => {
            mockIsSSHMode.mockReturnValue(true);
            mockExtractSshConfig.mockReturnValue({ host: "remote.example.com" });
            mockBuildMongoArgs.mockReturnValue(["--host", "localhost"]);
            mockRemoteBinaryCheck.mockResolvedValue("mongodump");
            mockSshConnect.mockResolvedValue(undefined);
            mockSshEnd.mockReturnValue(undefined);
            mockShellEscape.mockImplementation((s: string) => `'${s}'`);
        });

        it("dumps single database via SSH successfully", async () => {
            const mockStream = new PassThrough() as any;
            mockStream.stderr = new PassThrough();

            mockSshExecStream.mockImplementation((_cmd: string, cb: (err: null, s: any) => void) => {
                process.nextTick(() => {
                    cb(null, mockStream);
                    process.nextTick(() => mockStream.emit("exit", 0));
                });
            });

            const result = await dump(
                buildConfig({ database: "mydb", sshHost: "remote.example.com" } as any),
                "/tmp/output.archive"
            );

            expect(result.success).toBe(true);
            expect(mockSshExecStream).toHaveBeenCalled();
        });

        it("returns failure when SSH dump exits with non-zero code", async () => {
            const mockStream = new PassThrough() as any;
            mockStream.stderr = new PassThrough();

            mockSshExecStream.mockImplementation((_cmd: string, cb: (err: null, s: any) => void) => {
                process.nextTick(() => {
                    cb(null, mockStream);
                    process.nextTick(() => mockStream.emit("exit", 1));
                });
            });

            const result = await dump(
                buildConfig({ database: "mydb", sshHost: "remote.example.com" } as any),
                "/tmp/output.archive"
            );

            expect(result.success).toBe(false);
        });

        it("returns failure when SSH execStream returns error", async () => {
            mockSshExecStream.mockImplementation((_cmd: string, cb: (err: Error, s: any) => void) => {
                process.nextTick(() => cb(new Error("SSH exec failed"), null));
            });

            const result = await dump(
                buildConfig({ database: "mydb", sshHost: "remote.example.com" } as any),
                "/tmp/output.archive"
            );

            expect(result.success).toBe(false);
        });
    });
});

// -------------------------------------------------------------------------
// dumpOne() - capability export for combined DB+directory backups (JobSource)
// -------------------------------------------------------------------------

describe("MongoDB Dump - dumpOne()", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockIsSSHMode.mockReturnValue(false);
        mockWaitForProcess.mockResolvedValue(undefined);
        mockFsStat.mockResolvedValue({ size: 512000 });
        mockSpawnProcess.mockReturnValue(makeSpawnProcess());
    });

    it("dumps the given database directly, without TAR wrapping", async () => {
        const result = await dumpOne(buildConfig(), "otherdb", "/tmp/otherdb.archive");

        expect(result).toEqual({ size: 512000 });
        expect(mockSpawnProcess).toHaveBeenCalledWith(
            "mongodump",
            expect.arrayContaining(["--db", "otherdb"])
        );
        expect(mockCreateMultiDbTar).not.toHaveBeenCalled();
    });

    it("works without an onLog callback", async () => {
        await expect(dumpOne(buildConfig(), "otherdb", "/tmp/otherdb.archive")).resolves.toEqual({ size: 512000 });
    });
});
