import { describe, it, expect, vi, beforeEach } from "vitest";
import { MongoDBConfig } from "@/lib/adapters/definitions";

// --- Hoisted mocks ---

const {
    mockMongoConnect,
    mockMongoClose,
    mockDbCommand,
    mockCreateCollection,
    mockDropCollection,
    mockIsMultiDbTar,
    mockExtractSelectedDatabases,
    mockCreateTempDir,
    mockCleanupTempDir,
    mockShouldRestoreDatabase,
    mockGetTargetDatabaseName,
    mockSpawnProcess,
    mockWaitForProcess,
    mockFsStat,
    mockIsSSHMode,
    mockExtractSshConfig,
    mockBuildMongoArgs,
    mockRemoteBinaryCheck,
    mockShellEscape,
    mockSshConnect,
    mockSshExec,
    mockSshExecStream,
    mockSshUploadFile,
    mockSshEnd,
    mockCreateReadStream,
    PassThrough,
} = vi.hoisted(() => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { PassThrough } = require("stream") as { PassThrough: typeof import("stream").PassThrough };
    return {
        mockMongoConnect: vi.fn(),
        mockMongoClose: vi.fn(),
        mockDbCommand: vi.fn(),
        mockCreateCollection: vi.fn(),
        mockDropCollection: vi.fn(),
        mockIsMultiDbTar: vi.fn(),
        mockExtractSelectedDatabases: vi.fn(),
        mockCreateTempDir: vi.fn(),
        mockCleanupTempDir: vi.fn(),
        mockShouldRestoreDatabase: vi.fn(),
        mockGetTargetDatabaseName: vi.fn(),
        mockSpawnProcess: vi.fn(),
        mockWaitForProcess: vi.fn(),
        mockFsStat: vi.fn(),
        mockIsSSHMode: vi.fn(),
        mockExtractSshConfig: vi.fn(),
        mockBuildMongoArgs: vi.fn(),
        mockRemoteBinaryCheck: vi.fn(),
        mockShellEscape: vi.fn((s: string) => s),
        mockSshConnect: vi.fn(),
        mockSshExec: vi.fn(),
        mockSshExecStream: vi.fn(),
        mockSshUploadFile: vi.fn(),
        mockSshEnd: vi.fn(),
        mockCreateReadStream: vi.fn(),
        PassThrough,
    };
});

vi.mock("mongodb", () => {
    class MockMongoClient {
        connect() { return mockMongoConnect(); }
        close() { return mockMongoClose(); }
        db(_name: string) {
            return {
                command: (...args: any[]) => mockDbCommand(...args),
                createCollection: (...args: any[]) => mockCreateCollection(...args),
                collection: (_col: string) => ({
                    drop: () => mockDropCollection(),
                }),
            };
        }
    }
    return { MongoClient: MockMongoClient };
});

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
        connect(...args: any[]) { return mockSshConnect(...args); }
        exec(...args: any[]) { return mockSshExec(...args); }
        execStream(...args: any[]) { return mockSshExecStream(...args); }
        uploadFile(...args: any[]) { return mockSshUploadFile(...args); }
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
    return {
        default: { createReadStream: (...args: any[]) => mockCreateReadStream(...args) },
        createReadStream: (...args: any[]) => mockCreateReadStream(...args),
    };
});

vi.mock("crypto", () => ({
    randomUUID: vi.fn(() => "test-uuid-1234"),
    default: { randomUUID: vi.fn(() => "test-uuid-1234") },
}));

import { prepareRestore, restore, restoreOne } from "@/lib/adapters/database/mongodb/restore";

function buildConfig(overrides: Record<string, any> = {}): MongoDBConfig & Record<string, any> {
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

describe("prepareRestore()", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockMongoClose.mockResolvedValue(undefined);
    });

    it("skips permission check in SSH mode", async () => {
        mockIsSSHMode.mockReturnValue(true);

        await expect(prepareRestore(buildConfig({ sshHost: "remote.example.com" }), ["mydb"])).resolves.toBeUndefined();
        expect(mockMongoConnect).not.toHaveBeenCalled();
    });

    it("verifies write permission by creating and dropping a temp collection", async () => {
        mockIsSSHMode.mockReturnValue(false);
        mockMongoConnect.mockResolvedValue(undefined);
        mockCreateCollection.mockResolvedValue(undefined);
        mockDropCollection.mockResolvedValue(undefined);

        await expect(prepareRestore(buildConfig(), ["mydb"])).resolves.toBeUndefined();

        expect(mockCreateCollection).toHaveBeenCalledWith("__perm_check_tmp");
        expect(mockDropCollection).toHaveBeenCalled();
    });

    it("uses privileged auth credentials when provided", async () => {
        mockIsSSHMode.mockReturnValue(false);
        mockMongoConnect.mockResolvedValue(undefined);
        mockCreateCollection.mockResolvedValue(undefined);
        mockDropCollection.mockResolvedValue(undefined);

        const config = buildConfig({ privilegedAuth: { user: "superuser", password: "rootpw" } });
        await expect(prepareRestore(config, ["mydb"])).resolves.toBeUndefined();
    });

    it("throws access-denied error when not authorized", async () => {
        mockIsSSHMode.mockReturnValue(false);
        mockMongoConnect.mockResolvedValue(undefined);
        mockCreateCollection.mockRejectedValue({
            message: "not authorized on mydb to execute command",
            codeName: "Unauthorized",
        });

        await expect(prepareRestore(buildConfig(), ["mydb"])).rejects.toThrow(/Access denied/);
    });

    it("re-throws other errors from createCollection", async () => {
        mockIsSSHMode.mockReturnValue(false);
        mockMongoConnect.mockResolvedValue(undefined);
        mockCreateCollection.mockRejectedValue(new Error("Disk full"));

        await expect(prepareRestore(buildConfig(), ["mydb"])).rejects.toThrow("Disk full");
    });
});

describe("restore() - single database archive", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockIsSSHMode.mockReturnValue(false);
        mockIsMultiDbTar.mockResolvedValue(false);
        mockWaitForProcess.mockResolvedValue(undefined);
        mockCleanupTempDir.mockResolvedValue(undefined);
        const proc = makeSpawnProcess();
        mockSpawnProcess.mockReturnValue(proc);
        // Default: healthy read stream
        mockCreateReadStream.mockImplementation(() => {
            const stream = new PassThrough();
            process.nextTick(() => stream.end(Buffer.from("archive-content")));
            return stream;
        });
    });

    it("restores a single database successfully", async () => {
        const config = buildConfig({ database: "mydb" });

        const result = await restore(config, "/backups/mydb.archive");

        expect(result.success).toBe(true);
        expect(mockSpawnProcess).toHaveBeenCalledWith(
            "mongorestore",
            expect.arrayContaining(["--archive", "--gzip", "--drop"])
        );
    });

    it("adds nsFrom/nsTo args when source and target differ", async () => {
        const config = buildConfig({
            database: "mydb",
            originalDatabase: "mydb",
            targetDatabaseName: "mydb_restored",
        });

        const result = await restore(config, "/backups/mydb.archive");

        expect(result.success).toBe(true);
        expect(mockSpawnProcess).toHaveBeenCalledWith(
            "mongorestore",
            expect.arrayContaining([
                "--nsFrom", "mydb.*",
                "--nsTo", "mydb_restored.*",
            ])
        );
    });

    it("uses URI when present", async () => {
        const config = buildConfig({
            uri: "mongodb://user:pass@host:27017/",
            database: "mydb",
        });

        const result = await restore(config, "/backups/mydb.archive");

        expect(result.success).toBe(true);
        expect(mockSpawnProcess).toHaveBeenCalledWith(
            "mongorestore",
            expect.arrayContaining(["--uri=mongodb://user:pass@host:27017/"])
        );
    });

    it("includes auth args when user and password provided", async () => {
        const config = buildConfig({
            database: "mydb",
            user: "admin",
            password: "secret",
            authenticationDatabase: "admin",
        });

        const result = await restore(config, "/backups/mydb.archive");

        expect(result.success).toBe(true);
        expect(mockSpawnProcess).toHaveBeenCalledWith(
            "mongorestore",
            expect.arrayContaining([
                "--username", "admin",
                "--password", "secret",
            ])
        );
    });

    it("uses mapping when databaseMapping is provided", async () => {
        const config = buildConfig({
            database: "mydb",
            databaseMapping: [
                { originalName: "mydb", targetName: "mydb_new", selected: true },
            ],
        });

        const result = await restore(config, "/backups/mydb.archive");

        expect(result.success).toBe(true);
        expect(mockSpawnProcess).toHaveBeenCalledWith(
            "mongorestore",
            expect.arrayContaining(["--nsFrom", "mydb.*", "--nsTo", "mydb_new.*"])
        );
    });

    it("returns failure when waitForProcess throws", async () => {
        mockWaitForProcess.mockRejectedValue(new Error("mongorestore exited with code 1"));
        const proc = makeSpawnProcess();
        mockSpawnProcess.mockReturnValue(proc);

        const result = await restore(buildConfig({ database: "mydb" }), "/backups/mydb.archive");

        expect(result.success).toBe(false);
        expect(result.error).toContain("mongorestore exited");
    });

    it("logs stderr output from mongorestore process", async () => {
        const proc = makeSpawnProcess();
        // Emit stderr synchronously inside the spawn implementation so it fires before waitForProcess
        mockSpawnProcess.mockImplementation(() => {
            process.nextTick(() => proc.stderr.emit("data", Buffer.from("done dumping mydb")));
            return proc;
        });
        mockWaitForProcess.mockImplementation(() => new Promise(resolve => setTimeout(resolve, 5)));

        const result = await restore(
            buildConfig({ database: "mydb" }),
            "/backups/mydb.archive"
        );
        expect(result.success).toBe(true);
        expect(result.logs.some(l => l.includes("[mongorestore]"))).toBe(true);
    });

    it("logs read stream error when stream fails", async () => {
        // Override createReadStream to emit an error after spawn
        mockCreateReadStream.mockImplementation(() => {
            const stream = new PassThrough();
            process.nextTick(() => stream.emit("error", new Error("ENOENT: file not found")));
            return stream;
        });
        const proc = makeSpawnProcess();
        mockSpawnProcess.mockReturnValue(proc);
        // waitForProcess deferred long enough for the error event to fire
        mockWaitForProcess.mockImplementation(() => new Promise(resolve => setTimeout(resolve, 10)));

        const result = await restore(buildConfig({ database: "mydb" }), "/backups/mydb.archive");

        expect(result.success).toBe(true);
        expect(result.logs.some(l => l.includes("Read stream error"))).toBe(true);
    });
});

describe("restore() - multi-database TAR archive", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockIsSSHMode.mockReturnValue(false);
        mockIsMultiDbTar.mockResolvedValue(true);
        mockWaitForProcess.mockResolvedValue(undefined);
        mockMongoConnect.mockResolvedValue(undefined);
        mockMongoClose.mockResolvedValue(undefined);
        mockCreateCollection.mockResolvedValue(undefined);
        mockDropCollection.mockResolvedValue(undefined);
        mockCreateTempDir.mockResolvedValue("/tmp/mongo-restore-xyz");
        mockCleanupTempDir.mockResolvedValue(undefined);
    });

    it("restores all databases from TAR archive", async () => {
        mockExtractSelectedDatabases.mockResolvedValue({
            manifest: {
                databases: [
                    { name: "db1", filename: "db1.archive" },
                    { name: "db2", filename: "db2.archive" },
                ],
            },
            files: ["db1.archive", "db2.archive"],
        });
        mockShouldRestoreDatabase.mockReturnValue(true);
        mockGetTargetDatabaseName.mockImplementation((name: string) => name);

        const proc = makeSpawnProcess();
        mockSpawnProcess.mockReturnValue(proc);

        const result = await restore(buildConfig(), "/backups/multi.tar");

        expect(result.success).toBe(true);
        expect(mockSpawnProcess).toHaveBeenCalledTimes(2);
        expect(mockCleanupTempDir).toHaveBeenCalledWith("/tmp/mongo-restore-xyz");
    });

    it("skips databases that shouldRestoreDatabase returns false for", async () => {
        mockExtractSelectedDatabases.mockResolvedValue({
            manifest: {
                databases: [
                    { name: "db1", filename: "db1.archive" },
                    { name: "db2", filename: "db2.archive" },
                ],
            },
            files: ["db1.archive"],
        });
        mockShouldRestoreDatabase.mockImplementation(
            (name: string) => name === "db1"
        );
        mockGetTargetDatabaseName.mockImplementation((name: string) => name);

        const proc = makeSpawnProcess();
        mockSpawnProcess.mockReturnValue(proc);

        const onProgress = vi.fn();
        const result = await restore(buildConfig(), "/backups/multi.tar", undefined, onProgress);

        expect(result.success).toBe(true);
        expect(mockSpawnProcess).toHaveBeenCalledTimes(1);
        // db1 processed (index 0, processed=1, totalDbs=2): Math.round(1/2*100) = 50
        expect(onProgress).toHaveBeenCalledWith(50);
    });

    it("cleans up temp dir even when restore fails", async () => {
        mockExtractSelectedDatabases.mockRejectedValue(new Error("extraction failed"));

        const result = await restore(buildConfig(), "/backups/multi.tar");

        expect(result.success).toBe(false);
        expect(mockCleanupTempDir).toHaveBeenCalledWith("/tmp/mongo-restore-xyz");
    });
});

describe("restore() - SSH TAR archive restore", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockIsSSHMode.mockReturnValue(true);
        mockIsMultiDbTar.mockResolvedValue(true);
        mockExtractSshConfig.mockReturnValue({ host: "remote.example.com" });
        mockBuildMongoArgs.mockReturnValue(["--host", "localhost"]);
        mockRemoteBinaryCheck.mockResolvedValue("mongorestore");
        mockSshConnect.mockResolvedValue(undefined);
        mockSshEnd.mockReturnValue(undefined);
        mockFsStat.mockResolvedValue({ size: 102400 });
        mockSshUploadFile.mockResolvedValue(undefined);
        mockSshExec
            .mockResolvedValueOnce({ stdout: "102400", stderr: "" }) // size check
            .mockResolvedValue({ stdout: "", stderr: "" }); // cleanup
        mockMongoConnect.mockResolvedValue(undefined);
        mockMongoClose.mockResolvedValue(undefined);
        mockCreateTempDir.mockResolvedValue("/tmp/mongo-restore-xyz");
        mockCleanupTempDir.mockResolvedValue(undefined);
        mockShouldRestoreDatabase.mockReturnValue(true);
        mockGetTargetDatabaseName.mockImplementation((name: string) => name);
        mockShellEscape.mockImplementation((s: string) => `'${s}'`);
    });

    it("uploads archive and restores via SSH for TAR archive", async () => {
        mockExtractSelectedDatabases.mockResolvedValue({
            manifest: { databases: [{ name: "mydb", filename: "mydb.archive" }] },
            files: ["mydb.archive"],
        });

        const mockStream = new PassThrough() as any;
        mockStream.stderr = new PassThrough();

        mockSshExecStream.mockImplementation((_cmd: string, cb: (err: null, s: any) => void) => {
            process.nextTick(() => {
                cb(null, mockStream);
                process.nextTick(() => mockStream.emit("exit", 0));
            });
        });

        const result = await restore(
            buildConfig({ database: "mydb", sshHost: "remote.example.com" }),
            "/backups/multi.tar"
        );

        expect(result.success).toBe(true);
        expect(mockSshUploadFile).toHaveBeenCalled();
        expect(mockSshExecStream).toHaveBeenCalled();
    });

    it("returns failure when remote mongorestore exits with non-zero code", async () => {
        mockExtractSelectedDatabases.mockResolvedValue({
            manifest: { databases: [{ name: "mydb", filename: "mydb.archive" }] },
            files: ["mydb.archive"],
        });

        const mockStream = new PassThrough() as any;
        mockStream.stderr = new PassThrough();

        mockSshExecStream.mockImplementation((_cmd: string, cb: (err: null, s: any) => void) => {
            process.nextTick(() => {
                cb(null, mockStream);
                process.nextTick(() => mockStream.emit("exit", 1));
            });
        });

        const result = await restore(
            buildConfig({ database: "mydb", sshHost: "remote.example.com" }),
            "/backups/multi.tar"
        );

        expect(result.success).toBe(false);
    });
});

// -------------------------------------------------------------------------
// restoreOne() - capability export for combined DB+directory restores (JobSource)
// -------------------------------------------------------------------------

describe("restoreOne()", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockIsSSHMode.mockReturnValue(false);
        mockWaitForProcess.mockResolvedValue(undefined);
        mockSpawnProcess.mockReturnValue(makeSpawnProcess());
    });

    it("restores the given file into the given target database directly", async () => {
        await expect(restoreOne(buildConfig(), "/tmp/db.archive", "targetdb")).resolves.toBeUndefined();

        expect(mockSpawnProcess).toHaveBeenCalledWith(
            "mongorestore",
            expect.arrayContaining([`--archive=/tmp/db.archive`, "--gzip", "--drop"])
        );
    });

    it("works without an onLog callback", async () => {
        await expect(restoreOne(buildConfig(), "/tmp/db.archive", "targetdb")).resolves.toBeUndefined();
    });

    it("adds nsFrom/nsTo args when the original database name differs from the target", async () => {
        await restoreOne(buildConfig(), "/tmp/db.archive", "renamed_db", undefined, undefined, "original_db");

        expect(mockSpawnProcess).toHaveBeenCalledWith(
            "mongorestore",
            expect.arrayContaining(["--nsFrom", "original_db.*", "--nsTo", "renamed_db.*"])
        );
    });
});
