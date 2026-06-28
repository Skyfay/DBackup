import { describe, it, expect, vi, beforeEach } from "vitest";
import { SFTPAdapter } from "@/lib/adapters/storage/sftp";

// --- Hoisted mocks ---
const { mockSftpConnect, mockSftpEnd, mockSftpStat } = vi.hoisted(() => ({
    mockSftpConnect: vi.fn(),
    mockSftpEnd: vi.fn().mockResolvedValue(undefined),
    mockSftpStat: vi.fn(),
}));

vi.mock("ssh2-sftp-client", () => {
    class MockSFTPClient {
        connect = mockSftpConnect;
        end = mockSftpEnd;
        put = vi.fn().mockResolvedValue(undefined);
        get = vi.fn().mockResolvedValue(undefined);
        fastGet = vi.fn().mockResolvedValue(undefined);
        list = vi.fn().mockResolvedValue([]);
        exists = vi.fn().mockResolvedValue("d");
        mkdir = vi.fn().mockResolvedValue(undefined);
        delete = vi.fn().mockResolvedValue(undefined);
        stat = mockSftpStat;
    }
    return { default: MockSFTPClient };
});

vi.mock("fs", () => ({
    createReadStream: vi.fn(() => ({ pipe: vi.fn(), destroy: vi.fn() })),
    default: {
        createReadStream: vi.fn(() => ({ pipe: vi.fn(), destroy: vi.fn() })),
    },
    promises: {
        stat: vi.fn().mockResolvedValue({ size: 1024 }),
    },
}));

vi.mock("@/lib/logging/logger", () => ({
    logger: {
        child: vi.fn().mockReturnValue({
            info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn(),
        }),
    },
}));

vi.mock("@/lib/logging/errors", () => ({
    wrapError: vi.fn((e) => e),
}));

const config = {
    host: "sftp.example.com",
    port: 22,
    username: "backupuser",
    password: "secret",
    pathPrefix: "/backups",
};

describe("SFTPAdapter - extra coverage", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockSftpConnect.mockResolvedValue(undefined);
        mockSftpEnd.mockResolvedValue(undefined);
    });

    // ===== openSession() =====

    describe("openSession()", () => {
        it("returns a session object with upload and close methods", async () => {
            const session = await SFTPAdapter.openSession!(config);

            expect(session).toBeDefined();
            expect(typeof session.upload).toBe("function");
            expect(typeof session.close).toBe("function");
        });

        it("calls onLog with connection info when onLog is provided", async () => {
            const onLog = vi.fn();
            await SFTPAdapter.openSession!(config, onLog);

            expect(onLog).toHaveBeenCalledWith(
                expect.stringContaining("sftp.example.com:22"),
                "info",
                "storage"
            );
        });

        it("does not call onLog when onLog is not provided", async () => {
            // Should not throw even without onLog.
            const session = await SFTPAdapter.openSession!(config);
            expect(session).toBeDefined();
        });

        it("session.close() calls sftp end()", async () => {
            const session = await SFTPAdapter.openSession!(config);
            await session.close();

            expect(mockSftpEnd).toHaveBeenCalled();
        });

        it("session.close() does not throw even when end() rejects", async () => {
            mockSftpEnd.mockRejectedValue(new Error("already closed"));
            const session = await SFTPAdapter.openSession!(config);

            await expect(session.close()).resolves.toBeUndefined();
        });

        it("rejects when connect fails", async () => {
            mockSftpConnect.mockRejectedValue(new Error("Auth failed"));

            await expect(SFTPAdapter.openSession!(config)).rejects.toThrow("Auth failed");
        });
    });

    // ===== ping() =====

    describe("ping()", () => {
        it("returns success true on successful stat", async () => {
            mockSftpStat.mockResolvedValue({ size: 0 });

            const result = await SFTPAdapter.ping!(config);

            expect(result.success).toBe(true);
            expect(result.message).toBe("Connection successful");
        });

        it("uses pathPrefix as the stat target", async () => {
            mockSftpStat.mockResolvedValue({ size: 0 });

            await SFTPAdapter.ping!(config);

            expect(mockSftpStat).toHaveBeenCalledWith("/backups");
        });

        it("falls back to '.' when pathPrefix is not set", async () => {
            mockSftpStat.mockResolvedValue({ size: 0 });
            const noPrefix = { ...config, pathPrefix: undefined };

            await SFTPAdapter.ping!(noPrefix);

            expect(mockSftpStat).toHaveBeenCalledWith(".");
        });

        it("returns success false when connect fails", async () => {
            mockSftpConnect.mockRejectedValue(new Error("Connection refused"));

            const result = await SFTPAdapter.ping!(config);

            expect(result.success).toBe(false);
            expect(result.message).toContain("Connection refused");
        });

        it("returns success false when stat fails", async () => {
            mockSftpStat.mockRejectedValue(new Error("No such directory"));

            const result = await SFTPAdapter.ping!(config);

            expect(result.success).toBe(false);
            expect(result.message).toContain("No such directory");
        });

        it("always calls sftp end() on success", async () => {
            mockSftpStat.mockResolvedValue({ size: 0 });

            await SFTPAdapter.ping!(config);

            expect(mockSftpEnd).toHaveBeenCalled();
        });

        it("always calls sftp end() on failure", async () => {
            mockSftpStat.mockRejectedValue(new Error("Error"));

            await SFTPAdapter.ping!(config);

            expect(mockSftpEnd).toHaveBeenCalled();
        });
    });
});
