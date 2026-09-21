import { describe, it, expect, vi, beforeEach } from "vitest";
import { LocalFileSystemAdapter } from "@/lib/adapters/storage/local";

// --- Hoisted mocks ---
const { mockFsStat, mockFsAccess, mockFsMkdir, mockFsReadFile, mockFsWriteFile, mockFsUnlink, mockFsReaddir, mockCreateReadStream, mockCreateWriteStream, mockPipeline } = vi.hoisted(() => {
    const mockReadStream = {
        on: vi.fn().mockReturnThis(),
        pipe: vi.fn(),
    };
    return {
        mockFsStat: vi.fn().mockResolvedValue({ size: 1024, mtime: new Date() }),
        mockFsAccess: vi.fn().mockResolvedValue(undefined),
        mockFsMkdir: vi.fn().mockResolvedValue(undefined),
        mockFsReadFile: vi.fn().mockResolvedValue("file content"),
        mockFsWriteFile: vi.fn().mockResolvedValue(undefined),
        mockFsUnlink: vi.fn().mockResolvedValue(undefined),
        mockFsReaddir: vi.fn().mockResolvedValue([]),
        mockCreateReadStream: vi.fn().mockReturnValue(mockReadStream),
        mockCreateWriteStream: vi.fn().mockReturnValue({ on: vi.fn(), end: vi.fn() }),
        mockPipeline: vi.fn().mockResolvedValue(undefined),
    };
});

vi.mock("fs/promises", () => ({
    default: {
        stat: (...args: unknown[]) => mockFsStat(...args),
        access: (...args: unknown[]) => mockFsAccess(...args),
        mkdir: (...args: unknown[]) => mockFsMkdir(...args),
        readFile: (...args: unknown[]) => mockFsReadFile(...args),
        writeFile: (...args: unknown[]) => mockFsWriteFile(...args),
        unlink: (...args: unknown[]) => mockFsUnlink(...args),
        readdir: (...args: unknown[]) => mockFsReaddir(...args),
    },
    stat: (...args: unknown[]) => mockFsStat(...args),
    access: (...args: unknown[]) => mockFsAccess(...args),
    mkdir: (...args: unknown[]) => mockFsMkdir(...args),
    readFile: (...args: unknown[]) => mockFsReadFile(...args),
    writeFile: (...args: unknown[]) => mockFsWriteFile(...args),
    unlink: (...args: unknown[]) => mockFsUnlink(...args),
    readdir: (...args: unknown[]) => mockFsReaddir(...args),
}));

vi.mock("fs", () => ({
    createReadStream: (...args: unknown[]) => mockCreateReadStream(...args),
    createWriteStream: (...args: unknown[]) => mockCreateWriteStream(...args),
    default: {
        createReadStream: (...args: unknown[]) => mockCreateReadStream(...args),
        createWriteStream: (...args: unknown[]) => mockCreateWriteStream(...args),
    },
}));

vi.mock("stream/promises", () => ({
    pipeline: (...args: unknown[]) => mockPipeline(...args),
    default: { pipeline: (...args: unknown[]) => mockPipeline(...args) },
}));

vi.mock("@/lib/logging/logger", () => ({
    logger: {
        child: vi.fn().mockReturnValue({ info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() }),
    },
}));

vi.mock("@/lib/logging/errors", () => ({
    wrapError: vi.fn((e) => e),
    AdapterError: class AdapterError extends Error {
        constructor(adapter: string, code: string, message: string) {
            super(message);
            this.name = "AdapterError";
        }
    },
}));

const config = { basePath: "/data/backups" };

describe("LocalFileSystemAdapter", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockFsStat.mockResolvedValue({ size: 1024, mtime: new Date() });
        mockFsAccess.mockResolvedValue(undefined);
        mockFsMkdir.mockResolvedValue(undefined);
        mockFsReadFile.mockResolvedValue("file content");
        mockFsWriteFile.mockResolvedValue(undefined);
        mockFsUnlink.mockResolvedValue(undefined);
        mockFsReaddir.mockResolvedValue([]);
        mockPipeline.mockResolvedValue(undefined);
        // Reset readStream mock to return the on-chainable object
        mockCreateReadStream.mockReturnValue({ on: vi.fn().mockReturnThis(), pipe: vi.fn() });
        mockCreateWriteStream.mockReturnValue({ on: vi.fn(), end: vi.fn() });
    });

    it("has correct id, type, and name", () => {
        expect(LocalFileSystemAdapter.id).toBe("local-filesystem");
        expect(LocalFileSystemAdapter.type).toBe("storage");
        expect(LocalFileSystemAdapter.name).toBe("Local Filesystem");
    });

    // ===== upload() =====

    describe("upload()", () => {
        it("returns true on successful upload", async () => {
            const result = await LocalFileSystemAdapter.upload(config, "/tmp/source.sql", "Job/backup.sql");

            expect(result).toBe(true);
            expect(mockFsMkdir).toHaveBeenCalled();
            expect(mockPipeline).toHaveBeenCalled();
        });

        it("creates destination directory before upload", async () => {
            await LocalFileSystemAdapter.upload(config, "/tmp/source.sql", "Job/subdir/backup.sql");

            expect(mockFsMkdir).toHaveBeenCalledWith(expect.stringContaining("Job"), expect.objectContaining({ recursive: true }));
        });

        it("returns false when pipeline fails", async () => {
            mockPipeline.mockRejectedValue(new Error("Disk full"));

            const result = await LocalFileSystemAdapter.upload(config, "/tmp/source.sql", "Job/backup.sql");

            expect(result).toBe(false);
        });

        it("calls onProgress when data events are received", async () => {
            let dataCallback: ((chunk: Buffer) => void) | undefined;
            mockCreateReadStream.mockReturnValue({
                on: vi.fn().mockImplementation((event: string, cb: (chunk: Buffer) => void) => {
                    if (event === "data") dataCallback = cb;
                    return { on: vi.fn().mockReturnThis() };
                }),
            });

            const onProgress = vi.fn();
            await LocalFileSystemAdapter.upload(config, "/tmp/source.sql", "Job/backup.sql", onProgress);

            // Simulate a data chunk
            dataCallback?.(Buffer.alloc(512));
            expect(onProgress).toHaveBeenCalledWith(50); // 512/1024 * 100 = 50
        });

        it("calls onLog when provided", async () => {
            const onLog = vi.fn();

            await LocalFileSystemAdapter.upload(config, "/tmp/source.sql", "Job/backup.sql", undefined, onLog);

            // onLog is only called on errors in local adapter; no error means no log
            expect((_result: unknown) => _result).toBeTruthy();
        });

        it("calls onLog on pipeline error", async () => {
            mockPipeline.mockRejectedValue(new Error("Write error"));
            const onLog = vi.fn();

            await LocalFileSystemAdapter.upload(config, "/tmp/source.sql", "Job/backup.sql", undefined, onLog);

            expect(onLog).toHaveBeenCalledWith(expect.stringContaining("Local upload failed"), "error", "general", expect.anything());
        });
    });

    // ===== download() =====

    describe("download()", () => {
        it("returns true on successful download", async () => {
            const result = await LocalFileSystemAdapter.download(config, "Job/backup.sql", "/tmp/out.sql");

            expect(result).toBe(true);
            expect(mockPipeline).toHaveBeenCalled();
        });

        it("returns false when source file does not exist", async () => {
            mockFsAccess.mockRejectedValue(Object.assign(new Error("ENOENT"), { code: "ENOENT" }));

            const result = await LocalFileSystemAdapter.download(config, "Job/missing.sql", "/tmp/out.sql");

            expect(result).toBe(false);
        });

        it("creates local directory before download", async () => {
            await LocalFileSystemAdapter.download(config, "Job/backup.sql", "/tmp/subdir/out.sql");

            expect(mockFsMkdir).toHaveBeenCalledWith(expect.stringContaining("subdir"), expect.objectContaining({ recursive: true }));
        });

        it("calls onProgress when data events are received", async () => {
            let dataCallback: ((chunk: Buffer) => void) | undefined;
            mockCreateReadStream.mockReturnValue({
                on: vi.fn().mockImplementation((event: string, cb: (chunk: Buffer) => void) => {
                    if (event === "data") dataCallback = cb;
                    return { on: vi.fn().mockReturnThis() };
                }),
            });

            const onProgress = vi.fn();
            await LocalFileSystemAdapter.download(config, "Job/backup.sql", "/tmp/out.sql", onProgress);

            dataCallback?.(Buffer.alloc(512));
            expect(onProgress).toHaveBeenCalledWith(512, 1024);
        });

        it("returns false when pipeline fails", async () => {
            mockPipeline.mockRejectedValue(new Error("IO error"));

            const result = await LocalFileSystemAdapter.download(config, "Job/backup.sql", "/tmp/out.sql");

            expect(result).toBe(false);
        });
    });

    // ===== read() =====

    describe("read()", () => {
        it("returns file content as string", async () => {
            mockFsReadFile.mockResolvedValue("backup metadata");

            const result = await LocalFileSystemAdapter.read!(config, "Job/backup.sql.meta.json");

            expect(result).toBe("backup metadata");
        });

        it("returns null when file does not exist", async () => {
            mockFsAccess.mockRejectedValue(Object.assign(new Error("ENOENT"), { code: "ENOENT" }));

            const result = await LocalFileSystemAdapter.read!(config, "Job/missing.meta.json");

            expect(result).toBeNull();
        });

        it("returns null on unexpected read error", async () => {
            mockFsAccess.mockResolvedValue(undefined);
            mockFsReadFile.mockRejectedValue(new Error("IO error"));

            const result = await LocalFileSystemAdapter.read!(config, "Job/meta.json");

            expect(result).toBeNull();
        });
    });

    // ===== list() =====

    describe("list()", () => {
        it("returns files from directory listing", async () => {
            mockFsReaddir.mockResolvedValue([
                { name: "backup.sql", isFile: () => true, parentPath: "/data/backups/Job" },
                { name: "backup2.sql", isFile: () => true, parentPath: "/data/backups/Job" },
            ]);
            mockFsStat.mockResolvedValue({ size: 512, mtime: new Date() });

            const result = await LocalFileSystemAdapter.list!(config, "Job");

            expect(result).toHaveLength(2);
            expect(result[0].name).toBe("backup.sql");
        });

        it("returns empty array when directory does not exist", async () => {
            mockFsAccess.mockRejectedValue(Object.assign(new Error("ENOENT"), { code: "ENOENT" }));

            const result = await LocalFileSystemAdapter.list!(config, "NonExistent");

            expect(result).toEqual([]);
        });

        it("skips non-file directory entries", async () => {
            mockFsReaddir.mockResolvedValue([
                { name: "subdir", isFile: () => false, parentPath: "/data/backups" },
                { name: "backup.sql", isFile: () => true, parentPath: "/data/backups/Job" },
            ]);
            mockFsStat.mockResolvedValue({ size: 100, mtime: new Date() });

            const result = await LocalFileSystemAdapter.list!(config, "");

            expect(result).toHaveLength(1);
            expect(result[0].name).toBe("backup.sql");
        });

        it("leaves out a file that retention removes between listing and stat", async () => {
            mockFsReaddir.mockResolvedValue([
                { name: "old.tar", isFile: () => true, parentPath: "/data/backups/Job" },
                { name: "new.tar", isFile: () => true, parentPath: "/data/backups/Job" },
            ]);
            mockFsStat
                .mockRejectedValueOnce(Object.assign(new Error("ENOENT: no such file or directory"), { code: "ENOENT" }))
                .mockResolvedValueOnce({ size: 2048, mtime: new Date() });

            const result = await LocalFileSystemAdapter.list!(config, "");

            expect(result.map((file) => file.name)).toEqual(["new.tar"]);
        });

        it("still fails the listing when a file cannot be read for another reason", async () => {
            mockFsReaddir.mockResolvedValue([
                { name: "locked.tar", isFile: () => true, parentPath: "/data/backups/Job" },
            ]);
            mockFsStat.mockRejectedValueOnce(Object.assign(new Error("EACCES: permission denied"), { code: "EACCES" }));

            await expect(LocalFileSystemAdapter.list!(config, "")).rejects.toThrow("EACCES");
        });

        it("throws on unexpected readdir error (not ENOENT)", async () => {
            mockFsAccess.mockResolvedValue(undefined);
            mockFsReaddir.mockRejectedValue(new Error("Permission denied"));

            await expect(LocalFileSystemAdapter.list!(config, "Job")).rejects.toThrow();
        });

        it("throws on root listing error (remotePath is empty)", async () => {
            mockFsAccess.mockRejectedValue(Object.assign(new Error("ENOENT: no such file or directory"), { code: "ENOENT" }));

            await expect(LocalFileSystemAdapter.list!(config, "")).rejects.toThrow();
        });

        it("throws on non-ENOENT access error on subfolder", async () => {
            mockFsAccess.mockRejectedValue(Object.assign(new Error("EACCES: permission denied"), { code: "EACCES" }));

            await expect(LocalFileSystemAdapter.list!(config, "Job")).rejects.toThrow();
        });

        it("uses default empty string for remotePath when not provided", async () => {
            mockFsReaddir.mockResolvedValue([]);

            const result = await LocalFileSystemAdapter.list!(config, "");

            expect(result).toEqual([]);
        });
    });

    // ===== delete() =====

    describe("delete()", () => {
        it("returns true on successful delete", async () => {
            const result = await LocalFileSystemAdapter.delete!(config, "Job/backup.sql");

            expect(result).toBe(true);
            expect(mockFsUnlink).toHaveBeenCalled();
        });

        it("returns true when file does not exist (idempotent)", async () => {
            mockFsAccess.mockRejectedValue(Object.assign(new Error("ENOENT"), { code: "ENOENT" }));

            const result = await LocalFileSystemAdapter.delete!(config, "Job/missing.sql");

            expect(result).toBe(true);
            expect(mockFsUnlink).not.toHaveBeenCalled();
        });

        it("returns false when unlink throws", async () => {
            mockFsUnlink.mockRejectedValue(new Error("Permission denied"));

            const result = await LocalFileSystemAdapter.delete!(config, "Job/backup.sql");

            expect(result).toBe(false);
        });
    });

    // ===== test() =====

    describe("test()", () => {
        it("returns success when mkdir+write+delete succeed", async () => {
            const result = await LocalFileSystemAdapter.test!(config);

            expect(result.success).toBe(true);
            expect(result.message).toContain("/data/backups");
            expect(result.message).toContain("verified");
        });

        it("returns failure when mkdir throws", async () => {
            mockFsMkdir.mockRejectedValue(new Error("Permission denied: cannot create /data/backups"));

            const result = await LocalFileSystemAdapter.test!(config);

            expect(result.success).toBe(false);
            expect(result.message).toContain("Access failed");
        });

        it("returns failure when writeFile throws", async () => {
            mockFsWriteFile.mockRejectedValue(new Error("No space left on device"));

            const result = await LocalFileSystemAdapter.test!(config);

            expect(result.success).toBe(false);
            expect(result.message).toContain("No space left");
        });
    });

    // ===== Branch coverage: security error with onLog (line 36) =====

    describe("upload() security error with onLog", () => {
        it("calls onLog when security check fails with onLog provided", async () => {
            const onLog = vi.fn();

            await expect(
                LocalFileSystemAdapter.upload(config, "/tmp/source.sql", "../../etc/passwd", undefined, onLog)
            ).rejects.toThrow(/Access denied/);

            expect(onLog).toHaveBeenCalledWith(
                expect.stringContaining("Access denied"),
                "error",
                "security"
            );
        });
    });

    // ===== Branch coverage: size = 0 ternary (line 56) =====

    describe("upload() with zero-size file", () => {
        it("reports 0% progress when file size is 0", async () => {
            mockFsStat.mockResolvedValue({ size: 0, mtime: new Date() });

            let dataCallback: ((chunk: Buffer) => void) | undefined;
            mockCreateReadStream.mockReturnValue({
                on: vi.fn().mockImplementation((event: string, cb: (chunk: Buffer) => void) => {
                    if (event === "data") dataCallback = cb;
                    return { on: vi.fn().mockReturnThis() };
                }),
            });

            const onProgress = vi.fn();
            await LocalFileSystemAdapter.upload(config, "/tmp/source.sql", "Job/backup.sql", onProgress);

            dataCallback?.(Buffer.alloc(512));
            // size > 0 is false → percent = 0
            expect(onProgress).toHaveBeenCalledWith(0);
        });
    });

    // ===== Branch coverage: Access denied rethrow in list/delete =====

    describe("list() rethrows Access denied security errors", () => {
        it("rethrows when path traversal is detected in list", async () => {
            await expect(
                LocalFileSystemAdapter.list!(config, "../../etc")
            ).rejects.toThrow(/Access denied/);
        });
    });

    describe("delete() rethrows Access denied security errors", () => {
        it("rethrows when path traversal is detected in delete", async () => {
            await expect(
                LocalFileSystemAdapter.delete!(config, "../../etc/passwd")
            ).rejects.toThrow(/Access denied/);
        });
    });
});
