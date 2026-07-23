import { describe, it, expect, vi, beforeEach } from "vitest";
import { WebDAVAdapter } from "@/lib/adapters/storage/webdav";

// --- Hoisted mocks ---
const { mockClient, mockPipeline } = vi.hoisted(() => ({
    mockClient: {
        putFileContents: vi.fn(),
        getFileContents: vi.fn(),
        getDirectoryContents: vi.fn(),
        deleteFile: vi.fn(),
        exists: vi.fn(),
        createDirectory: vi.fn(),
        createReadStream: vi.fn(),
        createWriteStream: vi.fn((_path: string, _opts?: unknown) => ({ on: vi.fn(), end: vi.fn() })),
        stat: vi.fn(),
    },
    mockPipeline: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("webdav", () => ({
    createClient: vi.fn(() => mockClient),
}));

vi.mock("fs/promises", () => {
    const api = {
        readFile: vi.fn().mockResolvedValue(Buffer.from("backup data")),
        stat: vi.fn().mockResolvedValue({ size: 11 }),
    };
    return { default: api, ...api };
});

vi.mock("fs", () => {
    const api = {
        createWriteStream: vi.fn(() => ({ on: vi.fn(), end: vi.fn() })),
        createReadStream: vi.fn(() => ({ on: vi.fn(), pipe: vi.fn() })),
    };
    return { default: api, ...api };
});

vi.mock("stream/promises", () => ({
    pipeline: mockPipeline,
    default: { pipeline: mockPipeline },
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
    url: "https://dav.example.com",
    username: "admin",
    password: "secret",
    pathPrefix: "backups",
};

describe("WebDAVAdapter", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockClient.exists.mockResolvedValue(true);
        mockClient.createDirectory.mockResolvedValue(undefined);
        mockPipeline.mockResolvedValue(undefined);
    });

    // ===== upload() =====

    describe("upload()", () => {
        it("returns true on successful upload", async () => {
            const result = await WebDAVAdapter.upload(config, "/tmp/backup.sql", "Job/backup.sql");

            expect(result).toBe(true);
            // Streamed rather than read into a Buffer - a backup archive can exceed memory.
            expect(mockClient.createWriteStream).toHaveBeenCalled();
            expect(mockClient.putFileContents).not.toHaveBeenCalled();
        });

        it("creates parent directory when it does not exist", async () => {
            mockClient.exists.mockResolvedValue(false);
            
            await WebDAVAdapter.upload(config, "/tmp/backup.sql", "Job/backup.sql");

            expect(mockClient.createDirectory).toHaveBeenCalled();
        });

        it("returns false when the upload stream fails", async () => {
            mockPipeline.mockRejectedValue(new Error("Server Error"));

            const result = await WebDAVAdapter.upload(config, "/tmp/backup.sql", "Job/backup.sql");

            expect(result).toBe(false);
        });

        it("calls onProgress(100) after successful upload", async () => {
                        const onProgress = vi.fn();

            await WebDAVAdapter.upload(config, "/tmp/backup.sql", "Job/backup.sql", onProgress);

            expect(onProgress).toHaveBeenCalledWith(100);
        });

        it("respects pathPrefix in destination path", async () => {
            
            await WebDAVAdapter.upload(config, "/tmp/backup.sql", "Job/backup.sql");

            const destinationArg = mockClient.createWriteStream.mock.calls[0][0];
            expect(destinationArg).toContain("backups");
        });
    });

    // ===== download() =====

    describe("download()", () => {
        it("returns true on successful download", async () => {
            mockClient.createReadStream.mockReturnValue({ pipe: vi.fn() });

            const result = await WebDAVAdapter.download(config, "Job/backup.sql", "/tmp/out.sql");

            expect(result).toBe(true);
        });

        it("returns false when createReadStream pipeline throws", async () => {
            mockPipeline.mockRejectedValueOnce(new Error("Stream error"));
            mockClient.createReadStream.mockReturnValue({ pipe: vi.fn() });

            const result = await WebDAVAdapter.download(config, "Job/backup.sql", "/tmp/out.sql");

            expect(result).toBe(false);
        });

        it("uses progress tracking when onProgress is provided and stat succeeds", async () => {
            mockClient.stat.mockResolvedValue({ size: 2048 });
            mockClient.createReadStream.mockReturnValue({ pipe: vi.fn() });

            const onProgress = vi.fn();
            await WebDAVAdapter.download(config, "Job/backup.sql", "/tmp/out.sql", onProgress);

            // pipeline should have been called with a tracker stream
            expect(mockPipeline).toHaveBeenCalled();
        });
    });

    // ===== read() =====

    describe("read()", () => {
        it("returns file content as string", async () => {
            mockClient.getFileContents.mockResolvedValue('{"checksum":"abc"}');

            const result = await WebDAVAdapter.read!(config, "Job/backup.sql.meta.json");

            expect(result).toBe('{"checksum":"abc"}');
        });

        it("returns null when getFileContents throws", async () => {
            mockClient.getFileContents.mockRejectedValue(new Error("404 Not Found"));

            const result = await WebDAVAdapter.read!(config, "Job/missing.meta.json");

            expect(result).toBeNull();
        });
    });

    // ===== list() =====

    describe("list()", () => {
        it("returns files from directory walk", async () => {
            mockClient.getDirectoryContents.mockResolvedValue([
                {
                    type: "file",
                    filename: "/backups/Job/backup.sql",
                    basename: "backup.sql",
                    size: 1024,
                    lastmod: "2026-01-01T00:00:00Z",
                },
            ]);

            const result = await WebDAVAdapter.list(config, "Job");

            expect(result).toHaveLength(1);
            expect(result[0].name).toBe("backup.sql");
            expect(result[0].size).toBe(1024);
        });

        it("recurses into subdirectories", async () => {
            mockClient.getDirectoryContents
                .mockResolvedValueOnce([
                    { type: "directory", filename: "/backups/Job/sub", basename: "sub", size: 0, lastmod: "2026-01-01" },
                ])
                .mockResolvedValueOnce([
                    { type: "file", filename: "/backups/Job/sub/nested.sql", basename: "nested.sql", size: 512, lastmod: "2026-01-01" },
                ]);

            const result = await WebDAVAdapter.list(config, "Job");

            expect(result).toHaveLength(1);
            expect(result[0].name).toBe("nested.sql");
        });

        it("strips pathPrefix from returned paths", async () => {
            mockClient.getDirectoryContents.mockResolvedValue([
                {
                    type: "file",
                    filename: "/backups/Job/backup.sql",
                    basename: "backup.sql",
                    size: 100,
                    lastmod: "2026-01-01",
                },
            ]);

            const result = await WebDAVAdapter.list(config, "Job");

            expect(result[0].path).not.toContain("/backups/");
        });

        it("throws on getDirectoryContents error", async () => {
            mockClient.getDirectoryContents.mockRejectedValue(new Error("Connection refused"));

            await expect(WebDAVAdapter.list(config, "Job")).rejects.toThrow("Connection refused");
        });
    });

    // ===== delete() =====

    describe("delete()", () => {
        it("returns true on successful delete", async () => {
            mockClient.deleteFile.mockResolvedValue(undefined);

            const result = await WebDAVAdapter.delete(config, "Job/backup.sql");

            expect(result).toBe(true);
        });

        it("returns false when deleteFile throws", async () => {
            mockClient.deleteFile.mockRejectedValue(new Error("Not found"));

            const result = await WebDAVAdapter.delete(config, "Job/backup.sql");

            expect(result).toBe(false);
        });
    });

    // ===== test() =====

    describe("test()", () => {
        it("returns success when put+delete succeed", async () => {
            mockClient.putFileContents.mockResolvedValue(undefined);
            mockClient.deleteFile.mockResolvedValue(undefined);

            const result = await WebDAVAdapter.test!(config);

            expect(result.success).toBe(true);
        });

        it("returns failure when server throws", async () => {
            mockClient.putFileContents.mockRejectedValue(new Error("Unauthorized"));

            const result = await WebDAVAdapter.test!(config);

            expect(result.success).toBe(false);
            expect(result.message).toContain("Unauthorized");
        });

        it("creates pathPrefix directory when it does not exist", async () => {
            mockClient.exists.mockResolvedValue(false);
            mockClient.createDirectory.mockResolvedValue(undefined);
            mockClient.putFileContents.mockResolvedValue(undefined);
            mockClient.deleteFile.mockResolvedValue(undefined);

            const result = await WebDAVAdapter.test!(config);

            expect(result.success).toBe(true);
            expect(mockClient.createDirectory).toHaveBeenCalled();
        });
    });

    // ===== resolvePath without pathPrefix =====

    describe("upload() without pathPrefix", () => {
        it("uses root path when no pathPrefix is set", async () => {
            const noPrefix = { ...config, pathPrefix: undefined };
            
            const result = await WebDAVAdapter.upload(noPrefix, "/tmp/backup.sql", "backup.sql");

            expect(result).toBe(true);
            const destArg = mockClient.createWriteStream.mock.calls[0][0];
            expect(destArg).not.toContain("backups");
        });
    });

    // ===== download() - stat size 0 fallback =====

    describe("download() stat size 0", () => {
        it("falls back to plain pipeline when stat returns size 0", async () => {
            mockClient.stat.mockResolvedValue({ size: 0 });
            mockClient.createReadStream.mockReturnValue({ pipe: vi.fn() });

            const onProgress = vi.fn();
            const result = await WebDAVAdapter.download(config, "Job/backup.sql", "/tmp/out.sql", onProgress);

            expect(result).toBe(true);
            expect(mockPipeline).toHaveBeenCalled();
        });

        it("falls back to plain pipeline when stat throws", async () => {
            mockClient.stat.mockRejectedValue(new Error("stat not supported"));
            mockClient.createReadStream.mockReturnValue({ pipe: vi.fn() });

            const onProgress = vi.fn();
            const result = await WebDAVAdapter.download(config, "Job/backup.sql", "/tmp/out.sql", onProgress);

            expect(result).toBe(true);
        });
    });

    // ====================================================================
    // download() tracker transform body (lines 93-95)
    // ====================================================================
    describe("download() tracker transform body coverage", () => {
        it("invokes onProgress via tracker _transform when size > 0", async () => {
            mockClient.stat.mockResolvedValue({ size: 2048 });
            mockClient.createReadStream.mockReturnValue({ pipe: vi.fn() });

            // Override pipeline to call the tracker's _transform so lines 93-95 run
            mockPipeline.mockImplementationOnce(async (_src: any, tracker: any, _dst: any) => {
                if (tracker && typeof tracker._transform === "function") {
                    tracker._transform(Buffer.from("test chunk"), "buffer", () => {});
                }
            });

            const onProgress = vi.fn();
            const result = await WebDAVAdapter.download(config, "Job/backup.sql", "/tmp/out.sql", onProgress);

            expect(result).toBe(true);
            expect(onProgress).toHaveBeenCalled();
        });
    });
});
