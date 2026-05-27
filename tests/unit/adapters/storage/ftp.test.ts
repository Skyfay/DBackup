import { describe, it, expect, vi, beforeEach } from "vitest";
import { FTPAdapter } from "@/lib/adapters/storage/ftp";

// --- Hoisted mocks ---
const { mockAccess, mockClose, mockUploadFrom, mockDownloadTo, mockList, mockRemove, mockSize, mockEnsureDir, mockCd, mockTrackProgress } = vi.hoisted(() => ({
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
            info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn(),
        }),
    },
}));

vi.mock("@/lib/logging/errors", () => ({
    wrapError: vi.fn((e) => e),
}));

// --- Config ---
const config = {
    host: "ftp.example.com",
    port: 21,
    username: "ftpuser",
    password: "secret",
    tls: false,
    pathPrefix: "/backups",
};

describe("FTPAdapter", () => {
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
    });

    // ===== upload() =====

    describe("upload()", () => {
        it("returns true on successful upload", async () => {
            const result = await FTPAdapter.upload(config, "/tmp/backup.sql", "Job/backup.sql");

            expect(result).toBe(true);
            expect(mockUploadFrom).toHaveBeenCalled();
            expect(mockClose).toHaveBeenCalled();
        });

        it("calls cd('/') after ensureDir to reset CWD", async () => {
            await FTPAdapter.upload(config, "/tmp/backup.sql", "Job/backup.sql");

            expect(mockCd).toHaveBeenCalledWith("/");
        });

        it("returns false when connect fails", async () => {
            mockAccess.mockRejectedValue(new Error("Connection refused"));

            const result = await FTPAdapter.upload(config, "/tmp/backup.sql", "Job/backup.sql");

            expect(result).toBe(false);
        });

        it("returns false when uploadFrom throws", async () => {
            mockUploadFrom.mockRejectedValue(new Error("Disk full"));

            const result = await FTPAdapter.upload(config, "/tmp/backup.sql", "Job/backup.sql");

            expect(result).toBe(false);
        });

        it("always calls close() even on failure", async () => {
            mockUploadFrom.mockRejectedValue(new Error("Error"));

            await FTPAdapter.upload(config, "/tmp/backup.sql", "Job/backup.sql");

            expect(mockClose).toHaveBeenCalled();
        });

        it("calls onLog with connection info", async () => {
            const onLog = vi.fn();

            await FTPAdapter.upload(config, "/tmp/backup.sql", "Job/backup.sql", undefined, onLog);

            expect(onLog).toHaveBeenCalledWith(expect.stringContaining("ftp.example.com"), "info", "storage");
        });
    });

    // ===== download() =====

    describe("download()", () => {
        it("returns true on successful download", async () => {
            const result = await FTPAdapter.download(config, "Job/backup.sql", "/tmp/out.sql");

            expect(result).toBe(true);
            expect(mockDownloadTo).toHaveBeenCalled();
        });

        it("returns false when downloadTo throws", async () => {
            mockDownloadTo.mockRejectedValue(new Error("550 File not found"));

            const result = await FTPAdapter.download(config, "Job/missing.sql", "/tmp/out.sql");

            expect(result).toBe(false);
        });

        it("always closes client", async () => {
            mockDownloadTo.mockRejectedValue(new Error("Error"));

            await FTPAdapter.download(config, "Job/backup.sql", "/tmp/out.sql");

            expect(mockClose).toHaveBeenCalled();
        });
    });

    // ===== list() =====

    describe("list()", () => {
        it("returns files from directory walk", async () => {
            mockList.mockResolvedValue([
                { name: "backup.sql", isFile: true, isDirectory: false, size: 1024, modifiedAt: new Date() },
            ]);

            const result = await FTPAdapter.list(config, "Job");

            expect(result).toHaveLength(1);
            expect(result[0].name).toBe("backup.sql");
        });

        it("recurses into subdirectories", async () => {
            mockList
                .mockResolvedValueOnce([
                    { name: "subdir", isFile: false, isDirectory: true, size: 0, modifiedAt: new Date() },
                ])
                .mockResolvedValueOnce([
                    { name: "nested.sql", isFile: true, isDirectory: false, size: 512, modifiedAt: new Date() },
                ]);

            const result = await FTPAdapter.list(config, "Job");

            expect(result).toHaveLength(1);
            expect(result[0].name).toBe("nested.sql");
        });

        it("skips . and .. entries", async () => {
            mockList.mockResolvedValue([
                { name: ".", isFile: false, isDirectory: true, size: 0, modifiedAt: new Date() },
                { name: "..", isFile: false, isDirectory: true, size: 0, modifiedAt: new Date() },
                { name: "backup.sql", isFile: true, isDirectory: false, size: 100, modifiedAt: new Date() },
            ]);

            const result = await FTPAdapter.list(config, "Job");

            expect(result.map((f) => f.name)).not.toContain(".");
            expect(result.map((f) => f.name)).not.toContain("..");
            expect(result).toHaveLength(1);
        });

        it("throws on connection error", async () => {
            mockAccess.mockRejectedValue(new Error("Auth failed"));

            await expect(FTPAdapter.list(config, "Job")).rejects.toThrow("Auth failed");
        });

        it("throws when initial directory listing fails after connection", async () => {
            mockList.mockRejectedValue(new Error("550 Permission denied"));

            await expect(FTPAdapter.list(config, "Job")).rejects.toThrow("550 Permission denied");
        });
    });

    // ===== delete() =====

    describe("delete()", () => {
        it("returns true on successful delete", async () => {
            const result = await FTPAdapter.delete(config, "Job/backup.sql");

            expect(result).toBe(true);
            expect(mockRemove).toHaveBeenCalled();
        });

        it("returns false when remove throws", async () => {
            mockRemove.mockRejectedValue(new Error("550 No such file"));

            const result = await FTPAdapter.delete(config, "Job/missing.sql");

            expect(result).toBe(false);
        });
    });

    // ===== read() =====

    describe("read()", () => {
        it("returns file content as string", async () => {
            const result = await FTPAdapter.read!(config, "Job/backup.sql.meta.json");

            expect(typeof result).toBe("string");
            expect(mockDownloadTo).toHaveBeenCalled();
        });

        it("returns null when download fails", async () => {
            mockDownloadTo.mockRejectedValue(new Error("File not found"));

            const result = await FTPAdapter.read!(config, "Job/missing.meta.json");

            expect(result).toBeNull();
        });
    });

    // ===== test() =====

    describe("test()", () => {
        it("returns success when write+delete succeed", async () => {
            const result = await FTPAdapter.test!(config);

            expect(result.success).toBe(true);
            expect(result.message).toContain("successful");
        });

        it("returns failure when connection fails", async () => {
            mockAccess.mockRejectedValue(new Error("Connection refused"));

            const result = await FTPAdapter.test!(config);

            expect(result.success).toBe(false);
            expect(result.message).toContain("Connection refused");
        });
    });

    // ===== upload() progress tracking =====

    describe("upload() progress tracking", () => {
        it("invokes onProgress when trackProgress callback fires", async () => {
            let progressCb: ((info: { bytesOverall: number }) => void) | undefined;
            mockTrackProgress.mockImplementation((cb?: (info: { bytesOverall: number }) => void) => {
                if (cb) progressCb = cb;
            });

            const onProgress = vi.fn();
            await FTPAdapter.upload(config, "/tmp/backup.sql", "Job/backup.sql", onProgress);

            // Simulate progress event
            progressCb?.({ bytesOverall: 512 });
            expect(onProgress).toHaveBeenCalledWith(50); // 512/1024 * 100 = 50
            expect(onProgress).toHaveBeenCalledWith(100); // final
        });
    });

    // ===== download() progress tracking =====

    describe("download() progress tracking", () => {
        it("invokes onProgress when download trackProgress callback fires", async () => {
            let progressCb: ((info: { bytesOverall: number }) => void) | undefined;
            mockTrackProgress.mockImplementation((cb?: (info: { bytesOverall: number }) => void) => {
                if (cb) progressCb = cb;
            });

            const onProgress = vi.fn();
            await FTPAdapter.download(config, "Job/backup.sql", "/tmp/out.sql", onProgress);

            progressCb?.({ bytesOverall: 256 });
            expect(onProgress).toHaveBeenCalledWith(256, 1024);
        });

        it("proceeds when client.size() throws (size not supported)", async () => {
            mockSize.mockRejectedValue(new Error("SIZE not implemented"));

            let progressCb: ((info: { bytesOverall: number }) => void) | undefined;
            mockTrackProgress.mockImplementation((cb?: (info: { bytesOverall: number }) => void) => {
                if (cb) progressCb = cb;
            });

            const onProgress = vi.fn();
            const result = await FTPAdapter.download(config, "Job/backup.sql", "/tmp/out.sql", onProgress);

            // After size fails, total=0, onProgress uses bytesOverall for both
            progressCb?.({ bytesOverall: 100 });
            expect(onProgress).toHaveBeenCalledWith(100, 100);
            expect(result).toBe(true);
        });
    });

    // ===== list() - walk catch =====

    describe("list() walk error handling", () => {
        it("continues when list() throws for a subdirectory", async () => {
            mockList
                .mockResolvedValueOnce([
                    { name: "subdir", isFile: false, isDirectory: true, size: 0, modifiedAt: new Date() },
                ])
                .mockRejectedValueOnce(new Error("Subdirectory listing failed"));

            const result = await FTPAdapter.list(config, "Job");

            // walk catches the error and continues - result is empty but no throw
            expect(result).toEqual([]);
        });
    });

    // ===== resolvePath without pathPrefix (line 49) =====

    describe("resolvePath without pathPrefix", () => {
        it("uses remotePath directly when no pathPrefix is configured", async () => {
            const noPrefix = { ...config, pathPrefix: undefined };

            const result = await FTPAdapter.upload(noPrefix, "/tmp/backup.sql", "backup.sql");

            expect(result).toBe(true);
            expect(mockUploadFrom).toHaveBeenCalled();
        });

        it("list() works without pathPrefix", async () => {
            const noPrefix = { ...config, pathPrefix: undefined };
            mockList.mockResolvedValue([
                { name: "backup.sql", isFile: true, isDirectory: false, size: 512, modifiedAt: new Date() },
            ]);

            const result = await FTPAdapter.list(noPrefix, "");

            expect(result).toHaveLength(1);
            expect(result[0].name).toBe("backup.sql");
        });
    });
});
