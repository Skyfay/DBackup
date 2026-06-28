import { describe, it, expect, vi, beforeEach } from "vitest";
import { FTPAdapter } from "@/lib/adapters/storage/ftp";

// --- Hoisted mocks ---
const {
    mockAccess,
    mockClose,
    mockUploadFrom,
    mockDownloadTo,
    mockList,
    mockRemove,
    mockSize,
    mockEnsureDir,
    mockCd,
    mockTrackProgress,
    mockSend,
    mockPwd,
    mockWarn,
    mockError,
} = vi.hoisted(() => ({
    mockAccess: vi.fn(),
    mockClose: vi.fn(),
    mockUploadFrom: vi.fn().mockResolvedValue(undefined),
    mockDownloadTo: vi.fn().mockResolvedValue(undefined),
    mockList: vi.fn(),
    mockRemove: vi.fn().mockResolvedValue(undefined),
    mockSize: vi.fn().mockResolvedValue(1024),
    mockEnsureDir: vi.fn().mockResolvedValue(undefined),
    mockCd: vi.fn().mockResolvedValue(undefined),
    mockTrackProgress: vi.fn(),
    mockSend: vi.fn(),
    mockPwd: vi.fn(),
    mockWarn: vi.fn(),
    mockError: vi.fn(),
}));

vi.mock("basic-ftp", () => {
    class MockClient {
        ftp = { verbose: false };
        access = mockAccess;
        close = mockClose;
        uploadFrom = mockUploadFrom;
        downloadTo = mockDownloadTo;
        list = mockList;
        remove = mockRemove;
        size = mockSize;
        ensureDir = mockEnsureDir;
        cd = mockCd;
        trackProgress = mockTrackProgress;
        send = mockSend;
        pwd = mockPwd;
    }
    return { Client: MockClient };
});

vi.mock("fs", () => ({
    createReadStream: vi.fn(() => ({ pipe: vi.fn(), destroy: vi.fn() })),
    createWriteStream: vi.fn(() => ({ on: vi.fn(), end: vi.fn() })),
    default: {
        createReadStream: vi.fn(() => ({ pipe: vi.fn(), destroy: vi.fn() })),
        createWriteStream: vi.fn(() => ({ on: vi.fn(), end: vi.fn() })),
    },
}));

vi.mock("fs/promises", () => ({
    default: {
        stat: vi.fn().mockResolvedValue({ size: 1024 }),
        readFile: vi.fn().mockResolvedValue("file content"),
        unlink: vi.fn().mockResolvedValue(undefined),
        writeFile: vi.fn().mockResolvedValue(undefined),
    },
    stat: vi.fn().mockResolvedValue({ size: 1024 }),
    readFile: vi.fn().mockResolvedValue("file content"),
    unlink: vi.fn().mockResolvedValue(undefined),
    writeFile: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/lib/logging/logger", () => ({
    logger: {
        child: vi.fn().mockReturnValue({
            info: vi.fn(),
            error: mockError,
            warn: mockWarn,
            debug: vi.fn(),
        }),
    },
}));

vi.mock("@/lib/logging/errors", () => ({
    wrapError: vi.fn((e) => e),
}));

const config = {
    host: "ftp.example.com",
    port: 21,
    username: "ftpuser",
    password: "secret",
    tls: false,
    pathPrefix: "/backups",
};

describe("FTPAdapter - extra coverage", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockAccess.mockResolvedValue(undefined);
        mockClose.mockReturnValue(undefined);
        mockUploadFrom.mockResolvedValue(undefined);
        mockDownloadTo.mockResolvedValue(undefined);
        mockRemove.mockResolvedValue(undefined);
        mockSize.mockResolvedValue(1024);
        mockEnsureDir.mockResolvedValue(undefined);
        mockCd.mockResolvedValue(undefined);
        mockTrackProgress.mockReturnValue(undefined);
        mockSend.mockResolvedValue({ message: "211-Features:\n MLSD\n211 End" });
        mockPwd.mockResolvedValue("/");
    });

    // ===== list() - missing timestamp warning =====

    describe("list() - warnedAboutMissingTimestamp flag", () => {
        it("logs a warn when MLSD is not available and falls back to filename-based date", async () => {
            // No modifiedAt, but filename contains a parseable date.
            mockList.mockResolvedValue([
                {
                    name: "MyJob_2026-06-05_10-00-00.sql.gz",
                    isFile: true,
                    isDirectory: false,
                    size: 2048,
                    modifiedAt: undefined,
                },
            ]);

            const result = await FTPAdapter.list(config, "Job");

            expect(result).toHaveLength(1);
            // Date should be parsed from filename.
            expect(result[0].lastModified).toBeInstanceOf(Date);
            expect(result[0].lastModified!.toISOString()).toContain("2026-06-05");
            // Exactly one MLSD warning should be emitted.
            expect(mockWarn).toHaveBeenCalledTimes(1);
            expect(mockWarn.mock.calls[0][0]).toContain("MLSD");
        });

        it("logs the MLSD warning only once even when multiple files lack timestamps", async () => {
            mockList.mockResolvedValue([
                {
                    name: "Job_2026-01-01_00-00-00.sql.gz",
                    isFile: true,
                    isDirectory: false,
                    size: 100,
                    modifiedAt: undefined,
                },
                {
                    name: "Job_2026-01-02_00-00-00.sql.gz",
                    isFile: true,
                    isDirectory: false,
                    size: 200,
                    modifiedAt: undefined,
                },
            ]);

            await FTPAdapter.list(config, "Job");

            // The warnedAboutMissingTimestamp guard ensures the MLSD warning fires once.
            const mlsdWarnings = mockWarn.mock.calls.filter((c) =>
                typeof c[0] === "string" && c[0].includes("MLSD")
            );
            expect(mlsdWarnings).toHaveLength(1);
        });

        it("logs an additional per-file warning when the filename has no parseable date", async () => {
            mockList.mockResolvedValue([
                {
                    name: "backup-no-date.sql.gz",
                    isFile: true,
                    isDirectory: false,
                    size: 512,
                    modifiedAt: undefined,
                },
            ]);

            const result = await FTPAdapter.list(config, "Job");

            expect(result).toHaveLength(1);
            // Fallback: lastModified should be close to now.
            expect(result[0].lastModified).toBeInstanceOf(Date);

            // Two warnings: MLSD + filename-parse failure.
            expect(mockWarn).toHaveBeenCalledTimes(2);
            const fileWarn = mockWarn.mock.calls.find(
                (c) => typeof c[0] === "string" && c[0].includes("could not parse a date")
            );
            expect(fileWarn).toBeDefined();
        });

        it("does not warn when modifiedAt is provided by server (MLSD available)", async () => {
            const serverDate = new Date("2026-05-01T08:00:00Z");
            mockList.mockResolvedValue([
                {
                    name: "backup.sql.gz",
                    isFile: true,
                    isDirectory: false,
                    size: 512,
                    modifiedAt: serverDate,
                },
            ]);

            const result = await FTPAdapter.list(config, "Job");

            expect(result).toHaveLength(1);
            expect(result[0].lastModified).toBe(serverDate);
            expect(mockWarn).not.toHaveBeenCalled();
        });
    });

    // ===== ping() =====

    describe("ping()", () => {
        it("returns success when pwd() resolves", async () => {
            const result = await FTPAdapter.ping!(config);

            expect(result.success).toBe(true);
            expect(result.message).toContain("successful");
            expect(mockPwd).toHaveBeenCalled();
            expect(mockClose).toHaveBeenCalled();
        });

        it("returns failure when connection fails", async () => {
            mockAccess.mockRejectedValue(new Error("Connection timed out"));

            const result = await FTPAdapter.ping!(config);

            expect(result.success).toBe(false);
            expect(result.message).toContain("Connection timed out");
        });

        it("returns failure when pwd() throws after connection", async () => {
            mockPwd.mockRejectedValue(new Error("530 Not logged in"));

            const result = await FTPAdapter.ping!(config);

            expect(result.success).toBe(false);
            expect(result.message).toContain("530 Not logged in");
        });

        it("always closes the client even on failure", async () => {
            mockPwd.mockRejectedValue(new Error("Error"));

            await FTPAdapter.ping!(config);

            expect(mockClose).toHaveBeenCalled();
        });
    });

    // ===== test() - MLSD detection via FEAT =====

    describe("test() - MLSD detection", () => {
        it("includes MLSD-supported note when FEAT response contains MLSD", async () => {
            mockSend.mockResolvedValue({ message: "211-Features:\n MLSD\n211 End" });

            const result = await FTPAdapter.test!(config);

            expect(result.success).toBe(true);
            expect(result.message).toContain("MLSD supported");
        });

        it("includes MLSD-not-supported note when FEAT response does not contain MLSD", async () => {
            mockSend.mockResolvedValue({ message: "211-Features:\n SIZE\n211 End" });

            const result = await FTPAdapter.test!(config);

            expect(result.success).toBe(true);
            expect(result.message).toContain("MLSD not supported");
        });

        it("treats FEAT as unavailable when send() throws and still succeeds", async () => {
            mockSend.mockRejectedValue(new Error("500 Unknown command FEAT"));

            const result = await FTPAdapter.test!(config);

            expect(result.success).toBe(true);
            // Without FEAT support, mlsdSupported remains false.
            expect(result.message).toContain("MLSD not supported");
        });

        it("returns failure when uploadFrom throws during write test", async () => {
            mockUploadFrom.mockRejectedValue(new Error("553 Permission denied"));

            const result = await FTPAdapter.test!(config);

            expect(result.success).toBe(false);
            expect(result.message).toContain("553 Permission denied");
        });
    });
});
