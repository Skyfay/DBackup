import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { MSSQLConfig } from "@/lib/adapters/definitions";

// --- Mock setup ---

// Use vi.hoisted for variables referenced inside vi.mock factories
const {
    mockExecuteQuery,
    mockSupportsCompression,
    mockSshConnect,
    mockSshDownload,
    mockSshDeleteRemote,
    mockSshEnd,
    mockFsStat,
    mockFsUnlink,
    mockExistsSync,
} = vi.hoisted(() => ({
    mockExecuteQuery: vi.fn(),
    mockSupportsCompression: vi.fn(),
    mockSshConnect: vi.fn(),
    mockSshDownload: vi.fn(),
    mockSshDeleteRemote: vi.fn(),
    mockSshEnd: vi.fn(),
    mockFsStat: vi.fn(),
    mockFsUnlink: vi.fn(),
    mockExistsSync: vi.fn(),
}));

// Mock connection module
vi.mock("@/lib/adapters/database/mssql/connection", () => ({
    executeQuery: (...args: any[]) => mockExecuteQuery(...args),
    supportsCompression: (...args: any[]) => mockSupportsCompression(...args),
}));

// Mock SSH transfer (use a class so it's constructable with `new`)
vi.mock("@/lib/adapters/database/mssql/ssh-transfer", () => {
    class MockMssqlSshTransfer {
        connect(...args: any[]) { return mockSshConnect(...args); }
        download(...args: any[]) { return mockSshDownload(...args); }
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
    },
    stat: (...args: any[]) => mockFsStat(...args),
    unlink: (...args: any[]) => mockFsUnlink(...args),
}));

// Mock fs (sync functions + streams)
vi.mock("fs", () => {
    const { PassThrough } = require("stream");

    const existsSync = (...args: any[]) => mockExistsSync(...args);

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
        default: { existsSync, createReadStream, createWriteStream },
        existsSync,
        createReadStream,
        createWriteStream,
    };
});

// Mock tar-stream
vi.mock("tar-stream", () => ({
    pack: vi.fn(() => {
        const { PassThrough } = require("stream");
        const stream = new PassThrough();
        stream.entry = vi.fn((_opts: any) => {
            // Return a writable entry stream - don't auto-emit finish
            // The entry naturally ends when the source pipe calls .end()
            const entry = new PassThrough();
            return entry;
        });
        stream.finalize = vi.fn(() => {
            process.nextTick(() => stream.end());
        });
        return stream;
    }),
}));

// Mock stream/promises
vi.mock("stream/promises", () => {
    const pipeline = vi.fn().mockResolvedValue(undefined);
    return {
        default: { pipeline },
        pipeline,
    };
});

import { dump } from "@/lib/adapters/database/mssql/dump";

// Helper to build config
function buildConfig(overrides: Partial<MSSQLConfig> = {}): MSSQLConfig & { detectedVersion?: string } {
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

describe("MSSQL Dump", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockSupportsCompression.mockResolvedValue(true);
        mockExecuteQuery.mockResolvedValue({ recordset: [] });
        mockFsStat.mockResolvedValue({ size: 1024 * 1024 }); // 1 MB
        mockFsUnlink.mockResolvedValue(undefined);
        mockExistsSync.mockReturnValue(true);
        mockSshConnect.mockResolvedValue(undefined);
        mockSshDownload.mockResolvedValue(undefined);
        mockSshDeleteRemote.mockResolvedValue(undefined);
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    describe("Local Mode", () => {
        it("should execute BACKUP DATABASE and copy file locally", async () => {
            const config = buildConfig({ fileTransferMode: "local" });

            const result = await dump(config, "/dest/backup.bak");

            expect(result.success).toBe(true);
            expect(mockExecuteQuery).toHaveBeenCalledOnce();

            // Verify BACKUP DATABASE query was executed
            const query = mockExecuteQuery.mock.calls[0][1];
            expect(query).toContain("BACKUP DATABASE [testdb]");
            expect(query).toContain("COMPRESSION");
        });

        it("should fail when local file does not exist after backup", async () => {
            mockExistsSync.mockReturnValue(false);

            const config = buildConfig({ fileTransferMode: "local" });
            const result = await dump(config, "/dest/backup.bak");

            expect(result.success).toBe(false);
            expect(result.error).toContain("Backup file not found");
            expect(result.error).toContain("localBackupPath");
        });

        it("should log correct transfer mode", async () => {
            const logs: string[] = [];
            const config = buildConfig({ fileTransferMode: "local" });

            await dump(config, "/dest/backup.bak", (msg) => logs.push(msg));

            expect(logs).toContain("File transfer mode: Local (shared filesystem)");
        });
    });

    describe("SSH Mode", () => {
        it("should connect via SSH and download backup file", async () => {
            const config = buildConfig({
                fileTransferMode: "ssh",
                sshHost: "ssh.example.com",
                sshUsername: "deploy",
                sshAuthType: "password",
                sshPassword: "sshpass",
            });

            const result = await dump(config, "/dest/backup.bak");

            expect(result.success).toBe(true);

            // SSH connect should be called
            expect(mockSshConnect).toHaveBeenCalledOnce();
            expect(mockSshConnect).toHaveBeenCalledWith(config);

            // SFTP download should be called for the .bak file
            expect(mockSshDownload).toHaveBeenCalledOnce();
            expect(mockSshDownload).toHaveBeenCalledWith(
                expect.stringContaining("/var/opt/mssql/backup/"),
                expect.stringContaining("/tmp/")
            );
        });

        it("should clean up remote .bak file after download", async () => {
            const config = buildConfig({
                fileTransferMode: "ssh",
                sshUsername: "deploy",
            });

            await dump(config, "/dest/backup.bak");

            // Remote cleanup should happen
            expect(mockSshDeleteRemote).toHaveBeenCalled();
            expect(mockSshEnd).toHaveBeenCalled();
        });

        it("should use /tmp as local path in SSH mode", async () => {
            const config = buildConfig({
                fileTransferMode: "ssh",
                sshUsername: "deploy",
                localBackupPath: "/custom/path", // Should be ignored in SSH mode
            });

            await dump(config, "/dest/backup.bak");

            // Download target should be in /tmp, not /custom/path
            const downloadCall = mockSshDownload.mock.calls[0];
            expect(downloadCall[1]).toMatch(/^\/tmp\//);
        });

        it("should log SSH transfer mode", async () => {
            const logs: string[] = [];
            const config = buildConfig({
                fileTransferMode: "ssh",
                sshUsername: "deploy",
            });

            await dump(config, "/dest/backup.bak", (msg) => logs.push(msg));

            expect(logs).toContain("File transfer mode: SSH (remote server)");
            expect(logs.some((l) => l.includes("Connecting via SSH"))).toBe(true);
        });

        it("should still clean up on SSH download failure", async () => {
            mockSshDownload.mockRejectedValue(new Error("SFTP connection lost"));

            const config = buildConfig({
                fileTransferMode: "ssh",
                sshUsername: "deploy",
            });

            const result = await dump(config, "/dest/backup.bak");

            expect(result.success).toBe(false);
            expect(result.error).toContain("SFTP connection lost");

            // Cleanup should still happen
            expect(mockSshDeleteRemote).toHaveBeenCalled();
            expect(mockSshEnd).toHaveBeenCalled();
        });

        it("should not use existsSync check in SSH mode", async () => {
            const config = buildConfig({
                fileTransferMode: "ssh",
                sshUsername: "deploy",
            });

            await dump(config, "/dest/backup.bak");

            // existsSync should NOT be called (that's the local mode check)
            expect(mockExistsSync).not.toHaveBeenCalled();
        });
    });

    describe("Multi-Database Backup", () => {
        it("should backup multiple databases and download all via SSH", async () => {
            const config = buildConfig({
                database: ["db1", "db2"],
                fileTransferMode: "ssh",
                sshUsername: "deploy",
            });

            const result = await dump(config, "/dest/multi.tar");

            expect(result.success).toBe(true);

            // Two BACKUP DATABASE queries should be executed
            expect(mockExecuteQuery).toHaveBeenCalledTimes(2);
            expect(mockExecuteQuery.mock.calls[0][1]).toContain("[db1]");
            expect(mockExecuteQuery.mock.calls[1][1]).toContain("[db2]");

            // Two SFTP downloads
            expect(mockSshDownload).toHaveBeenCalledTimes(2);
        });

        it("should clean up all remote files after multi-DB backup", async () => {
            const config = buildConfig({
                database: ["db1", "db2"],
                fileTransferMode: "ssh",
                sshUsername: "deploy",
            });

            await dump(config, "/dest/multi.tar");

            // Should delete both remote files
            expect(mockSshDeleteRemote).toHaveBeenCalledTimes(2);
            expect(mockSshEnd).toHaveBeenCalledOnce();
        });
    });

    describe("Compression Detection", () => {
        it("should use compression when supported", async () => {
            mockSupportsCompression.mockResolvedValue(true);
            const config = buildConfig({ fileTransferMode: "ssh", sshUsername: "deploy" });

            const logs: string[] = [];
            await dump(config, "/dest/backup.bak", (msg) => logs.push(msg));

            expect(logs.some((l) => l.includes("Compression enabled"))).toBe(true);
            const query = mockExecuteQuery.mock.calls[0][1];
            expect(query).toContain("COMPRESSION");
        });

        it("should skip compression when not supported (Express edition)", async () => {
            mockSupportsCompression.mockResolvedValue(false);
            const config = buildConfig({ fileTransferMode: "ssh", sshUsername: "deploy" });

            const logs: string[] = [];
            await dump(config, "/dest/backup.bak", (msg) => logs.push(msg));

            expect(logs.some((l) => l.includes("Compression disabled"))).toBe(true);
        });
    });

    describe("Error Handling", () => {
        it("should return failure result when no database specified", async () => {
            const config = buildConfig({ database: "" });
            const result = await dump(config, "/dest/backup.bak");

            expect(result.success).toBe(false);
            expect(result.error).toContain("No database specified");
        });

        it("should return failure result when SQL query fails", async () => {
            mockExecuteQuery.mockRejectedValue(new Error("Login failed"));
            const config = buildConfig({ fileTransferMode: "ssh", sshUsername: "deploy" });

            const result = await dump(config, "/dest/backup.bak");

            expect(result.success).toBe(false);
            expect(result.error).toContain("Login failed");
        });

        it("should return failure result when SSH connect fails", async () => {
            mockSshConnect.mockRejectedValue(new Error("SSH connection refused"));
            const config = buildConfig({
                fileTransferMode: "ssh",
                sshUsername: "deploy",
            });

            const result = await dump(config, "/dest/backup.bak");

            expect(result.success).toBe(false);
            expect(result.error).toContain("SSH connection refused");
        });
    });
});
