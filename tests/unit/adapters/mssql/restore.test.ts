import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { MSSQLConfig } from "@/lib/adapters/definitions";

// --- Mock setup ---

// Use vi.hoisted for variables referenced inside vi.mock factories
const {
    mockExecuteQuery,
    mockExecuteParameterizedQuery,
    mockSshConnect,
    mockSshUpload,
    mockSshDeleteRemote,
    mockSshEnd,
    mockFsStat,
    mockFsUnlink,
    mockFsOpen,
} = vi.hoisted(() => ({
    mockExecuteQuery: vi.fn(),
    mockExecuteParameterizedQuery: vi.fn(),
    mockSshConnect: vi.fn(),
    mockSshUpload: vi.fn(),
    mockSshDeleteRemote: vi.fn(),
    mockSshEnd: vi.fn(),
    mockFsStat: vi.fn(),
    mockFsUnlink: vi.fn(),
    mockFsOpen: vi.fn(),
}));

// Mock connection module
vi.mock("@/lib/adapters/database/mssql/connection", () => ({
    executeQuery: (...args: any[]) => mockExecuteQuery(...args),
    executeParameterizedQuery: (...args: any[]) => mockExecuteParameterizedQuery(...args),
}));

// Mock SSH transfer (use a class so it's constructable with `new`)
vi.mock("@/lib/adapters/database/mssql/ssh-transfer", () => {
    class MockMssqlSshTransfer {
        connect(...args: any[]) { return mockSshConnect(...args); }
        upload(...args: any[]) { return mockSshUpload(...args); }
        deleteRemote(...args: any[]) { return mockSshDeleteRemote(...args); }
        end(...args: any[]) { return mockSshEnd(...args); }
    }
    return {
        MssqlSshTransfer: MockMssqlSshTransfer,
        isSSHTransferEnabled: (config: any) =>
            config.fileTransferMode === "ssh" && !!config.sshUsername,
    };
});

// Mock fs/promises
vi.mock("fs/promises", () => ({
    default: {
        stat: (...args: any[]) => mockFsStat(...args),
        unlink: (...args: any[]) => mockFsUnlink(...args),
        open: (...args: any[]) => mockFsOpen(...args),
    },
    stat: (...args: any[]) => mockFsStat(...args),
    unlink: (...args: any[]) => mockFsUnlink(...args),
    open: (...args: any[]) => mockFsOpen(...args),
}));

// Mock fs (sync functions + streams)
vi.mock("fs", () => {
    const { PassThrough } = require("stream");

    const createReadStream = vi.fn(() => {
        const stream = new PassThrough();
        process.nextTick(() => stream.end(Buffer.from("backup-content")));
        return stream;
    });

    const createWriteStream = vi.fn(() => {
        const stream = new PassThrough();
        stream.on("pipe", () => {
            process.nextTick(() => stream.emit("finish"));
        });
        return stream;
    });

    return {
        default: { createReadStream, createWriteStream },
        createReadStream,
        createWriteStream,
    };
});

// Mock tar-stream
vi.mock("tar-stream", () => ({
    extract: vi.fn(() => {
        const { PassThrough } = require("stream");
        const stream = new PassThrough({ objectMode: true });
        // Simulate empty tar (no entries) by default
        process.nextTick(() => stream.emit("finish"));
        return stream;
    }),
}));

import { restore, prepareRestore } from "@/lib/adapters/database/mssql/restore";

// Helper to build config
type RestoreConfig = MSSQLConfig & {
    detectedVersion?: string;
    privilegedAuth?: { user: string; password: string };
    databaseMapping?: Array<{ originalName: string; targetName: string; selected: boolean }>;
};

function buildConfig(overrides: Partial<RestoreConfig> = {}): RestoreConfig {
    return {
        host: "db.example.com",
        port: 1433,
        user: "sa",
        password: "secret",
        database: "testdb",
        encrypt: true,
        trustServerCertificate: false,
        backupPath: "/var/opt/mssql/backup",
        fileTransferMode: "local",
        localBackupPath: "/mssql-shared",
        requestTimeout: 300000,
        ...overrides,
    };
}

describe("MSSQL Restore", () => {
    beforeEach(() => {
        vi.clearAllMocks();

        // Default mock: RESTORE FILELISTONLY returns typical data/log files
        mockExecuteQuery.mockImplementation((_config: any, query: string) => {
            if (query.includes("RESTORE FILELISTONLY")) {
                return {
                    recordset: [
                        { LogicalName: "testdb_data", Type: "D", PhysicalName: "/var/opt/mssql/data/testdb.mdf" },
                        { LogicalName: "testdb_log", Type: "L", PhysicalName: "/var/opt/mssql/data/testdb_log.ldf" },
                    ],
                };
            }
            // RESTORE DATABASE returns empty
            return { recordset: [] };
        });

        mockFsStat.mockResolvedValue({ size: 1024 * 1024 });
        mockFsUnlink.mockResolvedValue(undefined);

        // Mock fs.open for TAR detection (returns non-TAR by default)
        const mockFileHandle = {
            read: vi.fn().mockResolvedValue({ bytesRead: 512 }),
            close: vi.fn().mockResolvedValue(undefined),
        };
        mockFsOpen.mockResolvedValue(mockFileHandle);

        mockSshConnect.mockResolvedValue(undefined);
        mockSshUpload.mockResolvedValue(undefined);
        mockSshDeleteRemote.mockResolvedValue(undefined);
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    describe("prepareRestore", () => {
        it("should validate existing online databases", async () => {
            mockExecuteParameterizedQuery.mockResolvedValue({
                recordset: [{ state_desc: "ONLINE" }],
            });

            const config = buildConfig();
            await expect(prepareRestore(config, ["testdb"])).resolves.toBeUndefined();
        });

        it("should reject invalid database names", async () => {
            const config = buildConfig();
            await expect(prepareRestore(config, ["db;DROP TABLE"])).rejects.toThrow("Invalid database name");
        });

        it("should throw when database is not online", async () => {
            mockExecuteParameterizedQuery.mockResolvedValue({
                recordset: [{ state_desc: "RESTORING" }],
            });

            const config = buildConfig();
            await expect(prepareRestore(config, ["testdb"])).rejects.toThrow("not online");
        });

        it("should allow restore when database does not exist yet", async () => {
            mockExecuteParameterizedQuery.mockResolvedValue({
                recordset: [], // No results = DB doesn't exist
            });

            const config = buildConfig();
            await expect(prepareRestore(config, ["newdb"])).resolves.toBeUndefined();
        });
    });

    describe("Local Mode", () => {
        it("should restore database from local .bak file", async () => {
            const config = buildConfig({ fileTransferMode: "local" });
            const result = await restore(config, "/backups/testdb.bak");

            expect(result.success).toBe(true);

            // Should execute RESTORE FILELISTONLY + RESTORE DATABASE
            expect(mockExecuteQuery).toHaveBeenCalledTimes(2);
            const restoreQuery = mockExecuteQuery.mock.calls[1][1];
            expect(restoreQuery).toContain("RESTORE DATABASE [testdb]");
        });

        it("should log local transfer mode", async () => {
            const logs: string[] = [];
            const config = buildConfig({ fileTransferMode: "local" });

            await restore(config, "/backups/testdb.bak", (msg) => logs.push(msg));

            expect(logs).toContain("File transfer mode: Local (shared filesystem)");
        });
    });

    describe("SSH Mode", () => {
        it("should connect via SSH and upload .bak file before restore", async () => {
            const config = buildConfig({
                fileTransferMode: "ssh",
                sshHost: "ssh.example.com",
                sshUsername: "deploy",
                sshPassword: "sshpass",
            });

            const result = await restore(config, "/backups/testdb.bak");

            expect(result.success).toBe(true);

            // SSH should connect and upload
            expect(mockSshConnect).toHaveBeenCalledOnce();
            expect(mockSshConnect).toHaveBeenCalledWith(config);
            expect(mockSshUpload).toHaveBeenCalledOnce();

            // Upload: local → remote backup path
            const uploadCall = mockSshUpload.mock.calls[0];
            expect(uploadCall[1]).toContain("/var/opt/mssql/backup/");
        });

        it("should clean up remote .bak file after restore", async () => {
            const config = buildConfig({
                fileTransferMode: "ssh",
                sshUsername: "deploy",
            });

            await restore(config, "/backups/testdb.bak");

            expect(mockSshDeleteRemote).toHaveBeenCalled();
            expect(mockSshEnd).toHaveBeenCalled();
        });

        it("should log SSH transfer mode", async () => {
            const logs: string[] = [];
            const config = buildConfig({
                fileTransferMode: "ssh",
                sshUsername: "deploy",
            });

            await restore(config, "/backups/testdb.bak", (msg) => logs.push(msg));

            expect(logs).toContain("File transfer mode: SSH (remote server)");
            expect(logs.some((l) => l.includes("Connecting via SSH"))).toBe(true);
            expect(logs.some((l) => l.includes("Uploading:"))).toBe(true);
        });

        it("should clean up on restore failure", async () => {
            // RESTORE DATABASE fails
            mockExecuteQuery.mockImplementation((_config: any, query: string) => {
                if (query.includes("RESTORE FILELISTONLY")) {
                    return {
                        recordset: [
                            { LogicalName: "testdb_data", Type: "D", PhysicalName: "/data/testdb.mdf" },
                            { LogicalName: "testdb_log", Type: "L", PhysicalName: "/data/testdb.ldf" },
                        ],
                    };
                }
                throw new Error("RESTORE failed: exclusive access could not be obtained");
            });

            const config = buildConfig({
                fileTransferMode: "ssh",
                sshUsername: "deploy",
            });

            const result = await restore(config, "/backups/testdb.bak");

            expect(result.success).toBe(false);
            expect(result.error).toContain("exclusive access");

            // Cleanup should still happen
            expect(mockSshDeleteRemote).toHaveBeenCalled();
            expect(mockSshEnd).toHaveBeenCalled();
        });

        it("should clean up when SSH upload fails", async () => {
            mockSshUpload.mockRejectedValue(new Error("SFTP upload failed"));

            const config = buildConfig({
                fileTransferMode: "ssh",
                sshUsername: "deploy",
            });

            const result = await restore(config, "/backups/testdb.bak");

            expect(result.success).toBe(false);
            expect(result.error).toContain("SFTP upload failed");

            // Cleanup should still happen
            expect(mockSshEnd).toHaveBeenCalled();
        });

        it("should not use local file copy in SSH mode", async () => {
            const config = buildConfig({
                fileTransferMode: "ssh",
                sshUsername: "deploy",
                localBackupPath: "/mssql-shared", // Should not be used
            });

            await restore(config, "/backups/testdb.bak");

            // SSH upload should be used instead of local copy
            expect(mockSshUpload).toHaveBeenCalled();
        });
    });

    describe("Database Mapping", () => {
        it("should restore to mapped target database", async () => {
            const config = buildConfig({
                fileTransferMode: "ssh",
                sshUsername: "deploy",
                databaseMapping: [
                    { originalName: "testdb", targetName: "testdb_copy", selected: true },
                ],
            });

            const result = await restore(config, "/backups/testdb.bak");

            expect(result.success).toBe(true);

            // RESTORE should target the mapped name
            const restoreQuery = mockExecuteQuery.mock.calls[1][1];
            expect(restoreQuery).toContain("[testdb_copy]");
        });

        it("should skip unselected databases in mapping", async () => {
            const config = buildConfig({
                fileTransferMode: "ssh",
                sshUsername: "deploy",
                databaseMapping: [
                    { originalName: "testdb", targetName: "testdb_copy", selected: false },
                ],
            });

            const result = await restore(config, "/backups/testdb.bak");

            expect(result.success).toBe(false);
            expect(result.error).toContain("No target database specified");
        });
    });

    describe("Error Handling", () => {
        it("should return failure when no target database specified", async () => {
            const config = buildConfig({ database: "" });
            const result = await restore(config, "/backups/testdb.bak");

            expect(result.success).toBe(false);
            expect(result.error).toContain("No target database specified");
        });

        it("should return failure when SSH connection fails", async () => {
            mockSshConnect.mockRejectedValue(new Error("SSH auth failed"));

            const config = buildConfig({
                fileTransferMode: "ssh",
                sshUsername: "deploy",
            });

            const result = await restore(config, "/backups/testdb.bak");

            expect(result.success).toBe(false);
            expect(result.error).toContain("SSH auth failed");
        });

        it("should include MOVE clauses when restoring to different DB name", async () => {
            const config = buildConfig({
                fileTransferMode: "ssh",
                sshUsername: "deploy",
                databaseMapping: [
                    { originalName: "testdb", targetName: "staging", selected: true },
                ],
            });

            const result = await restore(config, "/backups/testdb.bak");

            expect(result.success).toBe(true);

            // RESTORE query should include MOVE clauses for file relocation
            const restoreQuery = mockExecuteQuery.mock.calls[1][1];
            expect(restoreQuery).toContain("MOVE");
            expect(restoreQuery).toContain("staging");
        });
    });
});
